/**
 * 新标签页的「书签分组」渲染。
 *
 * 架构：每个分组渲染成**独立的面板**（`.panel-block`，id 形如 `group-ai`），
 * 直接放进 `#dashboardPanels` 网格，和「时间 / 备忘 / 趋势榜」等小组件同级。
 * 所以分组与小组件可以自由混排、互相贴合；位置、宽度、高度由 panel-layout 统一管理。
 *
 * 交互：
 *   - 分组面板可拖动排序、可拉伸宽高（由 main.ts 的 applyPanelLayout 处理）
 *   - 分组名双击可改
 *   - 批量选择：进入选择模式后每行出现勾选框，可跨分组批量删除
 *
 * 性能：详情只在 hover 时展示；不使用 backdrop-filter；不做逐帧动画。
 */

import {
  curateBookmarks,
  curationSummary,
  type CuratedBookmark,
  type CuratedCategory,
  type CuratorInput,
} from '@/lib/curator';

export interface CuratedElements {
  /** 面板网格容器（#dashboardPanels） */
  panels: HTMLElement;
  /** 分类导航（胶囊） */
  nav: HTMLElement;
}

export interface CuratedOptions {
  openUrl: (url: string) => void;
  onTagClick?: (tag: string) => void;
  perCategory?: number;
  keepRatio?: number;
  /** 是否启用清洗（关闭时展示全部，不裁剪） */
  curateEnabled?: boolean;
  /** 每次重绘后回调（重新绑定 3D 倾斜、面板布局等） */
  onRendered?: () => void;
  /** 删除一条浏览器书签 */
  onDeleteBookmark?: (url: string, title: string) => void;
  /** 批量删除 */
  onBulkDelete?: (targets: { url: string; title: string }[]) => void;
  /** 往指定分组（文件夹）添加一条书签 */
  onAddBookmark?: (url: string, title: string, folder: string) => void;
  /** 固定到常用 */
  onPinBookmark?: (url: string, title: string) => void;
  /** 存为备忘 */
  onSaveAsMemo?: (title: string, url: string) => void;
  /** 状态提示 */
  setStatus?: (text: string) => void;
  /** 分组重命名持久化 */
  onRenameGroup?: (groupId: string, name: string) => void;
  /** 读取已保存的分组名 */
  loadGroupNames?: () => Record<string, string>;
}

/** 分组面板 id 前缀（与 lib/panel-layout 的 GROUP_PANEL_PREFIX 一致） */
const GROUP_PREFIX = 'group-';

let lastCategories: CuratedCategory[] = [];
let lastTotal = 0;
let optionsRef: CuratedOptions | null = null;
let elementsRef: CuratedElements | null = null;
/** 已重命名的分组：id → 名称 */
let groupNames: Record<string, string> = {};

/** 选择模式 */
let selectMode = false;
/** 已勾选的 URL */
const selected = new Set<string>();

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

function iconHtml(item: CuratedBookmark): string {
  const initial = (item.title || item.domain || '?').trim().slice(0, 1).toUpperCase();
  let hue = 0;
  for (const ch of item.domain || item.url) hue = (hue * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="cur-icon" style="--h:${hue % 360}"><span class="cur-icon-letter">${escapeHtml(initial)}</span></span>`;
}

function relativeTime(value: string | undefined): string {
  if (!value) return '从未';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return '未知';
  const days = Math.floor((Date.now() - t) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  if (days < 365) return `${Math.floor(days / 30)} 个月前`;
  return `${Math.floor(days / 365)} 年前`;
}

/** 分组 id → 合法的面板 id */
export function groupPanelId(groupId: string): string {
  return `${GROUP_PREFIX}${String(groupId).replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

/** 主入口 */
export function renderCurated(
  els: CuratedElements,
  items: CuratorInput[],
  options: CuratedOptions = { openUrl: () => undefined },
): boolean {
  lastTotal = items.length;
  optionsRef = options;
  elementsRef = els;
  groupNames = options.loadGroupNames?.() ?? {};

  const enabled = options.curateEnabled !== false;
  lastCategories = curateBookmarks(items, enabled
    ? { keepRatio: options.keepRatio ?? 0.1, perCategory: options.perCategory ?? 14 }
    : { keepRatio: 1, perCategory: Number.MAX_SAFE_INTEGER, maxItems: Number.MAX_SAFE_INTEGER });

  // 移除上一次渲染出来的分组面板（静态小组件不动）
  for (const old of els.panels.querySelectorAll<HTMLElement>(`.panel-block[id^="${GROUP_PREFIX}"]`)) {
    old.remove();
  }

  if (!lastCategories.length) {
    els.nav.innerHTML = '';
    const empty = document.createElement('section');
    empty.className = 'panel-block';
    empty.id = groupPanelId('empty');
    empty.innerHTML = `
      <div class="cur-empty">
        <p>还没有可展示的收藏。</p>
        <p class="cur-empty-sub">导入浏览器书签，或用扩展弹窗剪藏网页后，这里会自动整理。</p>
      </div>`;
    els.panels.append(empty);
    options.onRendered?.();
    return false;
  }

  renderNav(els, lastCategories);
  renderGroupPanels(els, options);
  options.onRendered?.();
  return true;
}

/** 顶部胶囊导航：点击滚动到对应分组面板 */
function renderNav(els: CuratedElements, categories: CuratedCategory[]): void {
  const summary = curationSummary(lastTotal, categories);
  els.nav.innerHTML = categories.map((group) => `
    <button class="cat-chip" type="button" data-cat="${escapeAttr(String(group.id))}">
      <span>${escapeHtml(groupName(group))}</span>
      <span class="cat-chip-count">${group.items.length}</span>
    </button>`).join('') + `
    <button class="cat-chip cat-chip-select${selectMode ? ' active' : ''}" type="button" data-select-toggle
      title="批量选择书签">${selectMode ? '退出选择' : '批量选择'}</button>
    <span class="cat-chip-hint">共 ${summary.kept} 条</span>`;

  for (const chip of els.nav.querySelectorAll<HTMLElement>('[data-cat]')) {
    chip.addEventListener('click', () => {
      const id = chip.dataset.cat ?? '';
      const target = els.panels.querySelector<HTMLElement>(`[data-group="${CSS.escape(id)}"]`);
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      for (const other of els.nav.querySelectorAll<HTMLElement>('[data-cat]')) {
        other.classList.toggle('active', other.dataset.cat === id);
      }
    });
  }
  els.nav.querySelector<HTMLElement>('[data-select-toggle]')?.addEventListener('click', () => {
    setSelectMode(!selectMode);
  });
}

function groupName(group: CuratedCategory): string {
  return groupNames[String(group.id)] ?? group.label;
}

/** 每个分组渲染成一个独立面板 */
function renderGroupPanels(els: CuratedElements, options: CuratedOptions): void {
  for (const group of lastCategories) {
    const section = document.createElement('section');
    section.className = 'panel-block cur-group-panel';
    section.id = groupPanelId(String(group.id));
    section.dataset.group = String(group.id);
    section.innerHTML = `
      <div class="panel-head">
        <h2 class="cur-group-name" data-rename="${escapeAttr(String(group.id))}" title="双击重命名">${escapeHtml(groupName(group))}</h2>
        <span class="cur-group-count">${group.items.length}</span>
        <span class="panel-hint"></span>
        <button class="cur-group-add" type="button" data-group-add="${escapeAttr(String(group.id))}"
          title="往这个分组添加书签">+ 书签</button>
      </div>
      <ul class="cur-list">
        ${group.items.map((item) => rowHtml(item)).join('')}
      </ul>
      <form class="cur-group-form" data-group-form="${escapeAttr(String(group.id))}" hidden>
        <input type="url" data-group-url placeholder="https://example.com" autocomplete="off" />
        <input type="text" data-group-title placeholder="名称（可选）" autocomplete="off" />
        <button class="glass-button primary" type="submit">添加</button>
        <button class="glass-button" type="button" data-group-cancel>取消</button>
      </form>`;
    els.panels.append(section);
  }

  bindRowEvents(els, options);
  bindGroupPanelEvents(els, options);
  bindGroupAddForms(els, options);
  renderSelectionBar(els, options);
}

function rowHtml(item: CuratedBookmark): string {
  const tags = (item.tags ?? []).slice(0, 3);
  const tagsHtml = tags.length
    ? `<span class="cur-tags">${tags.map((tag) => `<span class="cur-tag" data-tag="${escapeAttr(tag)}">${escapeHtml(tag)}</span>`).join('')}</span>`
    : '';
  const reasons = item.reasons.length
    ? `<ul class="cur-reasons">${item.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}</ul>`
    : '<p class="cur-reason-empty">批量导入、尚未使用过</p>';
  const checked = selected.has(item.url) ? ' checked' : '';

  return `
    <li class="cur-row${checked ? ' is-selected' : ''}" data-url="${escapeAttr(item.url)}" data-title="${escapeAttr(item.title || item.url)}" tabindex="0">
      <label class="cur-check" title="选择这条书签">
        <input type="checkbox" data-row-check${checked} />
        <span class="cur-check-box" aria-hidden="true"></span>
      </label>
      ${iconHtml(item)}
      <span class="cur-main">
        <span class="cur-title">${escapeHtml(item.title || item.url)}</span>
        <span class="cur-meta">
          <span class="cur-domain">${escapeHtml(item.domain)}</span>
          ${tagsHtml}
        </span>
      </span>
      <span class="cur-actions">
        <button class="cur-act" type="button" data-row-action="newtab" title="在新标签页打开">↗</button>
        <button class="cur-act" type="button" data-row-action="copy" title="复制链接">⧉</button>
        <button class="cur-act" type="button" data-row-action="copy-md" title="复制为 Markdown 链接">M</button>
        <button class="cur-act" type="button" data-row-action="memo" title="存为备忘">✎</button>
        <button class="cur-act" type="button" data-row-action="pin" title="固定到常用">★</button>
        <button class="cur-act danger" type="button" data-row-action="delete" title="从浏览器书签中删除">✕</button>
      </span>
      <span class="cur-score" title="重要度评分">${item.score}</span>
      <span class="cur-detail" role="tooltip">
        <span class="cur-detail-title">${escapeHtml(item.title || item.url)}</span>
        <span class="cur-detail-url">${escapeHtml(item.url)}</span>
        ${item.summary ? `<span class="cur-detail-summary">${escapeHtml(item.summary)}</span>` : ''}
        ${item.why ? `<span class="cur-detail-why">备注：${escapeHtml(item.why)}</span>` : ''}
        <span class="cur-detail-grid">
          <span><b>重要度</b>${item.score}</span>
          <span><b>最近使用</b>${escapeHtml(relativeTime(item.lastVisited))}</span>
          <span><b>收录</b>${escapeHtml(relativeTime(item.clipped))}</span>
          <span><b>来源</b>${item.source === 'bookmark' ? '浏览器书签' : '剪藏'}</span>
        </span>
        ${reasons}
      </span>
    </li>`;
}

/* ------------------------------------------------------------ 选择模式 */

/** 进入 / 退出批量选择模式 */
export function setSelectMode(on: boolean): void {
  selectMode = on;
  if (!on) selected.clear();
  document.body.classList.toggle('select-mode', on);
  if (elementsRef && optionsRef) {
    renderNav(elementsRef, lastCategories);
    refreshSelectionUi(elementsRef, optionsRef);
  }
}

export function isSelectMode(): boolean {
  return selectMode;
}

/** 已选中的书签（按分组顺序，供批量操作使用） */
export function selectedBookmarks(): { url: string; title: string }[] {
  const out: { url: string; title: string }[] = [];
  const seen = new Set<string>();
  for (const group of lastCategories) {
    for (const item of group.items) {
      if (selected.has(item.url) && !seen.has(item.url)) {
        seen.add(item.url);
        out.push({ url: item.url, title: item.title || item.url });
      }
    }
  }
  return out;
}

/** 只更新勾选状态与底部操作条，不重建列表 */
function refreshSelectionUi(els: CuratedElements, options: CuratedOptions): void {
  for (const row of els.panels.querySelectorAll<HTMLElement>('.cur-row[data-url]')) {
    const on = selected.has(row.dataset.url ?? '');
    row.classList.toggle('is-selected', on);
    const box = row.querySelector<HTMLInputElement>('[data-row-check]');
    if (box) box.checked = on;
  }
  renderSelectionBar(els, options);
}

/** 底部批量操作条 */
function renderSelectionBar(els: CuratedElements, options: CuratedOptions): void {
  const existing = document.getElementById('selectionBar');
  if (!selectMode) {
    existing?.remove();
    return;
  }
  const bar = existing ?? document.createElement('div');
  if (!existing) {
    bar.id = 'selectionBar';
    bar.className = 'selection-bar';
    document.body.append(bar);
  }
  const count = selected.size;
  bar.innerHTML = `
    <span class="selection-count">已选 <b>${count}</b> 条</span>
    <button class="glass-button" type="button" data-sel="all">全选</button>
    <button class="glass-button" type="button" data-sel="none">清空</button>
    <button class="glass-button danger" type="button" data-sel="delete"${count ? '' : ' disabled'}>删除所选</button>
    <button class="glass-button" type="button" data-sel="exit">完成</button>`;

  bar.querySelector('[data-sel="all"]')?.addEventListener('click', () => {
    for (const group of lastCategories) {
      for (const item of group.items) selected.add(item.url);
    }
    refreshSelectionUi(els, options);
  });
  bar.querySelector('[data-sel="none"]')?.addEventListener('click', () => {
    selected.clear();
    refreshSelectionUi(els, options);
  });
  bar.querySelector('[data-sel="exit"]')?.addEventListener('click', () => {
    setSelectMode(false);
  });
  bar.querySelector('[data-sel="delete"]')?.addEventListener('click', () => {
    const targets = selectedBookmarks();
    if (!targets.length) return;
    options.onBulkDelete?.(targets);
  });
}

/** 批量操作完成后清空选择 */
export function clearSelection(): void {
  selected.clear();
  if (elementsRef && optionsRef) refreshSelectionUi(elementsRef, optionsRef);
}

/* ------------------------------------------------------------ 交互绑定 */

function bindRowEvents(els: CuratedElements, options: CuratedOptions): void {
  for (const row of els.panels.querySelectorAll<HTMLElement>('.cur-row[data-url]')) {
    const box = row.querySelector<HTMLInputElement>('[data-row-check]');
    box?.addEventListener('change', (event) => {
      event.stopPropagation();
      const url = row.dataset.url ?? '';
      if (box.checked) selected.add(url);
      else selected.delete(url);
      row.classList.toggle('is-selected', box.checked);
      renderSelectionBar(els, options);
    });

    row.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;

      // 选择模式下点整行 = 切换勾选，不打开链接
      if (selectMode && !target.closest('[data-row-action]') && !target.closest('.cur-check')) {
        event.preventDefault();
        const url = row.dataset.url ?? '';
        if (selected.has(url)) selected.delete(url);
        else selected.add(url);
        refreshSelectionUi(els, options);
        return;
      }

      const action = target.closest<HTMLElement>('[data-row-action]');
      if (action) {
        event.preventDefault();
        event.stopPropagation();
        const url = row.dataset.url ?? '';
        const title = row.dataset.title ?? '';
        const act = action.dataset.rowAction;
        if (act === 'delete') options.onDeleteBookmark?.(url, title);
        if (act === 'newtab') window.open(url, '_blank', 'noopener');
        if (act === 'pin') options.onPinBookmark?.(url, title);
        if (act === 'memo') options.onSaveAsMemo?.(title || url, url);
        if (act === 'copy') {
          void navigator.clipboard.writeText(url).then(
            () => options.setStatus?.('已复制链接'),
            () => options.setStatus?.('复制失败'),
          );
        }
        if (act === 'copy-md') {
          void navigator.clipboard.writeText(`[${title || url}](${url})`).then(
            () => options.setStatus?.('已复制 Markdown 链接'),
            () => options.setStatus?.('复制失败'),
          );
        }
        return;
      }

      const tagEl = target.closest('.cur-tag');
      if (tagEl instanceof HTMLElement && tagEl.dataset.tag && options.onTagClick) {
        event.preventDefault();
        event.stopPropagation();
        options.onTagClick(tagEl.dataset.tag);
        return;
      }
      const url = row.dataset.url;
      if (url) options.openUrl(url);
    });
  }
  bindHover(els);
}

/** 分组面板上的「+ 书签」内联表单 */
function bindGroupAddForms(els: CuratedElements, options: CuratedOptions): void {
  for (const btn of els.panels.querySelectorAll<HTMLElement>('[data-group-add]')) {
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      const groupId = btn.dataset.groupAdd ?? '';
      const panel = btn.closest<HTMLElement>('.cur-group-panel');
      const form = panel?.querySelector<HTMLFormElement>('[data-group-form]');
      if (!form) return;
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector<HTMLInputElement>('[data-group-url]')?.focus();
    });
  }

  for (const form of els.panels.querySelectorAll<HTMLFormElement>('[data-group-form]')) {
    const groupId = form.dataset.groupForm ?? '';
    const urlEl = form.querySelector<HTMLInputElement>('[data-group-url]');
    const titleEl = form.querySelector<HTMLInputElement>('[data-group-title]');

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const url = urlEl?.value.trim() ?? '';
      const title = titleEl?.value.trim() ?? '';
      if (!url) return;
      // 分组名作为书签文件夹，这样新书签会自然归到该分组
      options.onAddBookmark?.(url, title, groupNameById(groupId));
      if (urlEl) urlEl.value = '';
      if (titleEl) titleEl.value = '';
      form.hidden = true;
    });

    form.querySelector('[data-group-cancel]')?.addEventListener('click', () => {
      form.hidden = true;
    });
    urlEl?.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') form.hidden = true;
    });
  }
}

/** 分组 id → 显示名 */
function groupNameById(groupId: string): string {
  const g = lastCategories.find((c) => String(c.id) === groupId);
  return g ? groupName(g) : groupId;
}

/** 分组名双击重命名 */
function bindGroupPanelEvents(els: CuratedElements, options: CuratedOptions): void {
  for (const nameEl of els.panels.querySelectorAll<HTMLElement>('[data-rename]')) {
    nameEl.addEventListener('dblclick', () => {
      const groupId = nameEl.dataset.rename ?? '';
      const input = document.createElement('input');
      input.className = 'cur-rename-input';
      input.value = nameEl.textContent ?? '';
      input.maxLength = 24;
      nameEl.replaceWith(input);
      input.focus();
      input.select();

      const commit = (save: boolean) => {
        if (save) {
          const name = input.value.trim();
          if (name) {
            groupNames[groupId] = name;
            options.onRenameGroup?.(groupId, name);
          }
        }
        if (elementsRef && optionsRef) renderGroupPanels(elementsRef, optionsRef);
      };
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); commit(true); }
        if (event.key === 'Escape') { event.preventDefault(); commit(false); }
      });
      input.addEventListener('blur', () => commit(true));
    });
  }
}

/** hover 详情：委托 + 当前行去重，只在换行时算一次 */
function bindHover(els: CuratedElements): void {
  const host = els.panels as HTMLElement & { __hoverBound?: boolean };
  if (host.__hoverBound) return;
  host.__hoverBound = true;

  let activeRow: HTMLElement | null = null;
  const clear = () => {
    activeRow?.querySelector('.cur-detail')?.classList.remove('visible', 'flip-up');
    activeRow = null;
  };

  host.addEventListener('pointerover', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest<HTMLElement>('.cur-row');
    if (row === activeRow) return;
    clear();
    if (!row) return;
    const detail = row.querySelector<HTMLElement>('.cur-detail');
    if (!detail) return;
    activeRow = row;
    detail.classList.add('visible');
    const rect = row.getBoundingClientRect();
    const detailRect = detail.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    detail.classList.toggle('flip-up', spaceBelow < detailRect.height + 16 && rect.top > detailRect.height + 16);
  });

  host.addEventListener('pointerleave', clear);
  host.addEventListener('focusin', (event) => {
    const t = event.target;
    if (t instanceof HTMLElement) t.closest<HTMLElement>('.cur-row')?.querySelector('.cur-detail')?.classList.add('visible');
  });
  host.addEventListener('focusout', (event) => {
    const t = event.target;
    if (t instanceof HTMLElement) t.closest<HTMLElement>('.cur-row')?.querySelector('.cur-detail')?.classList.remove('visible');
  });
}

export function currentCuration(): { categories: CuratedCategory[]; total: number } {
  return { categories: lastCategories, total: lastTotal };
}

/** 当前所有分组面板 id（供面板布局使用） */
export function groupPanelIds(): string[] {
  return lastCategories.map((g) => groupPanelId(String(g.id)));
}

/** 分组面板 id → 显示名（供面板设置列表用） */
export function groupLabels(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const g of lastCategories) {
    out[groupPanelId(String(g.id))] = groupName(g);
  }
  return out;
}

/** 清空选择状态（重新渲染时调用） */
export function resetSelectionState(): void {
  selected.clear();
  document.getElementById('selectionBar')?.remove();
}
