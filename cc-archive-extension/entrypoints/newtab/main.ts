import {
  deleteImage,
  imageKey,
  isImageKey,
  loadImage,
  resizeImageFile,
  resolveImageUrl,
  saveImage,
  toImageKey,
} from '@/lib/image-store';
import { mountReauthBanner } from '@/lib/reauth-banner';
import { requestOriginAccess } from '@/lib/permissions';
import { affectsSavedClips } from '@/lib/revisit';
import {
  buildTagStats,
  pickFrequentBookmarks,
  sortCards,
  type CardSortKey,
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
  buildDefaultBoards,
  fetchTrending,
  normalizeBoards,
  type TrendingBoard,
  type TrendingRepo,
} from '@/lib/github-trending';
import { DEFAULT_BACKGROUND_VIDEO, normalizeBackground } from '@/lib/preferences';
import { runLegacyMigration } from '@/lib/legacy-migration';
import { createTiltBinder, prefersReducedMotion } from '@/lib/tilt';
import { DomeGallery, type DomeItem } from './dome-gallery';
import { addMemoFromOutside, renderPanels, type PanelElements } from './panels';
import {
  addLauncher,
  createLauncher,
  defaultLaunchers,
  isCommandAllowed,
  loadLaunchers,
  removeLauncher,
  saveLaunchers,
  type LauncherItem,
} from '@/lib/launcher';
import {
  computeDropIndex,
  moveNextTo,
  MAX_FREE_COORD,
  MAX_FREE_SIZE,
  MIN_FREE_COORD,
  MIN_FREE_H,
  MIN_FREE_W,
  MIN_PANEL_HEIGHT,
  setPanelColStart,
  setPanelRowSpan,
  toColStart,
  toRowSpan,
  setLayoutMode,
  setPanelBox,
  toPanelBox,
  cyclePanelSpan,
  defaultPanelLayout,
  FULL_ROW_MIN_SPAN,
  GROUP_PANEL_PREFIX,
  movePanel,
  normalizePanelLayout,
  PANEL_GRID_COLUMNS,
  PANEL_LABELS,
  packMasonry,
  panelListForSettings,
  planSnapColumns,
  resetPanelLayout,
  setPanelHeight,
  setPanelSpan,
  spanPercent,
  toHeight,
  toSpan,
  togglePanelHidden,
  type MasonryItem,
  type PanelBox,
  type PanelLayout,
} from '@/lib/panel-layout';
import {
  clearSelection,
  groupLabels,
  isSelectMode,
  setSelectMode,
  groupPanelIds,
  renderCurated,
  resetSelectionState,
} from './curated-view';

const appEl = document.getElementById('app') as HTMLElement;
const toastHostEl = document.getElementById('toastHost') as HTMLDivElement;
const dashboardPanelsEl = document.getElementById('dashboardPanels') as HTMLElement;
let panelSettingsListEl: HTMLDivElement | null = null;
const statusEl = document.getElementById('status') as HTMLElement;
const editPanelEl = document.getElementById('editPanel') as HTMLElement;
const editCloseEl = document.getElementById('editClose') as HTMLButtonElement;
const editTitleEl = document.getElementById('editTitle') as HTMLInputElement;
const editFolderEl = document.getElementById('editFolder') as HTMLSelectElement;
const editFaviconUrlEl = document.getElementById('editFaviconUrl') as HTMLInputElement;
const editFaviconFileEl = document.getElementById('editFaviconFile') as HTMLInputElement;
const editIconPreviewEl = document.getElementById('editIconPreview') as HTMLDivElement;
const editClearFaviconEl = document.getElementById('editClearFavicon') as HTMLButtonElement;
const uploadFaviconEl = document.getElementById('uploadFavicon') as HTMLButtonElement;
const editSaveEl = document.getElementById('editSave') as HTMLButtonElement;
const editCancelEl = document.getElementById('editCancel') as HTMLButtonElement;
const settingsPanelEl = document.getElementById('settingsPanel') as HTMLElement;
const settingsToggleEl = document.getElementById('settingsToggle') as HTMLButtonElement;
const settingsCloseEl = document.getElementById('settingsClose') as HTMLButtonElement;
const backgroundImageFileEl = document.getElementById('backgroundImageFile') as HTMLInputElement;
const wallpaperPreviewEl = document.getElementById('wallpaperPreview') as HTMLButtonElement;
const cycleWallpaperEl = document.getElementById('cycleWallpaper') as HTMLButtonElement;
const clearBackgroundImageEl = document.getElementById('clearBackgroundImage') as HTMLButtonElement;
const wallpaperMaskInputEl = document.getElementById('wallpaperMaskInput') as HTMLInputElement;
const wallpaperMaskValueEl = document.getElementById('wallpaperMaskValue') as HTMLOutputElement;
const wallpaperBlurInputEl = document.getElementById('wallpaperBlurInput') as HTMLInputElement;
const wallpaperBlurValueEl = document.getElementById('wallpaperBlurValue') as HTMLOutputElement;
const webSearchFormEl = document.getElementById('webSearchForm') as HTMLFormElement;
const searchEngineToggleEl = document.getElementById('searchEngineToggle') as HTMLButtonElement;
const searchInputEl = document.getElementById('searchInput') as HTMLInputElement;
const searchBoxVisibleInputEl = document.getElementById('searchBoxVisibleInput') as HTMLInputElement;
const searchBoxWidthInputEl = document.getElementById('searchBoxWidthInput') as HTMLInputElement;
const searchBoxWidthValueEl = document.getElementById('searchBoxWidthValue') as HTMLOutputElement;
const searchBoxRadiusInputEl = document.getElementById('searchBoxRadiusInput') as HTMLInputElement;
const searchBoxRadiusValueEl = document.getElementById('searchBoxRadiusValue') as HTMLOutputElement;
const drawerSearchInputEl = document.getElementById('drawerSearchInput') as HTMLInputElement;
const categoryListEl = document.getElementById('categoryList') as HTMLDivElement;
const cardsEl = document.getElementById('cards') as HTMLDivElement;
const cardsViewportEl = document.getElementById('cardsViewport') as HTMLDivElement;
const pageIndicatorEl = document.getElementById('pageIndicator') as HTMLDivElement;
const gridColumnsInputEl = document.getElementById('gridColumnsInput') as HTMLInputElement;
const gridColumnsValueEl = document.getElementById('gridColumnsValue') as HTMLOutputElement;
const gridRowsInputEl = document.getElementById('gridRowsInput') as HTMLInputElement;
const gridRowsValueEl = document.getElementById('gridRowsValue') as HTMLOutputElement;
const layoutPresetButtons = [...document.querySelectorAll<HTMLButtonElement>('.layout-preset')];
const cardRadiusInputEl = document.getElementById('cardRadiusInput') as HTMLInputElement;
const cardRadiusValueEl = document.getElementById('cardRadiusValue') as HTMLOutputElement;
const iconSizeInputEl = document.getElementById('iconSizeInput') as HTMLInputElement;
const iconSizeValueEl = document.getElementById('iconSizeValue') as HTMLOutputElement;
const columnGapInputEl = document.getElementById('columnGapInput') as HTMLInputElement;
const columnGapValueEl = document.getElementById('columnGapValue') as HTMLOutputElement;
const rowGapInputEl = document.getElementById('rowGapInput') as HTMLInputElement;
const rowGapValueEl = document.getElementById('rowGapValue') as HTMLOutputElement;
const showLabelsInputEl = document.getElementById('showLabelsInput') as HTMLInputElement;
const showTagsInputEl = document.getElementById('showTagsInput') as HTMLInputElement;
const curateKeepRatioInputEl = document.getElementById('curateKeepRatioInput') as HTMLInputElement;
const curateKeepRatioValueEl = document.getElementById('curateKeepRatioValue') as HTMLOutputElement;
const curatePerCategoryInputEl = document.getElementById('curatePerCategoryInput') as HTMLInputElement;
const curatePerCategoryValueEl = document.getElementById('curatePerCategoryValue') as HTMLOutputElement;
const showFrequentPanelInputEl = document.getElementById('showFrequentPanelInput') as HTMLInputElement;
const showTagPanelInputEl = document.getElementById('showTagPanelInput') as HTMLInputElement;
const showSummaryInputEl = document.getElementById('showSummaryInput') as HTMLInputElement;
const cardSortInputEl = document.getElementById('cardSortInput') as HTMLSelectElement;
const cardDensityInputEl = document.getElementById('cardDensityInput') as HTMLSelectElement;
const glowEnabledInputEl = document.getElementById('glowEnabledInput') as HTMLInputElement;
const cuteCursorInputEl = document.getElementById('cuteCursorInput') as HTMLInputElement;
const tiltEnabledInputEl = document.getElementById('tiltEnabledInput') as HTMLInputElement;
const tiltOnRowsInputEl = document.getElementById('tiltOnRowsInput') as HTMLInputElement;
const confirmBeforeDeleteInputEl = document.getElementById('confirmBeforeDeleteInput') as HTMLInputElement;
const showToastInputEl = document.getElementById('showToastInput') as HTMLInputElement;
const tiltMaxDegInputEl = document.getElementById('tiltMaxDegInput') as HTMLInputElement;
const tiltMaxDegValueEl = document.getElementById('tiltMaxDegValue') as HTMLOutputElement;
const tiltScaleInputEl = document.getElementById('tiltScaleInput') as HTMLInputElement;
const tiltScaleValueEl = document.getElementById('tiltScaleValue') as HTMLOutputElement;
const tiltShadowInputEl = document.getElementById('tiltShadowInput') as HTMLInputElement;
const tiltShadowValueEl = document.getElementById('tiltShadowValue') as HTMLOutputElement;
const tiltLiftInputEl = document.getElementById('tiltLiftInput') as HTMLInputElement;
const tiltLiftValueEl = document.getElementById('tiltLiftValue') as HTMLOutputElement;
const tiltTextLiftInputEl = document.getElementById('tiltTextLiftInput') as HTMLInputElement;
const tiltTextLiftValueEl = document.getElementById('tiltTextLiftValue') as HTMLOutputElement;
const tiltPerspectiveInputEl = document.getElementById('tiltPerspectiveInput') as HTMLInputElement;
const tiltPerspectiveValueEl = document.getElementById('tiltPerspectiveValue') as HTMLOutputElement;
const backgroundVideoInputEl = document.getElementById('backgroundVideoInput') as HTMLInputElement;
const backgroundKindInputEl = document.getElementById('backgroundKindInput') as HTMLSelectElement;
const previewVideoEl = document.getElementById('previewVideo') as HTMLVideoElement;



const resetPanelLayoutEl = document.getElementById('resetPanelLayout') as HTMLButtonElement;
const panelModeInputEl = document.getElementById('panelModeInput') as HTMLSelectElement;
const panelModeNoteEl = document.getElementById('panelModeNote') as HTMLParagraphElement;
panelSettingsListEl = document.getElementById('panelSettingsList') as HTMLDivElement;
const scanBookmarksEl = document.getElementById('scanBookmarks') as HTMLButtonElement;
const applyCleanupEl = document.getElementById('applyCleanup') as HTMLButtonElement;
const cleanupPreviewEl = document.getElementById('cleanupPreview') as HTMLDivElement;
const exportBookmarksEl = document.getElementById('exportBookmarks') as HTMLButtonElement;
const pickRestoreFileEl = document.getElementById('pickRestoreFile') as HTMLButtonElement;
const restoreFileEl = document.getElementById('restoreFile') as HTMLInputElement;
const restorePreviewEl = document.getElementById('restorePreview') as HTMLDivElement;
const applyRestoreEl = document.getElementById('applyRestore') as HTMLButtonElement;
const newTabTakeoverInputEl = document.getElementById('newTabTakeoverInput') as HTMLInputElement;
const newTabRedirectInputEl = document.getElementById('newTabRedirectInput') as HTMLInputElement;
const githubProjectsInputEl = document.getElementById('githubProjectsInput') as HTMLInputElement;
const widgetsInputEl = document.getElementById('widgetsInput') as HTMLInputElement;
const githubTokenInputEl = document.getElementById('githubTokenInput') as HTMLInputElement;
const bgVideoEl = document.getElementById('bgVideo') as HTMLVideoElement;
const glowCursorEl = document.getElementById('glowCursor') as HTMLDivElement;
const clockTimeEl = document.getElementById('clockTime') as HTMLDivElement;
const clockDateEl = document.getElementById('clockDate') as HTMLDivElement;
const clockExtraEl = document.getElementById('clockExtra') as HTMLDivElement;
const clockHintEl = document.getElementById('clockHint') as HTMLSpanElement;
const memoBlockEl = document.getElementById('memoBlock') as HTMLElement;
const memoListEl = document.getElementById('memoList') as HTMLDivElement;
const memoHintEl = document.getElementById('memoHint') as HTMLSpanElement;
const memoInputEl = document.getElementById('memoInput') as HTMLTextAreaElement;
const memoColorsEl = document.getElementById('memoColors') as HTMLDivElement;
const memoAddEl = document.getElementById('memoAdd') as HTMLButtonElement;
const localBlockEl = document.getElementById('localBlock') as HTMLElement;
const localGridEl = document.getElementById('localGrid') as HTMLDivElement;
const localHintEl = document.getElementById('localHint') as HTMLSpanElement;
const frequentBlockEl = document.getElementById('frequentBlock') as HTMLElement;
const frequentStripEl = document.getElementById('frequentStrip') as HTMLDivElement;
const frequentHintEl = document.getElementById('frequentHint') as HTMLSpanElement;
const tagBlockEl = document.getElementById('tagBlock') as HTMLElement;
const tagCloudEl = document.getElementById('tagCloud') as HTMLDivElement;
const tagHintEl = document.getElementById('tagHint') as HTMLSpanElement;
const widgetBlockEl = document.getElementById('widgetBlock') as HTMLElement;
const widgetGridEl = document.getElementById('widgetGrid') as HTMLDivElement;
const githubBlockEl = document.getElementById('githubBlock') as HTMLElement;
const githubGridEl = document.getElementById('githubGrid') as HTMLDivElement;
const githubHintEl = document.getElementById('githubHint') as HTMLSpanElement;
const catNavEl = document.getElementById('categoryNav') as HTMLElement;
const recategorizeEl = document.getElementById('recategorize') as HTMLButtonElement;
const addBookmarkToggleEl = document.getElementById('addBookmarkToggle') as HTMLButtonElement;
const addBookmarkFormEl = document.getElementById('addBookmarkForm') as HTMLDivElement;
const addBookmarkUrlEl = document.getElementById('addBookmarkUrl') as HTMLInputElement;
const addBookmarkTitleEl = document.getElementById('addBookmarkTitle') as HTMLInputElement;
const addBookmarkFolderEl = document.getElementById('addBookmarkFolder') as HTMLInputElement;
const addBookmarkSubmitEl = document.getElementById('addBookmarkSubmit') as HTMLButtonElement;
const addBookmarkCancelEl = document.getElementById('addBookmarkCancel') as HTMLButtonElement;

/** 模块区元素集合，传给 panels.ts */
const panelElements: PanelElements = {
  memoBlock: memoBlockEl,
  memoList: memoListEl,
  memoHint: memoHintEl,
  memoInput: memoInputEl,
  memoColors: memoColorsEl,
  memoAdd: memoAddEl,
  localBlock: localBlockEl,
  localGrid: localGridEl,
  localHint: localHintEl,
  frequentBlock: frequentBlockEl,
  frequentStrip: frequentStripEl,
  frequentHint: frequentHintEl,
  tagBlock: tagBlockEl,
  tagCloud: tagCloudEl,
  tagHint: tagHintEl,
  widgetBlock: widgetBlockEl,
  widgetGrid: widgetGridEl,
  githubBlock: githubBlockEl,
  githubGrid: githubGridEl,
  githubHint: githubHintEl,
};
const iconGlowInputEl = document.getElementById('iconGlowInput') as HTMLInputElement;
const fontFamilyInputEl = document.getElementById('fontFamilyInput') as HTMLSelectElement;
const fontShadowInputEl = document.getElementById('fontShadowInput') as HTMLInputElement;
const fontSizeInputEl = document.getElementById('fontSizeInput') as HTMLInputElement;
const fontSizeValueEl = document.getElementById('fontSizeValue') as HTMLOutputElement;
const galleryModeInputEl = document.getElementById('galleryModeInput') as HTMLInputElement;
const domeGalleryEl = document.getElementById('domeGallery') as HTMLDivElement;
const detailListEl = document.getElementById('detailList') as HTMLDivElement;
const rightPanelEl = document.getElementById('rightPanel') as HTMLElement;
const rightDrawerHotspotEl = document.getElementById('rightDrawerHotspot') as HTMLButtonElement;
const revisitWidgetEl = document.getElementById('revisitWidget') as HTMLDivElement;
const recentWidgetEl = document.getElementById('recentWidget') as HTMLDivElement;
const densityButtons = [...document.querySelectorAll<HTMLButtonElement>('.density-button')];
const engineListEl = document.getElementById('engineList') as HTMLDivElement;
const addEngineEl = document.getElementById('addEngine') as HTMLButtonElement;
const engineIconFileEl = document.getElementById('engineIconFile') as HTMLInputElement;
let engineMenuEl!: HTMLDivElement;
let pendingIconEngineId = '';
const themeToggleEl = document.getElementById('themeToggle') as HTMLButtonElement;
const drawerToggleEl = document.getElementById('rightDrawerToggle') as HTMLButtonElement;
const clipCurrentEl = document.getElementById('clipCurrent') as HTMLButtonElement;
const aiRecallEl = document.getElementById('aiRecall') as HTMLButtonElement;
const batchSelectEl = document.getElementById('batchSelect') as HTMLButtonElement;
const newGroupEl = document.getElementById('newGroup') as HTMLButtonElement;
const launcherGridEl = document.getElementById('launcherGrid') as HTMLDivElement;
const launcherHintEl = document.getElementById('launcherHint') as HTMLSpanElement;
const launcherAddEl = document.getElementById('launcherAdd') as HTMLButtonElement;
const launcherFormEl = document.getElementById('launcherForm') as HTMLFormElement;
const launcherNameEl = document.getElementById('launcherName') as HTMLInputElement;
const launcherCommandEl = document.getElementById('launcherCommand') as HTMLInputElement;
const launcherUrlEl = document.getElementById('launcherUrl') as HTMLInputElement;
const launcherCancelEl = document.getElementById('launcherCancel') as HTMLButtonElement;
const importButtons = [document.getElementById('importBookmarks') as HTMLButtonElement];
const settingsButtons = [document.getElementById('openSettings') as HTMLButtonElement];
const resetDefaultPrefsEl = document.getElementById('resetDefaultPrefs') as HTMLButtonElement;

type Density = 'compact' | 'standard' | 'large';
type Theme = 'light' | 'dark';
/** 可选字体族 id */
type DisplayFont =
  | 'system' | 'smiley-sans'
  | 'zcool-kuaile' | 'zcool-qingke' | 'zcool-xiaowei'
  | 'ma-shan-zheng' | 'long-cang';

/** 字体 id → 实际 font-family 栈 */
const FONT_STACKS: Record<DisplayFont, string> = {
  'system': 'Inter, "SF Pro Display", "Segoe UI", system-ui, sans-serif',
  'smiley-sans': '"Smiley Sans", Inter, "SF Pro Display", system-ui, sans-serif',
  'zcool-kuaile': '"ZCOOL KuaiLe", "Smiley Sans", system-ui, sans-serif',
  'zcool-qingke': '"ZCOOL QingKe", "Smiley Sans", system-ui, sans-serif',
  'zcool-xiaowei': '"ZCOOL XiaoWei", "Songti SC", serif',
  'ma-shan-zheng': '"Ma Shan Zheng", "Kaiti SC", cursive',
  'long-cang': '"Long Cang", "Kaiti SC", cursive',
};

/** 把任意输入收敛成合法字体 id */
function toDisplayFont(value: unknown): DisplayFont {
  return typeof value === 'string' && value in FONT_STACKS
    ? value as DisplayFont
    : 'system';
}
type SearchEngineConfig = { id: string; name: string; url: string; icon?: string };

type SavedClipStats = {
  total: number;
  clips: number;
  bookmarks: number;
  queued: number;
  unvisited: number;
  visited: number;
};

type DashboardCard = {
  url: string;
  canonicalUrl?: string;
  title: string;
  domain: string;
  path: string;
  source: 'clip' | 'bookmark';
  sourceLabel: string;
  folder?: string;
  faviconUrl: string;
  summary: string;
  tags: string[];
  keywords: string[];
  aliases: string[];
  intent: string;
  why: string;
  clipped: string;
  queued: boolean;
  revived: number;
  lastVisited: string;
  initial: string;
};

type BookmarkFolderOption = {
  path: string;
  count: number;
};

type DashboardData = {
  stats: SavedClipStats;
  folders: BookmarkFolderOption[];
  cards: DashboardCard[];
  recent: DashboardCard[];
  revisit?: DashboardCard;
  revisits?: DashboardCard[];
};

type Prefs = {
  density: Density;
  theme: Theme;
  rightPanelCollapsed: boolean;
  backgroundImageUrl: string;
  backgroundVideoUrl: string;
  backgroundVideoEnabled: boolean;
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
  showTags: boolean;
  showSummary: boolean;
  cardDensity: 'compact' | 'comfortable';
  cardSort: CardSortKey;
  galleryMode: boolean;
  iconGlow: boolean;
  glowEnabled: boolean;
  cuteCursor: boolean;
  tiltEnabled: boolean;
  tiltMaxDeg: number;
  tiltScale: number;
  tiltShadow: number;
  tiltLift: number;
  tiltTextLift: number;
  tiltPerspective: number;
  tiltOnRows: boolean;
  confirmBeforeDelete: boolean;
  showToast: boolean;
  panelLayout: PanelLayout | null;
  /** 分组自定义名称：分组 id → 名称 */
  groupNames: Record<string, string>;
  newTabTakeover: boolean;
  newTabRedirectUrl: string;
  githubProjectsEnabled: boolean;
  widgetsEnabled: boolean;
  githubToken: string;
  /** 精选保留比例（0~1），默认 0.1 即裁掉约 90% */
  curateKeepRatio: number;
  /** 每个主类最多展示条数 */
  curatePerCategory: number;
  /** 是否启用「精选清洗」（默认关闭：先完整展示，由用户主动开启） */
  curateEnabled: boolean;
  /** 看板列数 */
  /** 分组看板布局（列/宽度/自定义名）；null 表示用默认布局 */
  /** 是否显示「常用书签」面板 */
  showFrequentPanel: boolean;
  /** 是否显示「标签整理」面板 */
  showTagPanel: boolean;
  searchBoxVisible: boolean;
  searchBoxWidth: number;
  searchBoxRadius: number;
  fontFamily: DisplayFont;
  fontShadow: boolean;
  fontSize: number;
  searchEngines: SearchEngineConfig[];
  searchEngineId: string;
};

/** 书签清理计划（与 lib/bookmark-cleaner 的 CleanupPlan 结构一致） */
type CleanupDecision = {
  id: string;
  title: string;
  url: string;
  folder: string;
  keep: boolean;
  reason: string;
};
type RestoreItem = {
  title: string;
  url: string;
  folder: string;
  key: string;
};
type RestorePlan = {
  missing: RestoreItem[];
  existing: RestoreItem[];
  invalid: number;
  summary: { backupTotal: number; missing: number; existing: number; invalid: number };
};

type CleanupPlan = {
  decisions: CleanupDecision[];
  keep: CleanupDecision[];
  remove: CleanupDecision[];
  summary: { total: number; kept: number; removed: number; removedPercent: number };
};

type RuntimeResponse<T> = {
  ok?: boolean;
  error?: string;
} & T;

type AIRecallResponse = {
  data?: DashboardData;
  recall?: {
    query: string;
    keywords: string[];
    aliases: string[];
    intent: string;
  };
};

const DEFAULT_SEARCH_ENGINES: SearchEngineConfig[] = [
  { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=%s', icon: '/engine/google.png' },
  { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=%s', icon: '/engine/bing_new.png' },
  { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s?wd=%s', icon: '/engine/baidu.png' },
  { id: 'yandex', name: 'Yandex', url: 'https://yandex.com/search/?text=%s', icon: '/engine/yandex.png' },
];
const REVISIT_ROTATE_MS = 6000;
const REVISIT_FLASH_MS = 3000;

const DEFAULT_PREFS: Prefs = {
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
  groupNames: {},
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

// 内置壁纸打包在扩展 public/wallpaper 下，默认无远程请求（隐私/审核友好）；
// 用绝对路径（不含扩展 id）便于持久化到 prefs 且开发/发布环境通用。
const DEFAULT_BACKGROUND_IMAGE = '/wallpaper/wallpaper-1.jpg';
const BUILT_IN_WALLPAPERS = [
  DEFAULT_BACKGROUND_IMAGE,
  '/wallpaper/wallpaper-2.jpg',
  '/wallpaper/wallpaper-3.jpg',
  '/wallpaper/wallpaper-4.jpg',
  '/wallpaper/wallpaper-5.jpg',
];
const PREVIEW_PREFS_KEY = 'cc_archive_preview_new_tab_prefs';

let prefs: Prefs = DEFAULT_PREFS;
let dashboardData: DashboardData | null = null;
// 已解析图标后的最近一次数据：用于画廊/网格纯视图切换时的同步重渲染（避免异步刷新期间闪现旧内容）
let lastResolvedData: DashboardData | null = null;
let currentFolder = '';
let editingCard: DashboardCard | null = null;
let currentPage = 0;
let totalPages = 1;
let isScrolling = false;
let searchTimer: number | undefined;
let engineSaveTimer: number | undefined;
let dashboardRequestSeq = 0;
let prefsSaveSeq = 0;
let importingBookmarks = false;
let clippingRecentPage = false;
let drawerAutoCloseTimer: number | undefined;
let hotspotHideTimer: number | undefined;
let domeInstance: DomeGallery | null = null;
let revisitCards: DashboardCard[] = [];
let revisitIndex = 0;
let revisitRotateTimer: number | undefined;
let revisitFlashTimer: number | undefined;
let clipsRefreshTimer: number | undefined;

const PREVIEW_CARDS: DashboardCard[] = [
  // 内网 / 自建服务：本地预览下也展示，便于验证「内网与自建服务」模块。
  // 这里只能是虚构示例 —— 预览数据会随源码分发，不要放真实主机名或内网地址。
  previewCard('http://127.0.0.1:11434/', '本地模型服务', '127.0.0.1', '书签栏 / 自建', 'bookmark', ['AI'], '本机大模型运行时'),
  previewCard('http://localhost:5173/', '前端开发服务器', 'localhost', '书签栏 / 自建', 'bookmark', ['开发'], '本机 Vite 预览端口'),
  previewCard('http://router.example/', '路由器管理页', 'router.example', '书签栏 / 自建', 'bookmark', ['网络'], '局域网网关示例地址'),
  previewCard('http://nas.example/', 'NAS 管理页', 'nas.example', '书签栏 / 自建', 'bookmark', ['存储'], '局域网存储示例地址'),
  previewCard('https://example.com', 'Example Domain', 'example.com', '书签栏 / 自建', 'bookmark', ['文档'], '占位网址，用于检查卡片样式'),
  previewCard('https://github.com', 'GitHub: Where the world builds software', 'github.com', '书签栏 / 源码', 'bookmark', ['代码', '协作'], '开发者代码托管与项目协作'),
  previewCard('https://www.mercury.com', 'Mercury - Online Business Banking', 'mercury.com', '书签栏 / 工作 / 金融', 'clip', ['金融', 'SaaS'], '适合创业公司的在线银行服务'),
  previewCard('https://www.awwwards.com', 'Awwwards - SOTD', 'awwwards.com', '书签栏 / 设计类', 'bookmark', ['设计', '灵感'], '网站设计与交互灵感'),
  previewCard('https://www.lapaninja.com', 'Lapa Ninja | Landing Page Gallery', 'lapaninja.com', '书签栏 / 设计类', 'bookmark', ['落地页', 'UI'], '高质量 Landing Page 参考'),
  previewCard('https://resend.com', 'Resend | 域名邮箱', 'resend.com', '书签栏 / 管理站点', 'clip', ['邮件', '开发'], '开发者友好的邮件 API'),
  previewCard('https://www.cloudflare.com', 'Cloudflare: Build for the agentic web', 'cloudflare.com', '书签栏 / 管理站点', 'bookmark', ['部署', '网络'], '网络、DNS 与应用部署平台'),
  previewCard('https://www.pinterest.com', 'Pinterest', 'pinterest.com', '书签栏 / 图片', 'bookmark', ['图片', '灵感'], '视觉收藏与灵感检索'),
  previewCard('https://www.producthunt.com', 'Product Hunt', 'producthunt.com', '书签栏 / 产品', 'clip', ['产品', '趋势'], '发现新产品和工具'),
  previewCard('https://linear.app', 'Linear', 'linear.app', '书签栏 / 工作', 'bookmark', ['项目', '效率'], '产品研发项目管理工具'),
  previewCard('https://vercel.com', 'Vercel', 'vercel.com', '书签栏 / 开发工具', 'bookmark', ['部署', '前端'], '前端应用托管与部署'),
  previewCard('https://www.figma.com', 'Figma', 'figma.com', '书签栏 / 设计类', 'bookmark', ['设计', '协作'], '界面设计与原型协作'),
];

init();

async function init() {
  // 改名前存在旧 IndexedDB 库里的配图要先搬进新库，否则这次渲染看不到已有图片
  await runLegacyMigration();
  await loadPrefs();
  await refreshDashboard();
  bindEvents();
  void mountReauthBanner(appEl);
  applyPanelLayout();
  startClock();
  void initLaunchers();
  // 异步内容（趋势榜 / GitHub 项目 / 分组）加载完后再排一次瀑布流
  window.setTimeout(() => scheduleMasonryRelayout(), 400);
  window.setTimeout(() => scheduleMasonryRelayout(), 1400);
  searchInputEl.focus();
}

/* ---------------------------------------------------------------- 时钟 */

let clockTimer: number | undefined;

/** 启动时钟：每秒刷新时间，并显示当天进度 */
function startClock() {
  const tick = () => {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, '0');
    const mm = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    clockTimeEl.textContent = `${hh}:${mm}:${ss}`;
    clockDateEl.textContent = now.toLocaleDateString('zh-CN', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });

    // 当天已过百分比，给一个轻量的「今天还剩多少」提示
    const passed = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const percent = Math.round((passed / 86400) * 100);
    const leftHours = Math.floor((86400 - passed) / 3600);
    clockExtraEl.textContent = `今天已过 ${percent}% · 还剩约 ${leftHours} 小时`;
    clockHintEl.textContent = `${now.getFullYear()} 年`;
  };
  tick();
  window.clearInterval(clockTimer);
  clockTimer = window.setInterval(tick, 1000);
}

/* ------------------------------------------------------------ 背景视频 */

let videoListenersBound = false;

/**
 * 应用背景视频。
 *
 * 性能考量（此前卡顿的主要来源之一）：
 *  - 不再在 <video> 上做 CSS filter: blur —— 那会让每一帧都走一次全屏模糊；
 *  - 只在 loadeddata 之后才淡入，poster 先顶上，避免「背景加载有延迟」的空白感；
 *  - 页面不可见 / 窗口失焦时暂停播放，省电省 GPU；
 *  - 尊重「减少动效」偏好，直接不播视频。
 */
async function applyBackgroundVideo() {
  const enabled = prefs.backgroundKind === 'video' && prefs.backgroundVideoEnabled && !prefersReducedMotion();
  const source = prefs.backgroundVideoUrl.trim();

  if (!enabled || !source) {
    appEl.classList.remove('video-bg');
    bgVideoEl.classList.remove('ready');
    bgVideoEl.pause();
    bgVideoEl.removeAttribute('src');
    bgVideoEl.load();
    return;
  }

  // 本地 blob 键需要先解析成 object URL
  let resolved = source;
  if (isImageKey(source)) {
    resolved = (await resolveImageUrl(source)) || '';
  }
  if (!resolved) {
    appEl.classList.remove('video-bg');
    return;
  }

  if (!videoListenersBound) {
    videoListenersBound = true;
    bgVideoEl.addEventListener('loadeddata', () => {
      bgVideoEl.classList.add('ready');
      appEl.classList.add('video-bg');
    });
    // 加载失败时静默回退到静态壁纸，不打扰用户
    bgVideoEl.addEventListener('error', () => {
      bgVideoEl.classList.remove('ready');
      appEl.classList.remove('video-bg');
    });

    // 切到后台就暂停：新标签页常常被切走，白白解码视频是主要浪费
    const syncPlayback = () => {
      if (document.hidden || !document.hasFocus()) {
        bgVideoEl.pause();
      } else if (prefs.backgroundVideoEnabled && !prefersReducedMotion()) {
        void bgVideoEl.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', syncPlayback, { passive: true });
    window.addEventListener('blur', syncPlayback, { passive: true });
    window.addEventListener('focus', syncPlayback, { passive: true });
  }

  if (bgVideoEl.getAttribute('src') !== resolved) {
    bgVideoEl.setAttribute('src', resolved);
    bgVideoEl.load();
  }
  appEl.classList.toggle('video-bg', bgVideoEl.readyState >= 2);
  void bgVideoEl.play().catch(() => {
    // 自动播放被拦截（例如省电模式）：保留 poster，不报错
  });
}

/** 设置面板里的背景预览：视频模式时把预览视频指向同一个源 */
function syncPreviewVideo() {
  const src = prefs.backgroundVideoUrl.trim();
  if (prefs.backgroundKind !== 'video' || !src) {
    previewVideoEl.removeAttribute('src');
    return;
  }
  if (previewVideoEl.getAttribute('src') !== src) {
    previewVideoEl.setAttribute('src', src);
    previewVideoEl.load();
  }
  void previewVideoEl.play().catch(() => {});
}


/* --------------------------------------------------------- 可爱小猫鼠标 */

/**
 * 用原生 CSS cursor 指向打包的 SVG 小猫，替换原先「JS 跟随光点」的实现。
 * 旧方案每个 pointermove 都要写一次 transform 并重绘光晕，是卡顿来源之一；
 * 原生 cursor 由浏览器合成器处理，零 JS、零重绘。
 */
function applyCuteCursor() {
  const on = prefs.cuteCursor;
  appEl.classList.toggle('cat-cursor', on);
  // 旧的 JS 光点光标已停用（CSS 中也隐藏），确保不残留监听
  glowCursorEl.classList.remove('visible', 'hovering');
}

/* --------------------------------------------------- 3D 倾斜 / 鼠标视差 */

const tiltBinder = createTiltBinder();

function applyTilt() {
  const on = prefs.tiltEnabled && !prefersReducedMotion();
  appEl.classList.toggle('tilt', on);
  // 透视距离通过 CSS 变量下发，供卡片与行共用
  appEl.style.setProperty('--tilt-perspective', `${prefs.tiltPerspective}px`);
  if (!on) {
    // 关掉开关时要顺手解绑，否则已绑定的行还会继续跟着鼠标转
    tiltBinder.dispose();
    return;
  }

  // 每个元素单独倾斜：书签行、榜单行、卡片各自独立，互不牵连。
  // （之前把 .cur-list 整体当目标，导致整组一起转，正是用户反馈的问题）
  const selectors = [
    '.bookmark-card[data-url]',
    '.cur-row[data-url]',
    '.repo-row',
    '.github-card',
    '.frequent-chip',
    '.local-btn',
  ];
  if (!prefs.tiltOnRows) {
    // 关闭行级倾斜时只保留大卡片
    const idx = selectors.findIndex((sel) => sel.includes('cur-row'));
    if (idx >= 0) selectors.splice(idx, 1);
    selectors.splice(selectors.indexOf('.repo-row'), 1);
    selectors.splice(selectors.indexOf('.frequent-chip'), 1);
  }

  const options = {
    maxTiltDeg: prefs.tiltMaxDeg,
    scale: prefs.tiltScale,
    shadowOffsetPx: prefs.tiltShadow,
    liftPx: prefs.tiltLift,
    textLiftPx: prefs.tiltTextLift,
    perspectivePx: prefs.tiltPerspective,
  };

  // 分组卡片容器本身不倾斜（由内部的行各自倾斜）
  const targets = [...document.querySelectorAll<HTMLElement>(selectors.join(', '))]
    .filter((el) => !el.classList.contains('cur-list'));
  tiltBinder.bind(targets, options);
}

async function loadPrefs() {
  try {
    const res = await sendRuntimeMessage({ type: 'LOAD_NEW_TAB_PREFS' }) as RuntimeResponse<{ prefs?: Prefs }>;
    if (!res?.ok || !res.prefs) {
      throw new Error(res?.error ?? '无法读取偏好设置');
    }
    prefs = normalizePrefs(res.prefs);
  } catch (error) {
    prefs = DEFAULT_PREFS;
    setStatus(`偏好设置加载失败，已使用默认设置：${errorMessage(error)}`);
  }
  await applyPrefs();
}

async function refreshDashboard() {
  const requestId = ++dashboardRequestSeq;
  const query = searchInputEl.value;
  const folder = currentFolder;

  setStatus('正在加载收藏数据...');
  try {
    const res = await sendRuntimeMessage({
      type: 'GET_DASHBOARD_DATA',
      query,
      folder,
    }) as RuntimeResponse<{ data?: DashboardData }>;

    if (requestId !== dashboardRequestSeq) return;

    if (!res?.ok || !res.data) {
      throw new Error(res?.error ?? '无法读取收藏数据');
    }

    dashboardData = res.data;
    const resolvedData = await resolveDashboardImages(res.data);
    lastResolvedData = resolvedData;
    renderDashboard(resolvedData, query, folder);
    setStatus(statusText(resolvedData, query, folder));
  } catch (error) {
    if (requestId !== dashboardRequestSeq) return;

    dashboardData = null;
    categoryListEl.innerHTML = '';
    cardsEl.innerHTML = '<div class="empty-state">收藏数据加载失败</div>';
    detailListEl.innerHTML = '<div class="empty-state">暂无详细书签</div>';
    revisitWidgetEl.textContent = '暂无回访建议';
    recentWidgetEl.textContent = '暂无最近剪藏';
    setStatus(`加载失败：${errorMessage(error)}`);
  }
}

async function resolveDashboardImages(data: DashboardData): Promise<DashboardData> {
  const cards = await Promise.all(
    data.cards.map(resolveDashboardCardImage),
  );
  const revisit = data.revisit ? await resolveDashboardCardImage(data.revisit) : data.revisit;
  const revisits = data.revisits ? await Promise.all(data.revisits.map(resolveDashboardCardImage)) : data.revisits;
  return { ...data, cards, revisit, revisits };
}

async function resolveDashboardCardImage(card: DashboardCard): Promise<DashboardCard> {
  if (!card.faviconUrl || !isImageKey(card.faviconUrl)) return card;
  const resolved = await loadImage(imageKey(card.faviconUrl));
  return resolved ? { ...card, faviconUrl: resolved } : card;
}

/** 画廊模式是否实际生效：首启无书签（且未搜索）时回退网格，以复用其「导入书签」引导卡 */
function shouldShowGallery(): boolean {
  if (!prefs.galleryMode) return false;
  if (!dashboardData) return true; // 收藏数据未知时先按偏好显示，避免加载期闪烁
  const total = dashboardData.stats.total ?? 0;
  const hasQuery = searchInputEl.value.trim() !== '';
  return total > 0 || hasQuery;
}

/**
 * 只改视图/面板开关这类「数据没变、渲染结果变了」的设置：
 * 用已解析的缓存同步重渲染，避免走异步刷新时短暂露出旧内容。
 */
function rerenderBoard() {
  if (lastResolvedData) {
    renderDashboard(lastResolvedData, searchInputEl.value, currentFolder);
  } else {
    void refreshDashboard();
  }
}

function renderDashboard(data: DashboardData, query: string, folder: string) {
  renderCategories(data.folders);

  // 有搜索词 / 选定文件夹时走原来的筛选网格，其余情况展示「精选收藏」分类列表
  const searching = query.trim() !== '' || folder !== '';
  const galleryOn = !searching && shouldShowGallery();

  appEl.classList.toggle('gallery-mode', galleryOn);
  domeGalleryEl.hidden = !galleryOn;
  cardsViewportEl.hidden = searching ? false : true;

  if (galleryOn) {
    renderDome(data.cards);
  } else if (searching) {
    renderCards(data.cards, query);
  } else {
    // 精选列表：内部自行清洗（默认保留约 10%）并按主类归类
    renderCurated(
      { panels: dashboardPanelsEl, nav: catNavEl },
      data.cards,
      {
        openUrl: (url) => { void openTab(url); },
        onTagClick: (tag) => {
          searchInputEl.value = tag;
          currentPage = 0;
          void refreshDashboard();
          searchInputEl.focus();
        },
        keepRatio: prefs.curateKeepRatio,
        perCategory: prefs.curatePerCategory,
        curateEnabled: prefs.curateEnabled,
        loadGroupNames: () => prefs.groupNames,
        onRenameGroup: (groupId, name) => {
          savePrefs({ groupNames: { ...prefs.groupNames, [groupId]: name } });
        },
        onBulkDelete: (targets) => { void bulkDeleteBookmarks(targets); },
        onAddBookmark: (url, title, folder) => { void addBookmarkToGroup(url, title, folder); },
        onRendered: () => { applyTilt(); applyPanelLayout(); },
        onDeleteBookmark: (url, title) => { void deleteBookmark(url, title); },
        onSaveAsMemo: (title, url) => { void addMemoFromOutside(`${title}\n${url}`, '备忘'); },
        onPinBookmark: (url, title) => { void addMemoFromOutside(`★ ${title}\n${url}`, '置顶备忘'); },
        setStatus,
      },
    );
    // 列表是刚渲染的，绑定 3D 倾斜
    applyTilt();
  }

  renderDetailList(data.cards);
  renderWidgets(data);
  void renderPanels(panelElements, data.cards, {
    openUrl: (url) => { void openTab(url); },
    onTagClick: (tag) => {
      searchInputEl.value = tag;
      currentPage = 0;
      void refreshDashboard();
      searchInputEl.focus();
    },
    getGithubToken: () => prefs.githubToken,
    setStatus,
    onRendered: () => applyTilt(),
    showFrequent: !searching && prefs.showFrequentPanel,
    showTags: prefs.showTagPanel,
    showGithubProjects: prefs.githubProjectsEnabled,
    showWidgets: prefs.widgetsEnabled,
    sort: prefs.cardSort,
  });

  if (searching) {
    setStatus(query.trim()
      ? `本地收藏已按“${query.trim()}”筛选，按 Enter 可继续网页搜索。`
      : '该分类下的收藏。');
  }
}

async function openEditPanel(card: DashboardCard) {
  editingCard = card;
  editTitleEl.value = card.title || '';
  renderEditFolderOptions(card.folder || '');
  editFaviconUrlEl.value = card.faviconUrl || '';
  // 先展示面板并取消待折叠计时，避免异步渲染期间书签栏误触发自动折叠
  editPanelEl.hidden = false;
  window.clearTimeout(drawerAutoCloseTimer);
  editTitleEl.focus();
  await renderEditIconPreview(card);
}

function closeEditPanel() {
  editingCard = null;
  editPanelEl.hidden = true;
}

async function renderEditIconPreview(card?: DashboardCard | null) {
  if (!card) {
    editIconPreviewEl.innerHTML = '';
    return;
  }

  const rawUrl = editFaviconUrlEl.value.trim() || card.faviconUrl;
  const url = rawUrl ? await resolveImageUrl(rawUrl) : '';
  const initial = (card.initial || card.domain || '?').slice(0, 1).toUpperCase();
  editIconPreviewEl.innerHTML = url
    ? `<img class="icon-preview-img" src="${escapeAttr(url)}" alt="" data-initial="${escapeAttr(initial)}" />`
    : `<span class="icon-preview-fallback">${escapeHtml(initial)}</span>`;

  const img = editIconPreviewEl.querySelector<HTMLImageElement>('.icon-preview-img');
  img?.addEventListener('error', () => {
    img.replaceWith(document.createTextNode(initial));
  }, { once: true });
}

function renderEditFolderOptions(selectedFolder: string) {
  const folders = new Set((dashboardData?.folders ?? []).map((folder) => folder.path));
  if (selectedFolder) folders.add(selectedFolder);

  const options = [
    { label: '未指定收藏夹', value: '' },
    ...[...folders]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
      .map((folder) => ({ label: folder, value: folder })),
  ];

  editFolderEl.replaceChildren(...options.map((option) => {
    const el = document.createElement('option');
    el.value = option.value;
    el.textContent = option.label;
    el.selected = option.value === selectedFolder;
    return el;
  }));
}

async function saveEdit() {
  if (!editingCard) return;

  editSaveEl.disabled = true;
  try {
    const res = await sendRuntimeMessage({
      type: 'UPDATE_SAVED_CLIP',
      update: {
        url: editingCard.url,
        canonicalUrl: editingCard.canonicalUrl,
        title: editTitleEl.value,
        folder: editFolderEl.value,
        faviconUrl: editFaviconUrlEl.value.trim(),
      },
    }) as RuntimeResponse<{}>;

    if (res?.ok) {
      setStatus('已保存收藏信息');
      closeEditPanel();
      await refreshDashboard();
    } else {
      setStatus(`保存失败：${res?.error ?? '未知错误'}`);
    }
  } catch (error) {
    setStatus(`保存失败：${errorMessage(error)}`);
  } finally {
    editSaveEl.disabled = false;
  }
}

async function deleteCard(card: DashboardCard) {
  const confirmed = window.confirm(`删除收藏“${card.title || card.url}”？`);
  if (!confirmed) return;

  try {
    const res = await sendRuntimeMessage({
      type: 'DELETE_SAVED_CLIP',
      target: {
        url: card.url,
        canonicalUrl: card.canonicalUrl,
      },
    }) as RuntimeResponse<{ deleted?: boolean }>;

    if (!res?.ok) {
      setStatus(`删除失败：${res?.error ?? '未找到要删除的收藏'}`);
      return;
    }

    setStatus('已删除收藏');
    await refreshDashboard();
  } catch (error) {
    setStatus(`删除失败：${errorMessage(error)}`);
  }
}

function renderCategories(folders: BookmarkFolderOption[]) {
  categoryListEl.replaceChildren();
  categoryListEl.append(categoryButton('全部收藏', '', dashboardData?.stats.total ?? 0));
  if (currentFolder) {
    categoryListEl.append(categoryButton('上级', parentFolder(currentFolder), 0, 'category-back'));
  }
  for (const folder of childFolders(folders, currentFolder)) {
    categoryListEl.append(categoryButton(folderName(folder.path), folder.path, folder.count));
  }
}

function mapToDomeItems(cards: DashboardCard[]): DomeItem[] {
  return cards
    .filter((card) => card.url)
    .map((card) => ({
      src: faviconSource(card).src,
      title: card.title || card.url,
      url: card.url,
      initial: (card.initial || card.domain || '?').slice(0, 1).toUpperCase(),
    }));
}

function renderDome(cards: DashboardCard[]) {
  if (!domeInstance) {
    domeInstance = new DomeGallery(domeGalleryEl, {
      onOpen: (url) => { openTab(url); },
    });
  }
  domeInstance.setItems(mapToDomeItems(cards));
}

function emptyCardsHtml(query: string): string {
  const hasSavedItems = (dashboardData?.stats.total ?? 0) > 0;
  if (query || hasSavedItems) {
    return `
      <article class="bookmark-card empty-card">
        <div class="card-title">没有匹配的收藏</div>
        <div class="card-meta">${query ? '换个关键词试试，或按 Enter 搜索网页' : '导入或剪藏后会显示在这里'}</div>
      </article>
    `;
  }

  return `
    <article class="bookmark-card empty-card onboarding-card">
      <div class="empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M5 5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16l-7-4-7 4V5Z"/>
          <path d="M9 8h6"/>
          <path d="M9 12h4"/>
        </svg>
      </div>
      <div class="card-title">导入浏览器书签</div>
      <div class="card-meta">首次使用可一键导入 Chrome 书签，导入后会自动生成分类和图标网格。</div>
      <div class="empty-actions">
        <button class="empty-import-action" type="button">立即导入书签</button>
        <button class="empty-settings-action" type="button">更多设置</button>
      </div>
    </article>
  `;
}

function renderCards(cards: DashboardCard[], query: string) {
  if (!cards.length) {
    cardsEl.innerHTML = emptyCardsHtml(query);
    pageIndicatorEl.innerHTML = '';
    cardsEl.style.transform = '';
    return;
  }

  // 按用户选择的规则排序（frequent 需要一份「常用顺序」参考）
  const frequentOrder = pickFrequentBookmarks(cards, { limit: cards.length }).map((card) => card.url);
  cards = sortCards(cards, prefs.cardSort, { frequentOrder });

  const perPage = cardsPerPage();
  totalPages = Math.max(1, Math.ceil(cards.length / perPage));
  currentPage = Math.min(currentPage, totalPages - 1);

  const pages: DashboardCard[][] = [];
  for (let i = 0; i < totalPages; i += 1) {
    const pageCards = cards.slice(i * perPage, (i + 1) * perPage);
    while (pageCards.length < perPage) {
      pageCards.push({ ...cards[0], url: '', title: '', domain: '' } as DashboardCard);
    }
    pages.push(pageCards);
  }

  cardsEl.innerHTML = pages.map((pageCards, pageIndex) => `
    <div class="bookmark-page${pageIndex === currentPage ? ' active' : ''}" data-page="${pageIndex}" aria-label="第 ${pageIndex + 1} 页">
      ${pageCards.map((card, index) => card.url ? cardHtml(card) : placeholderCardHtml(index)).join('')}
    </div>
  `).join('');

  bindCardEvents(cards);
  renderPageIndicator();
  applyPageTransform(false);
  // 卡片是刚重建的，重新绑定 3D 倾斜
  applyTilt();
}

function renderPageIndicator() {
  if (totalPages <= 1) {
    pageIndicatorEl.replaceChildren();
    return;
  }

  // 胶囊分页指示器：每 3 页为一组，长条在组内循环移动，令每次翻页都有动效
  const groupStart = Math.floor(currentPage / 3) * 3;
  const count = Math.min(3, totalPages - groupStart);

  // 复用已有圆点元素（不重建 DOM），保证 CSS 宽度过渡生效、长条平滑伸缩
  while (pageIndicatorEl.childElementCount > count) {
    pageIndicatorEl.lastElementChild?.remove();
  }
  while (pageIndicatorEl.childElementCount < count) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = 'page-dot';
    pageIndicatorEl.appendChild(dot);
  }

  const dots = pageIndicatorEl.children;
  for (let i = 0; i < count; i += 1) {
    const page = groupStart + i;
    const dot = dots[i] as HTMLButtonElement;
    dot.dataset.page = String(page);
    dot.classList.toggle('active', page === currentPage);
    dot.setAttribute('aria-label', `第 ${page + 1} 页，共 ${totalPages} 页`);
  }
}

function applyPageTransform(animate: boolean) {
  cardsEl.style.transition = animate ? 'transform .38s cubic-bezier(.22, .61, .36, 1)' : 'none';
  const offset = currentPage * -100;
  cardsEl.style.transform = `translateX(${offset}%)`;
}

function refreshCardsPage() {
  renderPageIndicator();
  applyPageTransform(true);
  for (const page of cardsEl.querySelectorAll<HTMLElement>('.bookmark-page')) {
    page.classList.toggle('active', Number(page.dataset.page) === currentPage);
  }
}

function goToPage(delta: number) {
  if (totalPages <= 1) return;
  const next = currentPage + delta;
  if (next < 0 || next >= totalPages) return;
  currentPage = next;
  refreshCardsPage();
}

function handlePageWheel(event: WheelEvent) {
  if (!shouldHandlePageWheel(event)) return;
  handleCardsWheel(event);
}

function shouldHandlePageWheel(event: WheelEvent): boolean {
  if (prefs.galleryMode || totalPages <= 1) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  if (target.closest('input, textarea, select, button, [contenteditable="true"]')) return false;
  if (target.closest('#settingsPanel, #editPanel, #rightPanel, #rightDrawerHotspot, .bottom-dock, .engine-menu')) return false;
  return true;
}

function handleCardsWheel(event: WheelEvent) {
  if (totalPages <= 1) return;
  event.preventDefault();
  if (isScrolling) return;

  const delta = event.deltaY > 0 ? 1 : -1;
  const next = currentPage + delta;
  if (next < 0 || next >= totalPages) return;

  isScrolling = true;
  currentPage = next;
  refreshCardsPage();
  window.setTimeout(() => {
    isScrolling = false;
  }, 420);
}

function renderDetailList(cards: DashboardCard[]) {
  if (!cards.length) {
    detailListEl.innerHTML = '<div class="empty-state">暂无详细书签</div>';
    return;
  }

  const visibleCards = cards.slice(0, 18);
  detailListEl.innerHTML = visibleCards.map(detailItemHtml).join('');
  bindDetailListEvents(visibleCards);
}

function renderWidgets(data: DashboardData) {
  stopRevisitRotation();
  revisitCards = data.revisits?.length
    ? data.revisits
    : data.revisit
      ? [data.revisit]
      : [];
  revisitIndex = 0;
  renderRevisitWidget();
  startRevisitRotation();

  recentWidgetEl.innerHTML = data.recent.length
    ? data.recent.slice(0, 3).map((card) => compactCardHtml(card, 'recent-card')).join('')
    : '<div>暂无最近剪藏</div>';

  bindOpenableItems(recentWidgetEl);
}

function renderRevisitWidget() {
  const card = revisitCards[revisitIndex];
  revisitWidgetEl.classList.remove('is-flashing');
  revisitWidgetEl.innerHTML = card
    ? compactCardHtml(card, 'revisit-card')
    : '<div>暂无回访建议</div>';
  bindOpenableItems(revisitWidgetEl);
}

function rotateRevisitWidget() {
  if (document.visibilityState !== 'visible' || revisitCards.length <= 1) return;
  revisitIndex = (revisitIndex + 1) % revisitCards.length;
  renderRevisitWidget();
  scheduleRevisitFlash();
}

function scheduleRevisitFlash() {
  window.clearTimeout(revisitFlashTimer);
  revisitWidgetEl.classList.remove('is-flashing');
  if (document.visibilityState !== 'visible' || revisitCards.length <= 1) return;
  revisitFlashTimer = window.setTimeout(() => {
    revisitWidgetEl.classList.add('is-flashing');
  }, Math.max(0, REVISIT_ROTATE_MS - REVISIT_FLASH_MS));
}

function startRevisitRotation() {
  window.clearInterval(revisitRotateTimer);
  scheduleRevisitFlash();
  if (document.visibilityState !== 'visible' || revisitCards.length <= 1) return;
  revisitRotateTimer = window.setInterval(rotateRevisitWidget, REVISIT_ROTATE_MS);
}

function stopRevisitRotation() {
  window.clearInterval(revisitRotateTimer);
  window.clearTimeout(revisitFlashTimer);
  revisitRotateTimer = undefined;
  revisitFlashTimer = undefined;
  revisitWidgetEl.classList.remove('is-flashing');
}

function bindCardEvents(cards: DashboardCard[]) {
  const cardByUrl = new Map(cards.map((card) => [card.url, card]));

  for (const article of cardsEl.querySelectorAll<HTMLElement>('.bookmark-card[data-url]')) {
    const card = cardByUrl.get(article.dataset.url || '');
    article.querySelector('.edit-card')?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (card) openEditPanel(card);
    });

    article.addEventListener('click', async (event) => {
      if ((event.target as HTMLElement).closest('.edit-card')) return;
      await openUrlFromElement(article);
    });
  }

  bindFaviconFallbacks(cardsEl);
}

function bindOpenableItems(root: HTMLElement) {
  for (const itemEl of root.querySelectorAll<HTMLElement>('[data-url]')) {
    itemEl.addEventListener('click', async () => {
      await openUrlFromElement(itemEl);
    });
  }
  bindFaviconFallbacks(root);
}

function bindDetailListEvents(cards: DashboardCard[]) {
  const cardByUrl = new Map(cards.map((card) => [card.url, card]));

  for (const itemEl of detailListEl.querySelectorAll<HTMLElement>('.detail-item[data-url]')) {
    const card = cardByUrl.get(itemEl.dataset.url || '');

    itemEl.querySelector<HTMLElement>('.detail-main')?.addEventListener('click', async () => {
      await openUrlFromElement(itemEl);
    });

    itemEl.querySelector<HTMLButtonElement>('.detail-menu-button')?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeDetailMenus(itemEl);
      const menu = itemEl.querySelector<HTMLElement>('.detail-menu');
      if (menu) menu.hidden = !menu.hidden;
    });

    itemEl.querySelector<HTMLButtonElement>('.detail-menu-edit')?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeDetailMenus();
      if (card) openEditPanel(card);
    });

    itemEl.querySelector<HTMLButtonElement>('.detail-menu-delete')?.addEventListener('click', (event) => {
      event.stopPropagation();
      closeDetailMenus();
      if (card) deleteCard(card);
    });
  }

  bindFaviconFallbacks(detailListEl);
}

function closeDetailMenus(except?: HTMLElement) {
  for (const menu of detailListEl.querySelectorAll<HTMLElement>('.detail-menu')) {
    if (except?.contains(menu)) continue;
    menu.hidden = true;
  }
}

function bindFaviconFallbacks(root: HTMLElement) {
  for (const faviconEl of root.querySelectorAll<HTMLImageElement>('.favicon')) {
    faviconEl.addEventListener('error', () => {
      // 真实图标加载失败时，先用浏览器缓存的站点图标兜底，仍失败再退化为首字母
      const pageUrl = faviconEl.dataset.pageUrl;
      if (pageUrl && faviconEl.dataset.service !== 'true') {
        faviconEl.dataset.service = 'true';
        faviconEl.src = faviconServiceUrl(pageUrl);
        return;
      }
      const fallback = document.createElement('span');
      fallback.className = faviconEl.classList.contains('small-favicon')
        ? 'favicon-fallback small-favicon'
        : 'favicon-fallback';
      fallback.textContent = faviconEl.dataset.initial || '?';
      fallback.setAttribute('style', faviconEl.dataset.fallbackStyle || '');
      faviconEl.replaceWith(fallback);
    });
  }
}

async function openUrlFromElement(el: HTMLElement) {
  const url = el.dataset.url;
  if (!url) return;
  await openTab(url);
}

function bindEvents() {
  document.querySelector<HTMLButtonElement>('.brand')?.addEventListener('click', () => {
    currentFolder = '';
    searchInputEl.value = '';
    currentPage = 0;
    refreshDashboard();
  });

  editSaveEl.addEventListener('click', saveEdit);
  editCancelEl.addEventListener('click', closeEditPanel);
  editCloseEl.addEventListener('click', closeEditPanel);
  editFaviconUrlEl.addEventListener('input', () => {
    renderEditIconPreview(editingCard);
  });
  uploadFaviconEl.addEventListener('click', () => editFaviconFileEl.click());
  editFaviconFileEl.addEventListener('change', async () => {
    const file = editFaviconFileEl.files?.[0];
    if (!file || !editingCard) return;
    try {
      const dataUrl = await resizeImageFile(file, 256, 256, 0.9);
      const key = `favicon-${Date.now()}`;
      await saveImage(key, dataUrl);
      editFaviconUrlEl.value = toImageKey(key);
      await renderEditIconPreview(editingCard);
    } catch (error) {
      setStatus(`图标上传失败：${errorMessage(error)}`);
    }
    editFaviconFileEl.value = '';
  });
  editClearFaviconEl.addEventListener('click', () => {
    editFaviconUrlEl.value = '';
    renderEditIconPreview(editingCard);
  });

  settingsToggleEl.addEventListener('click', () => {
    settingsPanelEl.hidden = !settingsPanelEl.hidden;
    if (!settingsPanelEl.hidden) {
      wallpaperPreviewEl.focus();
    }
  });
  settingsCloseEl.addEventListener('click', () => {
    settingsPanelEl.hidden = true;
  });

  webSearchFormEl.addEventListener('submit', (event) => {
    event.preventDefault();
    openWebSearch();
  });

  searchInputEl.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      drawerSearchInputEl.value = searchInputEl.value;
      currentPage = 0;
      refreshDashboard();
    }, 160);
  });

  drawerSearchInputEl.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      searchInputEl.value = drawerSearchInputEl.value;
      currentPage = 0;
      refreshDashboard();
    }, 160);
  });

  // 引擎按钮：点击弹出引擎列表快速切换当前引擎
  setupEngineMenu();
  searchEngineToggleEl.addEventListener('click', (event) => {
    event.stopPropagation();
    if (engineMenuEl.hidden) openEngineMenu();
    else closeEngineMenu();
  });

  // 设置面板：搜索引擎增删改
  addEngineEl.addEventListener('click', () => {
    const engines = [...prefs.searchEngines, { id: createEngineId(), name: '', url: '' }];
    savePrefs({ searchEngines: engines });
  });

  engineListEl.addEventListener('input', (event) => {
    const target = event.target as HTMLInputElement;
    const id = target.closest<HTMLElement>('.engine-row')?.dataset.id;
    if (!id) return;
    const engine = prefs.searchEngines.find((item) => item.id === id);
    if (!engine) return;
    if (target.classList.contains('engine-name')) engine.name = target.value;
    else if (target.classList.contains('engine-url')) engine.url = target.value;
    updateSearchEngineButton();
    window.clearTimeout(engineSaveTimer);
    engineSaveTimer = window.setTimeout(() => {
      // 保存时以 DOM 为准，避免异步回写覆盖刚输入的内容
      savePrefs({ searchEngines: collectEnginesFromDom() });
    }, 300);
  });

  engineListEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>('.engine-row');
    const id = row?.dataset.id;
    if (!id) return;

    if (target.closest('.engine-icon')) {
      // 点击图标 → 上传/替换该引擎的图标
      pendingIconEngineId = id;
      engineIconFileEl.click();
      return;
    }
    if (target.closest('.engine-delete')) {
      const engines = prefs.searchEngines.filter((item) => item.id !== id);
      const update: Partial<Prefs> = { searchEngines: engines };
      if (prefs.searchEngineId === id) update.searchEngineId = engines[0]?.id ?? '';
      savePrefs(update);
    }
  });

  engineIconFileEl.addEventListener('change', async () => {
    const file = engineIconFileEl.files?.[0];
    const id = pendingIconEngineId;
    engineIconFileEl.value = '';
    pendingIconEngineId = '';
    if (!file || !id) return;
    try {
      const dataUrl = await resizeImageFile(file, 128, 128, 0.9);
      const key = toImageKey(`engine-icon-${Date.now()}`);
      await saveImage(key, dataUrl);
      const row = engineListEl.querySelector<HTMLElement>(`.engine-row[data-id="${id}"]`);
      if (row) {
        row.dataset.icon = key;
        const iconBtn = row.querySelector<HTMLElement>('.engine-icon');
        if (iconBtn) await applyEngineIcon(iconBtn, { name: '', icon: key });
      }
      await savePrefs({ searchEngines: collectEnginesFromDom() });
    } catch (error) {
      setStatus(`图标上传失败：${errorMessage(error)}`);
    }
  });

  for (const button of densityButtons) {
    button.addEventListener('click', () => {
      const density = button.dataset.density;
      if (density !== 'compact' && density !== 'standard' && density !== 'large') return;
      savePrefs({ density });
    });
  }

  for (const button of layoutPresetButtons) {
    button.addEventListener('click', () => {
      const columns = parseInt(button.dataset.columns ?? '', 10);
      const rows = parseInt(button.dataset.rows ?? '', 10);
      if (!Number.isFinite(columns) || !Number.isFinite(rows)) return;
      currentPage = 0;
      savePrefs({ gridColumns: columns, gridRows: rows });
      refreshDashboard();
    });
  }

  themeToggleEl.addEventListener('click', () => {
    const nextTheme = prefs.theme === 'dark' ? 'light' : 'dark';
    savePrefs(nextTheme === 'dark'
      ? { theme: nextTheme, wallpaperMask: 68 }
      : { theme: nextTheme, wallpaperMask: 0 });
  });

  drawerToggleEl.addEventListener('click', () => {
    const nextCollapsed = !prefs.rightPanelCollapsed;
    if (nextCollapsed) closeEditPanel();
    savePrefs({ rightPanelCollapsed: nextCollapsed });
  });

  rightDrawerHotspotEl.addEventListener('mouseenter', () => {
    openDrawerTemporarily();
  });

  rightDrawerHotspotEl.addEventListener('click', () => {
    openDrawerTemporarily();
  });

  // 鼠标滑向右侧边缘时显露入口，静止 3s 后自动隐藏
  window.addEventListener('mousemove', (event) => {
    if (event.clientX >= window.innerWidth - HOTSPOT_REVEAL_ZONE) {
      revealHotspot();
    }
  });

  rightPanelEl.addEventListener('mouseenter', () => {
    window.clearTimeout(drawerAutoCloseTimer);
  });

  rightPanelEl.addEventListener('mouseleave', () => {
    scheduleDrawerClose();
  });

  wallpaperPreviewEl.addEventListener('click', () => backgroundImageFileEl.click());
  cycleWallpaperEl.addEventListener('click', () => {
    const current = isImageKey(prefs.backgroundImageUrl)
      ? DEFAULT_BACKGROUND_IMAGE
      : prefs.backgroundImageUrl || DEFAULT_BACKGROUND_IMAGE;
    const index = BUILT_IN_WALLPAPERS.indexOf(current);
    const next = BUILT_IN_WALLPAPERS[(index + 1 + BUILT_IN_WALLPAPERS.length) % BUILT_IN_WALLPAPERS.length];
    savePrefs({ backgroundImageUrl: next === DEFAULT_BACKGROUND_IMAGE ? '' : next });
  });
  backgroundImageFileEl.addEventListener('change', async () => {
    const file = backgroundImageFileEl.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await resizeImageFile(file, 2560, 1440, 0.85);
      const key = `background-${Date.now()}`;
      await saveImage(key, dataUrl);
      savePrefs({ backgroundImageUrl: toImageKey(key) });
    } catch (error) {
      setStatus(`背景图上传失败：${errorMessage(error)}`);
    }
    backgroundImageFileEl.value = '';
  });

  wallpaperMaskInputEl.addEventListener('input', () => {
    const value = parseInt(wallpaperMaskInputEl.value, 10);
    wallpaperMaskValueEl.value = `${value}%`;
    savePrefs({ wallpaperMask: value });
  });

  wallpaperBlurInputEl.addEventListener('input', () => {
    const value = parseInt(wallpaperBlurInputEl.value, 10);
    wallpaperBlurValueEl.value = `${value}%`;
    savePrefs({ wallpaperBlur: value });
  });


  clearBackgroundImageEl.addEventListener('click', async () => {
    const oldUrl = prefs.backgroundImageUrl;
    if (isImageKey(oldUrl)) {
      await deleteImage(imageKey(oldUrl)).catch(() => {});
    }
    savePrefs({ backgroundImageUrl: '' });
  });

  for (const button of importButtons) {
    button.addEventListener('click', () => {
      importBookmarks();
    });
  }

  cardsEl.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (target.closest('.empty-import-action')) {
      event.stopPropagation();
      importBookmarks();
      return;
    }
    if (target.closest('.empty-settings-action')) {
      event.stopPropagation();
      settingsPanelEl.hidden = false;
    }
  });

  for (const button of settingsButtons) {
    button.addEventListener('click', () => {
      openOptionsPage();
    });
  }

  clipCurrentEl.addEventListener('click', async () => {
    captureRecentPage();
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (!settingsPanelEl.hidden && !target.closest('#settingsPanel, #settingsToggle')) {
      settingsPanelEl.hidden = true;
    }
    if (target.closest('.detail-menu, .detail-menu-button')) return;
    closeDetailMenus();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeDetailMenus();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') startRevisitRotation();
    else stopRevisitRotation();
  });

  // 后台在别处剪藏/补 AI/导入书签时会写入剪藏存储，已打开的新标签页据此自动刷新，
  // 无需重开页面即可让「最近剪藏」等区块更新；防抖以合并两阶段剪藏的连续写入
  // （本地预览模式下没有 chrome.storage，跳过订阅即可，不应中断后续事件绑定）
  chrome.storage?.onChanged?.addListener((changes, areaName) => {
    if (!affectsSavedClips(changes, areaName)) return;
    window.clearTimeout(clipsRefreshTimer);
    clipsRefreshTimer = window.setTimeout(() => {
      refreshDashboard();
    }, 250);
  });

  launcherAddEl.addEventListener('click', () => {
    launcherFormEl.hidden = !launcherFormEl.hidden;
    if (!launcherFormEl.hidden) launcherNameEl.focus();
  });
  launcherCancelEl.addEventListener('click', () => { launcherFormEl.hidden = true; });
  launcherFormEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const created = createLauncher({
      name: launcherNameEl.value,
      command: launcherCommandEl.value,
      url: launcherUrlEl.value,
      delayMs: 1500,
    });
    if (!created) {
      toast('请填写名称和命令（网址需以 http:// 或 https:// 开头）', 'err');
      return;
    }
    if (!isCommandAllowed(created.command)) {
      toast('该命令命中危险模式，已拒绝', 'err');
      return;
    }
    launcherItems = addLauncher(launcherItems, created);
    launcherItems = await saveLaunchers(launcherItems);
    launcherNameEl.value = '';
    launcherCommandEl.value = '';
    launcherUrlEl.value = '';
    launcherFormEl.hidden = true;
    renderLaunchers();
    toast(`已添加 ${created.name}`, 'ok');
  });

  newGroupEl.addEventListener('click', () => {
    const name = window.prompt('新建分组名称（会作为浏览器书签文件夹）', '');
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast('分组名不能为空', 'err');
      return;
    }
    void createBookmarkGroup(trimmed);
  });

  batchSelectEl.addEventListener('click', () => {
    const on = !isSelectMode();
    setSelectMode(on);
    batchSelectEl.classList.toggle('active', on);
    batchSelectEl.textContent = on ? '✕ 退出选择' : '☑ 批量选择';
    if (on) toast('已进入批量选择：点书签即可勾选，底部可批量删除', 'info');
  });

  aiRecallEl.addEventListener('click', () => {
    runAIRecall();
  });

  // 「重新整理」：清掉搜索条件并按最新数据重新清洗归类
  recategorizeEl.addEventListener('click', () => {
    searchInputEl.value = '';
    currentFolder = '';
    currentPage = 0;
    toast('正在重新整理…', 'info');
    void refreshDashboard().then(() => {
      toast('已按最新数据重新清洗并归类', 'ok');
    });
  });

  document.addEventListener('wheel', handlePageWheel, { passive: false });

  pageIndicatorEl.addEventListener('click', (event) => {
    const dot = (event.target as HTMLElement).closest<HTMLButtonElement>('.page-dot');
    if (!dot?.dataset.page) return;
    const page = Number(dot.dataset.page);
    if (page === currentPage) return;
    currentPage = page;
    refreshCardsPage();
  });

  gridColumnsInputEl.addEventListener('input', () => {
    const value = parseInt(gridColumnsInputEl.value, 10);
    gridColumnsValueEl.value = String(value);
    currentPage = 0;
    savePrefs({ gridColumns: value });
    refreshDashboard();
  });

  gridRowsInputEl.addEventListener('input', () => {
    const value = parseInt(gridRowsInputEl.value, 10);
    gridRowsValueEl.value = String(value);
    currentPage = 0;
    savePrefs({ gridRows: value });
    refreshDashboard();
  });

  cardRadiusInputEl.addEventListener('input', () => {
    const value = parseInt(cardRadiusInputEl.value, 10);
    cardRadiusValueEl.value = String(value);
    savePrefs({ cardRadius: value });
  });

  iconSizeInputEl.addEventListener('input', () => {
    const value = parseInt(iconSizeInputEl.value, 10);
    iconSizeValueEl.value = `${value}%`;
    savePrefs({ iconSize: value });
  });

  columnGapInputEl.addEventListener('input', () => {
    const value = parseInt(columnGapInputEl.value, 10);
    columnGapValueEl.value = `${value}px`;
    savePrefs({ columnGap: value });
  });

  rowGapInputEl.addEventListener('input', () => {
    const value = parseInt(rowGapInputEl.value, 10);
    rowGapValueEl.value = `${value}px`;
    savePrefs({ rowGap: value });
  });

  showLabelsInputEl.addEventListener('change', () => {
    savePrefs({ showLabels: showLabelsInputEl.checked });
  });

  showTagsInputEl.addEventListener('change', () => {
    savePrefs({ showTags: showTagsInputEl.checked });
  });

  curateKeepRatioInputEl.addEventListener('input', () => {
    const percent = parseInt(curateKeepRatioInputEl.value, 10);
    curateKeepRatioValueEl.value = `${percent}%`;
    savePrefs({ curateKeepRatio: percent / 100 });
  });
  // 拖动过程中只写值，松手才重排精选列表（否则每次 input 都重建 DOM）
  curateKeepRatioInputEl.addEventListener('change', () => rerenderBoard());

  curatePerCategoryInputEl.addEventListener('input', () => {
    const value = parseInt(curatePerCategoryInputEl.value, 10);
    curatePerCategoryValueEl.value = String(value);
    savePrefs({ curatePerCategory: value });
  });
  curatePerCategoryInputEl.addEventListener('change', () => rerenderBoard());

  showFrequentPanelInputEl.addEventListener('change', () => {
    savePrefs({ showFrequentPanel: showFrequentPanelInputEl.checked });
    rerenderBoard();
  });

  showTagPanelInputEl.addEventListener('change', () => {
    savePrefs({ showTagPanel: showTagPanelInputEl.checked });
    rerenderBoard();
  });

  showSummaryInputEl.addEventListener('change', () => {
    savePrefs({ showSummary: showSummaryInputEl.checked });
  });

  cardSortInputEl.addEventListener('change', () => {
    const sort = cardSortInputEl.value as CardSortKey;
    currentPage = 0;
    savePrefs({ cardSort: sort });
    rerenderBoard();
  });

  cardDensityInputEl.addEventListener('change', () => {
    const cardDensity = cardDensityInputEl.value === 'compact' ? 'compact' : 'comfortable';
    savePrefs({ cardDensity });
  });

  glowEnabledInputEl.addEventListener('change', () => {
    savePrefs({ glowEnabled: glowEnabledInputEl.checked });
  });

  cuteCursorInputEl.addEventListener('change', () => {
    savePrefs({ cuteCursor: cuteCursorInputEl.checked });
  });

  tiltEnabledInputEl.addEventListener('change', () => {
    savePrefs({ tiltEnabled: tiltEnabledInputEl.checked });
    applyTilt();
  });

  tiltOnRowsInputEl.addEventListener('change', () => {
    savePrefs({ tiltOnRows: tiltOnRowsInputEl.checked });
    applyTilt();
  });

  confirmBeforeDeleteInputEl.addEventListener('change', () => {
    savePrefs({ confirmBeforeDelete: confirmBeforeDeleteInputEl.checked });
  });

  showToastInputEl.addEventListener('change', () => {
    savePrefs({ showToast: showToastInputEl.checked });
  });

  tiltMaxDegInputEl.addEventListener('input', () => {
    const v = parseInt(tiltMaxDegInputEl.value, 10);
    tiltMaxDegValueEl.value = `${v}°`;
    savePrefs({ tiltMaxDeg: v });
    applyTilt();
  });

  tiltScaleInputEl.addEventListener('input', () => {
    const v = parseInt(tiltScaleInputEl.value, 10);
    tiltScaleValueEl.value = `${v}%`;
    savePrefs({ tiltScale: v / 100 });
    applyTilt();
  });

  tiltShadowInputEl.addEventListener('input', () => {
    const v = parseInt(tiltShadowInputEl.value, 10);
    tiltShadowValueEl.value = `${v}px`;
    savePrefs({ tiltShadow: v });
    applyTilt();
  });

  tiltLiftInputEl.addEventListener('input', () => {
    const v = parseInt(tiltLiftInputEl.value, 10);
    tiltLiftValueEl.value = `${v}px`;
    savePrefs({ tiltLift: v });
    applyTilt();
  });

  tiltTextLiftInputEl.addEventListener('input', () => {
    const v = parseInt(tiltTextLiftInputEl.value, 10);
    tiltTextLiftValueEl.value = `${v}px`;
    savePrefs({ tiltTextLift: v });
    applyTilt();
  });

  tiltPerspectiveInputEl.addEventListener('input', () => {
    const v = parseInt(tiltPerspectiveInputEl.value, 10);
    tiltPerspectiveValueEl.value = `${v}px`;
    savePrefs({ tiltPerspective: v });
    applyTilt();
  });

  backgroundVideoInputEl.addEventListener('change', () => {
    savePrefs({ backgroundVideoEnabled: backgroundVideoInputEl.checked });
  });

  backgroundKindInputEl.addEventListener('change', () => {
    const backgroundKind = backgroundKindInputEl.value === 'image' ? 'image' : 'video';
    savePrefs({ backgroundKind });
  });

  panelModeInputEl.addEventListener('change', () => {
    const mode: 'snap' | 'masonry' | 'free' =
      panelModeInputEl.value === 'free' ? 'free'
        : panelModeInputEl.value === 'masonry' ? 'masonry'
          : 'snap';
    const layout = currentPanelLayout();
    let next = setLayoutMode(layout, mode);
    if (mode === 'free') {
      // 用当前实际位置初始化坐标，切换时面板不会跳到左上角
      for (const id of knownPanelIds()) {
        const el = document.getElementById(id);
        if (!el) continue;
        next = setPanelBox(next, id, fallbackBox(el, id, layout));
      }
    }
    void savePrefs({ panelLayout: next });
    applyPanelLayout();
    toast(
      mode === 'free' ? '已切换到自由摆放'
        : mode === 'masonry' ? '已切换到瀑布流'
          : '已切换到吸附网格',
      'ok',
    );
  });

  resetPanelLayoutEl.addEventListener('click', () => {
    const next = resetPanelLayout(knownPanelIds());
    void savePrefs({ panelLayout: next });
    applyPanelLayout();
    toast('已恢复默认模块布局', 'ok');
  });

  // 内联新增书签
  addBookmarkToggleEl.addEventListener('click', () => {
    const show = addBookmarkFormEl.hidden;
    addBookmarkFormEl.hidden = !show;
    if (show) {
      // 若当前页就是可剪藏的网页，预填它的地址
      addBookmarkUrlEl.focus();
    }
  });
  addBookmarkCancelEl.addEventListener('click', () => {
    addBookmarkFormEl.hidden = true;
  });
  addBookmarkSubmitEl.addEventListener('click', async () => {
    const ok = await addBookmark(
      addBookmarkUrlEl.value,
      addBookmarkTitleEl.value,
      addBookmarkFolderEl.value,
    );
    if (ok) {
      addBookmarkUrlEl.value = '';
      addBookmarkTitleEl.value = '';
      addBookmarkFolderEl.value = '';
      addBookmarkFormEl.hidden = true;
    }
  });
  // 回车即提交
  for (const input of [addBookmarkUrlEl, addBookmarkTitleEl, addBookmarkFolderEl]) {
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') { event.preventDefault(); addBookmarkSubmitEl.click(); }
      if (event.key === 'Escape') addBookmarkFormEl.hidden = true;
    });
  }

  scanBookmarksEl.addEventListener('click', () => { void scanBookmarks(); });
  exportBookmarksEl.addEventListener('click', () => { void exportBookmarks(); });
  pickRestoreFileEl.addEventListener('click', () => restoreFileEl.click());
  restoreFileEl.addEventListener('change', () => { void previewRestore(); });
  applyRestoreEl.addEventListener('click', () => { void applyRestore(); });
  applyCleanupEl.addEventListener('click', () => { void applyCleanup(); });

  newTabTakeoverInputEl.addEventListener('change', () => {
    savePrefs({ newTabTakeover: newTabTakeoverInputEl.checked });
  });

  newTabRedirectInputEl.addEventListener('change', () => {
    savePrefs({ newTabRedirectUrl: newTabRedirectInputEl.value.trim() });
  });

  githubProjectsInputEl.addEventListener('change', () => {
    savePrefs({ githubProjectsEnabled: githubProjectsInputEl.checked });
    rerenderBoard();
  });

  widgetsInputEl.addEventListener('change', () => {
    savePrefs({ widgetsEnabled: widgetsInputEl.checked });
    rerenderBoard();
  });

  githubTokenInputEl.addEventListener('change', () => {
    savePrefs({ githubToken: githubTokenInputEl.value.trim() });
  });

  iconGlowInputEl.addEventListener('change', () => {
    savePrefs({ iconGlow: iconGlowInputEl.checked });
  });

  fontFamilyInputEl.addEventListener('change', () => {
    const fontFamily = toDisplayFont(fontFamilyInputEl.value);
    savePrefs({ fontFamily });
  });

  fontShadowInputEl.addEventListener('change', () => {
    savePrefs({ fontShadow: fontShadowInputEl.checked });
  });

  fontSizeInputEl.addEventListener('input', () => {
    const value = parseInt(fontSizeInputEl.value, 10);
    fontSizeValueEl.value = String(value);
    savePrefs({ fontSize: value });
  });

  galleryModeInputEl.addEventListener('change', () => {
    currentPage = 0;
    savePrefs({ galleryMode: galleryModeInputEl.checked });
    // 纯视图切换、数据未变：用缓存同步重渲染，避免异步刷新期间露出旧 cardsEl 内容（导入引导闪现）
    rerenderBoard();
  });

  searchBoxVisibleInputEl.addEventListener('change', () => {
    savePrefs({ searchBoxVisible: !searchBoxVisibleInputEl.checked });
  });

  searchBoxWidthInputEl.addEventListener('input', () => {
    const value = parseInt(searchBoxWidthInputEl.value, 10);
    searchBoxWidthValueEl.value = `${value}%`;
    savePrefs({ searchBoxWidth: value });
  });

  searchBoxRadiusInputEl.addEventListener('input', () => {
    const value = parseInt(searchBoxRadiusInputEl.value, 10);
    searchBoxRadiusValueEl.value = `${value}px`;
    savePrefs({ searchBoxRadius: value });
  });

  resetDefaultPrefsEl.addEventListener('click', async () => {
    const oldUrl = prefs.backgroundImageUrl;
    if (isImageKey(oldUrl)) {
      await deleteImage(imageKey(oldUrl)).catch(() => {});
    }
    currentPage = 0;
    await savePrefs({ ...DEFAULT_PREFS });
    refreshDashboard();
    setStatus('已恢复默认设置');
  });
}

function openDrawerTemporarily() {
  window.clearTimeout(drawerAutoCloseTimer);
  if (prefs.rightPanelCollapsed) {
    savePrefs({ rightPanelCollapsed: false });
  }
}

function scheduleDrawerClose() {
  if (!editPanelEl.hidden) return;
  window.clearTimeout(drawerAutoCloseTimer);
  drawerAutoCloseTimer = window.setTimeout(() => {
    // 计时结束时再次确认：编辑面板已打开则保持展开，避免中断编辑
    if (!editPanelEl.hidden) return;
    closeEditPanel();
    savePrefs({ rightPanelCollapsed: true });
  }, 360);
}

/** 鼠标进入右侧这个宽度内即视为“滑向右侧”，显露书签入口 */
const HOTSPOT_REVEAL_ZONE = 140;
/** 鼠标静止这么久后自动隐藏入口 */
const HOTSPOT_IDLE_HIDE_MS = 3000;

/** 显露书签入口，并在鼠标静止 3s 后自动淡出；抽屉已展开（入口不可用）时跳过 */
function revealHotspot() {
  if (rightDrawerHotspotEl.hidden) return;
  rightDrawerHotspotEl.classList.add('revealed');
  window.clearTimeout(hotspotHideTimer);
  hotspotHideTimer = window.setTimeout(() => {
    rightDrawerHotspotEl.classList.remove('revealed');
  }, HOTSPOT_IDLE_HIDE_MS);
}

function openWebSearch() {
  const query = searchInputEl.value.trim();
  if (!query) return;
  const engine = getCurrentEngine();
  if (!engine?.url) return;
  const encoded = encodeURIComponent(query);
  const url = engine.url.includes('%s') ? engine.url.replaceAll('%s', encoded) : `${engine.url}${encoded}`;
  openTab(url);
}

async function runAIRecall() {
  const query = searchInputEl.value.trim();
  if (!query) {
    setStatus('输入想找回的内容后，再点击 AI 找回。');
    searchInputEl.focus();
    return;
  }

  aiRecallEl.disabled = true;
  aiRecallEl.textContent = '找回中';
  setStatus('AI 正在理解你的找回意图...');

  try {
    const res = await sendRuntimeMessage({
      type: 'AI_RECALL',
      query,
      folder: currentFolder,
    }) as RuntimeResponse<AIRecallResponse>;

    if (!res?.ok || !res.data || !res.recall) {
      throw new Error(res?.error ?? 'AI 找回失败');
    }

    dashboardData = res.data;
    currentPage = 0;
    renderDashboard(res.data, query, currentFolder);
    const count = res.data.cards.length;
    const recallTerms = res.recall.query ? `：${res.recall.query}` : '';
    setStatus(`AI 找回完成，找到 ${count} 条结果${recallTerms}`);
  } catch (error) {
    if (isAIConfigError(error)) {
      setStatus(`AI 找回需要先配置 AI：${errorMessage(error)}。可从右上角设置进入扩展配置。`);
    } else {
      setStatus(`AI 找回失败，已使用本地搜索：${errorMessage(error)}`);
    }
    currentPage = 0;
    refreshDashboard();
  } finally {
    aiRecallEl.disabled = false;
    aiRecallEl.textContent = 'AI 找回';
    searchInputEl.focus();
  }
}

async function applyPrefs() {
  appEl.classList.remove('density-compact', 'density-standard', 'density-large', 'theme-light', 'theme-dark', 'right-collapsed', 'right-panel-open');
  appEl.classList.add(`density-${prefs.density}`, `theme-${prefs.theme}`);
  appEl.classList.toggle('right-collapsed', prefs.rightPanelCollapsed);
  appEl.classList.toggle('right-panel-open', !prefs.rightPanelCollapsed);
  rightPanelEl.classList.toggle('open', !prefs.rightPanelCollapsed);
  rightDrawerHotspotEl.hidden = !prefs.rightPanelCollapsed;
  if (prefs.rightPanelCollapsed) {
    revealHotspot(); // 首次加载与每次关闭抽屉后：先回显入口，再 3s 自动隐藏
  } else {
    window.clearTimeout(hotspotHideTimer);
    rightDrawerHotspotEl.classList.remove('revealed');
  }
  const resolvedUrl = await resolveImageUrl(prefs.backgroundImageUrl);
  const imageUrl = resolvedUrl || DEFAULT_BACKGROUND_IMAGE;
  appEl.style.setProperty('--wallpaper-image', `url("${cssUrl(imageUrl)}")`);
  appEl.style.setProperty('--wallpaper-mask', String(prefs.wallpaperMask / 100));
  appEl.style.setProperty('--wallpaper-blur', `${Math.round(prefs.wallpaperBlur * 0.24)}px`);
  appEl.style.setProperty('--wallpaper-blur-value', String(prefs.wallpaperBlur));
  appEl.style.setProperty('--grid-columns', String(prefs.gridColumns));
  appEl.style.setProperty('--grid-rows', String(prefs.gridRows));
  appEl.style.setProperty('--card-radius', `${prefs.cardRadius}px`);
  appEl.style.setProperty('--icon-size', String(prefs.iconSize / 100));
  appEl.style.setProperty('--column-gap', `${prefs.columnGap}px`);
  appEl.style.setProperty('--row-gap', `${prefs.rowGap}px`);
  appEl.style.setProperty('--search-box-width', String(prefs.searchBoxWidth));
  appEl.style.setProperty('--search-box-radius', `${prefs.searchBoxRadius}px`);
  // 同时写到 :root，确保任何不在 #app 内的元素（弹层、菜单）也继承到
  const fontStack = FONT_STACKS[toDisplayFont(prefs.fontFamily)];
  appEl.style.setProperty('--page-font-family', fontStack);
  document.documentElement.style.setProperty('--page-font-family', fontStack);
  // 直接写 font-family，双保险（有些元素不继承 CSS 变量链）
  document.body.style.fontFamily = fontStack;
  appEl.style.setProperty('--page-font-size', `${prefs.fontSize}px`);
  appEl.classList.toggle('hide-labels', !prefs.showLabels);
  appEl.classList.toggle('hide-tags', !prefs.showTags);
  appEl.classList.toggle('hide-summary', !prefs.showSummary);
  appEl.classList.toggle('density-card-compact', prefs.cardDensity === 'compact');
  appEl.classList.toggle('density-card-comfortable', prefs.cardDensity !== 'compact');
  appEl.classList.toggle('hide-search-box', !prefs.searchBoxVisible);
  appEl.classList.toggle('gallery-mode', shouldShowGallery());
  appEl.classList.toggle('font-shadow', prefs.fontShadow);
  appEl.classList.toggle('icon-glow', prefs.iconGlow);
  appEl.classList.toggle('glow', prefs.glowEnabled);
  domeGalleryEl.hidden = !shouldShowGallery();

  appEl.classList.toggle('bg-kind-video', prefs.backgroundKind === 'video');
  syncPreviewVideo();
  await applyBackgroundVideo();
  applyCuteCursor();
  applyTilt();

  gridColumnsInputEl.value = String(prefs.gridColumns);
  gridColumnsValueEl.value = String(prefs.gridColumns);
  gridRowsInputEl.value = String(prefs.gridRows);
  gridRowsValueEl.value = String(prefs.gridRows);
  cardRadiusInputEl.value = String(prefs.cardRadius);
  cardRadiusValueEl.value = String(prefs.cardRadius);
  iconSizeInputEl.value = String(prefs.iconSize);
  iconSizeValueEl.value = `${prefs.iconSize}%`;
  columnGapInputEl.value = String(prefs.columnGap);
  columnGapValueEl.value = `${prefs.columnGap}px`;
  rowGapInputEl.value = String(prefs.rowGap);
  rowGapValueEl.value = `${prefs.rowGap}px`;
  wallpaperMaskInputEl.value = String(prefs.wallpaperMask);
  wallpaperMaskValueEl.value = `${prefs.wallpaperMask}%`;
  wallpaperBlurInputEl.value = String(prefs.wallpaperBlur);
  wallpaperBlurValueEl.value = `${prefs.wallpaperBlur}%`;
  showLabelsInputEl.checked = prefs.showLabels;
  showTagsInputEl.checked = prefs.showTags;
  // 内部按 0~1 存储，UI 用百分比
  curateKeepRatioInputEl.value = String(Math.round(prefs.curateKeepRatio * 100));
  curateKeepRatioValueEl.value = `${Math.round(prefs.curateKeepRatio * 100)}%`;
  curatePerCategoryInputEl.value = String(prefs.curatePerCategory);
  curatePerCategoryValueEl.value = String(prefs.curatePerCategory);
  showFrequentPanelInputEl.checked = prefs.showFrequentPanel;
  showTagPanelInputEl.checked = prefs.showTagPanel;
  showSummaryInputEl.checked = prefs.showSummary;
  cardSortInputEl.value = prefs.cardSort;
  cardDensityInputEl.value = prefs.cardDensity;
  glowEnabledInputEl.checked = prefs.glowEnabled;
  cuteCursorInputEl.checked = prefs.cuteCursor;
  tiltEnabledInputEl.checked = prefs.tiltEnabled;
  tiltOnRowsInputEl.checked = prefs.tiltOnRows;
  confirmBeforeDeleteInputEl.checked = prefs.confirmBeforeDelete;
  showToastInputEl.checked = prefs.showToast;
  tiltMaxDegInputEl.value = String(prefs.tiltMaxDeg);
  tiltMaxDegValueEl.value = `${prefs.tiltMaxDeg}°`;
  tiltScaleInputEl.value = String(Math.round(prefs.tiltScale * 100));
  tiltScaleValueEl.value = `${Math.round(prefs.tiltScale * 100)}%`;
  tiltShadowInputEl.value = String(prefs.tiltShadow);
  tiltShadowValueEl.value = `${prefs.tiltShadow}px`;
  tiltLiftInputEl.value = String(prefs.tiltLift);
  tiltLiftValueEl.value = `${prefs.tiltLift}px`;
  tiltTextLiftInputEl.value = String(prefs.tiltTextLift);
  tiltTextLiftValueEl.value = `${prefs.tiltTextLift}px`;
  tiltPerspectiveInputEl.value = String(prefs.tiltPerspective);
  tiltPerspectiveValueEl.value = `${prefs.tiltPerspective}px`;
  backgroundVideoInputEl.checked = prefs.backgroundVideoEnabled;
  backgroundKindInputEl.value = prefs.backgroundKind;
  newTabTakeoverInputEl.checked = prefs.newTabTakeover;
  newTabRedirectInputEl.value = prefs.newTabRedirectUrl;
  githubProjectsInputEl.checked = prefs.githubProjectsEnabled;
  widgetsInputEl.checked = prefs.widgetsEnabled;
  githubTokenInputEl.value = prefs.githubToken;
  iconGlowInputEl.checked = prefs.iconGlow;
  fontFamilyInputEl.value = prefs.fontFamily;
  fontShadowInputEl.checked = prefs.fontShadow;
  fontSizeInputEl.value = String(prefs.fontSize);
  fontSizeValueEl.value = String(prefs.fontSize);
  galleryModeInputEl.checked = prefs.galleryMode;
  searchBoxVisibleInputEl.checked = !prefs.searchBoxVisible;
  searchBoxWidthInputEl.value = String(prefs.searchBoxWidth);
  searchBoxWidthValueEl.value = `${prefs.searchBoxWidth}%`;
  searchBoxRadiusInputEl.value = String(prefs.searchBoxRadius);
  searchBoxRadiusValueEl.value = `${prefs.searchBoxRadius}px`;

  for (const button of densityButtons) {
    button.classList.toggle('active', button.dataset.density === prefs.density);
  }
  for (const button of layoutPresetButtons) {
    const columns = parseInt(button.dataset.columns ?? '', 10);
    const rows = parseInt(button.dataset.rows ?? '', 10);
    button.classList.toggle('active', columns === prefs.gridColumns && rows === prefs.gridRows);
  }
  updateSearchEngineButton();
  // 结构变化（增删）时才重建配置列表，避免编辑输入时丢失焦点
  if (engineListEl.childElementCount !== prefs.searchEngines.length) {
    renderEngineList();
  }
}

function createEngineId(): string {
  return crypto.randomUUID?.() ?? `engine-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getCurrentEngine(): SearchEngineConfig | undefined {
  return prefs.searchEngines.find((engine) => engine.id === prefs.searchEngineId) ?? prefs.searchEngines[0];
}

function engineLabel(engine: { name: string }): string {
  return (engine.name.trim()[0] ?? '?').toUpperCase();
}

// 有图标显示图标，否则回退为名称首字母
async function applyEngineIcon(target: HTMLElement, engine: { name: string; icon?: string } | undefined) {
  const resolved = engine?.icon ? await resolveImageUrl(engine.icon) : null;
  if (resolved) {
    const img = document.createElement('img');
    img.className = 'engine-icon-img';
    img.src = resolved;
    img.alt = engine?.name ?? '';
    target.replaceChildren(img);
  } else {
    target.textContent = engine ? engineLabel(engine) : '?';
  }
}

function updateSearchEngineButton() {
  const engine = getCurrentEngine();
  searchEngineToggleEl.title = engine ? `当前搜索引擎：${engine.name || '(未命名)'}（点击切换）` : '未配置搜索引擎';
  void applyEngineIcon(searchEngineToggleEl, engine);
}

function collectEnginesFromDom(): SearchEngineConfig[] {
  return [...engineListEl.querySelectorAll<HTMLElement>('.engine-row')].map((row) => {
    const engine: SearchEngineConfig = {
      id: row.dataset.id ?? createEngineId(),
      name: (row.querySelector('.engine-name') as HTMLInputElement).value,
      url: (row.querySelector('.engine-url') as HTMLInputElement).value,
    };
    if (row.dataset.icon) engine.icon = row.dataset.icon;
    return engine;
  });
}

function renderEngineList() {
  engineListEl.replaceChildren(
    ...prefs.searchEngines.map((engine) => {
      const row = document.createElement('div');
      row.className = 'engine-row';
      row.dataset.id = engine.id;
      if (engine.icon) row.dataset.icon = engine.icon;

      const icon = document.createElement('button');
      icon.className = 'engine-icon';
      icon.type = 'button';
      icon.title = '上传图标';
      icon.setAttribute('aria-label', '上传搜索引擎图标');
      void applyEngineIcon(icon, engine);

      const name = document.createElement('input');
      name.className = 'engine-name';
      name.type = 'text';
      name.placeholder = '名称';
      name.value = engine.name;

      const url = document.createElement('input');
      url.className = 'engine-url';
      url.type = 'text';
      url.placeholder = 'https://…?q=%s';
      url.value = engine.url;

      const del = document.createElement('button');
      del.className = 'engine-delete';
      del.type = 'button';
      del.title = '删除';
      del.setAttribute('aria-label', '删除搜索引擎');
      del.textContent = '×';

      row.append(icon, name, url, del);
      return row;
    }),
  );
}

function setupEngineMenu() {
  engineMenuEl = document.createElement('div');
  engineMenuEl.className = 'engine-menu';
  engineMenuEl.setAttribute('role', 'listbox');
  engineMenuEl.hidden = true;
  document.body.appendChild(engineMenuEl);

  engineMenuEl.addEventListener('click', (event) => {
    const item = (event.target as HTMLElement).closest<HTMLButtonElement>('.engine-menu-item');
    if (!item?.dataset.id) return;
    closeEngineMenu();
    savePrefs({ searchEngineId: item.dataset.id });
    searchInputEl.focus();
  });
  document.addEventListener('click', (event) => {
    if (engineMenuEl.hidden) return;
    const target = event.target as Node;
    if (engineMenuEl.contains(target) || searchEngineToggleEl.contains(target)) return;
    closeEngineMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !engineMenuEl.hidden) closeEngineMenu();
  });
  window.addEventListener('resize', () => {
    if (!engineMenuEl.hidden) closeEngineMenu();
  });
}

function openEngineMenu() {
  // 每次打开按最新配置渲染，挂在 body 上按钮定位，避开搜索框 overflow:hidden 裁剪
  engineMenuEl.replaceChildren(
    ...prefs.searchEngines.map((engine) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `engine-menu-item${engine.id === prefs.searchEngineId ? ' active' : ''}`;
      item.dataset.id = engine.id;
      item.setAttribute('role', 'option');
      const mark = document.createElement('span');
      mark.className = 'engine-menu-mark';
      void applyEngineIcon(mark, engine);
      const name = document.createElement('span');
      name.className = 'engine-menu-name';
      name.textContent = engine.name || '(未命名)';
      item.append(mark, name);
      return item;
    }),
  );
  const rect = searchEngineToggleEl.getBoundingClientRect();
  engineMenuEl.style.left = `${rect.left}px`;
  engineMenuEl.style.top = `${rect.bottom + 8}px`;
  engineMenuEl.hidden = false;
  searchEngineToggleEl.setAttribute('aria-expanded', 'true');
}

function closeEngineMenu() {
  engineMenuEl.hidden = true;
  searchEngineToggleEl.setAttribute('aria-expanded', 'false');
}

async function savePrefs(update: Partial<Prefs>) {
  const requestId = ++prefsSaveSeq;
  const previousPrefs = { ...prefs };
  prefs = normalizePrefs({ ...prefs, ...update });
  await applyPrefs();

  try {
    const res = await sendRuntimeMessage({
      type: 'SAVE_NEW_TAB_PREFS',
      update,
    }) as RuntimeResponse<{ prefs?: Prefs }>;

    if (!res?.ok || !res.prefs) {
      throw new Error(res?.error ?? '偏好设置保存失败');
    }

    if (requestId === prefsSaveSeq) {
      prefs = normalizePrefs(res.prefs);
      await applyPrefs();
    }
  } catch (error) {
    if (requestId === prefsSaveSeq) {
      prefs = previousPrefs;
      await applyPrefs();
      setStatus(`偏好设置保存失败：${errorMessage(error)}`);
    }
  }
}
/* ------------------------------------------------------------ 新建书签分组 */

/**
 * 新建一个分组：在浏览器书签里创建一个同名文件夹。
 * 分组本身来自书签文件夹，所以建好文件夹后「重新整理」就会把它显示成面板。
 */
async function createBookmarkGroup(name: string) {
  setStatus(`正在创建分组「${name}」…`);
  try {
    const res = await sendRuntimeMessage({
      type: 'CREATE_BOOKMARK_GROUP',
      name,
    }) as RuntimeResponse<{ id?: string; existed?: boolean }>;
    if (!res?.ok) throw new Error(res?.error ?? '创建失败');
    setStatus(res.existed ? `分组「${name}」已存在` : `✓ 已创建分组「${name}」`);
    await refreshDashboard();
  } catch (error) {
    setStatus(`创建分组失败：${errorMessage(error)}`);
  }
}

/* ---------------------------------------------------------------- 启动器 */

let launcherItems: LauncherItem[] = [];
let launcherAvailable = false;

/** 渲染启动器按钮网格 */
function renderLaunchers() {
  if (!launcherGridEl) return;
  launcherHintEl.textContent = launcherAvailable
    ? `${launcherItems.length} 个应用`
    : '需要先安装本机启动器（native-host/install.sh）';

  if (!launcherItems.length) {
    launcherGridEl.innerHTML = '<div class="panel-empty">还没有应用。点「+ 应用」添加一个，例如命令 <b>open -a Obsidian</b> + 网址 <b>http://127.0.0.1:27123/</b>。</div>';
    return;
  }

  launcherGridEl.innerHTML = launcherItems.map((item) => `
    <button class="launcher-btn" type="button" data-launch="${escapeAttr(item.id)}" title="${escapeAttr(item.command)}">
      <span class="launcher-icon">${escapeHtml(item.icon)}</span>
      <span class="launcher-text">
        <span class="launcher-name">${escapeHtml(item.name)}</span>
        <span class="launcher-cmd">${escapeHtml(item.command)}</span>
      </span>
      <span class="launcher-del" data-launch-del="${escapeAttr(item.id)}" title="删除">✕</span>
    </button>
  `).join('');

  for (const btn of launcherGridEl.querySelectorAll<HTMLElement>('[data-launch]')) {
    btn.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('[data-launch-del]')) return;
      void launchApp(btn.dataset.launch ?? '');
    });
  }
  for (const del of launcherGridEl.querySelectorAll<HTMLElement>('[data-launch-del]')) {
    del.addEventListener('click', async (event) => {
      event.stopPropagation();
      launcherItems = removeLauncher(launcherItems, del.dataset.launchDel ?? '');
      launcherItems = await saveLaunchers(launcherItems);
      renderLaunchers();
      toast('已删除启动项', 'ok');
    });
  }
}

/** 一键启动：跑命令 → 等一会儿 → 打开网址 */
async function launchApp(id: string) {
  const item = launcherItems.find((x) => x.id === id);
  if (!item) return;

  if (!launcherAvailable) {
    toast('本机启动器未安装：请先运行 native-port/install.sh 并重启 Chrome', 'err');
    return;
  }

  toast(`正在启动 ${item.name}…`, 'info');
  try {
    const res = await sendRuntimeMessage({
      type: 'LAUNCH_APP',
      command: item.command,
    }) as RuntimeResponse<{ pid?: number }>;
    if (!res?.ok) throw new Error(res?.error ?? '启动失败');

    if (item.url) {
      // 给服务留出启动时间再打开网页
      window.setTimeout(() => { void openTab(item.url); }, item.delayMs);
      toast(`已启动 ${item.name}，${(item.delayMs / 1000).toFixed(1)}s 后打开页面`, 'ok');
    } else {
      toast(`已启动 ${item.name}`, 'ok');
    }
  } catch (error) {
    toast(`启动失败：${errorMessage(error)}`, 'err');
  }
}

/** 初始化启动器：读配置 + 探测 host 是否可用 */
async function initLaunchers() {
  launcherItems = await loadLaunchers();
  if (!launcherItems.length) {
    launcherItems = defaultLaunchers();
    launcherItems = await saveLaunchers(launcherItems);
  }
  renderLaunchers();

  try {
    const res = await sendRuntimeMessage({ type: 'LAUNCHER_AVAILABLE' }) as RuntimeResponse<{ available?: boolean }>;
    launcherAvailable = Boolean(res?.available);
  } catch {
    launcherAvailable = false;
  }
  renderLaunchers();
}

/* ------------------------------------------------- 工作台面板自定义布局 */

/**
 * 瀑布流重排的防抖定时器。
 * 内容异步加载完成后面板高度会变，需要重新排布；用防抖避免频繁重算。
 */
let masonryRelayoutTimer: number | undefined;
let masonryObserver: ResizeObserver | undefined;

/** 内容变化后延迟重排（瀑布流模式专用） */
function scheduleMasonryRelayout() {
  if (currentPanelLayout().mode !== 'masonry') return;
  window.clearTimeout(masonryRelayoutTimer);
  masonryRelayoutTimer = window.setTimeout(() => {
    // 只在高度真的变了才重排，避免无限循环
    if (currentPanelLayout().mode === 'masonry') applyPanelLayout();
  }, 180);
}

/** 监听面板尺寸变化 → 触发瀑布流重排 */
function observePanelResize() {
  if (typeof ResizeObserver === 'undefined') return;
  masonryObserver?.disconnect();
  masonryObserver = new ResizeObserver(() => scheduleMasonryRelayout());
  for (const el of dashboardPanelsEl.querySelectorAll<HTMLElement>('.panel-block')) {
    masonryObserver.observe(el);
  }
}

/** 网格行高单位：设置里的「行跨度」按它换算成像素高度 */
const ROW_UNIT = 120;

/** 面板间距（必须与 CSS 的 gap 一致，装箱才算得准） */
const PANEL_GAP = 14;

/** 窄屏退成一列（与 CSS @media (max-width: 900px) 对应） */
function panelColumnCount(): number {
  return window.innerWidth <= 900 ? 1 : 2;
}

/** 按 order 取面板元素（含被隐藏的，隐藏面板也要留在 DOM 里才能恢复） */
function orderedPanelEls(layout: PanelLayout): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const id of layout.order) {
    const el = document.getElementById(id);
    if (el) out.push(el);
  }
  return out;
}

/** 面板是否真的占据空间（[hidden] 或设置里收起的都算不可见） */
function isPanelShown(el: HTMLElement): boolean {
  return !el.hidden && !el.classList.contains('panel-collapsed');
}

/**
 * 面板的固定高度（px），0 = 随内容自适应。
 * 显式像素高度优先，其次「行跨度 × 行高单位」——两种设置方式都生效。
 */
function panelFixedHeight(layout: PanelLayout, id: string): number {
  const h = toHeight(layout.heights[id]) ?? 0;
  if (h > 0) return h;
  const rows = toRowSpan(layout.rowSpans[id]) ?? 0;
  return rows > 0 ? rows * ROW_UNIT : 0;
}

/** 写入/清除面板高度，并同步「固定高度后内容可滚动」的行为 */
function setPanelHeightStyle(el: HTMLElement, height: number) {
  if (height > 0) {
    el.style.height = `${height}px`;
    el.classList.add('panel-fixed');
  } else {
    el.style.removeProperty('height');
    el.classList.remove('panel-fixed');
  }
}

/** 清掉上一轮布局的定位残留，保证模式之间切换不会互相干扰 */
function resetPanelGeometry(el: HTMLElement) {
  el.classList.remove('panel-full', 'panel-fixed', 'is-clipped');
  for (const prop of [
    'position', 'left', 'top', 'width', 'height', 'min-height',
    'grid-row', 'grid-column', 'order', 'z-index', 'padding-top',
  ]) {
    el.style.removeProperty(prop);
  }
}

/** 把布局应用到 DOM：顺序、宽度、高度、显隐 */
function applyPanelLayout() {
  const layout = currentPanelLayout();
  const ids = knownPanelIds();
  const free = layout.mode === 'free';
  const masonry = layout.mode === 'masonry';

  dashboardPanelsEl.classList.toggle('mode-free', free);
  dashboardPanelsEl.classList.toggle('mode-masonry', masonry);
  dashboardPanelsEl.classList.toggle('mode-snap', !free && !masonry);

  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    resetPanelGeometry(el);
    el.classList.toggle('panel-collapsed', layout.hidden.includes(id));
    el.draggable = false;
    ensurePanelHandle(el);
  }

  if (free) applyFreeLayout(layout);
  else if (masonry) applyMasonryLayout(layout);
  else applySnapLayout(layout);

  syncPanelClipping();
  syncPanelModeUi(layout);
  renderPanelSettingsList();
  observePanelResize();
}

/**
 * 定高面板只在内容真的溢出时才裁剪（加 .is-clipped）。
 * 平时保持 overflow: visible，面板里的行做 3D 倾斜时才不会把伸出的一角切掉。
 */
function syncPanelClipping() {
  for (const el of dashboardPanelsEl.querySelectorAll<HTMLElement>('.panel-block.panel-fixed')) {
    el.classList.toggle('is-clipped', el.scrollHeight > el.clientHeight + 1);
  }
}

/**
 * 吸附布局：每个面板按「较矮的一列优先」放进两条独立纵向列里。
 *
 * 刻意不用 CSS Grid 的等高行 —— 同一行的网格项会被拉成等高，
 * 右侧一个高面板（趋势榜）就会在左侧矮面板下面撑出大片空白，
 * 这正是用户截图里的问题。列内是纵向 flex，列与列互不影响。
 *
 * 占满整行的面板（span >= 7）不属于任何一列，排在两列之上单独成行。
 */
function applySnapLayout(layout: PanelLayout) {
  const colLeft = document.getElementById('dashboardColLeft');
  const colRight = document.getElementById('dashboardColRight');

  // 窄屏只有一列：把右列从流里摘掉，否则它会占掉一条空轨道
  const columns = panelColumnCount();
  const cols: HTMLElement[] = colLeft
    ? (columns >= 2 && colRight ? [colLeft, colRight] : [colLeft])
    : [];
  if (colRight) colRight.hidden = cols.length < 2;

  const panelById = new Map(
    orderedPanelEls(layout).map((el) => [el.id, el] as const),
  );
  const items = layout.order
    .filter((id) => panelById.has(id))
    .map((id) => ({
      id,
      span: toSpan(layout.spans[id]) ?? 6,
      // 自适应高度用实测值，让装箱能平衡两列
      h: panelFixedHeight(layout, id) || (panelById.get(id)!.offsetHeight || 200),
      colStart: toColStart(layout.colStarts[id]) ?? 0,
    }));

  // 先清空列容器（包括窄屏不用的右列），面板随后按方案重新挂载
  const allCols = [colLeft, colRight].filter((col): col is HTMLElement => col !== null);
  for (const col of allCols) col.replaceChildren();

  const plan = planSnapColumns(items, cols.length || 1);
  const fullRow: HTMLElement[] = [];
  for (const p of plan) {
    const el = panelById.get(p.id);
    if (!el) continue;
    if (p.full) {
      el.classList.add('panel-full');
      fullRow.push(el);
    } else {
      (cols[p.col] ?? cols[0])?.append(el);
    }
    setPanelHeightStyle(el, panelFixedHeight(layout, p.id));
  }

  // 顺序 = DOM 顺序 = 阅读顺序：整行面板在最上，然后是各列容器
  for (const el of fullRow) dashboardPanelsEl.append(el);
  for (const col of allCols) dashboardPanelsEl.append(col);
  dashboardPanelsEl.style.removeProperty('min-height');
}

/**
 * 瀑布流：绝对定位 + packMasonry 装箱。
 * 每列独立堆叠，某个面板变高不会把整行拉高，空隙自然消失。
 */
function applyMasonryLayout(layout: PanelLayout) {
  const columns = panelColumnCount();
  const board = dashboardPanelsEl.getBoundingClientRect();
  const colWidth = (board.width - PANEL_GAP * (columns - 1)) / columns;
  const ordered = orderedPanelEls(layout);

  // 第一遍：只给宽度，让内容按目标列宽展开，才量得到真实高度
  const items: MasonryItem[] = [];
  for (const el of ordered) {
    dashboardPanelsEl.append(el);
    const span = toSpan(layout.spans[el.id]) ?? 6;
    const cols = span >= FULL_ROW_MIN_SPAN ? columns : 1;
    el.style.width = `${Math.round(cols * colWidth + (cols - 1) * PANEL_GAP)}px`;
    const explicit = panelFixedHeight(layout, el.id);
    setPanelHeightStyle(el, explicit);
    if (!isPanelShown(el)) continue;
    items.push({ id: el.id, span: cols, h: explicit || el.offsetHeight || 200 });
  }

  const { placements, totalHeight } = packMasonry(items, columns, colWidth, PANEL_GAP);
  for (const p of placements) {
    const el = document.getElementById(p.id);
    if (!el) continue;
    el.style.left = `${Math.round(p.col * (colWidth + PANEL_GAP))}px`;
    el.style.top = `${Math.round(p.y)}px`;
  }
  dashboardPanelsEl.style.minHeight = `${Math.ceil(totalHeight)}px`;
}

/**
 * 自由摆放：完全按存档的像素盒子定位，允许重叠。
 * 没有盒子的面板（切模式后新增的分组）排在最下方，不打乱已有布局。
 */
function applyFreeLayout(layout: PanelLayout) {
  const ordered = orderedPanelEls(layout);
  const boxes: Record<string, PanelBox> = { ...layout.positions };
  let bottom = 0;

  for (const el of ordered) {
    dashboardPanelsEl.append(el);
    let box = toPanelBox(boxes[el.id]);
    if (!box) {
      const naturalWidth = freeWidthForSpan(toSpan(layout.spans[el.id]) ?? 6);
      const explicit = panelFixedHeight(layout, el.id);
      el.style.width = `${naturalWidth}px`;
      box = clampFreeBox({
        x: 0,
        y: Math.round(bottom),
        w: naturalWidth,
        h: explicit || el.offsetHeight || 240,
      });
      boxes[el.id] = box;
    }
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
    el.classList.add('panel-fixed');
    bottom = Math.max(bottom, box.y + box.h);
  }

  dashboardPanelsEl.style.minHeight = `${Math.round(bottom + PANEL_GAP)}px`;

  // 补出来的盒子写回存档，否则刷新后位置又会漂一次
  const missing = ordered.filter((el) => !toPanelBox(layout.positions[el.id]));
  if (missing.length) {
    let next = layout;
    for (const el of missing) next = setPanelBox(next, el.id, boxes[el.id]);
    void savePrefs({ panelLayout: next });
  }
}

/**
 * 已知面板 id。
 * 书签分组的 id 是动态的（`group-ai` …），由 curated-view 渲染出来，
 * 所以这里直接从 DOM 读，保证与 HTML / 动态面板同步。
 */
function knownPanelIds(): string[] {
  return [...dashboardPanelsEl.querySelectorAll<HTMLElement>('.panel-block')]
    .map((el) => el.id)
    .filter(Boolean);
}

/** 面板显示名：分组用真实名称，静态面板用内置中文名 */
function panelLabels(): Record<string, string> {
  return { ...PANEL_LABELS, ...groupLabels() };
}

/** 读取当前布局（没有就用默认） */
function currentPanelLayout(): PanelLayout {
  const ids = knownPanelIds();
  return prefs.panelLayout
    ? normalizePanelLayout(prefs.panelLayout, ids)
    : defaultPanelLayout(ids);
}


/** 为面板加拖拽把手 / 宽度按钮 / 收起按钮 / 拉伸把手（只加一次） */
function ensurePanelHandle(el: HTMLElement) {
  const head = el.querySelector('.panel-head');
  if (!head) return;

  if (!head.querySelector('.panel-drag')) {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'panel-drag';
    handle.title = '按住拖动调整位置';
    handle.setAttribute('aria-label', '拖动调整位置');
    handle.textContent = '⠿';
    // 指针事件拖拽（比 HTML5 DnD 可靠：把手是 button 时 dragstart 常常不触发）
    handle.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPanelDrag(el, event);
    });
    head.prepend(handle);
  }

  if (!head.querySelector('.panel-span')) {
    const spanBtn = document.createElement('button');
    spanBtn.type = 'button';
    spanBtn.className = 'panel-span';
    spanBtn.title = '切换该面板放到哪一列 / 是否占满整行';
    spanBtn.setAttribute('aria-label', '切换宽度');
    spanBtn.textContent = '⇔';
    spanBtn.addEventListener('click', () => {
      const l = currentPanelLayout();
      const cur = toSpan(l.spans[el.id]) ?? 6;
      // 半宽 → 整行 → 半宽 循环
      const next = cur >= 7 ? 6 : 12;
      let nl = setPanelSpan(l, el.id, next);
      if (l.mode === 'free') {
        // 自由模式按像素盒子排版，改档位的视觉反馈就是改宽度
        nl = setPanelBox(nl, el.id, clampFreeBox({ ...panelBoxOrFallback(el, l), w: freeWidthForSpan(next) }));
      }
      void savePrefs({ panelLayout: nl });
      applyPanelLayout();
      toast(next >= 7 ? '已设为占满整行' : '已设为半宽（自动选较矮的一列）', 'ok');
    });
    head.append(spanBtn);
  }

  if (!head.querySelector('.panel-hide')) {
    const hideBtn = document.createElement('button');
    hideBtn.type = 'button';
    hideBtn.className = 'panel-hide';
    hideBtn.title = '收起这个模块（可在设置里恢复）';
    hideBtn.setAttribute('aria-label', '收起模块');
    hideBtn.textContent = '×';
    hideBtn.addEventListener('click', () => {
      const wasHidden = currentPanelLayout().hidden.includes(el.id);
      const next = togglePanelHidden(currentPanelLayout(), el.id);
      void savePrefs({ panelLayout: next });
      applyPanelLayout();
      toast(wasHidden ? '已恢复显示该模块' : '已收起模块，可在设置 → 工作台模块里恢复', 'info');
    });
    head.append(hideBtn);
  }

  // 把手的文字提示随模式变化：自由模式下拖右下角同时改宽和高
  const resizeTitle = currentPanelLayout().mode === 'free' ? '拖动调整大小' : '拖动调整高度';
  const existingResize = el.querySelector<HTMLElement>('.panel-resize');
  if (existingResize) {
    existingResize.title = resizeTitle;
    existingResize.setAttribute('aria-label', resizeTitle);
  } else {
    const resize = document.createElement('div');
    resize.className = 'panel-resize';
    resize.title = resizeTitle;
    resize.setAttribute('aria-label', resizeTitle);
    resize.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPanelResize(el, event);
    });
    el.append(resize);
  }
}

/** 把 span（1~12 列）换算成自由模式下的像素宽度 */
function freeWidthForSpan(span: number): number {
  const board = dashboardPanelsEl.getBoundingClientRect();
  const colWidth = (board.width - PANEL_GAP * (PANEL_GRID_COLUMNS - 1)) / PANEL_GRID_COLUMNS;
  const safe = Math.max(1, Math.min(PANEL_GRID_COLUMNS, Math.trunc(span) || 6));
  return Math.round(safe * colWidth + (safe - 1) * PANEL_GAP);
}

/** 把盒子夹进合法区间，异常坐标/尺寸不会把面板推出可视区 */
function clampFreeBox(box: PanelBox): PanelBox {
  const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(v)));
  return {
    x: clamp(box.x, MIN_FREE_COORD, MAX_FREE_COORD),
    y: clamp(box.y, MIN_FREE_COORD, MAX_FREE_COORD),
    w: clamp(box.w, MIN_FREE_W, MAX_FREE_SIZE),
    h: clamp(box.h, MIN_FREE_H, MAX_FREE_SIZE),
  };
}

/** 当前布局里某个面板的兜底位置尺寸（切到自由模式时用） */
function fallbackBox(el: HTMLElement, id: string, layout: PanelLayout) {
  const board = dashboardPanelsEl.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const w = freeWidthForSpan(toSpan(layout.spans[id]) ?? 6);
  const h = panelFixedHeight(layout, id) || Math.round(r.height) || 260;
  return clampFreeBox({
    x: Math.max(0, Math.round(r.left - board.left)),
    y: Math.max(0, Math.round(r.top - board.top)),
    w,
    h,
  });
}

/** 读取面板在自由模式下的盒子；没有就按当前视觉位置补一个 */
function panelBoxOrFallback(el: HTMLElement, layout: PanelLayout): PanelBox {
  return toPanelBox(layout.positions[el.id]) ?? fallbackBox(el, el.id, layout);
}

/**
 * 拖拽面板排序。
 * 两列布局下按「锚点相对移动」：把面板移到某个锚点面板的前面/后面。
 * 这也符合用户心智 ——「放到这个面板旁边」。
 */
function startPanelDrag(el: HTMLElement, down: PointerEvent) {
  if (currentPanelLayout().mode === 'free') {
    startFreePanelMove(el, down);
    return;
  }
  const startX = down.clientX;
  const startY = down.clientY;
  let moved = false;
  let last: { index: number; before: boolean } | null = null;
  let pointer = { x: down.clientX, y: down.clientY };

  const others = () => [...dashboardPanelsEl.querySelectorAll<HTMLElement>('.panel-block')]
    .filter((p) => p !== el && !p.hasAttribute('hidden') && p.getBoundingClientRect().width > 0);

  /** 按视觉阅读顺序（上→下，左→右）排序 */
  const orderedRects = () => others()
    .map((p) => ({ el: p, r: p.getBoundingClientRect() }))
    .sort((a, b) => (Math.abs(a.r.top - b.r.top) > 8 ? a.r.top - b.r.top : a.r.left - b.r.left))
    .map((x) => ({ el: x.el, left: x.r.left, top: x.r.top, right: x.r.right, bottom: x.r.bottom }));

  const clearMarks = () => {
    for (const other of dashboardPanelsEl.querySelectorAll('.panel-block')) {
      other.classList.remove('drop-before', 'drop-after');
    }
  };

  const onMove = (move: PointerEvent) => {
    if (!moved && Math.abs(move.clientX - startX) + Math.abs(move.clientY - startY) < 4) return;
    if (!moved) {
      moved = true;
      el.classList.add('dragging');
      document.body.classList.add('dragging-panel');
    }
    pointer = { x: move.clientX, y: move.clientY };
    const rects = orderedRects();
    if (!rects.length) return;
    const index = computeDropIndex(rects, pointer, last);
    clearMarks();
    const anchor = rects[Math.min(index, rects.length - 1)];
    if (!anchor) return;
    const before = index <= rects.length - 1;
    anchor.el.classList.add(before ? 'drop-before' : 'drop-after');
    last = { index, before };
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('dragging-panel');
    el.classList.remove('dragging');
    clearMarks();

    if (!moved) {
      toast('按住 ⠿ 拖动可调整位置', 'info');
      return;
    }

    const rects = orderedRects();
    const to = computeDropIndex(rects, pointer, last);
    const layout = currentPanelLayout();
    if (!layout.order.includes(el.id)) return;

    let next = layout;
    if (rects.length) {
      const clamped = Math.max(0, Math.min(to, rects.length));
      const before = clamped < rects.length;
      const anchor = before ? rects[clamped] : rects[rects.length - 1];
      next = moveNextTo(layout, el.id, anchor.el.id, before);
    }
    if (next.order.join() === layout.order.join()) {
      toast('位置未变化', 'info');
      return;
    }
    void savePrefs({ panelLayout: next });
    applyPanelLayout();
    toast('已调整模块位置', 'ok');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/**
 * 自由摆放模式下的拖拽：直接按像素改坐标，不影响任何其它面板。
 * 默认 4px 一格方便对齐，按住 Shift 逐像素微调。
 */
function startFreePanelMove(el: HTMLElement, down: PointerEvent) {
  const layout = currentPanelLayout();
  if (!layout.order.includes(el.id)) return;
  const start = panelBoxOrFallback(el, layout);
  const originX = down.clientX;
  const originY = down.clientY;
  let box: PanelBox = { ...start };

  document.body.classList.add('dragging-panel');
  el.classList.add('dragging');

  const onMove = (move: PointerEvent) => {
    const step = move.shiftKey ? 1 : 4;
    const snap = (v: number) => Math.round(v / step) * step;
    box = clampFreeBox({
      ...start,
      x: snap(start.x + (move.clientX - originX)),
      y: snap(start.y + (move.clientY - originY)),
    });
    el.style.left = `${box.x}px`;
    el.style.top = `${box.y}px`;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('dragging-panel');
    el.classList.remove('dragging');
    if (box.x === start.x && box.y === start.y) {
      toast('位置未变化', 'info');
      applyPanelLayout();
      return;
    }
    const next = setPanelBox(currentPanelLayout(), el.id, box);
    void savePrefs({ panelLayout: next });
    applyPanelLayout();
    toast(`已移动到 (${box.x}, ${box.y})`, 'ok');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** 自由摆放模式下的拉伸：右下角同时改宽和高 */
function startFreePanelResize(el: HTMLElement, down: PointerEvent) {
  const layout = currentPanelLayout();
  if (!layout.order.includes(el.id)) return;
  const start = panelBoxOrFallback(el, layout);
  const originX = down.clientX;
  const originY = down.clientY;
  let box: PanelBox = { ...start };

  document.body.classList.add('resizing-panel');
  el.classList.add('is-resizing');

  const onMove = (move: PointerEvent) => {
    const step = move.shiftKey ? 1 : 4;
    const snap = (v: number) => Math.round(v / step) * step;
    box = clampFreeBox({
      ...start,
      w: snap(start.w + (move.clientX - originX)),
      h: snap(start.h + (move.clientY - originY)),
    });
    el.style.width = `${box.w}px`;
    el.style.height = `${box.h}px`;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('resizing-panel');
    el.classList.remove('is-resizing');
    if (box.w === start.w && box.h === start.h) {
      toast('尺寸未变化', 'info');
      applyPanelLayout();
      return;
    }
    const next = setPanelBox(currentPanelLayout(), el.id, box);
    void savePrefs({ panelLayout: next });
    applyPanelLayout();
    toast(`尺寸 ${box.w}×${box.h}`, 'ok');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** 拖右下角调整高度（吸附 / 瀑布流模式只改高度） */
function startPanelResize(el: HTMLElement, down: PointerEvent) {
  if (currentPanelLayout().mode === 'free') {
    startFreePanelResize(el, down);
    return;
  }
  const startY = down.clientY;
  const layout0 = currentPanelLayout();
  const rect0 = el.getBoundingClientRect();
  const startHeight = panelFixedHeight(layout0, el.id);
  const baseHeight = startHeight > 0 ? startHeight : Math.round(rect0.height);
  let liveHeight = startHeight;

  document.body.classList.add('resizing-panel');
  el.classList.add('is-resizing');

  let moved = false;

  const onMove = (move: PointerEvent) => {
    const step = move.shiftKey ? 1 : 4;
    const snap = (v: number) => Math.round(v / step) * step;
    const next = Math.max(MIN_PANEL_HEIGHT, snap(baseHeight + (move.clientY - startY)));
    if (next === liveHeight && moved) return;
    moved = true;
    liveHeight = next;
    el.style.height = `${liveHeight}px`;
  };

  const onUp = () => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    document.body.classList.remove('resizing-panel');
    el.classList.remove('is-resizing');
    if (!moved) {
      applyPanelLayout();
      toast(liveHeight ? `当前高度 ${liveHeight}px，拖动右下角把手可调整` : '拖动右下角把手可调整高度', 'info');
      return;
    }
    const next = setPanelHeight(currentPanelLayout(), el.id, liveHeight);
    void savePrefs({ panelLayout: next });
    applyPanelLayout();
    toast(`高度 ${liveHeight}px`, 'ok');
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}

/** 同步「布局方式」下拉与说明文字 */
function syncPanelModeUi(layout: PanelLayout) {
  if (!panelModeInputEl) return;
  panelModeInputEl.value = layout.mode;
  if (panelModeNoteEl) {
    panelModeNoteEl.textContent =
      layout.mode === 'free'
        ? '自由摆放：每个面板独立定位，改大小或位置都不会影响其它面板，允许重叠。按住 Shift 精细调整。'
        : layout.mode === 'masonry'
          ? '瀑布流：每列独立堆叠，某个面板变高不会把整行拉高，空隙自动填满。拖 ⠿ 可调整顺序。'
          : '吸附网格：两列自动平衡、逐行独立排布。同一行的面板不会被拉成等高，矮面板下面不会留空白。拖 ⠿ 调整顺序，⇔ 切换半宽/整行。';
  }
}

function renderPanelSettingsList() {
  if (!panelSettingsListEl) return;
  const layout = currentPanelLayout();
  const items = panelListForSettings(layout, panelLabels());
  panelSettingsListEl.innerHTML = items.map((item) => `
    <div class="panel-setting-row" data-panel-id="${escapeAttr(item.id)}">
      <span class="panel-setting-name" title="${escapeAttr(item.id)}">${escapeHtml(item.label)}</span>
      <span class="panel-setting-actions">
        <button class="mini-action" type="button" data-panel-up title="上移">↑</button>
        <button class="mini-action" type="button" data-panel-down title="下移">↓</button>
        <button class="mini-action" type="button" data-panel-narrow title="变窄">−</button>
        <span class="panel-setting-w">${spanPercent(item.span)}%</span>
        <button class="mini-action" type="button" data-panel-wide title="变宽">+</button>
        <button class="mini-action" type="button" data-panel-rows title="循环行跨度（高度单位数）">${item.rowSpan}行</button>
        <button class="mini-action" type="button" data-panel-col title="循环列起点（0=自动，1~12 对齐到该列）">${item.colStart === 0 ? '自动列' : '第' + item.colStart + '列'}</button>
        <button class="mini-action" type="button" data-panel-height title="循环像素高度：自适应/200/320/480/700">${item.height || '自'}</button>
        <button class="mini-action" type="button" data-panel-toggle title="${item.hidden ? '显示' : '隐藏'}">${item.hidden ? '显示' : '隐藏'}</button>
      </span>
    </div>
  `).join('');

  for (const row of panelSettingsListEl.querySelectorAll<HTMLElement>('[data-panel-id]')) {
    const id = row.dataset.panelId ?? '';
    const commit = (next: PanelLayout, msg: string) => {
      void savePrefs({ panelLayout: next });
      applyPanelLayout();
      toast(msg, 'ok');
    };
    row.querySelector('[data-panel-up]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      const i = l.order.indexOf(id);
      if (i > 0) commit(movePanel(l, id, i - 1), '已上移');
    });
    row.querySelector('[data-panel-down]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      const i = l.order.indexOf(id);
      if (i >= 0 && i < l.order.length - 1) commit(movePanel(l, id, i + 1), '已下移');
    });
    row.querySelector('[data-panel-narrow]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      commit(setPanelSpan(l, id, (toSpan(l.spans[id]) ?? 6) - 1), '已变窄');
    });
    row.querySelector('[data-panel-wide]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      commit(setPanelSpan(l, id, (toSpan(l.spans[id]) ?? 6) + 1), '已变宽');
    });
    row.querySelector('[data-panel-rows]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      const cur = toRowSpan(l.rowSpans[id]) ?? 1;
      const next = cur >= 6 ? 1 : cur + 1;
      commit(setPanelRowSpan(l, id, next), `行跨度 ${next}`);
    });
    row.querySelector('[data-panel-col]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      const cur = toColStart(l.colStarts[id]) ?? 0;
      const next = cur >= PANEL_GRID_COLUMNS ? 0 : cur + 1;
      commit(setPanelColStart(l, id, next), next === 0 ? '列位置：自动' : `对齐到第 ${next} 列`);
    });
    row.querySelector('[data-panel-height]')?.addEventListener('click', () => {
      const l = currentPanelLayout();
      const presets = [0, 200, 320, 480, 700];
      const cur = toHeight(l.heights[id]) ?? 0;
      const idx = presets.indexOf(cur);
      const next = presets[(idx + 1) % presets.length];
      commit(setPanelHeight(l, id, next), next ? `高度 ${next}px` : '高度自适应');
    });
    row.querySelector('[data-panel-toggle]')?.addEventListener('click', () => {
      commit(togglePanelHidden(currentPanelLayout(), id), '已切换显示');
    });
  }
}

/* ------------------------------------------------------- 书签清理流程 */

let pendingCleanupIds: string[] = [];

/* ------------------------------------------------- 工作台内增删书签 */

/** 从浏览器书签中删除一条（带确认，不可恢复） */
async function deleteBookmark(url: string, title: string) {
  // 二次确认可关闭（设置 → 观感 → 删除前确认）
  if (prefs.confirmBeforeDelete) {
    const ok = window.confirm(`从浏览器书签中删除「${title || url}」吗？\n\n此操作不可恢复（可先用「导出书签备份」留底）。`);
    if (!ok) return;
  }

  setStatus('正在删除书签…');
  try {
    const res = await sendRuntimeMessage({
      type: 'DELETE_BROWSER_BOOKMARK',
      url,
    }) as RuntimeResponse<{ removed?: number }>;
    if (!res?.ok) throw new Error(res?.error ?? '删除失败');
    const removed = res.removed ?? 0;
    setStatus(removed ? `✓ 已从浏览器书签中删除` : '该网址不在浏览器书签中');
    void refreshDashboard();
  } catch (error) {
    setStatus(`删除失败：${errorMessage(error)}`);
  }
}

/**
 * 往指定分组添加书签。
 * 分组名当作浏览器书签的文件夹路径，这样新书签会自然归到那个分组里
 * （工作台的分类来自书签文件夹 + 关键词，写进文件夹是最稳的归属方式）。
 */
async function addBookmarkToGroup(url: string, title: string, folder: string) {
  if (!url.trim()) {
    setStatus('请先填写网址');
    return;
  }
  setStatus(`正在添加到「${folder}」…`);
  try {
    const res = await sendRuntimeMessage({
      type: 'ADD_BROWSER_BOOKMARK',
      bookmark: { url: url.trim(), title: title.trim(), folder: `书签栏/${folder}` },
    }) as RuntimeResponse<{ id?: string; folder?: string }>;
    if (!res?.ok) throw new Error(res?.error ?? '添加失败');
    // 回报真实落点，否则用户不知道书签被放进了哪个文件夹（「加完找不到」的由来）
    setStatus(`✓ 已添加到「${res.folder || folder}」`);
    await refreshDashboard();
  } catch (error) {
    setStatus(`添加失败：${errorMessage(error)}`);
  }
}

/**
 * 批量删除书签。走后台逐条删除并同步本地索引，最后刷新一次。
 * 二次确认可关闭（设置 → 观感 → 删除前确认）。
 */
async function bulkDeleteBookmarks(targets: { url: string; title: string }[]) {
  if (!targets.length) return;

  if (prefs.confirmBeforeDelete) {
    const preview = targets.slice(0, 5).map((t) => `· ${t.title}`).join('\n');
    const more = targets.length > 5 ? `\n…以及另外 ${targets.length - 5} 条` : '';
    const ok = window.confirm(
      `确定删除选中的 ${targets.length} 条书签吗？\n\n${preview}${more}\n\n此操作不可恢复（可先导出备份）。`,
    );
    if (!ok) return;
  }

  setStatus(`正在删除 ${targets.length} 条…`);
  let removed = 0;
  let failed = 0;
  for (const target of targets) {
    try {
      const res = await sendRuntimeMessage({
        type: 'DELETE_BROWSER_BOOKMARK',
        url: target.url,
      }) as RuntimeResponse<{ removed?: number }>;
      if (res?.ok) removed += res.removed ?? 0;
      else failed += 1;
    } catch {
      failed += 1;
    }
  }

  clearSelection();
  setStatus(failed
    ? `✓ 已删除 ${removed} 条，${failed} 条失败`
    : `✓ 已删除 ${removed} 条书签`);
  await refreshDashboard();
}

/** 在工作台新增一条浏览器书签 */
async function addBookmark(url: string, title: string, folder: string) {
  if (!url.trim()) {
    setStatus('请先填写网址');
    return false;
  }
  setStatus('正在添加书签…');
  try {
    const res = await sendRuntimeMessage({
      type: 'ADD_BROWSER_BOOKMARK',
      bookmark: { url: url.trim(), title: title.trim(), folder: folder.trim() },
    }) as RuntimeResponse<{ id?: string; folder?: string }>;
    if (!res?.ok) throw new Error(res?.error ?? '添加失败');
    const where = res.folder || folder.trim() || '书签栏';
    setStatus(`✓ 已添加到「${where}」，工作台已同步`);
    await refreshDashboard();
    return true;
  } catch (error) {
    setStatus(`添加失败：${errorMessage(error)}`);
    return false;
  }
}

/* --------------------------------------------------- 备份 / 恢复书签 */

let pendingRestoreBackup: unknown = null;

/** 导出全部书签为 JSON 文件 */
async function exportBookmarks() {
  exportBookmarksEl.disabled = true;
  setStatus('正在导出书签…');
  try {
    const res = await sendRuntimeMessage({ type: 'EXPORT_BOOKMARKS' }) as RuntimeResponse<{
      entries?: unknown[]; total?: number; exportedAt?: string;
    }>;
    if (!res?.ok || !res.entries) throw new Error(res?.error ?? '导出失败');

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const blob = new Blob([JSON.stringify(res.entries, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cc-archive-bookmarks-${stamp}.json`;
    a.click();
    // 稍后释放，确保下载已开始
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    setStatus(`✓ 已导出 ${res.total ?? res.entries.length} 条书签`);
  } catch (error) {
    setStatus(`导出失败：${errorMessage(error)}`);
  } finally {
    exportBookmarksEl.disabled = false;
  }
}

/** 选择备份文件后预览（只读） */
async function previewRestore() {
  const file = restoreFileEl.files?.[0];
  if (!file) return;

  pickRestoreFileEl.disabled = true;
  setStatus('正在对比备份与当前书签…');
  try {
    const text = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('文件不是合法的 JSON');
    }

    const res = await sendRuntimeMessage({
      type: 'PLAN_BOOKMARK_RESTORE',
      backup: parsed,
    }) as RuntimeResponse<{ plan?: RestorePlan }>;
    if (!res?.ok || !res.plan) throw new Error(res?.error ?? '解析失败');

    const plan = res.plan;
    pendingRestoreBackup = parsed;

    const byFolder = new Map<string, number>();
    for (const item of plan.missing) {
      const key = item.folder || '（根目录）';
      byFolder.set(key, (byFolder.get(key) ?? 0) + 1);
    }

    restorePreviewEl.hidden = false;
    restorePreviewEl.innerHTML = `
      <div class="cleanup-summary">
        备份 <b>${plan.summary.backupTotal}</b> 条：可恢复 <b>${plan.summary.missing}</b> 条，
        已存在跳过 <b>${plan.summary.existing}</b> 条${plan.summary.invalid ? `，无效 ${plan.summary.invalid} 条` : ''}
      </div>
      <div class="cleanup-reasons">
        ${[...byFolder.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
          .map(([folder, count]) => `<span class="row"><span>${escapeHtml(folder)}</span><span>${count}</span></span>`).join('')}
      </div>
      <div class="cleanup-list">
        ${plan.missing.slice(0, 15).map((d) => `<span class="item keep">↩ 恢复 · ${escapeHtml(d.title || d.url)}</span>`).join('')}
        ${plan.missing.length > 15 ? `<span class="item">…还有 ${plan.missing.length - 15} 条</span>` : ''}
      </div>`;

    applyRestoreEl.hidden = plan.missing.length === 0;
    applyRestoreEl.textContent = `确认恢复这 ${plan.missing.length} 条书签`;
    setStatus(plan.missing.length ? `可恢复 ${plan.missing.length} 条` : '没有需要恢复的书签');
  } catch (error) {
    setStatus(`预览失败：${errorMessage(error)}`);
    restorePreviewEl.hidden = true;
    applyRestoreEl.hidden = true;
  } finally {
    pickRestoreFileEl.disabled = false;
  }
}

/** 执行恢复 */
async function applyRestore() {
  if (!pendingRestoreBackup) return;
  applyRestoreEl.disabled = true;
  setStatus('正在恢复书签…');
  try {
    const res = await sendRuntimeMessage({
      type: 'APPLY_BOOKMARK_RESTORE',
      backup: pendingRestoreBackup,
    }) as RuntimeResponse<{ created?: number; failed?: number; folders?: number }>;
    if (!res?.ok) throw new Error(res?.error ?? '恢复失败');

    const created = res.created ?? 0;
    const failed = res.failed ?? 0;
    pendingRestoreBackup = null;
    restoreFileEl.value = '';
    applyRestoreEl.hidden = true;
    restorePreviewEl.hidden = true;
    setStatus(failed
      ? `已恢复 ${created} 条，${failed} 条失败`
      : `✓ 已恢复 ${created} 条书签，新建 ${res.folders ?? 0} 个文件夹`);
    void refreshDashboard();
  } catch (error) {
    setStatus(`恢复失败：${errorMessage(error)}`);
  } finally {
    applyRestoreEl.disabled = false;
  }
}

/** 扫描并预览：只读，不删任何东西 */
async function scanBookmarks() {
  scanBookmarksEl.disabled = true;
  setStatus('正在扫描浏览器书签…');
  try {
    const res = await sendRuntimeMessage({ type: 'PLAN_BOOKMARK_CLEANUP' }) as RuntimeResponse<{ plan?: CleanupPlan }>;
    if (!res?.ok || !res.plan) throw new Error(res?.error ?? '扫描失败');

    const { plan } = res;
    pendingCleanupIds = plan.remove.map((d) => d.id);

    // 按原因汇总
    const reasonCount = new Map<string, number>();
    for (const d of plan.remove) reasonCount.set(d.reason, (reasonCount.get(d.reason) ?? 0) + 1);
    const reasons = [...reasonCount.entries()].sort((a, b) => b[1] - a[1]);

    cleanupPreviewEl.hidden = false;
    cleanupPreviewEl.innerHTML = `
      <div class="cleanup-summary">
        共 <b>${plan.summary.total}</b> 条书签：保留 <b>${plan.summary.kept}</b> 条，
        将删除 <b>${plan.summary.removed}</b> 条（${plan.summary.removedPercent}%）
      </div>
      <div class="cleanup-reasons">
        ${reasons.map(([reason, count]) => `<span class="row"><span>${escapeHtml(reason)}</span><span>${count}</span></span>`).join('')}
      </div>
      <div class="cleanup-list">
        ${plan.keep.slice(0, 12).map((d) => `<span class="item keep">✓ 保留 · ${escapeHtml(d.title || d.url)}</span>`).join('')}
        ${plan.remove.slice(0, 20).map((d) => `<span class="item">✗ 删除 · ${escapeHtml(d.title || d.url)}</span>`).join('')}
        ${plan.remove.length > 20 ? `<span class="item">…还有 ${plan.remove.length - 20} 条待删除</span>` : ''}
      </div>`;

    applyCleanupEl.hidden = plan.remove.length === 0;
    applyCleanupEl.textContent = `确认删除这 ${plan.remove.length} 条书签`;
    setStatus(plan.remove.length ? `扫描完成：可删除 ${plan.remove.length} 条` : '扫描完成：没有需要删除的书签');
  } catch (error) {
    setStatus(`扫描失败：${errorMessage(error)}`);
  } finally {
    scanBookmarksEl.disabled = false;
  }
}

/** 执行删除（不可恢复，需二次确认） */
async function applyCleanup() {
  if (!pendingCleanupIds.length) return;
  const count = pendingCleanupIds.length;
  if (!window.confirm(`确定删除 ${count} 条浏览器书签吗？此操作不可恢复。\n\n建议先在扩展设置里确认已了解风险。`)) {
    return;
  }

  applyCleanupEl.disabled = true;
  setStatus(`正在删除 ${count} 条书签…`);
  try {
    const res = await sendRuntimeMessage({
      type: 'APPLY_BOOKMARK_CLEANUP',
      ids: pendingCleanupIds,
    }) as RuntimeResponse<{ removed?: number; failed?: number }>;
    if (!res?.ok) throw new Error(res?.error ?? '删除失败');

    const removed = res.removed ?? 0;
    const failed = res.failed ?? 0;
    pendingCleanupIds = [];
    applyCleanupEl.hidden = true;
    cleanupPreviewEl.hidden = true;
    setStatus(failed ? `已删除 ${removed} 条，${failed} 条失败` : `✓ 已删除 ${removed} 条书签`);
    void refreshDashboard();
  } catch (error) {
    setStatus(`删除失败：${errorMessage(error)}`);
  } finally {
    applyCleanupEl.disabled = false;
  }
}

async function captureRecentPage() {
  if (clippingRecentPage) return;

  clippingRecentPage = true;
  clipCurrentEl.disabled = true;
  setStatus('正在剪藏最近浏览的网页...');

  try {
    const target = await sendRuntimeMessage({
      type: 'GET_LAST_ACTIVE_ORIGIN',
    }) as RuntimeResponse<{ origin?: string }>;

    if (!target?.ok || !target.origin) {
      throw new Error(target?.error ?? '没有找到可剪藏的最近网页');
    }

    const granted = await requestOriginAccess([target.origin]);
    if (!granted) {
      setStatus('已跳过：可在目标网页用扩展图标「剪藏本页」。');
      return;
    }

    const res = await sendRuntimeMessage({
      type: 'CAPTURE_LAST_ACTIVE',
      why: '',
    }) as RuntimeResponse<{ queued?: boolean; path?: string }>;

    if (!res?.ok) {
      throw new Error(res?.error ?? '剪藏失败');
    }

    await refreshDashboard();
    setStatus(res.queued ? 'Obsidian 不可用，已暂存，恢复后自动写入' : '已剪藏最近浏览的网页');
  } catch (error) {
    setStatus(`剪藏失败：${errorMessage(error)}`);
  } finally {
    clippingRecentPage = false;
    clipCurrentEl.disabled = false;
  }
}

async function importBookmarks() {
  if (importingBookmarks) return;

  importingBookmarks = true;
  for (const button of getImportActionButtons()) {
    button.disabled = true;
  }

  setStatus('正在导入浏览器书签...');
  try {
    const res = await sendRuntimeMessage({ type: 'IMPORT_BROWSER_BOOKMARKS' }) as RuntimeResponse<{
      imported?: number;
      total?: number;
    }>;

    if (!res?.ok) {
      throw new Error(res?.error ?? '导入浏览器书签失败');
    }

    await refreshDashboard();
    setStatus(`已导入 ${res.imported ?? 0} / ${res.total ?? 0} 个浏览器书签`);
  } catch (error) {
    setStatus(`导入失败：${errorMessage(error)}`);
  } finally {
    importingBookmarks = false;
    for (const button of getImportActionButtons()) {
      button.disabled = false;
    }
  }
}

function getImportActionButtons(): HTMLButtonElement[] {
  return [
    ...importButtons,
    ...cardsEl.querySelectorAll<HTMLButtonElement>('.empty-import-action'),
  ];
}

async function sendRuntimeMessage(message: Record<string, unknown>): Promise<unknown> {
  if (hasExtensionRuntime()) {
    return globalThis.chrome.runtime.sendMessage(message);
  }
  return previewRuntimeMessage(message);
}

async function openTab(url: string) {
  if (hasExtensionRuntime() && globalThis.chrome.tabs?.create) {
    await globalThis.chrome.tabs.create({ url });
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function openOptionsPage() {
  if (hasExtensionRuntime() && globalThis.chrome.runtime.openOptionsPage) {
    globalThis.chrome.runtime.openOptionsPage();
    return;
  }
  setStatus('本地预览模式下无法打开扩展设置');
}

function hasExtensionRuntime(): boolean {
  return typeof globalThis.chrome !== 'undefined' && Boolean(globalThis.chrome.runtime?.sendMessage);
}

async function previewRuntimeMessage(message: Record<string, unknown>): Promise<RuntimeResponse<Record<string, unknown>>> {
  const type = String(message.type ?? '');
  if (type === 'LOAD_NEW_TAB_PREFS') {
    return { ok: true, prefs: loadPreviewPrefs() };
  }
  if (type === 'SAVE_NEW_TAB_PREFS') {
    const update = isRecord(message.update) ? message.update : {};
    const prefs = normalizePrefs({ ...loadPreviewPrefs(), ...update });
    localStorage.setItem(PREVIEW_PREFS_KEY, JSON.stringify(prefs));
    return { ok: true, prefs };
  }
  if (type === 'GET_DASHBOARD_DATA') {
    return {
      ok: true,
      data: buildPreviewDashboardData(String(message.query ?? ''), String(message.folder ?? '')),
    };
  }
  if (type === 'UPDATE_SAVED_CLIP') {
    return { ok: true };
  }
  if (type === 'DELETE_SAVED_CLIP') {
    const target = isRecord(message.target) ? message.target : {};
    const targetUrl = String(target.url ?? '');
    const index = PREVIEW_CARDS.findIndex((card) => card.url === targetUrl || card.canonicalUrl === targetUrl);
    if (index < 0) return { ok: false, deleted: false, error: '未找到要删除的收藏' };
    PREVIEW_CARDS.splice(index, 1);
    return { ok: true, deleted: true };
  }
  if (type === 'CAPTURE_LAST_ACTIVE') {
    return { ok: true, queued: false, path: 'preview/current-page.md' };
  }
  if (type === 'GET_LAST_ACTIVE_ORIGIN') {
    return { ok: true, origin: 'https://example.com/*' };
  }
  if (type === 'IMPORT_BROWSER_BOOKMARKS') {
    return { ok: true, imported: PREVIEW_CARDS.length, total: PREVIEW_CARDS.length };
  }
  return { ok: false, error: `预览模式未实现消息：${type}` };
}

function loadPreviewPrefs(): Prefs {
  try {
    return normalizePrefs(JSON.parse(localStorage.getItem(PREVIEW_PREFS_KEY) || '{}'));
  } catch {
    return DEFAULT_PREFS;
  }
}

function buildPreviewDashboardData(query: string, folder: string): DashboardData {
  const normalized = query.trim().toLowerCase();
  const cards = PREVIEW_CARDS
    .filter((card) => !folder || card.folder?.startsWith(folder))
    .filter((card) => {
      if (!normalized) return true;
      return [
        card.title,
        card.domain,
        card.folder ?? '',
        card.summary,
        ...card.tags,
        ...card.keywords,
      ].join(' ').toLowerCase().includes(normalized);
    });
  const folders = previewFolders(PREVIEW_CARDS);
  const clips = PREVIEW_CARDS.filter((card) => card.source === 'clip');
  const bookmarks = PREVIEW_CARDS.filter((card) => card.source === 'bookmark');
  return {
    stats: {
      total: PREVIEW_CARDS.length,
      clips: clips.length,
      bookmarks: bookmarks.length,
      queued: 0,
      unvisited: 7,
      visited: PREVIEW_CARDS.length - 7,
    },
    folders,
    cards,
    recent: clips.slice(0, 5),
    revisit: PREVIEW_CARDS[2],
  };
}

function previewFolders(cards: DashboardCard[]): BookmarkFolderOption[] {
  const counts = new Map<string, number>();
  for (const card of cards) {
    const parts = (card.folder || '书签栏').split(' / ').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) {
      const path = parts.slice(0, i).join(' / ');
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return [...counts.entries()].map(([path, count]) => ({ path, count }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function previewCard(
  url: string,
  title: string,
  domain: string,
  folder: string,
  source: 'clip' | 'bookmark',
  tags: string[],
  summary: string,
): DashboardCard {
  return {
    url,
    canonicalUrl: url,
    title,
    domain,
    path: `preview/${domain}.md`,
    source,
    sourceLabel: source === 'bookmark' ? '书签' : '剪藏',
    folder,
    faviconUrl: `${new URL(url).origin}/favicon.ico`,
    summary,
    tags,
    keywords: tags,
    aliases: [],
    intent: '',
    why: summary,
    clipped: '2026-07-04T00:00:00.000Z',
    queued: false,
    revived: 0,
    lastVisited: '',
    initial: (title || domain).slice(0, 1).toUpperCase(),
  };
}

function cardHtml(card: DashboardCard): string {
  // 标签最多展示 3 个，其余折叠为 +N，避免卡片被撑爆
  const tags = card.tags.filter(Boolean);
  const shownTags = tags.slice(0, 3);
  const extra = tags.length - shownTags.length;
  const tagsHtml = shownTags.length
    ? `<div class="card-tags">${shownTags.map((tag) => `<span class="card-tag">${escapeHtml(tag)}</span>`).join('')}${extra > 0 ? `<span class="card-tag more">+${extra}</span>` : ''}</div>`
    : '';
  const summaryHtml = card.summary
    ? `<div class="card-summary">${escapeHtml(card.summary)}</div>`
    : '';
  const badgeClass = card.source === 'bookmark' ? 'bookmark' : 'clip';

  return `
    <article class="bookmark-card" data-url="${escapeAttr(card.url)}" title="${escapeAttr(card.title || card.url)}">
      <div class="icon-wrap">${faviconHtml(card)}</div>
      <div class="card-copy">
        <div class="card-title">${escapeHtml(card.title || card.url)}</div>
        <div class="card-meta">${escapeHtml(card.domain)}</div>
        ${summaryHtml}
        ${tagsHtml}
      </div>
      <span class="card-badge ${badgeClass}">${escapeHtml(card.sourceLabel || (card.source === 'bookmark' ? '书签' : '剪藏'))}</span>
      <button class="edit-card" type="button" aria-label="编辑 ${escapeAttr(card.title || card.url)}">编辑</button>
    </article>
  `;
}

function placeholderCardHtml(_index: number): string {
  return `<article class="bookmark-card placeholder-card" aria-hidden="true"><div class="icon-wrap"></div><div class="card-copy"><div class="card-title">&nbsp;</div><div class="card-meta">&nbsp;</div></div></article>`;
}

function detailItemHtml(card: DashboardCard): string {
  const meta = card.folder ? `${card.domain} · ${card.folder}` : card.domain;
  return `
    <article class="detail-item" data-url="${escapeAttr(card.url)}" title="${escapeAttr(card.title || card.url)}">
      <button class="detail-main" type="button">
        ${faviconHtml(card, 'small-favicon')}
        <span>
          <strong>${escapeHtml(card.title || card.url)}</strong>
          <small>${escapeHtml(meta)}</small>
        </span>
      </button>
      <button class="detail-menu-button" type="button" aria-label="书签操作">⋯</button>
      <div class="detail-menu" role="menu" hidden>
        <button class="detail-menu-edit" type="button" role="menuitem">编辑</button>
        <button class="detail-menu-delete" type="button" role="menuitem">删除</button>
      </div>
    </article>
  `;
}

function compactCardHtml(card: DashboardCard, className: string): string {
  const meta = card.folder ? `${card.domain} · ${folderName(card.folder)}` : card.domain;
  return `
    <button class="dock-action ${escapeAttr(className)}" type="button" data-url="${escapeAttr(card.url)}" title="${escapeAttr(card.title || card.url)}">
      ${faviconHtml(card, 'small-favicon')}
      <span>
        <strong>${escapeHtml(card.title || card.url)}</strong>
        <small>${escapeHtml(meta)}</small>
      </span>
    </button>
  `;
}

// 用浏览器已缓存的站点图标（chrome _favicon 服务），比猜测 /favicon.ico 更可靠、不会挂起
function faviconServiceUrl(pageUrl: string, size = 64): string {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', String(size));
  return url.toString();
}

// faviconUrl 是否只是 origin/favicon.ico 的猜测值（并非真实捕获/自定义的图标）
function isGuessedFavicon(card: DashboardCard): boolean {
  if (!card.faviconUrl) return false;
  try {
    return card.faviconUrl === `${new URL(card.url).origin}/favicon.ico`;
  } catch {
    return false;
  }
}

// 图标显示源：优先真实捕获/自定义图标，其次浏览器缓存图标，最后由调用方回退首字母
function faviconSource(card: DashboardCard): { src: string; isService: boolean } {
  if (card.faviconUrl && !isGuessedFavicon(card)) return { src: card.faviconUrl, isService: false };
  if (/^https?:/i.test(card.url)) return { src: faviconServiceUrl(card.url), isService: true };
  return { src: '', isService: false };
}

function faviconHtml(card: DashboardCard, extraClass = ''): string {
  const initial = (card.initial || card.domain || '?').slice(0, 1).toUpperCase();
  const className = extraClass ? `favicon ${extraClass}` : 'favicon';
  const colorStyle = domainColorStyle(card.domain || card.url);
  const { src, isService } = faviconSource(card);
  if (!src) {
    return `<span class="favicon-fallback${extraClass ? ` ${escapeAttr(extraClass)}` : ''}" style="${escapeAttr(colorStyle)}">${escapeHtml(initial)}</span>`;
  }
  return `<img class="${escapeAttr(className)}" src="${escapeAttr(src)}" alt="" data-page-url="${escapeAttr(card.url)}" data-service="${isService ? 'true' : ''}" data-initial="${escapeAttr(initial)}" data-fallback-style="${escapeAttr(colorStyle)}" />`;
}

function domainColorStyle(seed: string): string {
  let hash = 0;
  for (const char of seed) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  const hue = hash % 360;
  return `--fallback-hue: ${hue}; --fallback-bg: hsl(${hue} 54% 44%); --fallback-bg-soft: hsl(${hue} 62% 58%)`;
}

function categoryButton(label: string, folder: string, count: number, extraClass = ''): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `category-button${folder === currentFolder ? ' active' : ''}${extraClass ? ` ${extraClass}` : ''}`;
  btn.innerHTML = `<span>${escapeHtml(label)}</span>${count ? `<b>${count}</b>` : '<b></b>'}`;
  btn.addEventListener('click', () => {
    currentFolder = folder;
    currentPage = 0;
    refreshDashboard();
  });
  return btn;
}

function childFolders(folders: BookmarkFolderOption[], parent: string): BookmarkFolderOption[] {
  const prefix = parent ? `${parent} / ` : '';
  const depth = parent ? parent.split(' / ').length + 1 : 1;
  return folders
    .filter((folder) => folder.path.startsWith(prefix) && folder.path.split(' / ').length === depth)
    .sort((a, b) => b.count - a.count || a.path.localeCompare(b.path, 'zh-CN'));
}

function parentFolder(path: string): string {
  const parts = path.split(' / ').filter(Boolean);
  return parts.slice(0, -1).join(' / ');
}

function folderName(path: string): string {
  const parts = path.split(' / ').filter(Boolean);
  return parts.at(-1) ?? path;
}

function normalizeEngines(value: unknown): SearchEngineConfig[] {
  if (!Array.isArray(value)) return DEFAULT_SEARCH_ENGINES.map((engine) => ({ ...engine }));
  const engines = value
    .filter((raw): raw is SearchEngineConfig =>
      !!raw && typeof raw === 'object'
      && typeof (raw as SearchEngineConfig).id === 'string'
      && typeof (raw as SearchEngineConfig).name === 'string'
      && typeof (raw as SearchEngineConfig).url === 'string')
    .map((raw) => {
      const engine: SearchEngineConfig = { id: raw.id, name: raw.name, url: raw.url };
      const icon = typeof raw.icon === 'string' && raw.icon
        ? raw.icon
        : DEFAULT_SEARCH_ENGINES.find((preset) => preset.id === engine.id)?.icon;
      if (icon) engine.icon = icon;
      return engine;
    });
  return engines.length ? engines : DEFAULT_SEARCH_ENGINES.map((engine) => ({ ...engine }));
}

function normalizePrefs(value: Partial<Prefs>): Prefs {
  // 以默认值为基线，避免新增偏好字段时这里漏字段（本地预览模式专用）
  const bool = <K extends keyof Prefs>(key: K): Prefs[K] =>
    (typeof value[key] === 'boolean' ? value[key] : DEFAULT_PREFS[key]);

  const normalized: Prefs = {
    ...DEFAULT_PREFS,
    density: value.density === 'compact' || value.density === 'large' ? value.density : DEFAULT_PREFS.density,
    theme: value.theme === 'light' ? 'light' : DEFAULT_PREFS.theme,
    backgroundImageUrl: typeof value.backgroundImageUrl === 'string'
      ? value.backgroundImageUrl.trim()
      : DEFAULT_PREFS.backgroundImageUrl,
    ...normalizeBackground(value, DEFAULT_PREFS.backgroundKind),
    wallpaperMask: clampInt(value.wallpaperMask, DEFAULT_PREFS.wallpaperMask, 0, 100),
    wallpaperBlur: clampInt(value.wallpaperBlur, DEFAULT_PREFS.wallpaperBlur, 0, 100),
    gridColumns: clampInt(value.gridColumns, DEFAULT_PREFS.gridColumns, 2, 12),
    gridRows: clampInt(value.gridRows, DEFAULT_PREFS.gridRows, 1, 8),
    cardRadius: clampInt(value.cardRadius, DEFAULT_PREFS.cardRadius, 0, 50),
    iconSize: clampInt(value.iconSize, DEFAULT_PREFS.iconSize, 50, 150),
    columnGap: clampInt(value.columnGap, DEFAULT_PREFS.columnGap, 0, 120),
    rowGap: clampInt(value.rowGap, DEFAULT_PREFS.rowGap, 0, 120),
    cardDensity: value.cardDensity === 'compact' ? 'compact' : 'comfortable',
    cardSort: (['recent', 'title', 'domain', 'frequent', 'manual'] as const).includes(value.cardSort as CardSortKey)
      ? value.cardSort as CardSortKey
      : DEFAULT_PREFS.cardSort,
    showLabels: bool('showLabels'),
    showTags: bool('showTags'),
    showSummary: bool('showSummary'),
    rightPanelCollapsed: bool('rightPanelCollapsed'),
    backgroundVideoEnabled: bool('backgroundVideoEnabled'),
    galleryMode: bool('galleryMode'),
    iconGlow: bool('iconGlow'),
    glowEnabled: bool('glowEnabled'),
    cuteCursor: bool('cuteCursor'),
    tiltEnabled: bool('tiltEnabled'),
    tiltMaxDeg: clampInt(value.tiltMaxDeg, DEFAULT_PREFS.tiltMaxDeg, 0, 30),
    tiltScale: clampScale(value.tiltScale, DEFAULT_PREFS.tiltScale, 1, 1.2),
    tiltShadow: clampInt(value.tiltShadow, DEFAULT_PREFS.tiltShadow, 0, 60),
    tiltLift: clampInt(value.tiltLift, DEFAULT_PREFS.tiltLift, 0, 80),
    tiltTextLift: clampInt(value.tiltTextLift, DEFAULT_PREFS.tiltTextLift, 0, 120),
    tiltPerspective: clampInt(value.tiltPerspective, DEFAULT_PREFS.tiltPerspective, 300, 3000),
    tiltOnRows: bool('tiltOnRows'),
    confirmBeforeDelete: bool('confirmBeforeDelete'),
    showToast: bool('showToast'),
    panelLayout: (value.panelLayout ?? null) as PanelLayout | null,
    groupNames: (value.groupNames && typeof value.groupNames === 'object' && !Array.isArray(value.groupNames))
      ? value.groupNames as Record<string, string>
      : {},
    newTabTakeover: bool('newTabTakeover'),
    githubProjectsEnabled: bool('githubProjectsEnabled'),
    widgetsEnabled: bool('widgetsEnabled'),
    searchBoxVisible: bool('searchBoxVisible'),
    newTabRedirectUrl: typeof value.newTabRedirectUrl === 'string'
      ? value.newTabRedirectUrl.trim()
      : DEFAULT_PREFS.newTabRedirectUrl,
    githubToken: typeof value.githubToken === 'string' ? value.githubToken.trim() : DEFAULT_PREFS.githubToken,
    curateKeepRatio: clampRatio(value.curateKeepRatio, DEFAULT_PREFS.curateKeepRatio),
    curatePerCategory: clampInt(value.curatePerCategory, DEFAULT_PREFS.curatePerCategory, 3, 40),
    curateEnabled: bool('curateEnabled'),
    showFrequentPanel: bool('showFrequentPanel'),
    showTagPanel: bool('showTagPanel'),
    searchBoxWidth: clampInt(value.searchBoxWidth, DEFAULT_PREFS.searchBoxWidth, 50, 100),
    searchBoxRadius: clampInt(value.searchBoxRadius, DEFAULT_PREFS.searchBoxRadius, 0, 50),
    fontFamily: toDisplayFont(value.fontFamily),
    fontShadow: bool('fontShadow'),
    fontSize: clampInt(value.fontSize, DEFAULT_PREFS.fontSize, 10, 18),
    searchEngines: normalizeEngines(value.searchEngines),
    searchEngineId: typeof value.searchEngineId === 'string' && value.searchEngineId
      ? value.searchEngineId
      : DEFAULT_PREFS.searchEngineId,
  };
  return normalized;
}

function clampScale(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(max, Math.max(min, n)) * 100) / 100;
}

function clampRatio(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0.01, n));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  if (Number.isNaN(n) || !Number.isFinite(n)) return fallback;
  const rounded = Math.round(n);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function cardsPerPage(): number {
  return prefs.gridColumns * prefs.gridRows;
}

function statusText(data: DashboardData, query: string, folder: string): string {
  const parts = [
    `${data.stats.total} 条收藏`,
    `${data.stats.clips} 条剪藏`,
    `${data.stats.bookmarks} 个书签`,
  ];
  const trimmedQuery = query.trim();
  if (trimmedQuery) parts.push(`本地筛选：${trimmedQuery}`);
  if (folder) parts.push(`分类：${folderName(folder)}`);
  return parts.join(' · ');
}

/**
 * 浮动提示。比顶部那行小字显眼得多，解决「操作了但没反馈」的问题。
 */
function toast(text: string, kind: 'ok' | 'err' | 'info' = 'info') {
  if (!prefs.showToast) return;
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = text;
  toastHostEl.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  window.setTimeout(() => {
    el.classList.remove('show');
    window.setTimeout(() => el.remove(), 220);
  }, 2600);
}

/**
 * 状态提示。除了顶部那行小字，重要结果同时弹 toast —— 否则用户容易以为「没反应」。
 * 只对「操作结果」类文案弹，加载中的进度文案不弹，避免刷屏。
 */
function setStatus(message: string) {
  statusEl.textContent = message;
  if (!prefs.showToast) return;
  const text = message.trim();
  if (!text) return;
  // 过滤掉纯进度类文案
  if (/^正在|^加载中|^\.\.\./.test(text)) return;
  if (text.startsWith('✓')) toast(text.replace(/^✓\s*/, ''), 'ok');
  else if (/^(✗|删除失败|添加失败|导出失败|恢复失败|扫描失败|预览失败|复制失败)/.test(text)) {
    toast(text.replace(/^✗\s*/, ''), 'err');
  }
  // 其余（如「已跳过」）只在顶部显示，不打扰
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAIConfigError(error: unknown): boolean {
  const message = errorMessage(error);
  return message.includes('未配置 AI API 端点')
    || message.includes('未配置 AI API Key')
    || message.includes('未配置 AI 模型');
}

function cssUrl(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

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

export {};
