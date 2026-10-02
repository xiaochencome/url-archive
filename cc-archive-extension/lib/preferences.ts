import type { PanelLayout } from './panel-layout';

const KEY = 'new_tab_prefs';

export type NewTabDensity = 'compact' | 'standard' | 'large';
export type NewTabTheme = 'light' | 'dark';
export type NewTabDisplayFont = 'system' | 'smiley-sans';
/** 卡片排序方式（与 tag-organizer 的 CardSortKey 保持一致，避免循环依赖） */
export type NewTabCardSort = 'recent' | 'title' | 'domain' | 'frequent' | 'manual';

export interface NewTabSearchEngine {
  id: string;
  name: string;
  url: string;
  icon?: string;
}

export interface NewTabPrefs {
  density: NewTabDensity;
  theme: NewTabTheme;
  rightPanelCollapsed: boolean;
  backgroundImageUrl: string;
  /** 背景视频地址：内置 '/wallpaper/cca-bg.mp4' 或用户自填 URL / 本地 blob 键 */
  backgroundVideoUrl: string;
  /** 背景视频开关（关掉后回退到静态壁纸） */
  backgroundVideoEnabled: boolean;
  /** 背景类型：动态视频 / 静态壁纸 */
  backgroundKind: 'video' | 'image';
  wallpaperMask: number;
  wallpaperBlur: number;
  gridColumns: number;
  gridRows: number;
  cardRadius: number;
  iconSize: number;
  columnGap: number;
  rowGap: number;
  showLabels: boolean;
  /** 是否在卡片上显示标签 */
  showTags: boolean;
  /** 是否在卡片上显示摘要（信息密度） */
  showSummary: boolean;
  /** 卡片信息密度：紧凑显示更多行 */
  cardDensity: 'compact' | 'comfortable';
  /** 卡片排序 */
  cardSort: NewTabCardSort;
  galleryMode: boolean;
  iconGlow: boolean;
  /** 组件发光（卡片/挂件外发光） */
  glowEnabled: boolean;
  /** 发光可爱鼠标 */
  cuteCursor: boolean;
  /** 3D Tilt / 鼠标视差 */
  tiltEnabled: boolean;
  /** 最大倾斜角度（度） */
  tiltMaxDeg: number;
  /** 悬停放大倍数（100 = 1.00） */
  tiltScale: number;
  /** 阴影位移（px） */
  tiltShadow: number;
  /** 图标层 translateZ（px） */
  tiltLift: number;
  /** 文字层 translateZ（px） */
  tiltTextLift: number;
  /** 透视距离（px） */
  tiltPerspective: number;
  /** 是否让书签行/榜单行也单独倾斜（关闭则只有大卡片倾斜） */
  tiltOnRows: boolean;
  /** 删除书签前是否二次确认（可关闭，关闭后直接删） */
  confirmBeforeDelete: boolean;
  /** 操作后是否显示浮动提示（toast） */
  showToast: boolean;
  /** 工作台面板布局（顺序/宽度/显隐）；null 表示默认 */
  panelLayout: PanelLayout | null;
  /** 是否接管新标签页（关闭后由 background 重定向到主页） */
  newTabTakeover: boolean;
  /** 关闭接管后的跳转地址；留空则用当前搜索引擎主页 */
  newTabRedirectUrl: string;
  /** 是否显示 GitHub 项目模块 */
  githubProjectsEnabled: boolean;
  /** 是否显示小组件区（GitHub 趋势榜等） */
  widgetsEnabled: boolean;
  /** GitHub API Token（可选，提高速率上限） */
  githubToken: string;
  /** 精选保留比例（0~1），默认 0.1 即裁掉约 90% */
  curateKeepRatio: number;
  /** 每个主类最多展示条数 */
  curatePerCategory: number;
  /** 是否启用「精选清洗」（默认关闭：先完整展示，由用户主动开启） */
  curateEnabled: boolean;
  /** 是否显示「常用书签」面板（精选列表已按重要度排序，默认关闭避免重复） */
  showFrequentPanel: boolean;
  /** 是否显示「标签整理」面板（默认关闭，避免信息过载） */
  showTagPanel: boolean;
  searchBoxVisible: boolean;
  searchBoxWidth: number;
  searchBoxRadius: number;
  fontFamily: NewTabDisplayFont;
  fontShadow: boolean;
  fontSize: number;
  searchEngines: NewTabSearchEngine[];
  searchEngineId: string;
}

export const DEFAULT_SEARCH_ENGINES: NewTabSearchEngine[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', icon: '/engine/google.png' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', icon: '/engine/bing_new.png' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s', icon: '/engine/baidu.png' },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text=%s', icon: '/engine/yandex.png' },
];

/** 背景视频：不内置视频素材（体积与版权），默认空 → 回落到图片壁纸；用户可自填 URL */
export const DEFAULT_BACKGROUND_VIDEO = '';

/**
 * 旧版本随包分发的内置背景视频（`/wallpaper/*.mp4`）。素材已下架，
 * 老用户的偏好里还留着这些路径，读到时必须回落到静态壁纸，否则背景是 404。
 */
function isRemovedBuiltinVideo(url: string): boolean {
  return /^\/wallpaper\/[^/]+\.mp4$/i.test(url);
}

/** 背景视频地址 + 背景类型：清掉失效的内置素材，没有可用视频源时不可能是「视频」 */
export function normalizeBackground(
  raw: { backgroundVideoUrl?: unknown; backgroundKind?: unknown },
  fallbackKind: NewTabPrefs['backgroundKind'],
): Pick<NewTabPrefs, 'backgroundVideoUrl' | 'backgroundKind'> {
  const url = typeof raw.backgroundVideoUrl === 'string' ? raw.backgroundVideoUrl.trim() : '';
  const backgroundVideoUrl = isRemovedBuiltinVideo(url) ? '' : url;
  const backgroundKind: NewTabPrefs['backgroundKind'] = !backgroundVideoUrl
    ? 'image'
    : raw.backgroundKind === 'video' || raw.backgroundKind === 'image'
      ? raw.backgroundKind
      : fallbackKind;
  return { backgroundVideoUrl, backgroundKind };
}

const DEFAULT_PREFS: NewTabPrefs = {
  density: 'large',
  theme: 'dark',
  rightPanelCollapsed: true,
  backgroundImageUrl: '',
  backgroundVideoUrl: DEFAULT_BACKGROUND_VIDEO,
  backgroundVideoEnabled: true,
  backgroundKind: 'image',
  wallpaperMask: 58,
  wallpaperBlur: 0,
  gridColumns: 4,
  gridRows: 3,
  cardRadius: 18,
  iconSize: 100,
  columnGap: 20,
  rowGap: 20,
  showLabels: true,
  showTags: true,
  showSummary: true,
  cardDensity: 'comfortable',
  cardSort: 'frequent',
  galleryMode: false,
  iconGlow: false,
  glowEnabled: true,
  cuteCursor: true,
  tiltEnabled: true,
  tiltMaxDeg: 10,
  tiltScale: 1.03,
  tiltShadow: 16,
  tiltLift: 16,
  tiltTextLift: 30,
  tiltPerspective: 900,
  tiltOnRows: true,
  confirmBeforeDelete: true,
  showToast: true,
  panelLayout: null,
  newTabTakeover: true,
  newTabRedirectUrl: '',
  githubProjectsEnabled: true,
  widgetsEnabled: true,
  githubToken: '',
  curateKeepRatio: 0.1,
  curatePerCategory: 14,
  curateEnabled: false,
  showFrequentPanel: false,
  showTagPanel: false,
  searchBoxVisible: true,
  searchBoxWidth: 75,
  searchBoxRadius: 9,
  fontFamily: 'system',
  fontShadow: true,
  fontSize: 13,
  searchEngines: DEFAULT_SEARCH_ENGINES.map((engine) => ({ ...engine })),
  searchEngineId: 'google',
};

export async function loadNewTabPrefs(): Promise<NewTabPrefs> {
  const got = await chrome.storage.local.get(KEY);
  return normalizePrefs(got[KEY]);
}

export async function saveNewTabPrefs(update: Partial<NewTabPrefs>): Promise<NewTabPrefs> {
  const current = await loadNewTabPrefs();
  const next = normalizePrefs({ ...current, ...update });
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export async function replaceNewTabPrefs(value: NewTabPrefs): Promise<NewTabPrefs> {
  const next = normalizePrefs(value);
  await chrome.storage.local.set({ [KEY]: next });
  return next;
}

export function normalizePrefs(value: unknown): NewTabPrefs {
  const raw = isRecord(value) ? value : {};
  const prefs = {
    density: isDensity(raw.density) ? raw.density : DEFAULT_PREFS.density,
    theme: isTheme(raw.theme) ? raw.theme : DEFAULT_PREFS.theme,
    rightPanelCollapsed: typeof raw.rightPanelCollapsed === 'boolean'
      ? raw.rightPanelCollapsed
      : DEFAULT_PREFS.rightPanelCollapsed,
    backgroundImageUrl: typeof raw.backgroundImageUrl === 'string'
      ? raw.backgroundImageUrl.trim()
      : DEFAULT_PREFS.backgroundImageUrl,
    backgroundVideoEnabled: typeof raw.backgroundVideoEnabled === 'boolean'
      ? raw.backgroundVideoEnabled
      : DEFAULT_PREFS.backgroundVideoEnabled,
    ...normalizeBackground(raw, DEFAULT_PREFS.backgroundKind),
    wallpaperMask: positiveInt(raw.wallpaperMask, DEFAULT_PREFS.wallpaperMask, 0, 100),
    wallpaperBlur: positiveInt(raw.wallpaperBlur, DEFAULT_PREFS.wallpaperBlur, 0, 100),
    gridColumns: positiveInt(raw.gridColumns, DEFAULT_PREFS.gridColumns, 2, 12),
    gridRows: positiveInt(raw.gridRows, DEFAULT_PREFS.gridRows, 1, 8),
    cardRadius: positiveInt(raw.cardRadius, DEFAULT_PREFS.cardRadius, 0, 50),
    iconSize: positiveInt(raw.iconSize, DEFAULT_PREFS.iconSize, 50, 150),
    columnGap: positiveInt(raw.columnGap, DEFAULT_PREFS.columnGap, 0, 120),
    rowGap: positiveInt(raw.rowGap, DEFAULT_PREFS.rowGap, 0, 120),
    showLabels: typeof raw.showLabels === 'boolean' ? raw.showLabels : DEFAULT_PREFS.showLabels,
    showTags: typeof raw.showTags === 'boolean' ? raw.showTags : DEFAULT_PREFS.showTags,
    showSummary: typeof raw.showSummary === 'boolean' ? raw.showSummary : DEFAULT_PREFS.showSummary,
    cardDensity: isCardDensity(raw.cardDensity) ? raw.cardDensity : DEFAULT_PREFS.cardDensity,
    cardSort: isCardSort(raw.cardSort) ? raw.cardSort : DEFAULT_PREFS.cardSort,
    galleryMode: typeof raw.galleryMode === 'boolean' ? raw.galleryMode : DEFAULT_PREFS.galleryMode,
    iconGlow: typeof raw.iconGlow === 'boolean' ? raw.iconGlow : DEFAULT_PREFS.iconGlow,
    glowEnabled: typeof raw.glowEnabled === 'boolean' ? raw.glowEnabled : DEFAULT_PREFS.glowEnabled,
    cuteCursor: typeof raw.cuteCursor === 'boolean' ? raw.cuteCursor : DEFAULT_PREFS.cuteCursor,
    tiltEnabled: typeof raw.tiltEnabled === 'boolean' ? raw.tiltEnabled : DEFAULT_PREFS.tiltEnabled,
    tiltMaxDeg: positiveInt(raw.tiltMaxDeg, DEFAULT_PREFS.tiltMaxDeg, 0, 30),
    tiltScale: scaleMultiplier(raw.tiltScale, DEFAULT_PREFS.tiltScale, 1, 1.2),
    tiltShadow: positiveInt(raw.tiltShadow, DEFAULT_PREFS.tiltShadow, 0, 60),
    tiltLift: positiveInt(raw.tiltLift, DEFAULT_PREFS.tiltLift, 0, 80),
    tiltTextLift: positiveInt(raw.tiltTextLift, DEFAULT_PREFS.tiltTextLift, 0, 120),
    tiltPerspective: positiveInt(raw.tiltPerspective, DEFAULT_PREFS.tiltPerspective, 300, 3000),
    tiltOnRows: typeof raw.tiltOnRows === 'boolean' ? raw.tiltOnRows : DEFAULT_PREFS.tiltOnRows,
    confirmBeforeDelete: typeof raw.confirmBeforeDelete === 'boolean' ? raw.confirmBeforeDelete : DEFAULT_PREFS.confirmBeforeDelete,
    showToast: typeof raw.showToast === 'boolean' ? raw.showToast : DEFAULT_PREFS.showToast,
    panelLayout: normalizePanelLayoutValue(raw.panelLayout),
    newTabTakeover: typeof raw.newTabTakeover === 'boolean' ? raw.newTabTakeover : DEFAULT_PREFS.newTabTakeover,
    newTabRedirectUrl: typeof raw.newTabRedirectUrl === 'string'
      ? raw.newTabRedirectUrl.trim()
      : DEFAULT_PREFS.newTabRedirectUrl,
    githubProjectsEnabled: typeof raw.githubProjectsEnabled === 'boolean'
      ? raw.githubProjectsEnabled
      : DEFAULT_PREFS.githubProjectsEnabled,
    widgetsEnabled: typeof raw.widgetsEnabled === 'boolean' ? raw.widgetsEnabled : DEFAULT_PREFS.widgetsEnabled,
    githubToken: typeof raw.githubToken === 'string' ? raw.githubToken.trim() : DEFAULT_PREFS.githubToken,
    curateKeepRatio: ratio(raw.curateKeepRatio, DEFAULT_PREFS.curateKeepRatio),
    curatePerCategory: positiveInt(raw.curatePerCategory, DEFAULT_PREFS.curatePerCategory, 3, 40),
    curateEnabled: typeof raw.curateEnabled === 'boolean' ? raw.curateEnabled : DEFAULT_PREFS.curateEnabled,
    showFrequentPanel: typeof raw.showFrequentPanel === 'boolean' ? raw.showFrequentPanel : DEFAULT_PREFS.showFrequentPanel,
    showTagPanel: typeof raw.showTagPanel === 'boolean' ? raw.showTagPanel : DEFAULT_PREFS.showTagPanel,
    searchBoxVisible: typeof raw.searchBoxVisible === 'boolean' ? raw.searchBoxVisible : DEFAULT_PREFS.searchBoxVisible,
    searchBoxWidth: positiveInt(raw.searchBoxWidth, DEFAULT_PREFS.searchBoxWidth, 50, 100),
    searchBoxRadius: positiveInt(raw.searchBoxRadius, DEFAULT_PREFS.searchBoxRadius, 0, 50),
    fontFamily: isDisplayFont(raw.fontFamily) ? raw.fontFamily : DEFAULT_PREFS.fontFamily,
    fontShadow: typeof raw.fontShadow === 'boolean' ? raw.fontShadow : DEFAULT_PREFS.fontShadow,
    fontSize: positiveInt(raw.fontSize, DEFAULT_PREFS.fontSize, 10, 18),
    searchEngines: normalizeEngines(raw.searchEngines),
    searchEngineId: typeof raw.searchEngineId === 'string' && raw.searchEngineId
      ? raw.searchEngineId
      : DEFAULT_PREFS.searchEngineId,
  };
  // ── 布局迁移 ──────────────────────────────────────────────
  // 只迁移「从未自定义过布局」的用户（即各项都还停在某个历史默认值上），
  // 用户手动调过的列数/间距一律不动。
  const layout = (columns: number, rows: number, radius: number, icon: number, col: number, row: number) =>
    prefs.gridColumns === columns &&
    prefs.gridRows === rows &&
    prefs.cardRadius === radius &&
    prefs.iconSize === icon &&
    prefs.columnGap === col &&
    prefs.rowGap === row;

  const cardLayoutDefaults = {
    gridColumns: DEFAULT_PREFS.gridColumns,
    gridRows: DEFAULT_PREFS.gridRows,
    cardRadius: DEFAULT_PREFS.cardRadius,
    columnGap: DEFAULT_PREFS.columnGap,
    rowGap: DEFAULT_PREFS.rowGap,
  };

  // 最老的「图标墙」默认值（6 列 / 48·50 间距）→ 卡片布局
  if (layout(6, 3, 24, 100, 48, 50)) {
    return {
      ...prefs,
      ...cardLayoutDefaults,
      // 卡片视图才谈得上可读性，旧默认的画廊/光晕一并关掉
      galleryMode: false,
      iconGlow: false,
    };
  }
  // 中间版本的预设（5×2）
  if (layout(5, 2, 26, 100, 24, 30)) {
    return { ...prefs, ...cardLayoutDefaults };
  }
  // 只调过间距的那一版
  if (layout(6, 3, 24, DEFAULT_PREFS.iconSize, 38, 44)) {
    return {
      ...prefs,
      columnGap: DEFAULT_PREFS.columnGap,
      rowGap: DEFAULT_PREFS.rowGap,
    };
  }
  return prefs;
}

function normalizeEngines(value: unknown): NewTabSearchEngine[] {
  if (!Array.isArray(value)) return DEFAULT_SEARCH_ENGINES.map((engine) => ({ ...engine }));
  const engines = value
    .filter(isRecord)
    .filter((raw) => typeof raw.id === 'string' && typeof raw.name === 'string' && typeof raw.url === 'string')
    .map((raw) => {
      const engine: NewTabSearchEngine = { id: raw.id as string, name: raw.name as string, url: raw.url as string };
      const icon = typeof raw.icon === 'string' && raw.icon
        ? raw.icon
        : DEFAULT_SEARCH_ENGINES.find((preset) => preset.id === engine.id)?.icon;
      if (icon) engine.icon = icon;
      return engine;
    });
  return engines.length ? engines : DEFAULT_SEARCH_ENGINES.map((engine) => ({ ...engine }));
}

function positiveInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

/** 缩放倍数（1.0 = 原始大小），夹到 [min, max] 并保留两位小数 */
function scaleMultiplier(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return Math.round(clamped * 100) / 100;
}

/** 面板布局：只做浅校验，具体归一化交给 panel-layout.normalizePanelLayout */
function normalizePanelLayoutValue(value: unknown): PanelLayout | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<PanelLayout>;
  if (!Array.isArray(raw.order)) return null;
  const order = raw.order.filter((x): x is string => typeof x === 'string');
  if (!order.length) return null;
  const spans: Record<string, number> = {};
  if (raw.spans && typeof raw.spans === 'object') {
    for (const [k, v] of Object.entries(raw.spans as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) spans[k] = v;
    }
  }
  const heights: Record<string, number> = {};
  if (raw.heights && typeof raw.heights === 'object') {
    for (const [k, v] of Object.entries(raw.heights as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) heights[k] = v;
    }
  }
  // 行跨度（吸附网格的高度单位数），详细校验交给 toRowSpan
  const rowSpans: Record<string, number> = {};
  if (raw.rowSpans && typeof raw.rowSpans === 'object') {
    for (const [k, v] of Object.entries(raw.rowSpans as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) rowSpans[k] = v;
    }
  }
  // 显式列起点（0 = 自动）
  const colStarts: Record<string, number> = {};
  if (raw.colStarts && typeof raw.colStarts === 'object') {
    for (const [k, v] of Object.entries(raw.colStarts as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v)) colStarts[k] = v;
    }
  }
  const hidden = Array.isArray(raw.hidden) ? raw.hidden.filter((x): x is string => typeof x === 'string') : [];

  // 自由模式的位置盒（浅校验，详细校验交给 toPanelBox）
  const positions: Record<string, { x: number; y: number; w: number; h: number }> = {};
  if (raw.positions && typeof raw.positions === 'object') {
    for (const [k, v] of Object.entries(raw.positions as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const box = v as Record<string, unknown>;
      const nums = ['x', 'y', 'w', 'h'].map((f) => box[f]);
      if (nums.every((n) => typeof n === 'number' && Number.isFinite(n))) {
        positions[k] = { x: nums[0] as number, y: nums[1] as number, w: nums[2] as number, h: nums[3] as number };
      }
    }
  }

  return { mode: raw.mode === 'free' ? 'free' : 'snap', order, spans, rowSpans, colStarts, heights, positions, hidden };
}

/** 0~1 之间的小数，非法则回退默认 */
function ratio(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0.01, n));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isDensity(value: unknown): value is NewTabDensity {
  return value === 'compact' || value === 'standard' || value === 'large';
}

function isTheme(value: unknown): value is NewTabTheme {
  return value === 'light' || value === 'dark';
}

function isDisplayFont(value: unknown): value is NewTabDisplayFont {
  return value === 'system' || value === 'smiley-sans';
}

function isCardDensity(value: unknown): value is 'compact' | 'comfortable' {
  return value === 'compact' || value === 'comfortable';
}

function isCardSort(value: unknown): value is NewTabCardSort {
  return value === 'recent'
    || value === 'title'
    || value === 'domain'
    || value === 'frequent'
    || value === 'manual';
}
