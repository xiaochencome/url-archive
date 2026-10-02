/**
 * GitHub 趋势榜单：GitHub 没有官方 trending API，这里走官方 Search API（无需鉴权）。
 * 纯模块：不直接调用 chrome.*，不访问 DOM，仅使用 fetch。
 */

/** 官方仓库搜索端点 */
const SEARCH_ENDPOINT = 'https://api.github.com/search/repositories';
/** 默认返回条数 */
const DEFAULT_LIMIT = 10;
/** per_page 允许区间：GitHub 上限 100，这里保守取 50，避免一次拉太多 */
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
/** 请求超时（毫秒）：后台/新标签页都不能被挂起的请求拖住 */
export const TRENDING_TIMEOUT_MS = 12000;
/** GitHub 推荐的 API 版本头 */
const API_VERSION = '2022-11-28';
/** 一天的毫秒数，用于按 now 计算时间窗口 */
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TrendingRepo {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  language: string;
  topics: string[];
  avatarUrl: string;
  ownerUrl: string;
}

/** 可配置的榜单 */
export interface TrendingBoard {
  id: string;
  /** 展示用名称，如「本周新星」 */
  name: string;
  /** GitHub 搜索限定词，不含 sort/order/per_page，如 "created:>2024-01-01 stars:>10" */
  query: string;
  enabled: boolean;
}

export interface FetchTrendingOptions {
  limit?: number;
  signal?: AbortSignal;
  token?: string;
}

/**
 * 生成默认榜单：时间窗口按传入的 now 动态计算（默认当前时间），
 * 因此不会像写死日期那样随时间失效。
 */
export function buildDefaultBoards(now: Date = new Date()): TrendingBoard[] {
  const week = daysAgo(now, 7);
  const month = daysAgo(now, 30);
  const quarter = daysAgo(now, 90);
  const year = daysAgo(now, 365);
  return [
    { id: 'weekly', name: '本周新星', query: `created:>${week} stars:>10`, enabled: true },
    { id: 'monthly', name: '本月热门', query: `created:>${month} stars:>100`, enabled: true },
    { id: 'quarterly', name: '近三月崛起', query: `created:>${quarter} stars:>500`, enabled: true },
    { id: 'yearly', name: '年度精选', query: `created:>${year} stars:>2000`, enabled: true },
    {
      id: 'typescript',
      name: 'TypeScript 精选',
      query: `language:typescript pushed:>${month} stars:>1000`,
      enabled: true,
    },
    { id: 'chinese', name: '中文热门', query: `中文 in:readme stars:>500`, enabled: true },
  ];
}

/** 默认榜单：模块加载时按当时时间派生一份；跨天长驻场景请直接调用 buildDefaultBoards() 取最新窗口 */
export const DEFAULT_TRENDING_BOARDS: TrendingBoard[] = buildDefaultBoards();

/** 拉取某个榜单的仓库列表；HTTP 异常会抛出带状态码的错误 */
export async function fetchTrending(
  board: TrendingBoard,
  options: FetchTrendingOptions = {},
): Promise<TrendingRepo[]> {
  const limit = clampLimit(options.limit);
  const url = buildSearchUrl(board.query, limit);
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
  const token = options.token?.trim();
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers, signal: combineSignals(options.signal) });
  if (!res.ok) throw new Error(describeHttpError(res.status));

  const data: unknown = await res.json();
  const items: unknown[] = isRecord(data) && Array.isArray(data.items) ? data.items : [];
  return items.map(mapRepo).filter((repo): repo is TrendingRepo => repo !== null);
}

/** 读取用户保存的榜单配置时的防御性归一化：丢弃畸形项、去重，完全不可用时回退默认榜单 */
export function normalizeBoards(value: unknown): TrendingBoard[] {
  if (!Array.isArray(value)) return buildDefaultBoards();

  const boards: TrendingBoard[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const id = toText(item.id);
    const name = toText(item.name);
    const query = toText(item.query);
    if (!id || !name || !query) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    boards.push({ id, name, query, enabled: toEnabled(item.enabled) });
  }
  return boards.length ? boards : buildDefaultBoards();
}

function buildSearchUrl(query: string, limit: number): string {
  const params = [
    `q=${encodeURIComponent(query.trim())}`,
    'sort=stars',
    'order=desc',
    `per_page=${limit}`,
  ];
  return `${SEARCH_ENDPOINT}?${params.join('&')}`;
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.floor(value)));
}

/** 把搜索结果条目映射成 TrendingRepo；缺 html_url 或 owner 的条目返回 null 由调用方过滤 */
function mapRepo(value: unknown): TrendingRepo | null {
  if (!isRecord(value)) return null;
  const url = toText(value.html_url);
  const owner = isRecord(value.owner) ? value.owner : null;
  const fullName = toText(value.full_name);
  // owner 对象缺失直接跳过；login 为空时退化用 full_name 前缀，仍拿不到才跳过
  if (!url || !owner) return null;
  const ownerLogin = toText(owner.login) || fullName.split('/')[0];
  if (!ownerLogin) return null;

  const [, name = ''] = fullName.split('/');
  return {
    fullName: fullName || `${ownerLogin}/${name}`,
    owner: ownerLogin,
    name: name || fullName,
    description: toText(value.description),
    url,
    stars: toCount(value.stargazers_count),
    forks: toCount(value.forks_count),
    language: toText(value.language),
    topics: toTopics(value.topics),
    avatarUrl: toText(owner.avatar_url),
    ownerUrl: toText(owner.html_url),
  };
}

/** 区分限流与其他失败，给出可操作提示 */
function describeHttpError(status: number): string {
  if (status === 403 || status === 429) {
    return `GitHub 搜索请求被限流（HTTP ${status}，rate limit）：请稍后重试，或配置 GitHub Token 以提高配额`;
  }
  return `GitHub 搜索请求失败：HTTP ${status}`;
}

/** 组合调用方信号与超时信号；老环境没有 AbortSignal.any 时手动桥接 */
function combineSignals(signal?: AbortSignal): AbortSignal {
  const timeout = createTimeoutSignal(TRENDING_TIMEOUT_MS);
  if (!signal) return timeout;

  const anySignal = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (typeof anySignal === 'function') return anySignal([signal, timeout]);

  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted || timeout.aborted) {
    controller.abort();
  } else {
    signal.addEventListener('abort', abort, { once: true });
    timeout.addEventListener('abort', abort, { once: true });
  }
  return controller.signal;
}

/** 超时信号；不支持 AbortSignal.timeout 的环境退化为手动定时器 */
function createTimeoutSignal(ms: number): AbortSignal {
  const timeout = (AbortSignal as { timeout?: (ms: number) => AbortSignal }).timeout;
  if (typeof timeout === 'function') return timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function daysAgo(now: Date, days: number): string {
  return toDateString(new Date(now.getTime() - days * DAY_MS));
}

function toDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function toTopics(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  return list
    .filter((topic): topic is string => typeof topic === 'string')
    .map((topic) => topic.trim())
    .filter(Boolean);
}

/** 缺省视为启用；字符串 'false'/'0'/'no' 视为关闭 */
function toEnabled(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return text !== '' && text !== 'false' && text !== '0' && text !== 'no';
  }
  return Boolean(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
