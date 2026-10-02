/**
 * 仪表盘小部件（widget）注册与配置。
 * 第一个部件是 GitHub 趋势；配置同样落在 chrome.storage.local。
 */

const KEY = 'dashboard_widgets';

/** 小部件配置在 chrome.storage.local 中的键 */
export const WIDGETS_KEY = KEY;

export type WidgetKind = 'github-trending';

export interface WidgetConfig {
  id: string;
  kind: WidgetKind;
  title: string;
  enabled: boolean;
  order: number;
  boardIds: string[];   // 该部件展示的趋势榜单；空数组表示「使用全部已启用榜单」
}

const WIDGET_KINDS: WidgetKind[] = ['github-trending'];

/** 默认：一个启用的 GitHub 趋势部件，boardIds 为空表示跟随全部已启用榜单 */
export function defaultWidgets(): WidgetConfig[] {
  return [
    {
      id: 'github-trending',
      kind: 'github-trending',
      title: 'GitHub 趋势',
      enabled: true,
      order: 0,
      boardIds: [],
    },
  ];
}

/** 防御性归一化：丢弃畸形项、按 id 去重（先出现优先）、按 order 排序；完全不可用时回退默认 */
export function normalizeWidgets(value: unknown): WidgetConfig[] {
  if (!Array.isArray(value)) return defaultWidgets();

  const seen = new Set<string>();
  const widgets: WidgetConfig[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = toText(item.id);
    const kind = toKind(item.kind);
    if (!id || !kind) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    widgets.push({
      id,
      kind,
      title: toText(item.title) || defaultTitle(kind),
      enabled: item.enabled === undefined ? true : item.enabled === true,
      order: toInt(item.order),
      boardIds: uniqueStrings(item.boardIds),
    });
  }

  if (!widgets.length) return defaultWidgets();
  return widgets.sort((a, b) => a.order - b.order);
}

export async function loadWidgets(): Promise<WidgetConfig[]> {
  if (!hasStorage()) return defaultWidgets();
  const got = await chrome.storage.local.get(WIDGETS_KEY);
  return normalizeWidgets(got[WIDGETS_KEY]);
}

export async function saveWidgets(list: WidgetConfig[]): Promise<WidgetConfig[]> {
  const next = normalizeWidgets(list);
  if (hasStorage()) await chrome.storage.local.set({ [WIDGETS_KEY]: next });
  return next;
}

/**
 * 计算部件实际展示的榜单：
 * - boardIds 为空：返回所有已启用榜单的 id（按传入顺序）
 * - 否则：取 boardIds 与榜单集合的交集，保持 boardIds 的顺序，忽略未知 id
 */
export function resolveWidgetBoards(
  widget: WidgetConfig,
  boards: { id: string; enabled: boolean }[],
): string[] {
  if (!widget.boardIds.length) {
    return boards.filter((board) => board.enabled).map((board) => board.id);
  }
  const known = new Map(boards.map((board) => [board.id, board]));
  return widget.boardIds.filter((id) => known.has(id));
}

/** 上移/下移一个部件：纯函数，重排后重新分配连续 order，越界则保持原顺序 */
export function reorderWidgets(
  list: WidgetConfig[],
  id: string,
  direction: -1 | 1,
): WidgetConfig[] {
  const ordered = [...list].sort((a, b) => a.order - b.order);
  const index = ordered.findIndex((widget) => widget.id === id);
  if (index < 0) return ordered;

  const target = index + direction;
  if (target < 0 || target >= ordered.length) return ordered;

  const moved = ordered[index];
  ordered[index] = ordered[target];
  ordered[target] = moved;
  return ordered.map((widget, position) => ({ ...widget, order: position }));
}

/** 测试可桩掉 chrome；无 storage 时读默认、写不抛错 */
function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage) && Boolean(chrome.storage.local);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toKind(value: unknown): WidgetKind | null {
  const text = toText(value);
  return (WIDGET_KINDS as string[]).includes(text) ? text as WidgetKind : null;
}

function defaultTitle(kind: WidgetKind): string {
  return kind === 'github-trending' ? 'GitHub 趋势' : kind;
}

/** order 允许为负；非法值回退 0 */
function toInt(value: unknown): number {
  const raw = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.trunc(raw);
}

function uniqueStrings(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
