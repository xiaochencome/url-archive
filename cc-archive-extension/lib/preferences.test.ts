import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_BACKGROUND_VIDEO,
  DEFAULT_SEARCH_ENGINES,
  loadNewTabPrefs,
  replaceNewTabPrefs,
  saveNewTabPrefs,
  type NewTabPrefs,
} from './preferences';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
      },
    },
  };
});

/** 完整默认偏好：断言可基于它做局部覆盖，新增字段时只需改这一处 */
function fullPrefs(overrides: Partial<NewTabPrefs> = {}): NewTabPrefs {
  return {
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
    ...overrides,
  };
}

describe('new tab preferences', () => {
  test('loads defaults when no preferences are saved', async () => {
    await expect(loadNewTabPrefs()).resolves.toEqual(fullPrefs());
  });

  test('saves valid preferences', async () => {
    const custom = fullPrefs({
      density: 'compact',
      theme: 'light',
      backgroundImageUrl: 'https://example.com/wallpaper.jpg',
      wallpaperMask: 72,
      wallpaperBlur: 35,
      cardRadius: 16,
      iconSize: 120,
      columnGap: 40,
      showLabels: false,
      galleryMode: true,
      searchBoxVisible: false,
      searchBoxWidth: 92,
      searchBoxRadius: 18,
      fontFamily: 'smiley-sans',
      fontShadow: false,
      fontSize: 16,
      cardSort: 'recent',
      cardDensity: 'compact',
      tiltEnabled: false,
    });
    await saveNewTabPrefs(custom);
    await expect(loadNewTabPrefs()).resolves.toEqual(custom);
  });

  test('replaces preferences with a normalized full snapshot', async () => {
    await saveNewTabPrefs({ density: 'compact', theme: 'dark', gridColumns: 8, gridRows: 4 });
    await replaceNewTabPrefs(fullPrefs());
    await expect(loadNewTabPrefs()).resolves.toEqual(fullPrefs());
  });

  test('falls back from invalid stored values', async () => {
    store.new_tab_prefs = {
      density: 'tiny',
      theme: 'neon',
      rightPanelCollapsed: 'yes',
      backgroundImageUrl: 42,
      backgroundVideoUrl: 99,
      backgroundVideoEnabled: 'sure',
      wallpaperMask: 200,
      wallpaperBlur: 'strong',
      gridColumns: 'many',
      gridRows: null,
      cardRadius: -10,
      iconSize: 'big',
      columnGap: -5,
      rowGap: 999,
      showLabels: 'no',
      showTags: 'no',
      showSummary: 'no',
      cardDensity: 'cozy',
      cardSort: 'random',
      galleryMode: 'nope',
      iconGlow: 'nope',
      glowEnabled: 'nope',
      cuteCursor: 'nope',
      tiltEnabled: 'nope',
      newTabTakeover: 'nope',
      newTabRedirectUrl: 123,
      githubProjectsEnabled: 'nope',
      widgetsEnabled: 'nope',
      githubToken: 456,
      searchBoxVisible: 'yes',
      searchBoxWidth: 1000,
      searchBoxRadius: -1,
      fontFamily: 'comic-sans',
      fontShadow: 'no',
      fontSize: 99,
    };
    await expect(loadNewTabPrefs()).resolves.toEqual(fullPrefs());
  });

  test('normalizes galleryMode', async () => {
    store.new_tab_prefs = { galleryMode: true };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({ galleryMode: true });

    store.new_tab_prefs = { galleryMode: false };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({ galleryMode: false });

    // 非布尔值回退到默认（卡片视图默认关闭画廊）
    store.new_tab_prefs = { galleryMode: 'yes' };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({ galleryMode: false });
  });

  test('normalizes the new feature toggles', async () => {
    store.new_tab_prefs = {
      showTags: false,
      showSummary: false,
      glowEnabled: false,
      cuteCursor: false,
      tiltEnabled: false,
      backgroundVideoEnabled: false,
      newTabTakeover: false,
      githubProjectsEnabled: false,
      widgetsEnabled: false,
      cardDensity: 'compact',
      cardSort: 'domain',
      githubToken: '  ghp_abc  ',
      newTabRedirectUrl: '  https://example.com/  ',
    };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({
      showTags: false,
      showSummary: false,
      glowEnabled: false,
      cuteCursor: false,
      tiltEnabled: false,
      backgroundVideoEnabled: false,
      newTabTakeover: false,
      githubProjectsEnabled: false,
      widgetsEnabled: false,
      cardDensity: 'compact',
      cardSort: 'domain',
      githubToken: 'ghp_abc',
      newTabRedirectUrl: 'https://example.com/',
    });
  });

  test('drops a blank backgroundVideoUrl back to the default', async () => {
    store.new_tab_prefs = { backgroundVideoUrl: '   ' };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({
      backgroundVideoUrl: DEFAULT_BACKGROUND_VIDEO,
    });
  });

  test('rewrites the retired built-in wallpaper video to the static wallpaper', async () => {
    // 改名前的构建把内置背景视频存在 /wallpaper/*.mp4，素材已不再随包分发
    store.new_tab_prefs = {
      backgroundVideoUrl: '/wallpaper/legacy-bg.mp4',
      backgroundKind: 'video',
      backgroundVideoEnabled: true,
    };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({
      backgroundVideoUrl: '',
      backgroundKind: 'image',
      backgroundVideoEnabled: true,
    });
  });

  test('keeps a user-supplied background video', async () => {
    store.new_tab_prefs = {
      backgroundVideoUrl: ' https://example.com/bg.mp4 ',
      backgroundKind: 'video',
    };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({
      backgroundVideoUrl: 'https://example.com/bg.mp4',
      backgroundKind: 'video',
    });
  });

  test('cannot stay in video mode without a video source', async () => {
    store.new_tab_prefs = { backgroundVideoUrl: '', backgroundKind: 'video' };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({ backgroundKind: 'image' });
  });

  test('accepts every valid card sort key', async () => {
    for (const sort of ['recent', 'title', 'domain', 'frequent', 'manual'] as const) {
      store.new_tab_prefs = { cardSort: sort };
      await expect(loadNewTabPrefs()).resolves.toMatchObject({ cardSort: sort });
    }
  });

  test('migrates untouched legacy icon-wall defaults to the card layout', async () => {
    store.new_tab_prefs = {
      gridColumns: 6,
      gridRows: 3,
      cardRadius: 24,
      iconSize: 100,
      columnGap: 48,
      rowGap: 50,
      galleryMode: true,
      iconGlow: true,
    };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({
      gridColumns: 4,
      gridRows: 3,
      cardRadius: 18,
      columnGap: 20,
      rowGap: 20,
      galleryMode: false,
      iconGlow: false,
    });
  });

  test('keeps custom layouts untouched during migration', async () => {
    // 用户改过列数/间距：迁移不得覆盖
    store.new_tab_prefs = {
      gridColumns: 8,
      gridRows: 4,
      cardRadius: 30,
      iconSize: 100,
      columnGap: 48,
      rowGap: 50,
      galleryMode: true,
    };
    await expect(loadNewTabPrefs()).resolves.toMatchObject({
      gridColumns: 8,
      gridRows: 4,
      cardRadius: 30,
      columnGap: 48,
      rowGap: 50,
      galleryMode: true,
    });
  });
});
