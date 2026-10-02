import { describe, expect, test } from 'vitest';
import {
  describeLocalService,
  groupLocalServices,
  isLocalService,
  portHint,
} from './local-services';
import type { LocalServiceInfo, LocalServiceKind } from './local-services';

/** 断言 URL 会被识别为内网/自建服务，并返回解析结果 */
function expectService(url: string, title = ''): LocalServiceInfo {
  const info = describeLocalService(url, title);
  expect(info, `${url} 应被识别为内网/自建服务`).not.toBeNull();
  return info as LocalServiceInfo;
}

/** 本机地址（localhost 家族） */
const LOCALHOST_URLS = [
  'http://localhost:3000/',
  'http://127.0.0.1:8080/',
  'http://0.0.0.0:5000/',
  'http://[::1]:8000/',
];

/** 局域网域名（mDNS / 内网后缀） */
const MDNS_URLS = [
  'http://myapp.local/',
  'http://nas.lan/',
  'http://box.internal/',
  'http://server.home/',
];

/** 私有 IPv4 + Tailscale CGNAT 100.64.0.0/10 */
const PRIVATE_IP_URLS = [
  'http://192.168.1.50/',
  'http://10.0.0.5/',
  'http://172.16.5.4/',
  'http://172.31.255.1/',
  'http://100.64.0.1/',
  'http://100.127.255.254/',
];

/** 明确不属于内网的公网地址 */
const PUBLIC_URLS = [
  'https://github.com/',
  'http://example.com/',
  'https://example.com/',
];

/** 协议就不是 http(s) 的地址 */
const NON_HTTP_URLS = ['ftp://localhost/', 'chrome-extension://abc/x.html', 'file:///tmp/x'];

/** 无法解析 / 空输入 */
const MALFORMED_URLS = ['', '   ', 'not a url', 'example.com', 'http://'];

describe('isLocalService', () => {
  test('本机地址（localhost / 127.0.0.1 / 0.0.0.0 / ::1）都算内网服务', () => {
    for (const url of LOCALHOST_URLS) {
      expect(isLocalService(url), url).toBe(true);
    }
  });

  test('局域网域名（.local / .lan / .internal / .home）都算内网服务', () => {
    for (const url of MDNS_URLS) {
      expect(isLocalService(url), url).toBe(true);
    }
  });

  test('Tailscale 域名（*.ts.net）算内网服务', () => {
    expect(isLocalService('https://home-server.example.ts.net/')).toBe(true);
    // 后缀判定不区分大小写（hostname 已小写化）
    expect(isLocalService('http://foo.TS.NET/')).toBe(true);
  });

  test('私有 IPv4 与 Tailscale CGNAT 段算内网服务', () => {
    for (const url of PRIVATE_IP_URLS) {
      expect(isLocalService(url), url).toBe(true);
    }
  });

  test('公网域名带非默认端口算自建服务', () => {
    expect(isLocalService('https://example.com:8443/')).toBe(true);
  });

  test('公网域名使用默认端口或省略端口不算', () => {
    for (const url of PUBLIC_URLS) {
      expect(isLocalService(url), url).toBe(false);
    }
    // :80 / :443 是默认端口，URL 解析后端口为空 → 与省略端口同等待遇
    expect(isLocalService('http://example.com:80/')).toBe(false);
    expect(isLocalService('https://example.com:443/')).toBe(false);
  });

  test('非 http(s) 协议不算', () => {
    for (const url of NON_HTTP_URLS) {
      expect(isLocalService(url), url).toBe(false);
    }
  });

  test('空串 / 纯空白 / 无法解析的字符串不算且不抛错', () => {
    for (const url of MALFORMED_URLS) {
      expect(isLocalService(url), JSON.stringify(url)).toBe(false);
    }
  });

  test('CGNAT 与私有段的边界外地址不算', () => {
    // 100.64.0.0/10 的两侧：100.63.x 与 100.128.x 都在范围外
    expect(isLocalService('http://100.63.0.1/')).toBe(false);
    expect(isLocalService('http://100.128.0.1/')).toBe(false);
    // 172.16.0.0/12 的两侧：172.15.x 与 172.32.x 都在范围外
    expect(isLocalService('http://172.15.0.1/')).toBe(false);
    expect(isLocalService('http://172.32.0.1/')).toBe(false);
    // 只有 10.x 属于私有段，11.x 不是
    expect(isLocalService('http://11.0.0.1/')).toBe(false);
  });

  test('isLocalService 与 describeLocalService 的判定完全一致', () => {
    const urls = [
      ...LOCALHOST_URLS,
      ...MDNS_URLS,
      ...PRIVATE_IP_URLS,
      ...PUBLIC_URLS,
      ...NON_HTTP_URLS,
      ...MALFORMED_URLS,
      'https://example.com:8443/',
    ];
    for (const url of urls) {
      expect(isLocalService(url), url).toBe(describeLocalService(url) !== null);
    }
  });
});

describe('describeLocalService', () => {
  test('不是内网/自建服务时返回 null', () => {
    for (const url of [...PUBLIC_URLS, ...NON_HTTP_URLS, ...MALFORMED_URLS]) {
      expect(describeLocalService(url), JSON.stringify(url)).toBeNull();
    }
  });

  test('kind 按地址族判定正确', () => {
    expect(expectService('http://localhost:3000/').kind).toBe('localhost');
    expect(expectService('http://127.0.0.1:8080/').kind).toBe('localhost');
    expect(expectService('http://0.0.0.0:5000/').kind).toBe('localhost');
    expect(expectService('http://x.localhost/').kind).toBe('localhost');
    expect(expectService('https://home-server.example.ts.net/').kind).toBe('tailscale');
    expect(expectService('http://192.168.1.50/').kind).toBe('private-ip');
    expect(expectService('http://100.64.0.1/').kind).toBe('private-ip');
    expect(expectService('http://myapp.local/').kind).toBe('mdns');
    expect(expectService('http://nas.lan/').kind).toBe('mdns');
    expect(expectService('http://box.internal/').kind).toBe('mdns');
    expect(expectService('http://server.home/').kind).toBe('mdns');
    expect(expectService('https://example.com:8443/').kind).toBe('custom-port');
  });

  test('局域网后缀优先于自定义端口：.local:5173 归为 mdns 而不是 custom-port', () => {
    const info = expectService('http://my-nas.local:5173/');
    expect(info.kind).toBe('mdns');
    expect(info.port).toBe('5173');
  });

  test('kindLabel 是非空中文，且每种 kind 各不相同', () => {
    const samples: LocalServiceKind[] = [
      expectService('http://localhost:3000/').kind,
      expectService('https://home-server.example.ts.net/').kind,
      expectService('http://192.168.1.50/').kind,
      expectService('http://myapp.local/').kind,
      expectService('https://example.com:8443/').kind,
    ];
    const labels = [
      expectService('http://localhost:3000/').kindLabel,
      expectService('https://home-server.example.ts.net/').kindLabel,
      expectService('http://192.168.1.50/').kindLabel,
      expectService('http://myapp.local/').kindLabel,
      expectService('https://example.com:8443/').kindLabel,
    ];
    for (const label of labels) {
      expect(label.length).toBeGreaterThan(0);
      // 含中日韩统一表意文字，确认是中文而不是英文兜底
      expect(label).toMatch(/[\u4e00-\u9fa5]/);
    }
    // 五种 kind 的 kindLabel 互不重复
    expect(new Set(labels).size).toBe(samples.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('port 返回真实端口，缺省端口时为空串', () => {
    expect(expectService('http://localhost:3000/').port).toBe('3000');
    expect(expectService('https://example.com:8443/').port).toBe('8443');
    expect(expectService('http://myserver.example:27125/').port).toBe('27125');
    expect(expectService('http://myapp.local/').port).toBe('');
    expect(expectService('http://localhost/').port).toBe('');
    expect(expectService('http://192.168.1.50/').port).toBe('');
    // 显式写默认端口也会被 URL 归一化掉，无法与「没写端口」区分
    expect(expectService('http://localhost:80/').port).toBe('');
  });

  test('host 统一小写', () => {
    expect(expectService('HTTP://LOCALHOST:3000/').host).toBe('localhost');
    expect(expectService('http://foo.TS.NET/').host).toBe('foo.ts.net');
    expect(expectService('http://My-Nas.LOCAL:5000/').host).toBe('my-nas.local');
  });

  test('insecure：http 为 true，https 为 false', () => {
    expect(expectService('http://localhost:3000/').insecure).toBe(true);
    expect(expectService('http://192.168.1.50/').insecure).toBe(true);
    expect(expectService('https://home-server.example.ts.net/').insecure).toBe(false);
    expect(expectService('https://example.com:8443/').insecure).toBe(false);
    expect(expectService('https://localhost:8443/').insecure).toBe(false);
  });

  test('protocol 不带结尾冒号', () => {
    const http = expectService('http://localhost:3000/');
    const https = expectService('https://example.com:8443/');
    expect(http.protocol).toBe('http');
    expect(https.protocol).toBe('https');
    expect(http.protocol).not.toContain(':');
    expect(https.protocol).not.toContain(':');
  });

  test('label 优先使用传入标题，并去掉首尾空白', () => {
    expect(expectService('http://localhost:3000/', '我的服务').label).toBe('我的服务');
    expect(expectService('http://localhost:3000/', '  我的服务  ').label).toBe('我的服务');
  });

  test('label 回退：已知端口用 PORT_HINT 文案', () => {
    expect(expectService('http://myserver.example:27125/').label).toBe('CC Archive 剪藏服务');
    expect(expectService('http://myserver.example:11434/').label).toBe('Ollama');
    // 回退文案里应提到 CC Archive / Ollama
    expect(expectService('http://myserver.example:27125/').label).toContain('CC Archive');
    expect(expectService('http://myserver.example:11434/').label).toContain('Ollama');
  });

  test('label 回退：纯空白标题视为未提供标题', () => {
    expect(expectService('http://localhost:3000/', '   ').label).toBe('Node / 前端开发');
    expect(expectService('http://localhost:3000/', '').label).toBe('Node / 前端开发');
  });

  test('label 回退：未知端口/无端口时用 host:port', () => {
    expect(expectService('http://localhost:9999/').label).toBe('localhost:9999');
    expect(expectService('http://myapp.local/').label).toBe('myapp.local');
    expect(expectService('http://192.168.1.50/').label).toBe('192.168.1.50');
    expect(expectService('http://192.168.1.50:9999/').label).toBe('192.168.1.50:9999');
  });

  test('url 是 URL 归一化后的真实值', () => {
    expect(expectService('  HTTP://LOCALHOST:3000  ').url).toBe('http://localhost:3000/');
    expect(expectService('http://localhost:3000').url).toBe('http://localhost:3000/');
    expect(expectService('https://example.com:8443/path?q=1#h').url)
      .toBe('https://example.com:8443/path?q=1#h');
    // 主机大小写被归一化，路径大小写保留
    expect(expectService('http://LOCALHOST.LOCAL:5173/A?b=1').url)
      .toBe('http://localhost.local:5173/A?b=1');
  });

  test('IPv6 回环地址被正确识别为 localhost', () => {
    // 修复前：URL.hostname 对 IPv6 返回带方括号的 "[::1]"，与裸 "::1" 不等，
    // 于是带端口时被兜底成 custom-port，不带端口时直接返回 null（自相矛盾）。
    // 现在先去方括号再比较，四种写法都稳定归为 localhost。
    const withPort = expectService('http://[::1]:8000/');
    expect(withPort.kind).toBe('localhost');
    expect(withPort.host).toBe('[::1]');

    // 不带端口 / 默认端口也必须是服务，而不是 null
    expect(expectService('http://[::1]/').kind).toBe('localhost');
    expect(expectService('https://[::1]/').kind).toBe('localhost');
    expect(expectService('http://[::1]:80/').kind).toBe('localhost');

    // 完整写法会被 URL 归一化成 [::1]，同样归为 localhost
    expect(expectService('http://[0:0:0:0:0:0:0:1]:9000/').kind).toBe('localhost');

    // isLocalService 与 describeLocalService 保持一致
    expect(isLocalService('http://[::1]:8000/')).toBe(true);
    expect(isLocalService('http://[::1]/')).toBe(true);
  });

  test("kind 永远不会是 'unknown'（该分支只在类型层面存在）", () => {
    const urls = [
      ...LOCALHOST_URLS,
      ...MDNS_URLS,
      ...PRIVATE_IP_URLS,
      'https://example.com:8443/',
      'http://localhost:9999/',
    ];
    for (const url of urls) {
      expect(expectService(url).kind).not.toBe('unknown');
    }
  });
});

describe('portHint', () => {
  test('已知端口返回非空提示', () => {
    for (const port of ['27125', '11434', '5173', '5432']) {
      expect(portHint(port), port).not.toBe('');
    }
    expect(portHint('27125')).toContain('CC Archive');
    expect(portHint('11434')).toBe('Ollama');
    expect(portHint('5173')).toContain('Vite');
    expect(portHint('5432')).toContain('PostgreSQL');
  });

  test('未知端口返回空串', () => {
    expect(portHint('9999')).toBe('');
    expect(portHint('')).toBe('');
    expect(portHint('65535')).toBe('');
    // 端口提示是精确匹配，不做前缀/模糊匹配
    expect(portHint('2712')).toBe('');
  });
});

describe('groupLocalServices', () => {
  test('同一 host 的多个服务合并为一组，且全部保留', () => {
    const groups = groupLocalServices([
      { url: 'http://localhost:3000/' },
      { url: 'http://localhost:4000/' },
      { url: 'http://localhost:5173/' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].host).toBe('localhost');
    expect(groups[0].kind).toBe('localhost');
    expect(groups[0].services).toHaveLength(3);
    expect(groups[0].services.map((s) => s.port)).toEqual(['3000', '4000', '5173']);
  });

  test('不同 host 生成不同分组，组的 host/kind 与组内服务一致', () => {
    const groups = groupLocalServices([
      { url: 'http://localhost:3000/' },
      { url: 'http://nas.lan/' },
      { url: 'http://192.168.1.50/' },
    ]);
    expect(groups.map((g) => g.host)).toEqual(['localhost', '192.168.1.50', 'nas.lan']);
    for (const group of groups) {
      expect(group.kindLabel).toBe(group.services[0].kindLabel);
      for (const service of group.services) {
        expect(service.host).toBe(group.host);
        expect(service.kind).toBe(group.kind);
      }
    }
  });

  test('完全跳过非内网条目', () => {
    const groups = groupLocalServices([
      { url: 'https://github.com/' },
      { url: 'ftp://localhost/' },
      { url: 'not a url' },
      { url: '' },
      { url: 'http://localhost:3000/' },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].services).toHaveLength(1);
    expect(groups[0].services[0].url).toBe('http://localhost:3000/');
  });

  test('分组排序：localhost → tailscale → private-ip → mdns → custom-port', () => {
    const groups = groupLocalServices([
      { url: 'https://example.com:8443/' },        // custom-port
      { url: 'http://nas.lan/' },                  // mdns
      { url: 'http://192.168.1.50/' },             // private-ip
      { url: 'https://m.ts.net/' },                // tailscale
      { url: 'http://localhost:3000/' },           // localhost
    ]);
    expect(groups.map((g) => g.kind)).toEqual([
      'localhost',
      'tailscale',
      'private-ip',
      'mdns',
      'custom-port',
    ]);
  });

  test('同 kind 内：服务多的在前，数量相同按 host 升序', () => {
    const groups = groupLocalServices([
      { url: 'http://c.lan/' },
      { url: 'http://b.lan/' },
      { url: 'http://b.lan:8080/' },
      { url: 'http://a.lan/' },
    ]);
    expect(groups.map((g) => g.kind)).toEqual(['mdns', 'mdns', 'mdns']);
    // b.lan 有 2 个服务排最前，其余 1 个服务的按 host 升序
    expect(groups.map((g) => g.host)).toEqual(['b.lan', 'a.lan', 'c.lan']);
    expect(groups.map((g) => g.services.length)).toEqual([2, 1, 1]);
  });

  test('空输入返回空数组', () => {
    expect(groupLocalServices([])).toEqual([]);
  });

  test('不修改入参数组', () => {
    const items = [
      { url: 'http://localhost:3000/', title: '本机 A' },
      { url: 'https://github.com/', title: '公网' },
      { url: 'http://nas.lan/', title: 'NAS' },
    ];
    const snapshot = items.map((item) => ({ ...item }));
    groupLocalServices(items);
    expect(items).toEqual(snapshot);
    expect(items).toHaveLength(3);
  });
});
