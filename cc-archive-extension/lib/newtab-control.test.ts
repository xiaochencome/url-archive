import { describe, expect, test } from 'vitest';
import {
  FALLBACK_NEW_TAB_URL,
  NEW_TAB_PAGE,
  homepageFromEngine,
  isExtensionNewTab,
  isSafeRedirectUrl,
  resolveNewTabRedirect,
  shouldRedirectNewTab,
  type NewTabControlPrefs,
} from './newtab-control';

const ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

/** 完整偏好：断言基于它做局部覆盖，新增字段时只需改这一处 */
function fullPrefs(overrides: Partial<NewTabControlPrefs> = {}): NewTabControlPrefs {
  return {
    newTabTakeover: true,
    newTabRedirectUrl: '',
    searchEngines: [
      { id: 'google', url: 'https://www.google.com/search?q=%s' },
      { id: 'bing', url: 'https://www.bing.com/search?q=%s' },
    ],
    searchEngineId: 'google',
    ...overrides,
  };
}

describe('常量', () => {
  test('NEW_TAB_PAGE 是覆盖页文件名', () => {
    expect(NEW_TAB_PAGE).toBe('newtab.html');
  });

  test('FALLBACK_NEW_TAB_URL 是安全的 https 地址', () => {
    expect(FALLBACK_NEW_TAB_URL).toBe('https://www.google.com/');
    expect(isSafeRedirectUrl(FALLBACK_NEW_TAB_URL)).toBe(true);
  });
});

describe('isSafeRedirectUrl', () => {
  test('接受 http 与 https', () => {
    expect(isSafeRedirectUrl('http://example.com')).toBe(true);
    expect(isSafeRedirectUrl('https://example.com')).toBe(true);
    expect(isSafeRedirectUrl('https://example.com/path?q=1#hash')).toBe(true);
  });

  test('协议大小写不敏感', () => {
    expect(isSafeRedirectUrl('HTTPS://EXAMPLE.COM')).toBe(true);
    expect(isSafeRedirectUrl('Http://example.com')).toBe(true);
  });

  test('拒绝 javascript:', () => {
    expect(isSafeRedirectUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeRedirectUrl('JAVASCRIPT:alert(1)')).toBe(false);
  });

  test('拒绝 data:', () => {
    expect(isSafeRedirectUrl('data:text/html,<h1>hi</h1>')).toBe(false);
  });

  test('拒绝 file:', () => {
    expect(isSafeRedirectUrl('file:///etc/passwd')).toBe(false);
  });

  test('拒绝 chrome:// 与 chrome-extension://', () => {
    expect(isSafeRedirectUrl('chrome://newtab')).toBe(false);
    expect(isSafeRedirectUrl('chrome://settings')).toBe(false);
    expect(isSafeRedirectUrl(`${ORIGIN}/newtab.html`)).toBe(false);
  });

  test('拒绝 about:', () => {
    expect(isSafeRedirectUrl('about:blank')).toBe(false);
    expect(isSafeRedirectUrl('about:config')).toBe(false);
  });

  test('拒绝其它非 http(s) 协议', () => {
    expect(isSafeRedirectUrl('ftp://example.com/')).toBe(false);
    expect(isSafeRedirectUrl('mailto:a@b.com')).toBe(false);
  });

  test('拒绝空串、纯空白与乱码', () => {
    expect(isSafeRedirectUrl('')).toBe(false);
    expect(isSafeRedirectUrl('   ')).toBe(false);
    expect(isSafeRedirectUrl('\t\n')).toBe(false);
    expect(isSafeRedirectUrl('not a url')).toBe(false);
    expect(isSafeRedirectUrl('www.google.com')).toBe(false);
    expect(isSafeRedirectUrl('https://')).toBe(false);
  });

  test('解析前先去掉首尾空白', () => {
    expect(isSafeRedirectUrl('  https://example.com  ')).toBe(true);
    expect(isSafeRedirectUrl('\n\thttps://example.com/x\n')).toBe(true);
    // 空白包裹的危险协议仍被拒绝
    expect(isSafeRedirectUrl('  javascript:alert(1)  ')).toBe(false);
  });

  test('https:example.com（缺 //）在 URL 解析后仍被接受', () => {
    // 观察：WHATWG URL 会把 "https:example.com" 规范化为 https://example.com/，
    // 因此这里判定为安全。属于实现的真实行为，非预期外的绕过风险（协议仍是 https）。
    expect(isSafeRedirectUrl('https:example.com')).toBe(true);
  });
});

describe('isExtensionNewTab', () => {
  test('chrome://newtab 与带斜杠的形式都算', () => {
    expect(isExtensionNewTab('chrome://newtab', ORIGIN)).toBe(true);
    expect(isExtensionNewTab('chrome://newtab/', ORIGIN)).toBe(true);
    expect(isExtensionNewTab('chrome://newtab?x=1', ORIGIN)).toBe(true);
  });

  test('chrome://newtab 判定不依赖 extensionOrigin', () => {
    expect(isExtensionNewTab('chrome://newtab', '')).toBe(true);
  });

  test('自身扩展的 newtab.html 算', () => {
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html`, ORIGIN)).toBe(true);
  });

  test('自身扩展的 newtab.html 带查询串也算', () => {
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html?x=1`, ORIGIN)).toBe(true);
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html?`, ORIGIN)).toBe(true);
  });

  test('其它扩展页面不算', () => {
    expect(isExtensionNewTab(`${ORIGIN}/options.html`, ORIGIN)).toBe(false);
    expect(isExtensionNewTab(`${ORIGIN}/popup.html`, ORIGIN)).toBe(false);
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html.bak`, ORIGIN)).toBe(false);
    expect(isExtensionNewTab(`${ORIGIN}/sub/newtab.html`, ORIGIN)).toBe(false);
  });

  test('hash 形式不算（实现只认精确路径或 ? 查询）', () => {
    // 观察：实现用 startsWith(`${origin}/newtab.html?`)，所以 #hash 形式落到 false。
    // 实际跳转不会带 hash，影响可忽略，但这是实现的真实边界。
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html#top`, ORIGIN)).toBe(false);
  });

  test('别的扩展的 newtab.html 不算', () => {
    const other = 'chrome-extension://ponmlkjihgfedcbaponmlkjihgfedcba';
    expect(isExtensionNewTab(`${other}/newtab.html`, ORIGIN)).toBe(false);
    expect(isExtensionNewTab(`${other}/newtab.html?x=1`, ORIGIN)).toBe(false);
  });

  test('undefined / 空串不算', () => {
    expect(isExtensionNewTab(undefined, ORIGIN)).toBe(false);
    expect(isExtensionNewTab('', ORIGIN)).toBe(false);
  });

  test('extensionOrigin 带尾部斜杠会被规范化', () => {
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html`, `${ORIGIN}/`)).toBe(true);
    expect(isExtensionNewTab(`${ORIGIN}/newtab.html?x=1`, `${ORIGIN}/`)).toBe(true);
    expect(isExtensionNewTab(`${ORIGIN}/options.html`, `${ORIGIN}/`)).toBe(false);
  });

  test('普通 https 页面不算', () => {
    expect(isExtensionNewTab('https://example.com/', ORIGIN)).toBe(false);
    expect(isExtensionNewTab('https://example.com/newtab.html', ORIGIN)).toBe(false);
  });

  test('chrome://newtab 前缀匹配偏宽松（记录观察）', () => {
    // 观察：实现只做 startsWith('chrome://newtab')，所以任何以该串开头的地址都算新标签页。
    // 浏览器不存在 chrome://newtabfoo 这类页面，故不构成实际风险，但属于真实行为。
    expect(isExtensionNewTab('chrome://newtabfoo', ORIGIN)).toBe(true);
  });
});

describe('homepageFromEngine', () => {
  test('从带 %s 的搜索地址推导 origin', () => {
    expect(homepageFromEngine('https://www.google.com/search?q=%s')).toBe('https://www.google.com/');
    expect(homepageFromEngine('https://www.bing.com/search?q=%s')).toBe('https://www.bing.com/');
  });

  test('带路径但无查询串也取 origin', () => {
    expect(homepageFromEngine('https://example.com/search')).toBe('https://example.com/');
    expect(homepageFromEngine('https://example.com/a/b/c')).toBe('https://example.com/');
  });

  test('undefined / 空串回退兜底地址', () => {
    expect(homepageFromEngine(undefined)).toBe(FALLBACK_NEW_TAB_URL);
    expect(homepageFromEngine('')).toBe(FALLBACK_NEW_TAB_URL);
  });

  test('畸形地址回退兜底地址', () => {
    expect(homepageFromEngine('not a url')).toBe(FALLBACK_NEW_TAB_URL);
    expect(homepageFromEngine('www.google.com')).toBe(FALLBACK_NEW_TAB_URL);
    expect(homepageFromEngine('https://')).toBe(FALLBACK_NEW_TAB_URL);
  });

  test('非 http(s) 协议回退兜底地址', () => {
    expect(homepageFromEngine('ftp://example.com/x')).toBe(FALLBACK_NEW_TAB_URL);
    expect(homepageFromEngine('chrome://newtab')).toBe(FALLBACK_NEW_TAB_URL);
    expect(homepageFromEngine('javascript:alert(1)')).toBe(FALLBACK_NEW_TAB_URL);
  });

  test('保留非默认端口', () => {
    expect(homepageFromEngine('https://example.com:8443/search?q=%s')).toBe('https://example.com:8443/');
    expect(homepageFromEngine('http://127.0.0.1:8080/search?q=%s')).toBe('http://127.0.0.1:8080/');
  });

  test('默认端口被 URL 规范化去掉', () => {
    expect(homepageFromEngine('https://example.com:443/search?q=%s')).toBe('https://example.com/');
    expect(homepageFromEngine('http://example.com:80/search?q=%s')).toBe('http://example.com/');
  });
});

describe('resolveNewTabRedirect', () => {
  test('自定义地址是安全 http(s) 时直接使用', () => {
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: 'https://example.com/home' })))
      .toBe('https://example.com/home');
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: 'http://localhost:3000/' })))
      .toBe('http://localhost:3000/');
  });

  test('自定义地址首尾空白被裁掉', () => {
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: '  https://example.com/home  ' })))
      .toBe('https://example.com/home');
  });

  test('自定义地址不安全时回退兜底地址（而非引擎主页）', () => {
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: 'javascript:alert(1)' })))
      .toBe(FALLBACK_NEW_TAB_URL);
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: 'chrome://settings' })))
      .toBe(FALLBACK_NEW_TAB_URL);
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: 'not a url' })))
      .toBe(FALLBACK_NEW_TAB_URL);
  });

  test('自定义地址为空时用所选引擎的主页', () => {
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: '' })))
      .toBe('https://www.google.com/');
  });

  test('自定义地址为纯空白时同样走引擎主页', () => {
    expect(resolveNewTabRedirect(fullPrefs({ newTabRedirectUrl: '   ' })))
      .toBe('https://www.google.com/');
  });

  test('按 searchEngineId 选中对应引擎', () => {
    expect(resolveNewTabRedirect(fullPrefs({ searchEngineId: 'bing' })))
      .toBe('https://www.bing.com/');
  });

  test('searchEngineId 匹配不到时回退到第一个引擎', () => {
    expect(resolveNewTabRedirect(fullPrefs({ searchEngineId: 'duckduckgo' })))
      .toBe('https://www.google.com/');
  });

  test('searchEngines 为空数组时回退兜底地址', () => {
    expect(resolveNewTabRedirect(fullPrefs({ searchEngines: [] })))
      .toBe(FALLBACK_NEW_TAB_URL);
  });

  test('选中引擎的地址畸形时回退兜底地址', () => {
    expect(resolveNewTabRedirect(fullPrefs({
      searchEngines: [{ id: 'broken', url: 'not a url' }],
      searchEngineId: 'broken',
    }))).toBe(FALLBACK_NEW_TAB_URL);
  });

  test('选中引擎的地址非 http(s) 时回退兜底地址', () => {
    expect(resolveNewTabRedirect(fullPrefs({
      searchEngines: [{ id: 'weird', url: 'ftp://example.com/search?q=%s' }],
      searchEngineId: 'weird',
    }))).toBe(FALLBACK_NEW_TAB_URL);
  });
});

describe('shouldRedirectNewTab', () => {
  const ownNewTab = `${ORIGIN}/newtab.html`;

  test('开启接管时永不重定向，即使就在自己的新标签页', () => {
    const prefs = fullPrefs({ newTabTakeover: true });
    expect(shouldRedirectNewTab({ url: ownNewTab }, ORIGIN, prefs)).toBe(false);
    expect(shouldRedirectNewTab({ url: 'chrome://newtab' }, ORIGIN, prefs)).toBe(false);
    expect(shouldRedirectNewTab({ url: ownNewTab, pendingUrl: ownNewTab }, ORIGIN, prefs)).toBe(false);
  });

  test('关闭接管且位于自己的新标签页时重定向', () => {
    const prefs = fullPrefs({ newTabTakeover: false });
    expect(shouldRedirectNewTab({ url: ownNewTab }, ORIGIN, prefs)).toBe(true);
    expect(shouldRedirectNewTab({ url: 'chrome://newtab' }, ORIGIN, prefs)).toBe(true);
    expect(shouldRedirectNewTab({ url: 'chrome://newtab/' }, ORIGIN, prefs)).toBe(true);
    expect(shouldRedirectNewTab({ url: `${ownNewTab}?x=1` }, ORIGIN, prefs)).toBe(true);
  });

  test('关闭接管但标签页是普通网页时不重定向', () => {
    const prefs = fullPrefs({ newTabTakeover: false });
    expect(shouldRedirectNewTab({ url: 'https://example.com/' }, ORIGIN, prefs)).toBe(false);
    expect(shouldRedirectNewTab({ url: `${ORIGIN}/options.html` }, ORIGIN, prefs)).toBe(false);
  });

  test('url 缺失时不重定向', () => {
    const prefs = fullPrefs({ newTabTakeover: false });
    expect(shouldRedirectNewTab({}, ORIGIN, prefs)).toBe(false);
    expect(shouldRedirectNewTab({ url: undefined }, ORIGIN, prefs)).toBe(false);
    expect(shouldRedirectNewTab({ url: '' }, ORIGIN, prefs)).toBe(false);
  });

  test('pendingUrl 优先于 url：pendingUrl 是新标签页则重定向', () => {
    const prefs = fullPrefs({ newTabTakeover: false });
    expect(shouldRedirectNewTab({ pendingUrl: ownNewTab, url: 'https://example.com/' }, ORIGIN, prefs))
      .toBe(true);
  });

  test('pendingUrl 优先于 url：pendingUrl 是普通网页则不重定向', () => {
    const prefs = fullPrefs({ newTabTakeover: false });
    expect(shouldRedirectNewTab({ pendingUrl: 'https://example.com/', url: ownNewTab }, ORIGIN, prefs))
      .toBe(false);
  });

  test('pendingUrl 为空串时回落到 url', () => {
    // 实现用 `tab.pendingUrl || tab.url`，空串属于假值，因此这里看 url。
    const prefs = fullPrefs({ newTabTakeover: false });
    expect(shouldRedirectNewTab({ pendingUrl: '', url: ownNewTab }, ORIGIN, prefs)).toBe(true);
    expect(shouldRedirectNewTab({ pendingUrl: '', url: 'https://example.com/' }, ORIGIN, prefs))
      .toBe(false);
  });
});
