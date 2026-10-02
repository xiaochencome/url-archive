/**
 * 工作台面板布局：让用户自由自定义「书签分组 / 小组件 / 备忘」等区块的
 * 顺序、宽度、高度与显隐。
 *
 * 纯逻辑模块（无 DOM），便于单测；真正的拖拽与样式应用在 UI 层完成。
 *
 * 设计要点：
 *   - 基准网格 12 列 → 宽度有 12 档，接近「自由拉伸」，同时仍能对齐；
 *   - heights 记录自定义高度（px），0 表示随内容自适应；
 *   - 书签的每个分组是独立面板（id 形如 `group-ai`），由调用方动态传入 knownIds；
 *   - order 保存展示顺序，新增面板自动出现在末尾，不会因旧布局而丢失。
 */

/**
 * 布局模式。
 *   - 'snap'：12 列吸附网格。自动对齐、自动换行，面板之间互不重叠。
 *             代价是「改一个面板的宽度可能把邻居挤到下一行」——这是流式网格的固有行为。
 *   - 'free'：自由定位。每个面板用像素坐标 (x, y, w, h) 绝对定位，
 *             想放哪放哪、可以重叠，改一个不会影响任何其它面板。
 */
export type PanelLayoutMode = 'snap' | 'masonry' | 'free';

/** 行跨度范围（吸附网格里「1×2」「2×2」的高 = 占几行） */
export const MIN_ROW_SPAN = 1;
export const MAX_ROW_SPAN = 6;

/** 自由模式下面板的位置与尺寸（像素，相对网格容器左上角） */
export interface PanelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 自由模式下的最小尺寸（白板式：可以很小） */
export const MIN_FREE_W = 60;
export const MIN_FREE_H = 40;

/**
 * 自由模式允许的坐标范围。
 * 白板式布局允许负坐标（往左/往上摆），所以下界取一个足够大的负数，
 * 只用来挡住明显异常的存档值，不限制正常使用。
 */
export const MIN_FREE_COORD = -10000;

/** 基准网格列数（12 档兼顾自由度与对齐） */
export const PANEL_GRID_COLUMNS = 12;

/** 面板最小 / 最大占列数 */
export const MIN_SPAN = 2;
export const MAX_SPAN = PANEL_GRID_COLUMNS;

/** 自定义高度的允许区间（px） */
export const MIN_PANEL_HEIGHT = 80;
export const MAX_PANEL_HEIGHT = 2000;

/** 「切换宽度」按钮循环经过的档位 */
export const SPAN_PRESETS = [3, 4, 6, 8, 12];

/** 书签分组面板的 id 前缀：`group-ai`、`group-dev` … */
export const GROUP_PANEL_PREFIX = 'group-';

export function isGroupPanel(id: string): boolean {
  return typeof id === 'string' && id.startsWith(GROUP_PANEL_PREFIX);
}

export interface PanelState {
  id: string;
  /** 占几列（MIN_SPAN ~ PANEL_GRID_COLUMNS） */
  span: number;
  /** 自定义高度（px）；0 表示随内容自适应 */
  height: number;
  hidden: boolean;
}

export interface PanelLayout {
  /** 布局模式：吸附网格 / 自由定位 */
  mode: PanelLayoutMode;
  /** 展示顺序（面板 id） */
  order: string[];
  /** 自由模式下每个面板的位置尺寸（仅 mode === 'free' 时使用） */
  positions: Record<string, PanelBox>;
  /** id → 占列数（宽度） */
  spans: Record<string, number>;
  /** id → 占行数（高度单位）；1 = 单行高 */
  rowSpans: Record<string, number>;
  /** id → 显式列起点（1~12）；0 表示自动排布。用于精确对齐到某一列 */
  colStarts: Record<string, number>;
  /** id → 自定义高度（px），0 = 自适应 */
  heights: Record<string, number>;
  /** 被隐藏的面板 id */
  hidden: string[];
}

/** 静态面板的中文名（动态的书签分组由调用方提供 label） */
export const PANEL_LABELS: Record<string, string> = {
  launcherBlock: '启动器',
  clockBlock: '时间',
  memoBlock: '备忘',
  localBlock: '内网与自建服务',
  frequentBlock: '常用书签',
  tagBlock: '标签整理',
  widgetBlock: 'GitHub 趋势榜',
  githubBlock: 'GitHub 项目',
};

/**
 * 默认顺序。书签分组是动态 id，不在此列表内，
 * 由 normalizePanelLayout 追加到末尾。
 */
export const DEFAULT_PANEL_ORDER = [
  'launcherBlock',
  'clockBlock',
  'memoBlock',
  'localBlock',
  'frequentBlock',
  'tagBlock',
  'widgetBlock',
  'githubBlock',
];

/** 默认列起点：把「备忘」钉到右半边，与「时间」并排对齐 */
const DEFAULT_COL_START: Record<string, number> = {
  // 左列（1~6）
  localBlock: 1,
  clockBlock: 1,
  // 右列（7~12）
  widgetBlock: 7,
  memoBlock: 7,
};

/**
 * 默认占整行的静态面板。
 *
 * 刻意保持为空：两列布局下所有面板默认都进列（半宽），由「较矮列优先」
 * 自动平衡 —— 这样左侧不会被右侧高面板撑出空白。
 * 需要整行的面板（如趋势榜）用户可以点 ⇔ 单独设为占满整行。
 */
const DEFAULT_FULL_WIDTH = new Set<string>([]);

/**
 * 浅拷贝一份布局，并把所有 map / 数组字段都换成独立副本。
 *
 * 之前各函数只重建自己负责的那个字段（`setPanelSpan` 只换 spans、
 * `setPanelSpan` 只换 spans 等），于是未触及的字段与入参共享引用，
 * 调用方改动返回值会**污染入参**。这种不一致已经导致过真实 bug，
 * 这里统一成一个助手，所有返回新布局的地方都走它。
 */
function cloneLayout(layout: PanelLayout): PanelLayout {
  const positions: Record<string, PanelBox> = {};
  for (const [key, value] of Object.entries(layout.positions)) {
    positions[key] = { ...value };
  }
  return {
    mode: layout.mode,
    order: [...layout.order],
    spans: { ...layout.spans },
    rowSpans: { ...layout.rowSpans },
    colStarts: { ...layout.colStarts },
    heights: { ...layout.heights },
    positions,
    hidden: [...layout.hidden],
  };
}

/**
 * 原始值是否为负。
 * 必须先于取整判断：Math.round(-0.4) === -0，而 -0 === 0，
 * 于是 -0.4 会被静默当成「0 / 自动」而不是非法值。
 */
function isNegativeRaw(value: unknown): boolean {
  if (typeof value === 'number') return value < 0;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value.trim());
    return Number.isFinite(n) && n < 0;
  }
  return false;
}

/** 把任意输入转成合法列数，非法返回 null；只接受数字或纯整数字符串 */
export function toSpan(value: unknown): number | null {
  const n = toFiniteInt(value);
  if (n === null) return null;
  if (n < MIN_SPAN || n > MAX_SPAN) return null;
  return n;
}

/**
 * 把任意输入转成合法高度（px），非法返回 null；0 表示自适应。
 *
 * 边界：只有**精确的 0** 才是「自适应」。0.4 这类小数不再被四舍五入成 0
 * （否则 0.4 → 自适应、0.5 → 非法，边界极不对称、难以理解）。
 */
/** 把任意输入转成合法列起点（0 = 自动，或 1~12），非法返回 null */
export function toColStart(value: unknown): number | null {
  if (isNegativeRaw(value)) return null;
  const n = toFiniteInt(value);
  if (n === null) return null;
  if (n === 0) return 0;
  if (n < 1 || n > PANEL_GRID_COLUMNS) return null;
  return n;
}

/**
 * 把任意输入转成合法行跨度，非法返回 null。
 * 0 表示「自动」——由 UI 层按内容实际高度换算成行数。
 */
export function toRowSpan(value: unknown): number | null {
  if (isNegativeRaw(value)) return null;
  const n = toFiniteInt(value);
  if (n === null) return null;
  if (n === 0) return 0;
  if (n < MIN_ROW_SPAN || n > MAX_ROW_SPAN) return null;
  return n;
}

export function toHeight(value: unknown): number | null {
  if (typeof value === 'number') {
    if (value === 0) return 0;
    if (!Number.isFinite(value)) return null;
    if (value < 0) return null;
    const r = Math.round(value);
    if (r < MIN_PANEL_HEIGHT || r > MAX_PANEL_HEIGHT) return null;
    return r;
  }
  if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (n === 0) return 0;
    if (n < MIN_PANEL_HEIGHT || n > MAX_PANEL_HEIGHT) return null;
    return n;
  }
  return null;
}

/**
 * 严格的整数解析。
 * 刻意不接受数组 / 带 toString 的对象 —— 用 parseInt(String(v)) 会把 [3] 变成 3、
 * 把 {toString:()=>'4'} 变成 4，让明显的非法输入悄悄通过。
 */
function toFiniteInt(value: unknown): number | null {
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^[0-9]+$/.test(value.trim())) {
    n = Number(value.trim());
  } else {
    return null;
  }
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/** 默认占列数：书签分组半宽，静态宽面板整行，其余半宽 */
function defaultSpanFor(id: string): number {
  if (isGroupPanel(id)) return 6;
  return DEFAULT_FULL_WIDTH.has(id) ? 12 : 6;
}

export function defaultPanelLayout(knownIds: string[] = DEFAULT_PANEL_ORDER): PanelLayout {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const id of DEFAULT_PANEL_ORDER) {
    if (knownIds.includes(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  }
  for (const id of knownIds) {
    if (!DEFAULT_PANEL_ORDER.includes(id) && !seen.has(id)) { seen.add(id); order.push(id); }
  }
  const spans: Record<string, number> = {};
  const rowSpans: Record<string, number> = {};
  const colStarts: Record<string, number> = {};
  const heights: Record<string, number> = {};
  for (const id of order) {
    spans[id] = defaultSpanFor(id);
    // 0 = 自动：UI 层会按内容实际高度换算成行数，避免「默认 1 行」把内容压扁
    rowSpans[id] = 0;
    // 默认让「时间」占左半、「备忘」钉到右半，两者顶部对齐并排。
    // 其余面板保持自动排布（0），跟着流式网格走。
    colStarts[id] = DEFAULT_COL_START[id] ?? 0;
    heights[id] = 0;
  }
  return { mode: 'snap', order, spans, rowSpans, colStarts, heights, positions: {}, hidden: [] };
}

/**
 * 归一化布局：丢掉已不存在的面板，把新增面板补到末尾。
 * 这样以后加了新模块、或新增了书签分组，老用户的布局不会把它藏起来。
 */
export function normalizePanelLayout(value: unknown, knownIds: string[]): PanelLayout {
  const fallback = defaultPanelLayout(knownIds);
  if (!value || typeof value !== 'object') return fallback;
  const raw = value as Partial<PanelLayout>;
  const known = new Set(knownIds);

  const order: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw.order)) {
    for (const id of raw.order) {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      order.push(id);
    }
  }
  // 新增的面板追加到末尾（同步 seen，避免 knownIds 自带重复时产生重复项）
  for (const id of fallback.order) {
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  if (!order.length) return fallback;

  const rawSpans = isRecord(raw.spans) ? raw.spans : {};
  const rawHeights = isRecord(raw.heights) ? raw.heights : {};
  const rawRowSpans = isRecord(raw.rowSpans) ? raw.rowSpans : {};
  const rawColStarts = isRecord(raw.colStarts) ? raw.colStarts : {};
  const spans: Record<string, number> = {};
  const rowSpans: Record<string, number> = {};
  const colStarts: Record<string, number> = {};
  const heights: Record<string, number> = {};
  for (const id of order) {
    spans[id] = toSpan(rawSpans[id]) ?? fallback.spans[id];
    rowSpans[id] = toRowSpan(rawRowSpans[id]) ?? 0;
    // 缺省时回落到 fallback（默认钉位：clock 第1列 / memo 第7列）。
    // 若一律给 0，老存档（没有 colStarts 键）会丢掉「时间/备忘并排」的默认布局。
    colStarts[id] = toColStart(rawColStarts[id]) ?? fallback.colStarts[id] ?? 0;
    heights[id] = toHeight(rawHeights[id]) ?? 0;
  }

  const hidden: string[] = [];
  if (Array.isArray(raw.hidden)) {
    for (const id of raw.hidden) {
      if (typeof id === 'string' && known.has(id) && !hidden.includes(id)) hidden.push(id);
    }
  }

  const mode: PanelLayoutMode =
    raw.mode === 'free' ? 'free' : raw.mode === 'masonry' ? 'masonry' : 'snap';

  // 自由模式的位置：只保留仍然存在的面板，非法值丢弃（下次会按网格自动铺开）
  const positions: Record<string, PanelBox> = {};
  if (isRecord(raw.positions)) {
    for (const id of order) {
      const box = toPanelBox(raw.positions[id]);
      if (box) positions[id] = box;
    }
  }

  return { mode, order, spans, rowSpans, colStarts, heights, positions, hidden };
}

/** 把任意输入转成合法的面板位置盒，非法返回 null */
/** 坐标 / 尺寸的合理上界，防止异常存档把面板推到看不见的地方 */
export const MAX_FREE_COORD = 20000;
export const MAX_FREE_SIZE = 20000;

export function toPanelBox(value: unknown): PanelBox | null {
  if (!isRecord(value)) return null;
  const x = toFiniteInt(value.x);
  const y = toFiniteInt(value.y);
  const w = toFiniteInt(value.w);
  const h = toFiniteInt(value.h);
  if (x === null || y === null || w === null || h === null) return null;

  // 白板式：允许负坐标（往左/往上摆），只挡住异常极值
  if (x < MIN_FREE_COORD || y < MIN_FREE_COORD) return null;
  if (w < MIN_FREE_W || h < MIN_FREE_H) return null;
  if (x > MAX_FREE_COORD || y > MAX_FREE_COORD) return null;
  if (w > MAX_FREE_SIZE || h > MAX_FREE_SIZE) return null;

  // 归一化 -0 为 0，避免 Object.is 层面出现反直觉的值
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y, w, h };
}

/** 设置面板在自由模式下的位置尺寸 */
export function setPanelBox(layout: PanelLayout, id: string, box: PanelBox): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const safe = toPanelBox(box);
  if (!safe) return layout;
  // 逐个复制盒子对象。只做 { ...positions } 是浅拷贝，未改动的 id 仍与入参
  // 共享同一个盒子引用 —— 调用方改返回值会连带污染入参，与同模块其它函数
  // （movePanel / togglePanelHidden 都做独立副本）的不可变约定不一致。
  const next = cloneLayout(layout);
  next.positions[id] = safe;
  return next;
}

/** 切换布局模式 */
export function setLayoutMode(layout: PanelLayout, mode: PanelLayoutMode): PanelLayout {
  return { ...cloneLayout(layout), mode };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 把面板移动到目标位置。
 * toIndex 会被取整并夹到合法范围 —— NaN / 小数 / 越界值都不该产生意外位置。
 */
export function movePanel(layout: PanelLayout, id: string, toIndex: number): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const order = layout.order.filter((x) => x !== id);
  const raw = Math.trunc(Number(toIndex));
  const safe = Number.isFinite(raw) ? raw : order.length;
  const index = Math.max(0, Math.min(safe, order.length));
  order.splice(index, 0, id);
  return { ...cloneLayout(layout), order };
}

/** 设置面板占列数；非法值回退到该面板的默认值 */
export function setPanelSpan(layout: PanelLayout, id: string, span: number): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const safe = toSpan(span) ?? defaultSpanFor(id);
  const next = cloneLayout(layout);
  next.spans[id] = safe;
  return next;
}

/** 设置显式列起点（0 = 自动，1~12 = 对齐到该列） */
export function setPanelColStart(layout: PanelLayout, id: string, col: number): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const safe = toColStart(col) ?? 0;
  const next = cloneLayout(layout);
  next.colStarts[id] = safe;
  return next;
}

/** 设置行跨度（吸附网格里的高度单位数） */
export function setPanelRowSpan(layout: PanelLayout, id: string, rows: number): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const safe = toRowSpan(rows) ?? 0;
  const next = cloneLayout(layout);
  next.rowSpans[id] = safe;
  return next;
}

/** 设置自定义高度；0 表示自适应 */
export function setPanelHeight(layout: PanelLayout, id: string, height: number): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const safe = toHeight(height) ?? 0;
  const next = cloneLayout(layout);
  next.heights[id] = safe;
  return next;
}

/**
 * 循环切换宽度档位（SPAN_PRESETS）。
 * 12 列下手动拖拽更自然，这个按钮只作为「一键跳到下一档」的快捷方式。
 */
export function cyclePanelSpan(layout: PanelLayout, id: string): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const current = toSpan(layout.spans[id]) ?? defaultSpanFor(id);
  // 严格大于当前档位的第一个预设值；没有则回绕到最小档
  // （不能用 findIndex(s => s >= current)，那会让 9/10/11 回绕到 3 而不是前进）
  const nextSpan = SPAN_PRESETS.find((s) => s > current) ?? SPAN_PRESETS[0];
  const next = cloneLayout(layout);
  next.spans[id] = nextSpan;
  return next;
}

/** 显示/隐藏面板 */
export function togglePanelHidden(layout: PanelLayout, id: string): PanelLayout {
  if (!layout.order.includes(id)) return layout;
  const hidden = layout.hidden.includes(id)
    ? layout.hidden.filter((x) => x !== id)
    : [...layout.hidden, id];
  return { ...cloneLayout(layout), hidden };
}

/** 恢复默认布局 */
export function resetPanelLayout(knownIds: string[]): PanelLayout {
  return defaultPanelLayout(knownIds);
}

/** 面板是否可见 */
export function isPanelVisible(layout: PanelLayout, id: string): boolean {
  return !layout.hidden.includes(id);
}

/** 供设置面板展示的列表（按当前顺序，带名称与状态） */
export function panelListForSettings(
  layout: PanelLayout,
  labels: Record<string, string> = PANEL_LABELS,
): { id: string; label: string; span: number; rowSpan: number; colStart: number; height: number; hidden: boolean }[] {
  return layout.order.map((id) => ({
    id,
    label: labels[id] ?? PANEL_LABELS[id] ?? id,
    span: toSpan(layout.spans[id]) ?? defaultSpanFor(id),
    rowSpan: toRowSpan(layout.rowSpans[id]) ?? 0,
    colStart: toColStart(layout.colStarts[id]) ?? 0,
    height: toHeight(layout.heights[id]) ?? 0,
    hidden: layout.hidden.includes(id),
  }));
}

/**
 * 计算拖拽落点应插入到第几个位置。
 *
 * 之前的做法是「找中心距离最近的面板」，鼠标只动几像素、最近中心就可能换成
 * 另一个面板，于是 order 大改、面板视觉上「一下子跳到别处」。
 *
 * 现在改为「阅读顺序比较」，语义稳定：
 *   - 指针在某个面板的上方 / 下方 → 直接判定在前 / 在后；
 *   - 指针与面板纵向重叠 → 用横向中线判断，并留 DEAD_ZONE 的死区，
 *     避免在临界点反复横跳。
 *
 * @param rects  按当前视觉顺序排列的面板矩形（已排除被拖动的那个）
 * @param pointer 指针坐标
 * @returns 插入下标（0..rects.length）
 */
export const DROP_DEAD_ZONE = 10;

export function computeDropIndex(
  rects: { left: number; top: number; right: number; bottom: number }[],
  pointer: { x: number; y: number },
  previous?: { index: number; before: boolean } | null,
): number {
  if (!rects.length) return 0;

  // 指针在所有面板上方 → 插到最前
  if (pointer.y < rects[0].top) return 0;

  // 按「行」分组。这一步是关键：
  // 早先的实现一旦遇到纵向重叠的矩形就立刻 return，于是同一行里
  // 后面的矩形根本没机会参与横向判定 —— 一行有 A B C 时，指针悬在 C 上
  // 却只能落到 B 前面，「明明有空间却拖不进去」就是这么来的。
  const rows: { index: number; rect: (typeof rects)[number] }[][] = [];
  for (let i = 0; i < rects.length; i += 1) {
    const r = rects[i];
    const last = rows[rows.length - 1];
    if (last) {
      const rowTop = Math.min(...last.map((x) => x.rect.top));
      const rowBottom = Math.max(...last.map((x) => x.rect.bottom));
      const overlap = Math.min(rowBottom, r.bottom) - Math.max(rowTop, r.top);
      const minHeight = Math.min(rowBottom - rowTop, r.bottom - r.top);
      // 纵向重叠超过较矮者的 50% 视为同一行
      if (minHeight > 0 && overlap > minHeight * 0.5) {
        last.push({ index: i, rect: r });
        continue;
      }
    }
    rows.push([{ index: i, rect: r }]);
  }

  // 找到指针所在（或最接近的下一个）行
  let row = rows[rows.length - 1];
  for (const candidate of rows) {
    const bottom = Math.max(...candidate.map((x) => x.rect.bottom));
    if (pointer.y <= bottom) { row = candidate; break; }
  }
  // 指针在所有面板下方 → 插到最后
  if (pointer.y > Math.max(...row.map((x) => x.rect.bottom))) return rects.length;

  // 行内对所有矩形做横向比较，这样同一行里的每个落点都能到达
  for (const cell of row) {
    const { left, right } = cell.rect;
    const cx = left + (right - left) / 2;
    if (pointer.x < cx - DROP_DEAD_ZONE) return cell.index;
    if (pointer.x > cx + DROP_DEAD_ZONE) continue;

    // 落在死区内：沿用上一次的判定，避免临界点反复横跳
    if (previous) {
      if (previous.index === cell.index) return previous.before ? cell.index : cell.index + 1;
      if (previous.index === cell.index + 1) return cell.index + 1;
    }
    return cell.index;
  }

  // 在该行最右侧之外 → 插到这一行最后一个面板之后
  return row[row.length - 1].index + 1;
}

/**
 * 把面板移动到「某个锚点面板」的前面或后面。
 *
 * 这是 dense 装箱下唯一正确的拖拽语义：
 *   dense 会让「视觉顺序 ≠ order」，所以**不能**用视觉序列去整体重写 order
 *   （那会摧毁装箱优先级，被拖的面板总是弹回最前）。
 *   改为「相对锚点移动」——用户的心智模型也正是「放到这个面板旁边」。
 *
 * 隐藏面板留在原位不动。
 */
export function moveNextTo(
  layout: PanelLayout,
  draggedId: string,
  anchorId: string,
  before: boolean,
): PanelLayout {
  if (draggedId === anchorId) return layout;
  if (!layout.order.includes(draggedId) || !layout.order.includes(anchorId)) return layout;

  const order = layout.order.filter((id) => id !== draggedId);
  const anchorAt = order.indexOf(anchorId);
  if (anchorAt < 0) return layout;
  order.splice(before ? anchorAt : anchorAt + 1, 0, draggedId);
  return { ...cloneLayout(layout), order };
}

/* ---------------------------------------------------------- 瀑布流装箱 */

/** 瀑布流输入项 */
export interface MasonryItem {
  id: string;
  /** 内容高度（px） */
  h: number;
  /** 占几列（1 = 单列宽） */
  span: number;
}

/** 瀑布流结果 */
export interface MasonryPlacement {
  id: string;
  /** 0-based 列 */
  col: number;
  /** px 纵向位置 */
  y: number;
  /** 占几列 */
  span: number;
}

/**
 * 最短列优先装箱（Pinterest 式瀑布流）。
 *
 * 为什么需要它：CSS Grid 里**同一行的所有面板会被拉成等高**，
 * 所以只要右侧有个很高的面板（比如趋势榜），左侧那一整行就会留下大片空白 ——
 * 这正是「排版不够自由、明明有空间却填不上」的根因。
 *
 * 瀑布流让每列独立堆叠，互不影响，空隙自然消失。
 *
 * @param items     按 order 排列的面板（含实测高度）
 * @param columns   总列数
 * @param colWidth  单列宽度（px）
 * @param gap       面板间距（px）
 */
export function packMasonry(
  items: MasonryItem[],
  columns: number,
  colWidth: number,
  gap: number,
): { placements: MasonryPlacement[]; totalHeight: number } {
  if (columns < 1 || colWidth <= 0) return { placements: [], totalHeight: 0 };
  // 每列的当前底部 y
  const bottoms = new Array<number>(columns).fill(0);
  const placements: MasonryPlacement[] = [];

  for (const item of items) {
    const span = Math.max(1, Math.min(Math.trunc(item.span) || 1, columns));
    const h = Math.max(1, Math.round(item.h));

    // 找一个能放下 span 列、且底部最低的起始列
    let bestCol = 0;
    let bestBottom = Infinity;
    for (let c = 0; c + span <= columns; c += 1) {
      let bottom = 0;
      for (let k = 0; k < span; k += 1) bottom = Math.max(bottom, bottoms[c + k]);
      if (bottom < bestBottom) {
        bestBottom = bottom;
        bestCol = c;
      }
    }

    placements.push({ id: item.id, col: bestCol, y: bestBottom, span });
    for (let k = 0; k < span; k += 1) bottoms[bestCol + k] = bestBottom + h + gap;
  }

  return { placements, totalHeight: Math.max(0, Math.max(0, ...bottoms) - gap) };
}

/* ---------------------------------------------------- 吸附布局分列 */

/** 12 列体系下，占列数达到这个值就视为「占满整行」 */
export const FULL_ROW_MIN_SPAN = 7;

/** 吸附布局输入项 */
export interface SnapItem {
  id: string;
  /** 12 列体系下的占列数（>= FULL_ROW_MIN_SPAN 独占一整行） */
  span: number;
  /** 预估高度（px），用于挑「较矮的一列」 */
  h: number;
  /** 显式列起点：0 = 自动，1~6 → 左列，7~12 → 右列 */
  colStart: number;
}

/** 吸附布局结果：面板落到第几列（占满整行的面板由调用方单独成行） */
export interface SnapPlacement {
  id: string;
  /** 0-based 列号；full 的面板恒为 0 */
  col: number;
  /** 是否横跨所有列 */
  full: boolean;
}

/**
 * 把面板分配到各列。
 *
 * 为什么不用 CSS Grid 的自动排布：同一行的网格项会被拉成等高，
 * 右侧一个高面板（趋势榜）就会让左侧那一整行留下大片空白 ——
 * 正是「明明有空间却填不上」的根因。所以这里只决定「进哪一列」，
 * 每列由调用方渲染成独立的纵向容器，列与列互不共享行高，空隙自然消失。
 *
 * 规则：
 *   - 整行面板（span >= 7）不参与分列，调用方把它们排在最上面；
 *   - 指定列起点的面板钉到对应那列（1~6 左、7~12 右）；
 *   - 其余面板进「累计高度更矮」的那一列，于是两列自然平衡。
 *
 * @param items   按 order 排列的面板
 * @param columns 总列数（窄屏为 1）
 */
export function planSnapColumns(items: SnapItem[], columns: number): SnapPlacement[] {
  const cols = Math.max(1, Math.trunc(columns) || 1);
  const placements: SnapPlacement[] = [];
  const heights = new Array<number>(cols).fill(0);
  const counts = new Array<number>(cols).fill(0);

  /** 「更矮优先，同样矮则块数少者优先」——高度全 0 时也能均匀铺开 */
  const shortestColumn = (): number => {
    let best = 0;
    for (let c = 1; c < cols; c += 1) {
      if (heights[c] < heights[best]) best = c;
      else if (heights[c] === heights[best] && counts[c] < counts[best]) best = c;
    }
    return best;
  };

  for (const item of items) {
    const h = Math.max(0, Math.round(item.h || 0));

    if (Math.trunc(item.span) >= FULL_ROW_MIN_SPAN) {
      placements.push({ id: item.id, col: 0, full: true });
      continue;
    }

    const pinned = item.colStart >= 1 && item.colStart <= 6
      ? 0
      : item.colStart >= 7 ? cols - 1 : -1;
    const col = pinned >= 0 ? pinned : shortestColumn();

    placements.push({ id: item.id, col, full: false });
    heights[col] += h;
    counts[col] += 1;
  }

  return placements;
}

/** 宽度占整行的百分比（用于设置面板显示，如 "50%"） */
export function spanPercent(span: number): number {
  const safe = toSpan(span) ?? 6;
  return Math.round((safe / PANEL_GRID_COLUMNS) * 100);
}
