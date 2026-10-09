/**
 * 内网 / 本机 / 自建服务识别与展示。
 *
 * 这类链接（localhost、私有网段、.local、Tailscale 域名、带自定义端口的服务）
 * 用普通域名规则永远归不了类，但它们往往是用户自己部署、价值最高的入口。
 * 这里把它们抽成独立模块：识别 + 生成可读标签，供新标签页做成按钮卡片展示。
 */

export interface LocalServiceInfo {
  url: string;
  /** 展示名（优先书签标题） */
  label: string;
  host: string;
  /** 非标准端口，空串表示默认端口 */
  port: string;
  /** 服务类型，用于选图标与配色 */
  kind: LocalServiceKind;
  /** 人类可读的类型名 */
  kindLabel: string;
  /** 协议 */
  protocol: string;
  /** 是否明文 http（内网常见，提示用） */
  insecure: boolean;
}

export type LocalServiceKind =
  | 'localhost'
  | 'private-ip'
  | 'mdns'
  | 'tailscale'
  | 'custom-port'
  | 'unknown';

const KIND_LABEL: Record<LocalServiceKind, string> = {
  localhost: '本机服务',
  'private-ip': '局域网设备',
  mdns: '局域网域名',
  tailscale: 'Tailscale 内网',
  'custom-port': '自建服务',
  unknown: '内网地址',
};

/** 常见自建服务的端口 → 用途，命中就显示得更清楚 */
const PORT_HINT: Record<string, string> = {
  '3000': 'Node / 前端开发',
  '3001': 'Node / 前端开发',
  '4000': '开发服务',
  '5000': '开发服务',
  '5173': 'Vite 开发服务器',
  '8000': 'Python / 通用 HTTP',
  '8080': '通用 HTTP 代理',
  '8081': '通用 HTTP',
  '8443': 'HTTPS 服务',
  '9000': 'Portainer / 通用',
  '9090': 'Prometheus',
  '9200': 'Elasticsearch',
  '11434': 'Ollama',
  '27123': 'Obsidian Local REST API',
  '27125': 'CC Archive 剪藏服务',
  '5432': 'PostgreSQL',
  '3306': 'MySQL',
  '6379': 'Redis',
  '7860': 'Gradio',
  '8888': 'Jupyter',
};

function isPrivateIpv4(host: string): boolean {
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  // Tailscale 使用 100.64.0.0/10
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
  return false;
}

/**
 * 判断是否内网/自建服务。
 * 与 curator 的 isLocalServiceUrl 保持一致的判定口径。
 */
export function isLocalService(url: string): boolean {
  const info = describeLocalService(url, '');
  return info !== null;
}

/**
 * 解析成可展示的服务信息；不是内网/自建服务时返回 null。
 */
export function describeLocalService(url: string, title = ''): LocalServiceInfo | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase();
  const port = parsed.port;
  const isDefaultPort = port === '' || port === '80' || port === '443';

  // 注意：WHATWG URL 的 hostname 对 IPv6 会带方括号（'[::1]'），
  // 必须去掉括号再比较，否则 ::1 永远匹配不上 localhost 分支。
  const bareHost = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;

  let kind: LocalServiceKind | null = null;
  if (
    bareHost === 'localhost'
    || bareHost === '127.0.0.1'
    || bareHost === '0.0.0.0'
    || bareHost === '::1'
    || bareHost === '0:0:0:0:0:0:0:1'
    || host.endsWith('.localhost')
  ) {
    kind = 'localhost';
  } else if (host.endsWith('.ts.net')) {
    kind = 'tailscale';
  } else if (host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal') || host.endsWith('.home')) {
    kind = 'mdns';
  } else if (isPrivateIpv4(host)) {
    kind = 'private-ip';
  } else if (!isDefaultPort) {
    // 公网域名但带自定义端口，通常也是自建服务
    kind = 'custom-port';
  }

  if (!kind) return null;

  const fallbackLabel = port && PORT_HINT[port] ? PORT_HINT[port] : `${host}${port ? `:${port}` : ''}`;

  return {
    url: parsed.toString(),
    label: (title || '').trim() || fallbackLabel,
    host,
    port,
    kind,
    kindLabel: KIND_LABEL[kind],
    protocol: parsed.protocol.replace(':', ''),
    insecure: parsed.protocol === 'http:',
  };
}

/**
 * 从一组卡片里筛出内网/自建服务，按 host 分组聚合。
 * 同一台机器上的多个服务会被归到一组，便于「一个按钮展开更多」。
 */
export interface LocalServiceGroup {
  host: string;
  kind: LocalServiceKind;
  kindLabel: string;
  services: LocalServiceInfo[];
}

export function groupLocalServices(
  items: { url: string; title?: string }[],
): LocalServiceGroup[] {
  const groups = new Map<string, LocalServiceGroup>();

  for (const item of items) {
    const info = describeLocalService(item.url, item.title);
    if (!info) continue;
    const existing = groups.get(info.host);
    if (existing) {
      existing.services.push(info);
    } else {
      groups.set(info.host, {
        host: info.host,
        kind: info.kind,
        kindLabel: info.kindLabel,
        services: [info],
      });
    }
  }

  // 本机服务排最前，其余按服务数量降序
  const rank: Record<LocalServiceKind, number> = {
    localhost: 0,
    tailscale: 1,
    'private-ip': 2,
    mdns: 3,
    'custom-port': 4,
    unknown: 5,
  };
  return [...groups.values()].sort((a, b) => {
    if (a.kind !== b.kind) return rank[a.kind] - rank[b.kind];
    if (b.services.length !== a.services.length) return b.services.length - a.services.length;
    return a.host.localeCompare(b.host);
  });
}

/** 端口用途提示，供详情展示 */
export function portHint(port: string): string {
  return PORT_HINT[port] ?? '';
}
