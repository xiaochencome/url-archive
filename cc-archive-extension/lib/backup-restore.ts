/**
 * 书签备份恢复决策层（纯函数）。
 *
 * 背景：这个扩展会激进地批量删除浏览器书签（见 `lib/bookmark-cleaner.ts`），
 * 所以必须能从一份 JSON 备份里把书签**恢复**回去。备份文件是一个对象数组：
 *
 *   [{ id, guid, title, url, folder, date_added }]
 *
 * 其中 `id` / `guid` 来自**旧**的书签树，Chrome 新建书签时会重新分配，**不能复用**；
 * 真正有意义的只有 `title` / `url` / `folder`。`date_added` 是 Chrome/WebKit 时间戳
 * （1601-01-01 起的微秒数），只作为可选元数据保留。
 *
 * 本模块只做「解析备份 → 和当前书签比对 → 给出恢复计划」的纯决策，方便单测；
 * 真正的 `chrome.bookmarks.create()` 由调用方执行。
 *
 * **重要：本模块必须保持纯净——不碰 `chrome.*`、不碰 DOM、不碰网络（fetch）。**
 * 这样它才能在 node 环境下直接单测，也才能被任意入口（新标签页 / options / popup）复用。
 */

/** 备份文件里的一条记录（已清洗，只保留可复用字段） */
export interface BackupEntry {
  title: string;
  url: string;
  /** 'Bookmarks Bar/study' 风格的文件夹路径，可能为 '' */
  folder: string;
  /** Chrome/WebKit 时间戳字符串（微秒，1601 起算），可选元数据 */
  dateAdded?: string;
}

/** 经过比对、确认需要（或不需要）恢复的候选条目 */
export interface RestoreCandidate extends BackupEntry {
  /** 归一化后的 URL，用于与现有书签比对 */
  key: string;
  /** 文件夹路径拆成的一段段，供逐级创建 */
  path: string[];
}

/** 一次恢复的完整计划 */
export interface RestorePlan {
  /** 备份里、当前浏览器中已不存在的（即需要恢复的） */
  missing: RestoreCandidate[];
  /** 备份里、当前仍然存在的（跳过） */
  existing: RestoreCandidate[];
  /** 备份里被丢弃的无效条目（无 url / 非 http(s) / 重复） */
  invalid: number;
  summary: { backupTotal: number; missing: number; existing: number; invalid: number };
}

/**
 * 文件夹最大层级。
 * 备份可能来自别的工具或被人工改坏，出现 `a/b/c/.../z` 这种荒谬路径时，
 * 截断总比在浏览器里建出一棵几十层深的树要好。
 */
export const MAX_FOLDER_DEPTH = 8;

/**
 * 追踪参数：**精确名** + **前缀名**分开判断。
 *
 * 这里刻意复制了 `lib/curator.ts` 的 `normalizeCuratorUrl` 思路，而**不 import**：
 * 两个模块的演进方向不同——curator 关心「去重后打分」，本模块关心「恢复时别误判成已存在」，
 * 需求可能会分叉（比如本模块将来要处理 Chrome 导出格式的特有参数）。
 * 复制这一小段，好过让两个模块互相锁死。
 *
 * 注意：必须用「精确名集合」而不是单个前缀正则——`refresh` 撞 `ref`、`fromage` 撞 `from`，
 * 用前缀匹配会把正常参数误删，导致两个不同页面被当成同一个 URL。
 */
const TRACKING_PARAM_EXACT = new Set([
  'ref', 'from', 'spm', 'source', 'fbclid', 'gclid',
  'scene', '_t', 'share', 'share_source', 'share_medium', 'share_plat', 'share_tag', 'wt_mc',
]);
const TRACKING_PARAM_PREFIX = ['utm_', 'share_', 'spm_', 'ref_', 'mc_', 'pk_'];

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_EXACT.has(lower)) return true;
  return TRACKING_PARAM_PREFIX.some((prefix) => lower.startsWith(prefix));
}

/**
 * 归一化 URL，作为「是不是同一条书签」的比较键：小写、去 hash、去追踪参数、
 * 去末尾斜杠、去掉默认端口（:80 / :443）。
 *
 * 非法输入绝不抛错，退化成「去空白 + 小写」的字符串——哪怕输入是 null/undefined，
 * 也只返回空串。调用方据此永远拿得到可比较的键。
 */
export function normalizeUrlKey(url: string): string {
  // 参数类型是 string，但运行时可能被 JS 调用方塞进非字符串；这里做防御性收口。
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    parsed.hash = '';

    // 删追踪参数
    const drop = [...parsed.searchParams.keys()].filter(isTrackingParam);
    for (const key of drop) parsed.searchParams.delete(key);
    const query = parsed.searchParams.toString();

    // URL 通常已经吃掉了默认端口，这里再显式兜一层，防止个别运行时不规范
    const protocol = parsed.protocol.toLowerCase();
    const host = parsed.hostname.toLowerCase();
    const port = parsed.port;
    const isDefaultPort = (protocol === 'https:' && port === '443') || (protocol === 'http:' && port === '80');
    const authority = port && !isDefaultPort ? `${host}:${port}` : host;

    const path = parsed.pathname.replace(/\/+$/, '');
    return `${protocol}//${authority}${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    // 非法 URL（'not a url' / 'example.com' / 空串等）走这里，绝不抛错
    return raw.toLowerCase();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 读一个字段并 trim；非字符串一律当空串 */
function readString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** 只接受能解析出 http/https 协议的绝对 URL */
function isUsableHttpUrl(url: string): boolean {
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 兼容两种外壳：裸数组，或 `{ bookmarks: [...] }` 包装。
 * 其它任何输入（null / 字符串 / 数字 / 对象但没有 bookmarks）都当空数组，不抛错。
 */
function extractRawEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.bookmarks)) return value.bookmarks;
  return [];
}

/**
 * 解析备份内容。
 *
 * - 接受裸数组与 `{ bookmarks: [...] }` 两种外壳；
 * - 丢掉没有可用 http(s) url 的条目；
 * - 按归一化 URL 去重（**先出现的赢**，保持备份原始顺序）；
 * - 所有字符串字段 trim，`folder` 缺省为 `''`；
 * - `dateAdded` 同时兼容 `dateAdded` 与 Chrome 导出常见的 `date_added`。
 *
 * `invalid` 统计的是「原始条目里被丢弃的条数」（含无效对象与重复项），
 * 因此恒有 `entries.length + invalid === 原始条目数`。
 */
export function parseBackup(value: unknown): { entries: BackupEntry[]; invalid: number } {
  const raw = extractRawEntries(value);
  const entries: BackupEntry[] = [];
  const seen = new Set<string>();
  let invalid = 0;

  for (const item of raw) {
    if (!isRecord(item)) {
      invalid++;
      continue;
    }

    const url = readString(item, 'url');
    if (!isUsableHttpUrl(url)) {
      invalid++;
      continue;
    }

    const key = normalizeUrlKey(url);
    if (seen.has(key)) {
      // 备份里重复出现的同一条，只保留第一次
      invalid++;
      continue;
    }
    seen.add(key);

    const title = readString(item, 'title');
    const folder = readString(item, 'folder');
    // 真实备份里是 date_added（Chrome 导出风格），接口里叫 dateAdded，两个都认
    const dateAdded = readString(item, 'dateAdded') || readString(item, 'date_added');

    entries.push(dateAdded ? { title, url, folder, dateAdded } : { title, url, folder });
  }

  return { entries, invalid };
}

/**
 * 拆文件夹路径：按 '/' 分段、逐段 trim、丢掉空段，并截断到 `MAX_FOLDER_DEPTH`。
 * 空串、'/'、'a//b'、'  /  ' 这类输入都只产出干净的非空段。
 */
export function folderSegments(folder: string): string[] {
  const raw = typeof folder === 'string' ? folder : '';
  return raw
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .slice(0, MAX_FOLDER_DEPTH);
}

/**
 * 生成恢复计划：把备份和「当前浏览器里已有的书签 URL」比对。
 *
 * 比对走 `normalizeUrlKey`，所以只差追踪参数（utm_* / fbclid / ref…）或末尾斜杠的
 * URL 会被判定为**已存在**，不会重复创建。`missing` / `existing` 保持备份原始顺序，
 * 输出稳定可测。
 */
export function planRestore(backup: unknown, currentBookmarkUrls: string[]): RestorePlan {
  const { entries, invalid } = parseBackup(backup);

  const currentKeys = new Set<string>();
  for (const url of currentBookmarkUrls ?? []) {
    const key = normalizeUrlKey(url);
    if (key) currentKeys.add(key);
  }

  const missing: RestoreCandidate[] = [];
  const existing: RestoreCandidate[] = [];

  for (const entry of entries) {
    const candidate: RestoreCandidate = {
      ...entry,
      key: normalizeUrlKey(entry.url),
      path: folderSegments(entry.folder),
    };
    if (currentKeys.has(candidate.key)) existing.push(candidate);
    else missing.push(candidate);
  }

  return {
    missing,
    existing,
    invalid,
    summary: {
      // 原始备份条数 = 有效条目 + 被丢弃的无效条目
      backupTotal: entries.length + invalid,
      missing: missing.length,
      existing: existing.length,
      invalid,
    },
  };
}

/**
 * 按文件夹分组，供 UI 展示「将恢复到哪些文件夹」。
 * 组名用归一化后的路径（`folderSegments` 拼回），空文件夹固定排在最后。
 */
export function groupByFolder(items: RestoreCandidate[]): { folder: string; items: RestoreCandidate[] }[] {
  const groups = new Map<string, RestoreCandidate[]>();

  for (const item of items) {
    const folder = folderSegments(item.folder).join('/');
    const list = groups.get(folder);
    if (list) list.push(item);
    else groups.set(folder, [item]);
  }

  return [...groups.entries()]
    .map(([folder, grouped]) => ({ folder, items: grouped }))
    .sort((a, b) => {
      // 没有文件夹的（直接建在根下）排最后，其余按中文/拼音顺序
      if (a.folder === '' && b.folder !== '') return 1;
      if (b.folder === '' && a.folder !== '') return -1;
      return a.folder.localeCompare(b.folder, 'zh');
    });
}

/**
 * 一句中文摘要，直接展示给用户。
 * 覆盖三种情况：空备份、无需恢复（都已存在）、有可恢复项；全无有效条目时单独措辞，
 * 避免出现「备份 0 条，其中 0 条…」这种别扭句子。
 */
export function formatRestoreSummary(plan: RestorePlan): string {
  const { backupTotal, missing, existing, invalid } = plan.summary;

  if (backupTotal <= 0) return '备份为空，没有可恢复的书签。';

  if (missing <= 0) {
    if (existing <= 0) return `备份 ${backupTotal} 条，但没有可恢复的有效书签。`;
    return `备份 ${backupTotal} 条，浏览器中都已存在，无需恢复。`;
  }

  return `备份 ${backupTotal} 条，其中 ${missing} 条已不在浏览器中，可恢复。`;
}
