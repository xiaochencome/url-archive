/**
 * 新标签页的扩展模块区：常用书签 / 标签整理 / GitHub 趋势小组件 / GitHub 项目。
 *
 * 这里只负责「渲染 + 交互」，数据来自 lib/tag-organizer、lib/github-trending、
 * lib/github-projects；main.ts 负责在合适的时机调用 renderPanels。
 */

import {
  buildTagStats,
  groupCardsByDomain,
  pickFrequentBookmarks,
  sortCards,
  type CardSortKey,
  type TagCard,
  type TagStat,
} from '@/lib/tag-organizer';
import {
  addGithubProject,
  githubProjectFromRepo,
  loadGithubProjects,
  removeGithubProject,
  updateGithubProject,
  type GithubProject,
} from '@/lib/github-projects';
import {
  createMemo,
  loadMemos,
  memoStats,
  MEMO_COLORS,
  removeMemo,
  saveMemos,
  sortMemos,
  toggleMemoDone,
  toggleMemoPinned,
  updateMemo,
  type Memo,
  type MemoColor,
} from '@/lib/memo';
import {
  groupLocalServices,
  portHint,
  type LocalServiceGroup,
} from '@/lib/local-services';
import {
  buildDefaultBoards,
  fetchTrending,
  type TrendingBoard,
  type TrendingRepo,
} from '@/lib/github-trending';

/** 面板需要的最小卡片结构（与 DashboardCard 兼容） */
export interface PanelCard extends TagCard {
  faviconUrl?: string;
  summary?: string;
  initial?: string;
  sourceLabel?: string;
}

let elementsRef: PanelElements | null = null;
let optionsRef: PanelOptions | null = null;

export interface PanelElements {
  memoBlock: HTMLElement;
  memoList: HTMLElement;
  memoHint: HTMLElement;
  memoInput: HTMLTextAreaElement;
  memoColors: HTMLElement;
  memoAdd: HTMLButtonElement;
  localBlock: HTMLElement;
  localGrid: HTMLElement;
  localHint: HTMLElement;
  frequentBlock: HTMLElement;
  frequentStrip: HTMLElement;
  frequentHint: HTMLElement;
  tagBlock: HTMLElement;
  tagCloud: HTMLElement;
  tagHint: HTMLElement;
  widgetBlock: HTMLElement;
  widgetGrid: HTMLElement;
  githubBlock: HTMLElement;
  githubGrid: HTMLElement;
  githubHint: HTMLElement;
}

export interface PanelOptions {
  /** 打开链接 */
  openUrl: (url: string) => void;
  /** 把标签写进搜索框并筛选 */
  onTagClick: (tag: string) => void;
  /** 读取 GitHub Token（可能为空） */
  getGithubToken: () => string;
  /** 状态提示 */
  setStatus: (text: string) => void;
  /** 面板渲染完成（用于重新绑定 3D 倾斜等） */
  onRendered?: () => void;
  showFrequent: boolean;
  showTags: boolean;
  showGithubProjects: boolean;
  showWidgets: boolean;
  sort: CardSortKey;
}

const TRENDING_BOARDS: TrendingBoard[] = buildDefaultBoards();

/** 语言 → 颜色，用于 GitHub 卡片的语言点 */
const LANG_COLORS: Record<string, string> = {
  TypeScript: '#3178c6',
  JavaScript: '#f1e05a',
  Python: '#3572A5',
  Go: '#00ADD8',
  Rust: '#dea584',
  Java: '#b07219',
  'C++': '#f34b7d',
  C: '#555555',
  Ruby: '#701516',
  PHP: '#4F5D95',
  Swift: '#F05138',
  Kotlin: '#A97BFF',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Dart: '#00B4AB',
  'Jupyter Notebook': '#DA5B0B',
  MDX: '#fcb32c',
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replaceAll('`', '&#96;');
}

function langColor(language: string): string {
  return LANG_COLORS[language] ?? '#8b949e';
}

/** 大数字缩写：12345 → 12.3k */
function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1000000) return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}M`;
}

const STAR_SVG = '<svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2Z"/></svg>';
const GITHUB_SVG = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>';

/** 记住当前选中的趋势榜，刷新时保持不跳 */
let activeBoardId = TRENDING_BOARDS[0]?.id ?? '';
/** 已保存的 GitHub 项目缓存，用于给趋势榜打「已保存」标记 */
let savedProjectIds = new Set<string>();
/** 趋势请求进行中标记，避免重复点击 */
let trendingLoading = false;

/**
 * 渲染全部模块区。
 */
export async function renderPanels(
  els: PanelElements,
  cards: PanelCard[],
  options: PanelOptions,
): Promise<void> {
  elementsRef = els;
  optionsRef = options;
  await renderMemos(els, options);
  renderLocalServices(els, cards, options);
  renderFrequent(els, cards, options);
  renderTags(els, cards, options);

  if (options.showGithubProjects) {
    await renderGithubProjects(els, options);
  } else {
    els.githubBlock.hidden = true;
  }

  if (options.showWidgets) {
    await renderTrendingWidget(els, options);
  } else {
    els.widgetBlock.hidden = true;
  }

  // 面板卡片是刚渲染的，通知调用方重新绑定交互（3D 倾斜等）
  options.onRendered?.();
}

/* ---------------------------------------------------------------- 备忘 */

const MEMO_COLOR_HEX: Record<MemoColor, string> = {
  yellow: '#ffd966',
  pink: '#ff9db8',
  blue: '#7ec8ff',
  green: '#8ef0a8',
  purple: '#c792ea',
  gray: '#a8b4c4',
};

let memoCache: Memo[] = [];
let memoColor: MemoColor = 'yellow';
let memoBound = false;

/** 渲染备忘面板：便签网格 + 新增表单 */
async function renderMemos(els: PanelElements, options: PanelOptions): Promise<void> {
  els.memoBlock.hidden = false;

  try {
    memoCache = await loadMemos();
  } catch {
    memoCache = [];
  }

  renderMemoColors(els);
  renderMemoList(els, options);
  bindMemoEvents(els, options);
}

function renderMemoColors(els: PanelElements): void {
  if (els.memoColors.childElementCount) return;
  els.memoColors.innerHTML = MEMO_COLORS.map((color) => `
    <button class="memo-swatch${color === memoColor ? ' active' : ''}" type="button"
      data-memo-color="${color}" style="--sw:${MEMO_COLOR_HEX[color]}" title="${color}"></button>
  `).join('');
  for (const swatch of els.memoColors.querySelectorAll<HTMLElement>('[data-memo-color]')) {
    swatch.addEventListener('click', () => {
      memoColor = swatch.dataset.memoColor as MemoColor;
      for (const other of els.memoColors.querySelectorAll<HTMLElement>('[data-memo-color]')) {
        other.classList.toggle('active', other.dataset.memoColor === memoColor);
      }
    });
  }
}

function renderMemoList(els: PanelElements, options: PanelOptions): void {
  const sorted = sortMemos(memoCache);
  const stats = memoStats(memoCache);
  els.memoHint.textContent = stats.total
    ? `${stats.total} 条 · ${stats.open} 待办 · ${stats.done} 已完成`
    : '随手记，自动保存在本地';

  if (!sorted.length) {
    els.memoList.innerHTML = '<div class="memo-empty">还没有备忘。写一条试试，会自动保存在本地。</div>';
    return;
  }

  els.memoList.innerHTML = sorted.map((memo) => `
    <article class="memo-card${memo.pinned ? ' pinned' : ''}${memo.done ? ' done' : ''}"
      data-memo-id="${escapeAttr(memo.id)}" style="--memo-bg:${MEMO_COLOR_HEX[memo.color]}22">
      <div class="memo-text">${escapeHtml(memo.text)}</div>
      <div class="memo-meta">
        <span>${escapeHtml(formatMemoTime(memo.updatedAt))}</span>
        <span class="memo-actions">
          <button class="memo-act" type="button" data-memo-act="done" title="${memo.done ? '标记未完成' : '标记完成'}">${memo.done ? '↺' : '✓'}</button>
          <button class="memo-act" type="button" data-memo-act="pin" title="${memo.pinned ? '取消置顶' : '置顶'}">${memo.pinned ? '★' : '☆'}</button>
          <button class="memo-act" type="button" data-memo-act="copy" title="复制内容">⧉</button>
          <button class="memo-act danger" type="button" data-memo-act="delete" title="删除">✕</button>
        </span>
      </div>
    </article>
  `).join('');

  for (const card of els.memoList.querySelectorAll<HTMLElement>('[data-memo-id]')) {
    const id = card.dataset.memoId ?? '';
    for (const btn of card.querySelectorAll<HTMLElement>('[data-memo-act]')) {
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const act = btn.dataset.memoAct;
        const memo = memoCache.find((m) => m.id === id);
        if (!memo) return;

        if (act === 'delete') memoCache = removeMemo(memoCache, id);
        else if (act === 'done') memoCache = toggleMemoDone(memoCache, id);
        else if (act === 'pin') memoCache = toggleMemoPinned(memoCache, id);
        else if (act === 'copy') {
          await navigator.clipboard.writeText(memo.text).catch(() => {});
          options.setStatus?.('已复制备忘内容');
          return;
        }
        await persistMemos();
        renderMemoList(els, options);
      });
    }
  }
}

function bindMemoEvents(els: PanelElements, options: PanelOptions): void {
  if (memoBound) return;
  memoBound = true;

  const submit = async () => {
    const text = els.memoInput.value.trim();
    if (!text) {
      options.setStatus?.('备忘内容不能为空');
      return;
    }
    memoCache = [...memoCache, createMemo({ text, color: memoColor })];
    els.memoInput.value = '';
    await persistMemos();
    renderMemoList(els, options);
    options.setStatus?.('✓ 已保存备忘');
  };

  els.memoAdd.addEventListener('click', () => { void submit(); });
  els.memoInput.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      void submit();
    }
  });
}

async function persistMemos(): Promise<void> {
  try {
    memoCache = await saveMemos(memoCache);
  } catch {
    // 存储失败时保留内存态，避免用户刚写的内容消失
  }
}

function formatMemoTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(t).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

/**
 * 供外部（行内 ✎ / ★ 按钮）新增一条备忘。
 * 返回是否成功，并给出明确反馈 —— 之前没有任何提示，用户会以为按钮坏了。
 */
export async function addMemoFromOutside(text: string, label = '备忘'): Promise<boolean> {
  const content = text.trim();
  if (!content) {
    optionsRef?.setStatus?.('内容为空，未保存');
    return false;
  }

  memoCache = [...memoCache, createMemo({ text: content })];
  await persistMemos();

  if (elementsRef && optionsRef) {
    // 若备忘面板被用户收起，自动展开，否则用户看不到刚存的东西
    const layoutHidden = elementsRef.memoBlock.classList.contains('panel-collapsed');
    if (layoutHidden) {
      elementsRef.memoBlock.classList.remove('panel-collapsed');
    }
    renderMemoList(elementsRef, optionsRef);
    elementsRef.memoBlock.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  optionsRef?.setStatus?.(`✓ 已存为${label}`);
  return true;
}

/* ---------------------------------------------------- 内网 / 自建服务 */

/**
 * 内网服务做成按钮：一个服务一个按钮，悬停/点击展开更多信息。
 * 同一台主机上的多个服务聚合为一个按钮（显示数量），展开后可逐个打开。
 */
function renderLocalServices(els: PanelElements, cards: PanelCard[], options: PanelOptions): void {
  const groups = groupLocalServices(cards.map((c) => ({ url: c.url, title: c.title })));

  if (!groups.length) {
    els.localBlock.hidden = true;
    return;
  }

  els.localBlock.hidden = false;
  const total = groups.reduce((sum, g) => sum + g.services.length, 0);
  els.localHint.textContent = `${groups.length} 台主机 · ${total} 个服务`;

  els.localGrid.innerHTML = groups.map((group, index) => localButtonHtml(group, index)).join('');

  // 绑定：点击按钮打开第一个服务；悬停展开详情
  let activeItem: HTMLElement | null = null;
  const clearActive = () => {
    activeItem?.querySelector('.local-pop')?.classList.remove('visible', 'flip-up');
    activeItem = null;
  };

  els.localGrid.addEventListener('pointerover', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const item = target.closest<HTMLElement>('.local-item');
    if (item === activeItem) return;
    clearActive();
    if (!item) return;
    activeItem = item;
    const pop = item.querySelector<HTMLElement>('.local-pop');
    if (!pop) return;
    pop.classList.add('visible');
    const rect = item.getBoundingClientRect();
    const popRect = pop.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    pop.classList.toggle('flip-up', spaceBelow < popRect.height + 16 && rect.top > popRect.height + 16);
  });
  els.localGrid.addEventListener('pointerleave', clearActive);

  for (const btn of els.localGrid.querySelectorAll<HTMLElement>('[data-local-open]')) {
    btn.addEventListener('click', () => {
      const url = btn.dataset.localOpen;
      if (url) options.openUrl(url);
    });
  }
  // 展开面板里的「同主机其它服务」也能点
  for (const sib of els.localGrid.querySelectorAll<HTMLElement>('[data-local-sibling]')) {
    sib.addEventListener('click', (event) => {
      event.stopPropagation();
      const url = sib.dataset.localSibling;
      if (url) options.openUrl(url);
    });
  }
}

const KIND_COLOR: Record<string, string> = {
  localhost: '#00e5ff',
  tailscale: '#80ff00',
  'private-ip': '#ffd166',
  mdns: '#c792ea',
  'custom-port': '#ff9db8',
  unknown: '#8b949e',
};

function localButtonHtml(group: LocalServiceGroup, index: number): string {
  const first = group.services[0];
  const color = KIND_COLOR[group.kind] ?? '#00e5ff';
  const extra = group.services.length > 1
    ? `<span class="local-count">${group.services.length}</span>`
    : '';

  const siblings = group.services.length > 1
    ? `<div class="local-siblings">
         <span class="label">同一主机上的其它服务</span>
         ${group.services.slice(1).map((svc) => `
           <button class="local-sibling" type="button" data-local-sibling="${escapeAttr(svc.url)}">
             <span>${escapeHtml(svc.label)}</span>
             <span>${escapeHtml(svc.port ? `:${svc.port}` : '')}</span>
           </button>`).join('')}
       </div>`
    : '';

  const hint = portHint(first.port);
  const rows = [
    `<b>地址</b><span>${escapeHtml(first.url)}</span>`,
    `<b>主机</b><span>${escapeHtml(group.host)}</span>`,
    `<b>端口</b><span>${escapeHtml(first.port || '默认')}${hint ? ` · ${escapeHtml(hint)}` : ''}</span>`,
    `<b>类型</b><span>${escapeHtml(group.kindLabel)}</span>`,
    `<b>协议</b><span>${escapeHtml(first.protocol)}${first.insecure ? '（未加密）' : ''}</span>`,
  ].join('');

  const warn = first.insecure
    ? '<div class="local-warn">明文 HTTP：仅建议在内网/本机使用，公网访问请改用 HTTPS。</div>'
    : '';

  return `
    <div class="local-item" data-local-index="${index}">
      <button class="local-btn" type="button" data-local-open="${escapeAttr(first.url)}" title="${escapeAttr(first.url)}">
        <span class="local-dot" style="--dot:${color}"></span>
        <span class="local-text">
          <span class="local-name">${escapeHtml(first.label)}</span>
          <span class="local-host">${escapeHtml(group.host)}${first.port ? `:${escapeHtml(first.port)}` : ''}</span>
        </span>
        <span class="local-kind">${escapeHtml(group.kindLabel)}</span>
        ${extra}
      </button>
      <div class="local-pop" role="tooltip">
        <span class="local-pop-title">${escapeHtml(first.label)}</span>
        <div class="local-pop-grid">${rows}</div>
        ${warn}
        ${siblings}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- 常用书签 */

function renderFrequent(els: PanelElements, cards: PanelCard[], options: PanelOptions): void {
  if (!options.showFrequent || !cards.length) {
    els.frequentBlock.hidden = true;
    return;
  }

  const frequent = pickFrequentBookmarks(cards, { limit: 12 });
  if (!frequent.length) {
    els.frequentBlock.hidden = true;
    return;
  }

  els.frequentBlock.hidden = false;
  els.frequentHint.textContent = `最常用的 ${frequent.length} 条`;
  els.frequentStrip.innerHTML = frequent.map((card) => {
    const count = cards.filter((c) => c.domain === card.domain).length;
    return `
      <button class="frequent-chip" type="button" data-url="${escapeAttr(card.url)}" title="${escapeAttr(card.title)}">
        <span class="chip-text">${escapeHtml(card.title || card.domain)}</span>
        <span class="chip-count">${count > 1 ? `${count}×` : escapeHtml(card.domain)}</span>
      </button>
    `;
  }).join('');

  for (const chip of els.frequentStrip.querySelectorAll<HTMLElement>('[data-url]')) {
    chip.addEventListener('click', () => {
      const url = chip.dataset.url;
      if (url) options.openUrl(url);
    });
  }
}

/* ---------------------------------------------------------------- 标签整理 */

function renderTags(els: PanelElements, cards: PanelCard[], options: PanelOptions): void {
  if (!options.showTags || !cards.length) {
    els.tagBlock.hidden = true;
    return;
  }

  const stats = buildTagStats(cards, { limit: 36 });
  if (!stats.length) {
    els.tagBlock.hidden = true;
    return;
  }

  els.tagBlock.hidden = false;
  const total = stats.reduce((sum, s) => sum + s.count, 0);
  els.tagHint.textContent = `${stats.length} 个标签 · 共 ${total} 次引用`;

  els.tagCloud.innerHTML = stats.map((stat) => `
    <button class="tag-pill" type="button" data-tag="${escapeAttr(stat.tag)}" title="按「${escapeAttr(stat.tag)}」筛选">
      <span>${escapeHtml(stat.tag)}</span>
      <span class="tag-count">${stat.count}</span>
    </button>
  `).join('');

  for (const pill of els.tagCloud.querySelectorAll<HTMLElement>('[data-tag]')) {
    pill.addEventListener('click', () => {
      const tag = pill.dataset.tag;
      if (tag) options.onTagClick(tag);
    });
  }
}

/* ------------------------------------------------------- GitHub 趋势小组件 */

async function renderTrendingWidget(els: PanelElements, options: PanelOptions): Promise<void> {
  const boards = TRENDING_BOARDS.filter((board) => board.enabled);
  if (!boards.length) {
    els.widgetBlock.hidden = true;
    return;
  }

  els.widgetBlock.hidden = false;
  if (!boards.some((board) => board.id === activeBoardId)) {
    activeBoardId = boards[0].id;
  }

  // 骨架：榜单单选 + 内容占位
  els.widgetGrid.innerHTML = `
    <article class="widget-card" data-widget="github-trending">
      <div class="widget-head">
        <span class="widget-title">${GITHUB_SVG}<span>GitHub 趋势榜</span></span>
        <span class="panel-hint" id="trendingUpdated"></span>
      </div>
      <div class="widget-board-tabs">
        ${boards.map((board) => `
          <button class="board-tab${board.id === activeBoardId ? ' active' : ''}" type="button" data-board="${escapeAttr(board.id)}">${escapeHtml(board.name)}</button>
        `).join('')}
      </div>
      <div class="widget-body" id="trendingBody">
        <div class="panel-loading">正在加载…</div>
      </div>
    </article>
  `;

  for (const tab of els.widgetGrid.querySelectorAll<HTMLElement>('[data-board]')) {
    tab.addEventListener('click', () => {
      const id = tab.dataset.board;
      if (!id || id === activeBoardId) return;
      activeBoardId = id;
      for (const other of els.widgetGrid.querySelectorAll<HTMLElement>('[data-board]')) {
        other.classList.toggle('active', other.dataset.board === id);
      }
      void loadTrendingBoard(els, options);
    });
  }

  await loadTrendingBoard(els, options);
}

async function loadTrendingBoard(els: PanelElements, options: PanelOptions): Promise<void> {
  const body = els.widgetGrid.querySelector<HTMLElement>('#trendingBody');
  const updated = els.widgetGrid.querySelector<HTMLElement>('#trendingUpdated');
  if (!body || trendingLoading) return;

  const board = TRENDING_BOARDS.find((item) => item.id === activeBoardId);
  if (!board) {
    body.innerHTML = '<div class="panel-empty">没有可用的榜单</div>';
    return;
  }

  trendingLoading = true;
  body.innerHTML = '<div class="panel-loading">正在加载…</div>';

  try {
    const token = options.getGithubToken().trim();
    const repos = await fetchTrending(board, { limit: 10, ...(token ? { token } : {}) });

    if (!repos.length) {
      body.innerHTML = '<div class="panel-empty">这个榜单暂时没有结果</div>';
      if (updated) updated.textContent = '';
      return;
    }

    body.innerHTML = repos.map((repo, index) => repoRowHtml(repo, index)).join('');
    if (updated) updated.textContent = `${board.name} · 更新于 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;

    for (const row of body.querySelectorAll<HTMLElement>('[data-repo-url]')) {
      row.addEventListener('click', (event) => {
        // 点「收藏」按钮时不要同时打开仓库
        if ((event.target as HTMLElement).closest('.repo-save')) return;
        const url = row.dataset.repoUrl;
        if (url) options.openUrl(url);
      });
    }

    // 关键：趋势榜是**异步**加载的，行在 applyTilt() 跑完之后才被写进 DOM，
    // 所以新行拿不到倾斜监听 —— 表现为「趋势榜有时候 3D 失效」。
    // 每次重建行之后都要重新绑定。
    options.onRendered?.();

    for (const saveBtn of body.querySelectorAll<HTMLElement>('.repo-save')) {
      saveBtn.addEventListener('click', async (event) => {
        event.stopPropagation();
        const payload = saveBtn.dataset.repo;
        if (!payload) return;
        try {
          const repo = JSON.parse(payload) as TrendingRepo;
          const { added } = await addGithubProject(githubProjectFromRepo(repo));
          saveBtn.classList.add('saved');
          saveBtn.textContent = added ? '✓' : '已在';
          savedProjectIds.add(repo.fullName.toLowerCase());
          options.setStatus(added ? `已收藏 ${repo.fullName}` : `${repo.fullName} 已在项目中`);
          if (added) await renderGithubProjects(els, options);
          options.onRendered?.();
        } catch (error) {
          options.setStatus(`收藏失败：${error instanceof Error ? error.message : String(error)}`);
        }
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    body.innerHTML = `<div class="panel-error">${escapeHtml(message)}</div>`;
    if (updated) updated.textContent = '';
  } finally {
    trendingLoading = false;
  }
}

function repoRowHtml(repo: TrendingRepo, index: number): string {
  const saved = savedProjectIds.has(repo.fullName.toLowerCase());
  return `
    <div class="repo-row" data-repo-url="${escapeAttr(repo.url)}" title="${escapeAttr(repo.description || repo.fullName)}">
      <span class="repo-rank">${index + 1}</span>
      <span class="repo-main">
        <span class="repo-name">${escapeHtml(repo.fullName)}</span>
        <span class="repo-desc">${escapeHtml(repo.description || repo.language || '—')}</span>
      </span>
      <span class="repo-stars">${STAR_SVG}${formatCount(repo.stars)}</span>
      <button class="repo-save${saved ? ' saved' : ''}" type="button" title="收藏到 GitHub 项目"
        data-repo="${escapeAttr(JSON.stringify(repo))}">${saved ? '✓' : '+'}</button>
    </div>
  `;
}

/* ------------------------------------------------------------ GitHub 项目 */

async function renderGithubProjects(els: PanelElements, options: PanelOptions): Promise<void> {
  let projects: GithubProject[] = [];
  try {
    projects = await loadGithubProjects();
  } catch {
    projects = [];
  }

  savedProjectIds = new Set(projects.map((project) => project.fullName.toLowerCase()));
  els.githubBlock.hidden = false;

  if (!projects.length) {
    els.githubHint.textContent = '';
    els.githubGrid.innerHTML = '<div class="panel-empty">还没有收藏的 GitHub 项目。可在下方输入 <b>owner/repo</b> 手动添加，或到「GitHub 趋势榜」点 ＋ 加入。</div>';
  } else {

    const starred = projects.filter((project) => project.starredByMe).length;
    els.githubHint.textContent = starred
      ? `${projects.length} 个项目 · ${starred} 个标星`
      : `${projects.length} 个项目`;

    els.githubGrid.innerHTML = projects.map((project) => githubCardHtml(project)).join('');
  }

  // 手动添加：输入 owner/repo 或完整 GitHub 链接
  els.githubBlock.querySelector('.github-add-form')?.remove();
  const form = document.createElement('form');
  form.className = 'github-add-form';
  form.innerHTML = `
    <input type="text" placeholder="owner/repo 或 GitHub 链接" autocomplete="off" />
    <button class="glass-button primary" type="submit">添加</button>`;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = form.querySelector('input');
    const raw = input?.value.trim() ?? '';
    if (!raw) return;
    const fullName = parseRepoInput(raw);
    if (!fullName) {
      options.setStatus('格式不对，请填 owner/repo 或完整 GitHub 链接');
      return;
    }
    const [owner, name] = fullName.split('/');
    const { added } = await addGithubProject({
      fullName,
      owner,
      name,
      url: `https://github.com/${fullName}`,
    });
    if (input) input.value = '';
    options.setStatus(added ? `已添加 ${fullName}` : `${fullName} 已在项目中`);
    await renderGithubProjects(els, options);
    options.onRendered?.();
  });
  els.githubBlock.append(form);

  for (const card of els.githubGrid.querySelectorAll<HTMLElement>('[data-project-id]')) {
    const id = card.dataset.projectId ?? '';

    card.querySelector('.github-open')?.addEventListener('click', () => {
      const url = card.dataset.projectUrl;
      if (url) options.openUrl(url);
    });

    card.querySelector('.github-star')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      const project = projects.find((item) => item.id === id);
      if (!project) return;
      await updateGithubProject(id, { starredByMe: !project.starredByMe });
      await renderGithubProjects(els, options);
      options.onRendered?.();
    });

    card.querySelector('.github-remove')?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await removeGithubProject(id);
      options.setStatus('已移除该项目');
      await renderGithubProjects(els, options);
      options.onRendered?.();
    });
  }
}

/**
 * 解析用户输入的仓库标识，支持三种写法：
 *   owner/repo
 *   https://github.com/owner/repo
 *   git@github.com:owner/repo.git
 * 返回规范化的 owner/repo，无法识别返回 null。
 */
export function parseRepoInput(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  let m = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(value);
  if (m) return `${m[1]}/${m[2]}`;
  m = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/.exec(value);
  if (m) return `${m[1]}/${m[2]}`;
  return null;
}

function githubCardHtml(project: GithubProject): string {
  const language = project.language
    ? `<span class="github-lang" style="--lang-color:${langColor(project.language)}">${escapeHtml(project.language)}</span>`
    : '';
  return `
    <article class="github-card" data-project-id="${escapeAttr(project.id)}" data-project-url="${escapeAttr(project.url)}">
      <div class="github-head">
        <img class="github-avatar" src="${escapeAttr(project.avatarUrl || '/icon/48.png')}" alt="" loading="lazy" />
        <span class="github-name" title="${escapeAttr(project.fullName)}">${escapeHtml(project.fullName)}</span>
      </div>
      <p class="github-desc">${escapeHtml(project.description || '暂无描述')}</p>
      <div class="github-meta">
        <span class="repo-stars">${STAR_SVG}${formatCount(project.stars)}</span>
        <span>⑂ ${formatCount(project.forks)}</span>
        ${language}
      </div>
      <div class="github-actions">
        <button class="github-open" type="button">打开</button>
        <button class="github-star${project.starredByMe ? ' starred' : ''}" type="button">${project.starredByMe ? '★ 已标星' : '☆ 标星'}</button>
        <button class="github-remove danger" type="button">移除</button>
      </div>
    </article>
  `;
}

/** 供外部（如设置面板）复用的榜单列表 */
export function trendingBoards(): TrendingBoard[] {
  return TRENDING_BOARDS;
}

export type { TagStat, CardSortKey };
