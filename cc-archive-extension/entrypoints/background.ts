import { loadSettings } from '@/lib/settings';
import { enrichClip, recallQuery } from '@/lib/llm';
import { createVaultWriter, resolveVaultEndpoint } from '@/lib/vault';
import { ClipQueue } from '@/lib/queue';
import { runLegacyMigration } from '@/lib/legacy-migration';
import { captureClipFast, enrichAndRewrite } from '@/lib/capture';
import { clipsFromBookmarkTree, formatFolderDisplay, parseFolderSegments } from '@/lib/bookmarks';
import { canonicalizeUrl } from '@/lib/markdown';
import { SAVED_CLIPS_KEY } from '@/lib/revisit';
import { planCleanup, type CleanupPlan } from '@/lib/bookmark-cleaner';
import { parseBackup, planRestore, folderSegments, type RestorePlan } from '@/lib/backup-restore';
import { buildDashboardData } from '@/lib/dashboard';
import { loadNewTabPrefs, saveNewTabPrefs } from '@/lib/preferences';
import {
  getSavedClipStats,
  getBookmarkFolders,
  loadSavedClips,
  pickRevisitClips,
  recordRevisit,
  deleteSavedClip,
  saveClipForRevisit,
  saveClipsForRevisit,
  searchSavedClips,
  type ClipFilter,
  updateSavedClip,
} from '@/lib/revisit';
import type { ClipData } from '@/lib/types';
import type { NewTabPrefs } from '@/lib/preferences';
import {
  isExtensionNewTab,
  resolveNewTabRedirect,
  shouldRedirectNewTab,
} from '@/lib/newtab-control';
import type { EnrichStatus } from '@/lib/enrich-status';
import { hasOriginAccess, originPattern, MissingHostPermissionError } from '@/lib/permissions';

type ExtractResult = {
  title: string;
  contentMarkdown: string;
  selection: string;
};

const CONTENT_SCRIPT_FILE = 'content-scripts/content.js';
const QUEUE_FLUSH_ALARM = 'cc-archive-flush-queue';
/** 本机 host 卡住时不能让启动器永远转圈 */
const NATIVE_PING_TIMEOUT_MS = 3000;
const NATIVE_RUN_TIMEOUT_MS = 8000;
let newTabPrefsSaveQueue: Promise<unknown> = Promise.resolve();

export default defineBackground(() => {
  const queue = new ClipQueue();

  // 启动时先尝试把离线队列写回 vault；旧库数据搬家必须在队列读取前完成，
  // 否则刚搬进来的暂存项要等下一次 alarm（5 分钟）才会被冲掉。
  void runLegacyMigration()
    .then(() => flushQueue(queue))
    .catch((error) => console.warn('[cc-archive] 启动冲队列失败', error));

  // worker 活着的时候不会重新执行入口代码，所以光靠启动 flush 是不够的：
  // Obsidian 恢复后必须有个定时器把队列补写掉，否则笔记会一直停在「已暂存」。
  chrome.alarms?.onAlarm?.addListener((alarm) => {
    if (alarm.name === QUEUE_FLUSH_ALARM) void flushQueue(queue);
  });
  chrome.alarms?.create?.(QUEUE_FLUSH_ALARM, { periodInMinutes: 5 });

  // 「关闭新标签页接管」：manifest 的 chrome_url_overrides 无法在运行时撤销，
  // 因此改为在新建标签页时把扩展覆盖页重定向到用户指定的主页。
  chrome.tabs.onCreated.addListener((tab) => {
    void redirectNewTabIfDisabled(tab);
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'CAPTURE') {
      handleCapture(msg.why ?? '', queue)
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse(captureErrorResponse(e)));
      return true; // 异步
    }
    if (msg?.type === 'CAPTURE_LAST_ACTIVE') {
      handleCaptureLastActive(msg.why ?? '', queue)
        .then((r) => sendResponse({ ok: true, ...r }))
        .catch((e) => sendResponse(captureErrorResponse(e)));
      return true;
    }
    if (msg?.type === 'GET_LAST_ACTIVE_ORIGIN') {
      handleLastActiveOrigin()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'SUGGEST_REVISIT') {
      handleSuggestRevisit()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'OPEN_REVISIT') {
      handleOpenRevisit(String(msg.url ?? ''))
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'SEARCH_CLIPS') {
      handleSearchClips(
        String(msg.query ?? ''),
        String(msg.filter ?? 'all') as ClipFilter,
        String(msg.folder ?? ''),
        Number(msg.limit ?? 20),
      )
        .then((clips) => sendResponse({ ok: true, clips }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'GET_DASHBOARD_DATA') {
      handleDashboardData(String(msg.query ?? ''), String(msg.folder ?? ''))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'AI_RECALL') {
      handleAIRecall(String(msg.query ?? ''), String(msg.folder ?? ''))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'LOAD_NEW_TAB_PREFS') {
      loadNewTabPrefs()
        .then((prefs) => sendResponse({ ok: true, prefs }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'SAVE_NEW_TAB_PREFS') {
      handleSaveNewTabPrefs(msg.update ?? msg.prefs ?? {})
        .then((prefs) => sendResponse({ ok: true, prefs }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'BOOKMARK_FOLDERS') {
      handleBookmarkFolders()
        .then((folders) => sendResponse({ ok: true, folders }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'SAVED_CLIP_STATS') {
      handleSavedClipStats()
        .then((stats) => sendResponse({ ok: true, stats }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'IMPORT_BROWSER_BOOKMARKS') {
      handleImportBrowserBookmarks()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'PLAN_BOOKMARK_CLEANUP') {
      planBookmarkCleanup()
        .then((plan) => sendResponse({ ok: true, plan }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'APPLY_BOOKMARK_CLEANUP') {
      applyBookmarkCleanup(Array.isArray(msg.ids) ? msg.ids as string[] : [])
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'CREATE_BOOKMARK_GROUP') {
      createBookmarkGroup(String(msg.name ?? ''))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'LAUNCH_APP') {
      runNativeCommand(String(msg.command ?? ''))
        .then((result) => sendResponse(result))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'LAUNCHER_AVAILABLE') {
      pingNativeHost()
        .then((available) => sendResponse({ ok: true, available }))
        .catch(() => sendResponse({ ok: true, available: false }));
      return true;
    }
    if (msg?.type === 'ADD_BROWSER_BOOKMARK') {
      addBrowserBookmark(msg.bookmark ?? {})
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'DELETE_BROWSER_BOOKMARK') {
      deleteBrowserBookmarkByUrl(String(msg.url ?? ''))
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'EXPORT_BOOKMARKS') {
      exportBrowserBookmarks()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'PLAN_BOOKMARK_RESTORE') {
      planBookmarkRestore(msg.backup)
        .then((plan) => sendResponse({ ok: true, plan }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'APPLY_BOOKMARK_RESTORE') {
      applyBookmarkRestore(msg.backup)
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'UPDATE_SAVED_CLIP') {
      updateSavedClip(msg.update ?? {})
        .then((clip) => sendResponse({ ok: Boolean(clip), clip, error: clip ? undefined : '未找到要编辑的收藏' }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
    if (msg?.type === 'DELETE_SAVED_CLIP') {
      deleteSavedClip(msg.target ?? {})
        .then((deleted) => sendResponse({ ok: deleted, deleted, error: deleted ? undefined : '未找到要删除的收藏' }))
        .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
      return true;
    }
  });
});

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 关闭接管后，把落在扩展新标签页上的标签页跳转到用户主页。
 * 只在确实命中我们自己的新标签页时动作，避免影响其它导航。
 */
async function redirectNewTabIfDisabled(tab: chrome.tabs.Tab): Promise<void> {
  try {
    const extensionOrigin = chrome.runtime.getURL('');
    const url = tab.pendingUrl || tab.url;
    if (!isExtensionNewTab(url, extensionOrigin)) return;

    const prefs = await loadNewTabPrefs();
    if (!shouldRedirectNewTab({ pendingUrl: tab.pendingUrl, url: tab.url }, extensionOrigin, prefs)) return;

    const target = resolveNewTabRedirect(prefs);
    if (!target) return;
    if (!tab.id) return;

    // 刚创建时 URL 可能仍在 pending，稍等一拍再跳，避免被后续导航覆盖
    await new Promise((resolve) => setTimeout(resolve, 0));
    await chrome.tabs.update(tab.id, { url: target });
  } catch {
    // 重定向失败不影响其它功能（例如标签页已被用户关闭）
  }
}

// 剪藏失败响应：缺 host 权限时回传具体 origin，供弹出页只申请缺失端点（而非全站）
function captureErrorResponse(error: unknown) {
  const base = { ok: false as const, error: getErrorMessage(error) };
  return error instanceof MissingHostPermissionError ? { ...base, missingOrigin: error.origin } : base;
}

function canInjectIntoTab(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

async function requestExtract(tab: chrome.tabs.Tab): Promise<ExtractResult> {
  if (!tab.id) throw new Error('无法获取当前标签页');
  if (!canInjectIntoTab(tab.url)) {
    throw new Error('当前页面不支持剪藏：请在普通 http/https 网页中使用');
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch (injectError) {
    throw new Error(`无法在当前页面注入剪藏脚本：${getErrorMessage(injectError)}`);
  }
  return await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT' }) as ExtractResult;
}

// 写 vault 前确认已授权对应 host；缺失则抛 MissingHostPermissionError（后台无手势，不能静默申请）
async function ensureVaultAccess(settings: Awaited<ReturnType<typeof loadSettings>>): Promise<void> {
  const origin = originPattern(resolveVaultEndpoint(settings).baseUrl);
  if (origin && !(await hasOriginAccess([origin]))) {
    throw new MissingHostPermissionError(origin);
  }
}

async function handleCapture(why: string, queue: ClipQueue) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return handleCaptureFromTab(tab, why, queue, '无法获取当前标签页');
}

async function handleCaptureLastActive(why: string, queue: ClipQueue) {
  const tab = await findMostRecentCapturableTab();
  return handleCaptureFromTab(
    tab,
    why,
    queue,
    '没有找到可剪藏的最近网页：请先打开一个普通 http/https 页面',
  );
}

async function handleCaptureFromTab(
  tab: chrome.tabs.Tab | undefined,
  why: string,
  queue: ClipQueue,
  missingMessage: string,
) {
  const settings = await loadSettings();
  if (!tab?.id) throw new Error(missingMessage);
  const extract = await requestExtract(tab);

  const clip: ClipData = {
    url: tab.url ?? '',
    title: extract.title || tab.title || '',
    selection: extract.selection,
    contentMarkdown: extract.contentMarkdown,
    clippedAt: new Date().toISOString(),
  };

  await ensureVaultAccess(settings);
  const writer = createVaultWriter(settings);

  // Phase A：秒级写入占位笔记，立即返回给弹出页
  const result = await captureClipFast(clip, why, settings, { writer, queue });
  await saveClipForRevisit(result.savedClip);

  // Phase B：后台补 AI 覆盖写（不 await，in-flight fetch 保活 SW；best-effort）
  void enrichInBackground(clip, why, settings, writer, queue, result.savedClip.canonicalUrl ?? result.savedClip.url);

  return result;
}

// 后台补 AI：成功则覆盖写回并更新索引；失败/中断则保留占位笔记（Phase A 已落盘，不丢失）。
// 完成后向弹出页广播状态，若弹出页已关闭则忽略。
async function enrichInBackground(
  clip: ClipData,
  why: string,
  settings: Awaited<ReturnType<typeof loadSettings>>,
  writer: ReturnType<typeof createVaultWriter>,
  queue: ClipQueue,
  canonicalUrl: string,
) {
  let status: EnrichStatus = 'skipped';
  let error: string | undefined;

  if (hasLlmConfig(settings)) {
    try {
      const llmOrigin = originPattern(settings.llmBaseUrl);
      if (llmOrigin && !(await hasOriginAccess([llmOrigin]))) {
        throw new MissingHostPermissionError(llmOrigin);
      }
      const enriched = await enrichAndRewrite(clip, why, settings, { enrich: enrichClip, writer, queue });
      await saveClipForRevisit(enriched.savedClip);
      status = 'done';
    } catch (e) {
      status = 'failed';
      error = describeEnrichError(e);
    }
  }

  notifyEnriched(canonicalUrl, status, error);
}

// 把补 AI 的失败原因转成可读文案；超时（AbortError）单独提示，便于用户判断是否需要更快的模型
function describeEnrichError(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return 'AI 请求超时';
    return error.message;
  }
  return String(error);
}

function hasLlmConfig(settings: Awaited<ReturnType<typeof loadSettings>>): boolean {
  return Boolean(settings.llmBaseUrl.trim() && settings.llmApiKey.trim() && settings.llmModel.trim());
}

function notifyEnriched(canonicalUrl: string, status: EnrichStatus, error?: string) {
  // 弹出页已关闭时无接收者，sendMessage 会 reject，忽略即可
  chrome.runtime.sendMessage({ type: 'CAPTURE_ENRICHED', canonicalUrl, status, error }).catch(() => undefined);
}

async function findMostRecentCapturableTab() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .filter((tab) => tab.id != null && canInjectIntoTab(tab.url))
    .sort((a, b) => (b.lastAccessed ?? 0) - (a.lastAccessed ?? 0))[0];
}

async function handleLastActiveOrigin() {
  const tab = await findMostRecentCapturableTab();
  if (!tab?.url) {
    throw new Error('没有找到可剪藏的最近网页：请先打开一个普通 http/https 页面');
  }
  const origin = originPattern(tab.url);
  if (!origin) {
    throw new Error('最近网页不支持剪藏：请使用普通 http/https 页面');
  }
  return { origin };
}

async function handleSaveNewTabPrefs(update: Partial<NewTabPrefs>) {
  const save = newTabPrefsSaveQueue.then(() => saveNewTabPrefs(update));
  newTabPrefsSaveQueue = save.catch(() => undefined);
  return save;
}

async function handleSuggestRevisit() {
  const clips = pickRevisitClips(await loadSavedClips(), 20);
  return { clip: clips[0] ?? null, clips };
}

async function handleOpenRevisit(url: string) {
  if (!url) throw new Error('缺少要打开的 URL');
  await recordRevisit(url);
  await chrome.tabs.create({ url });
}

async function handleSearchClips(query: string, filter: ClipFilter, folder: string, limit: number) {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 1000) : 20;
  return searchSavedClips(await loadSavedClips(), query, { filter, folder, limit: safeLimit });
}

async function handleDashboardData(query: string, folder: string) {
  const clips = await loadSavedClips();
  return buildDashboardData(clips, { query, folder });
}

async function handleAIRecall(query: string, folder: string) {
  const settings = await loadSettings();
  const llmOrigin = originPattern(settings.llmBaseUrl);
  if (llmOrigin && !(await hasOriginAccess([llmOrigin]))) {
    throw new MissingHostPermissionError(llmOrigin);
  }
  const recall = await recallQuery(query, settings);
  const clips = await loadSavedClips();
  let data = buildDashboardData(clips, { query: recall.query, folder });
  if (data.cards.length === 0 && recall.query !== query.trim()) {
    data = buildDashboardData(clips, { query, folder });
  }
  return { data, recall };
}

async function handleSavedClipStats() {
  return getSavedClipStats(await loadSavedClips());
}

async function handleBookmarkFolders() {
  return getBookmarkFolders(await loadSavedClips());
}

/**
 * 生成书签清理计划（只读，不动数据）。
 *
 * 为什么必须走 chrome.bookmarks API 而不是直接改文件：Chrome 的权威书签存储是
 * EncryptedBookmarks2（账号同步 + 加密），手改 Bookmarks 文件会在下次启动时被还原。
 */
async function planBookmarkCleanup(): Promise<CleanupPlan> {
  if (!chrome.bookmarks?.getTree) {
    throw new Error('当前浏览器不支持读取书签');
  }
  const tree = await chrome.bookmarks.getTree();
  return planCleanup(tree as unknown as Parameters<typeof planCleanup>[0]);
}

/** 执行清理：逐条调用 chrome.bookmarks.remove */
async function applyBookmarkCleanup(ids: string[]): Promise<{ removed: number; failed: number }> {
  if (!chrome.bookmarks?.remove) {
    throw new Error('当前浏览器不支持删除书签');
  }
  let removed = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      await chrome.bookmarks.remove(id);
      removed += 1;
    } catch {
      failed += 1;
    }
  }

  // 清理后重建索引：否则被删的书签仍留在工作台
  if (removed > 0) {
    await handleImportBrowserBookmarks().catch(() => undefined);
  }

  return { removed, failed };
}

/**
 * 在工作台里新增一个浏览器书签。
 * parentId 省略时放进「书签栏」；传 folder 则按路径逐级创建。
 */
async function addBrowserBookmark(input: {
  url?: unknown;
  title?: unknown;
  folder?: unknown;
}): Promise<{ id: string; folder: string }> {
  if (!chrome.bookmarks?.create) {
    throw new Error('当前浏览器不支持创建书签');
  }
  const url = String(input.url ?? '').trim();
  if (!/^https?:\/\//i.test(url)) {
    throw new Error('请填写以 http:// 或 https:// 开头的网址');
  }
  const title = String(input.title ?? '').trim() || url;

  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const barRoot = root.children?.find((c) => c.id === '1') ?? root.children?.[0];
  if (!barRoot) throw new Error('无法定位书签栏');

  // 去重：按规范化后的 URL 比较，否则尾斜杠和 utm 参数会造出重复书签
  const existing = new Set<string>();
  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const node of nodes) {
      if (node.url) existing.add(canonicalizeUrl(node.url));
      else if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  if (existing.has(canonicalizeUrl(url))) {
    throw new Error('这个网址已经在书签里了');
  }

  // 始终显式给出 parentId：省略时 Chrome 会丢进「其它书签」，用户在书签栏里根本看不到
  const segments = parseFolderSegments(String(input.folder ?? ''), barRoot.title ?? '');
  let parent = barRoot.id;
  for (const segment of segments) {
    const siblings = (await chrome.bookmarks.getChildren(parent)) ?? [];
    const found = siblings.find((c) => !c.url && (c.title ?? '').trim() === segment);
    parent = found ? found.id : (await chrome.bookmarks.create({ parentId: parent, title: segment })).id;
  }
  const created = await chrome.bookmarks.create({ title, url, parentId: parent });
  const folder = formatFolderDisplay(barRoot.title ?? '', segments);

  // 同步写入本地索引，否则新书签不会出现在工作台（数据源是 saved_clips）
  await saveClipForRevisit({
    url,
    canonicalUrl: canonicalizeUrl(url),
    title,
    domain: safeHostname(url),
    path: `browser-bookmarks/${created.id}.md`,
    source: 'bookmark',
    folder,
    faviconUrl: '',
    summary: folder ? `浏览器书签，位于：${folder}` : '浏览器书签',
    tags: ['浏览器书签'],
    keywords: [],
    aliases: title ? [title] : [],
    intent: folder ? `从浏览器书签文件夹「${folder}」找回` : '从浏览器书签找回',
    why: folder ? `导入自浏览器书签：${folder}` : '手动添加',
    clipped: new Date().toISOString(),
    queued: false,
    revived: 0,
    lastVisited: '',
  });

  return { id: created.id, folder };
}

/**
 * 新建一个书签分组（= 浏览器书签栏下的同名文件夹）。
 * 工作台的分组来自书签文件夹，所以建好文件夹再重新整理就会出现对应面板。
 */
async function createBookmarkGroup(name: string): Promise<{ id: string; existed: boolean }> {
  if (!chrome.bookmarks?.create || !chrome.bookmarks?.getTree) {
    throw new Error('当前浏览器不支持创建书签文件夹');
  }
  const trimmed = name.trim();
  if (!trimmed) throw new Error('分组名不能为空');
  if (trimmed.length > 40) throw new Error('分组名过长（最多 40 字）');

  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];
  const barRoot = root.children?.find((c) => c.id === '1') ?? root.children?.[0];
  if (!barRoot) throw new Error('无法定位书签栏');

  const siblings = await chrome.bookmarks.getChildren(barRoot.id);
  const found = siblings.find((c) => !c.url && (c.title ?? '').trim() === trimmed);
  if (found) return { id: found.id, existed: true };

  const created = await chrome.bookmarks.create({ parentId: barRoot.id, title: trimmed });
  return { id: created.id, existed: false };
}

/* ---------------------------------------------------- 启动器（Native Messaging） */

/** 本机 host 的名字，需与 native-host/install.sh 里注册的一致 */
const NATIVE_HOST = 'com.ccarchive.launcher';

/** 探测本机 host 是否可用 */
async function pingNativeHost(): Promise<boolean> {
  if (!chrome.runtime?.sendNativeMessage) return false;
  try {
    const res = await withTimeout(
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'ping' }),
      NATIVE_PING_TIMEOUT_MS,
      '本机启动器没有响应',
    );
    return Boolean(res?.ok && res.pong);
  } catch {
    return false;
  }
}

/** host 无响应时 Promise 永不 settle，这里兜一层超时 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/** 执行一条本地命令（危险模式由 host 端再做一次拦截） */
async function runNativeCommand(command: string): Promise<{ ok: boolean; pid?: number; error?: string }> {
  const cmd = command.trim();
  if (!cmd) return { ok: false, error: '命令为空' };
  if (!chrome.runtime?.sendNativeMessage) {
    return { ok: false, error: '当前浏览器不支持本机命令调用' };
  }
  try {
    const res = await withTimeout(
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { type: 'run', command: cmd }),
      NATIVE_RUN_TIMEOUT_MS,
      `本机启动器 ${NATIVE_RUN_TIMEOUT_MS / 1000} 秒没有响应`,
    );
    return res?.ok ? { ok: true, pid: res.pid } : { ok: false, error: res?.error ?? '执行失败' };
  } catch (error) {
    // 最常见的失败是「host 未安装」或「Chrome 未重启」
    return {
      ok: false,
      error: `无法调用本机启动器（请先运行 native-host/install.sh 并重启 Chrome）：${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** 取主机名，失败时回退空串（避免 URL 异常导致整条添加失败） */
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/** 按 URL 删除浏览器书签（可能有多条，全部删除） */
async function deleteBrowserBookmarkByUrl(url: string): Promise<{ removed: number; clipsCleared: number }> {
  if (!chrome.bookmarks?.search || !chrome.bookmarks?.remove) {
    throw new Error('当前浏览器不支持删除书签');
  }
  const trimmed = url.trim();
  if (!trimmed) throw new Error('缺少网址');

  const matches = await chrome.bookmarks.search({ url: trimmed });
  let removed = 0;
  for (const node of matches) {
    // 只删 URL 完全一致的，避免误删
    if (node.url !== trimmed) continue;
    try {
      await chrome.bookmarks.remove(node.id);
      removed += 1;
    } catch {
      // 已不存在则忽略
    }
  }

  // 关键：工作台的卡片读的是 saved_clips，不是实时的 chrome.bookmarks。
  // 不同步清理的话，浏览器书签删掉了但卡片还在（用户反馈的「删除后还在」）。
  const clipsCleared = await removeClipsByUrl(trimmed);

  return { removed, clipsCleared };
}

/**
 * 从 saved_clips 里移除指定 URL 的记录（含 canonicalUrl 匹配）。
 * 用于「浏览器书签已删，本地索引也要跟着删」的场景。
 */
async function removeClipsByUrl(url: string): Promise<number> {
  const clips = await loadSavedClips();
  const target = canonicalizeUrl(url);
  const next = clips.filter((clip) => {
    const clipCanonical = clip.canonicalUrl || clip.url;
    return clipCanonical !== target && clip.url !== url && clipCanonical !== url;
  });
  const removed = clips.length - next.length;
  if (removed > 0) {
    await chrome.storage.local.set({ [SAVED_CLIPS_KEY]: next });
  }
  return removed;
}

/** 导出全部浏览器书签为可再次导入的备份结构 */
async function exportBrowserBookmarks(): Promise<{ entries: unknown[]; total: number; exportedAt: string }> {
  if (!chrome.bookmarks?.getTree) {
    throw new Error('当前浏览器不支持读取书签');
  }
  const tree = await chrome.bookmarks.getTree();
  const entries: { title: string; url: string; folder: string; dateAdded?: string }[] = [];

  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[], folders: string[]) => {
    for (const node of nodes) {
      const name = (node.title ?? '').trim();
      if (node.url) {
        entries.push({
          title: name,
          url: node.url,
          folder: folders.join('/'),
          ...(node.dateAdded ? { dateAdded: String(node.dateAdded) } : {}),
        });
      } else if (node.children?.length) {
        walk(node.children, [...folders, name]);
      }
    }
  };
  walk(tree, []);

  return { entries, total: entries.length, exportedAt: new Date().toISOString() };
}

/** 只读：对比备份与当前书签，算出需要恢复哪些 */
async function planBookmarkRestore(backup: unknown): Promise<RestorePlan> {
  if (!chrome.bookmarks?.getTree) {
    throw new Error('当前浏览器不支持读取书签');
  }
  const tree = await chrome.bookmarks.getTree();
  const currentUrls: string[] = [];
  const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
    for (const node of nodes) {
      if (node.url) currentUrls.push(node.url);
      else if (node.children?.length) walk(node.children);
    }
  };
  walk(tree);
  return planRestore(backup, currentUrls);
}

/**
 * 执行恢复：按 folder 逐级创建文件夹，再创建书签。
 * Chrome 会为新节点分配 id，因此备份里的旧 id/guid 一律不使用。
 */
async function applyBookmarkRestore(backup: unknown): Promise<{ created: number; failed: number; folders: number }> {
  if (!chrome.bookmarks?.create) {
    throw new Error('当前浏览器不支持创建书签');
  }

  const plan = await planBookmarkRestore(backup);
  const tree = await chrome.bookmarks.getTree();
  const root = tree[0];

  // 默认书签栏 + 其它书签两个根
  const barRoot = root.children?.find((c) => c.id === '1') ?? root.children?.[0];
  const otherRoot = root.children?.find((c) => c.id === '2') ?? root.children?.[1] ?? barRoot;
  if (!barRoot || !otherRoot) {
    throw new Error('无法定位书签根目录');
  }

  // 文件夹路径 → id 缓存，避免重复创建
  const folderCache = new Map<string, string>();
  const ensureFolder = async (segments: string[], parentId: string): Promise<string> => {
    let parent = parentId;
    let pathKey = '';
    for (const segment of segments) {
      pathKey = pathKey ? `${pathKey}/${segment}` : segment;
      const cached = folderCache.get(pathKey);
      if (cached) { parent = cached; continue; }
      // 先找已存在的同名子文件夹
      const siblings = (await chrome.bookmarks.getChildren(parent)) ?? [];
      const found = siblings.find((c) => !c.url && (c.title ?? '').trim() === segment);
      if (found) {
        folderCache.set(pathKey, found.id);
        parent = found.id;
      } else {
        const created = await chrome.bookmarks.create({ parentId: parent, title: segment });
        folderCache.set(pathKey, created.id);
        parent = created.id;
      }
    }
    return parent;
  };

  let created = 0;
  let failed = 0;
  const usedFolders = new Set<string>();

  for (const item of plan.missing) {
    try {
      const segments = folderSegments(item.folder);
      // 「Bookmarks Bar」/「Other Bookmarks」这类根名不重建，直接映射到对应根
      const withoutRoot = segments.filter((seg, index) => {
        if (index !== 0) return true;
        const lower = seg.toLowerCase();
        return lower !== 'bookmarks bar' && lower !== 'bookmarks_bar' && lower !== '书签栏' && lower !== 'other bookmarks' && lower !== '其它书签' && lower !== '其他书签';
      });
      const useOtherRoot = /other bookmarks|其它书签|其他书签/i.test(segments[0] ?? '');
      const parentId = await ensureFolder(withoutRoot, useOtherRoot ? otherRoot.id : barRoot.id);
      if (withoutRoot.length) usedFolders.add(withoutRoot.join('/'));
      await chrome.bookmarks.create({ parentId, title: item.title || item.url, url: item.url });
      created += 1;
    } catch {
      failed += 1;
    }
  }

  // 恢复完成后重建本地索引，让工作台立刻看到恢复的书签
  if (created > 0) {
    await handleImportBrowserBookmarks().catch(() => undefined);
  }

  return { created, failed, folders: usedFolders.size };
}

async function handleImportBrowserBookmarks() {
  if (!chrome.bookmarks?.getTree) {
    throw new Error('当前浏览器不支持读取书签');
  }

  const tree = await chrome.bookmarks.getTree();
  const clips = clipsFromBookmarkTree(tree);
  const imported = await saveClipsForRevisit(clips);
  return { imported, total: clips.length };
}

async function flushQueue(queue: ClipQueue) {
  try {
    const settings = await loadSettings();
    if (!resolveVaultEndpoint(settings).token.trim()) return;
    const writer = createVaultWriter(settings);
    const items = await queue.getAll();
    if (items.length === 0) return;
    // 写成功后要把索引里的 queued 标记撤掉，否则那条剪藏永远挂着「已暂存」
    const clips = await loadSavedClips();
    let dirty = false;
    for (const item of items) {
      try {
        await writer.write(item.path, item.content);
      } catch {
        // 仍不可用，留待下次闹钟再来
        break;
      }
      if (item.id != null) await queue.remove(item.id);
      const index = clips.findIndex((clip) => clip.path === item.path);
      if (index >= 0 && clips[index].queued) {
        clips[index] = { ...clips[index], queued: false };
        dirty = true;
      }
    }
    if (dirty) await chrome.storage.local.set({ [SAVED_CLIPS_KEY]: clips });
  } catch {
    // 忽略：下次闹钟再试
  }
}
