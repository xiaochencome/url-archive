/**
 * 新标签页接管控制。
 *
 * manifest 的 `chrome_url_overrides.newtab` 是静态的，浏览器没有提供关闭它的 API，
 * 因此「关闭接管」只能靠 `chrome.tabs.onCreated` 把新建标签页重定向到用户指定的主页。
 * 本模块只放纯逻辑，便于单测；真正的监听在 background 中注册。
 */

export const NEW_TAB_PAGE = 'newtab.html';

/** 未配置主页时的兜底地址 */
export const FALLBACK_NEW_TAB_URL = 'https://www.google.com/';

/** 重定向目标只接受 http/https，避免把标签页导向危险协议 */
export function isSafeRedirectUrl(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 判断这个标签页是否落在「我们自己的新标签页」上。
 * 覆盖两种形态：扩展覆盖页（chrome-extension://<id>/newtab.html）
 * 以及浏览器原生新标签页（chrome://newtab），后者在覆盖生效时会被换成前者。
 */
export function isExtensionNewTab(url: string | undefined, extensionOrigin: string): boolean {
  if (!url) return false;
  if (url.startsWith('chrome://newtab')) return true;
  if (!extensionOrigin) return false;
  const normalizedOrigin = extensionOrigin.replace(/\/$/, '');
  return url === `${normalizedOrigin}/${NEW_TAB_PAGE}` || url.startsWith(`${normalizedOrigin}/${NEW_TAB_PAGE}?`);
}

/**
 * 从搜索引擎配置推导一个可用的主页地址：
 * `https://www.google.com/search?q=%s` -> `https://www.google.com/`。
 * 取不到时回退到 FALLBACK_NEW_TAB_URL。
 */
export function homepageFromEngine(engineUrl: string | undefined): string {
  if (!engineUrl) return FALLBACK_NEW_TAB_URL;
  try {
    const parsed = new URL(engineUrl);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return FALLBACK_NEW_TAB_URL;
    return `${parsed.origin}/`;
  } catch {
    return FALLBACK_NEW_TAB_URL;
  }
}

export interface NewTabControlPrefs {
  newTabTakeover: boolean;
  newTabRedirectUrl: string;
  searchEngines: { id: string; url: string }[];
  searchEngineId: string;
}

/** 解析关闭接管后的跳转目标；返回空串表示无需重定向 */
export function resolveNewTabRedirect(prefs: NewTabControlPrefs): string {
  const custom = prefs.newTabRedirectUrl?.trim() ?? '';
  if (custom) return isSafeRedirectUrl(custom) ? custom : FALLBACK_NEW_TAB_URL;
  const current = prefs.searchEngines?.find((engine) => engine.id === prefs.searchEngineId)
    ?? prefs.searchEngines?.[0];
  return homepageFromEngine(current?.url);
}

/** 该标签页此刻是否应该被重定向 */
export function shouldRedirectNewTab(
  tab: { url?: string; pendingUrl?: string },
  extensionOrigin: string,
  prefs: NewTabControlPrefs,
): boolean {
  if (prefs.newTabTakeover) return false;
  const url = tab.pendingUrl || tab.url;
  return isExtensionNewTab(url, extensionOrigin);
}
