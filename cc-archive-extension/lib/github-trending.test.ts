import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  DEFAULT_TRENDING_BOARDS,
  buildDefaultBoards,
  fetchTrending,
  normalizeBoards,
} from './github-trending';
import type { TrendingBoard } from './github-trending';

/** 构造一个搜索接口响应 */
function mockResponse(data: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => data,
  } as Response;
}

/** 从 mock 的第一次调用里取出请求 URL 与 init */
function firstCall(): [string, RequestInit] {
  const calls = vi.mocked(globalThis.fetch).mock.calls;
  return [String(calls[0][0]), (calls[0][1] ?? {}) as RequestInit];
}

const board: TrendingBoard = {
  id: 'weekly',
  name: '本周新星',
  query: 'created:>2024-01-01 stars:>10',
  enabled: true,
};

const fullItem = {
  full_name: 'owner/name',
  html_url: 'https://github.com/owner/name',
  description: '一个项目',
  stargazers_count: 1234,
  forks_count: 56,
  language: 'TypeScript',
  topics: ['cli', 'tool'],
  owner: {
    login: 'owner',
    avatar_url: 'https://avatars.githubusercontent.com/u/1',
    html_url: 'https://github.com/owner',
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('fetchTrending', () => {
  test('映射成功响应，并容忍 null 描述/语言与缺失 topics', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockResponse({
        items: [
          fullItem,
          {
            ...fullItem,
            full_name: 'nulls/repo',
            html_url: 'https://github.com/nulls/repo',
            description: null,
            language: null,
            topics: undefined,
            owner: { ...fullItem.owner, login: 'nulls' },
          },
        ],
      }),
    );

    const repos = await fetchTrending(board, { limit: 2 });

    expect(repos).toHaveLength(2);
    expect(repos[0]).toEqual({
      fullName: 'owner/name',
      owner: 'owner',
      name: 'name',
      description: '一个项目',
      url: 'https://github.com/owner/name',
      stars: 1234,
      forks: 56,
      language: 'TypeScript',
      topics: ['cli', 'tool'],
      avatarUrl: 'https://avatars.githubusercontent.com/u/1',
      ownerUrl: 'https://github.com/owner',
    });
    expect(repos[1].description).toBe('');
    expect(repos[1].language).toBe('');
    expect(repos[1].topics).toEqual([]);
  });

  test('URL 正确编码 q 并带 sort/order/per_page', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ items: [] }));

    await fetchTrending(board, { limit: 25 });

    const [url] = firstCall();
    expect(url.startsWith('https://api.github.com/search/repositories?')).toBe(true);
    expect(url).toContain(`q=${encodeURIComponent(board.query)}`);
    expect(url).toContain('sort=stars');
    expect(url).toContain('order=desc');
    expect(url).toContain('per_page=25');
    expect(url).not.toContain('created:>');
  });

  test('limit 越界被夹到 1..50，缺省为 10', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ items: [] }));

    await fetchTrending(board, { limit: 999 });
    expect(firstCall()[0]).toContain('per_page=50');

    vi.mocked(globalThis.fetch).mockClear();
    await fetchTrending(board, { limit: 0 });
    expect(firstCall()[0]).toContain('per_page=1');

    vi.mocked(globalThis.fetch).mockClear();
    await fetchTrending(board);
    expect(firstCall()[0]).toContain('per_page=10');
  });

  test('只在提供 token 时带 Authorization 头', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({ items: [] }));

    await fetchTrending(board);
    const [, withoutToken] = firstCall();
    expect(withoutToken.headers).toMatchObject({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    });
    expect(withoutToken.headers).not.toHaveProperty('Authorization');

    vi.mocked(globalThis.fetch).mockClear();
    await fetchTrending(board, { token: '  ghp_test  ' });
    const [, withToken] = firstCall();
    expect(withToken.headers).toMatchObject({ Authorization: 'Bearer ghp_test' });
  });

  test('非 OK 状态抛出包含状态码的错误', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({}, { ok: false, status: 500 }));

    await expect(fetchTrending(board)).rejects.toThrow(/500/);
  });

  test('403/429 给出限流专属的可操作提示', async () => {
    for (const status of [403, 429]) {
      vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({}, { ok: false, status }));
      await expect(fetchTrending(board)).rejects.toThrow(/rate limit/i);
      await expect(fetchTrending(board)).rejects.toThrow(String(status));
      vi.mocked(globalThis.fetch).mockClear();
    }
  });

  test('跳过缺 html_url 或 owner 的条目', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(
      mockResponse({
        items: [
          { ...fullItem, html_url: undefined },
          { ...fullItem, owner: null },
          { ...fullItem, owner: { login: '' }, full_name: '' },
          fullItem,
        ],
      }),
    );

    const repos = await fetchTrending(board);

    expect(repos.map((repo) => repo.fullName)).toEqual(['owner/name']);
  });

  test('响应缺少 items 时返回空数组', async () => {
    vi.mocked(globalThis.fetch).mockResolvedValue(mockResponse({}));
    await expect(fetchTrending(board)).resolves.toEqual([]);
  });
});

describe('normalizeBoards', () => {
  test('丢弃畸形项、trim 字符串并去重 id', () => {
    const boards = normalizeBoards([
      { id: ' a ', name: ' A ', query: ' stars:>1 ', enabled: 'false' },
      { id: 'a', name: '重复', query: 'stars:>2' },
      { id: 'b', name: 'B', query: 'stars:>3' },
      { id: '', name: 'B', query: 'stars:>3' },
      { id: 'c', name: 'C' },
      'nope',
      null,
      { id: 'd', name: 'D', query: 'stars:>4', enabled: 0 },
    ]);

    expect(boards).toEqual([
      { id: 'a', name: 'A', query: 'stars:>1', enabled: false },
      { id: 'b', name: 'B', query: 'stars:>3', enabled: true },
      { id: 'd', name: 'D', query: 'stars:>4', enabled: false },
    ]);
  });

  test('非数组或全部畸形时回退默认榜单', () => {
    const fallback = buildDefaultBoards();
    for (const garbage of [null, undefined, 42, 'x', {}, [], [1, 'x', null]]) {
      const boards = normalizeBoards(garbage);
      expect(boards.length).toBeGreaterThanOrEqual(5);
      expect(boards.map((item) => item.id)).toEqual(fallback.map((item) => item.id));
    }
  });
});

describe('buildDefaultBoards', () => {
  test('至少 5 个榜单，且包含语言类榜单', () => {
    const boards = buildDefaultBoards(new Date('2026-06-15T00:00:00Z'));
    expect(boards.length).toBeGreaterThanOrEqual(5);
    expect(new Set(boards.map((item) => item.id)).size).toBe(boards.length);
    expect(boards.some((item) => item.query.includes('language:'))).toBe(true);
    expect(DEFAULT_TRENDING_BOARDS.length).toBeGreaterThanOrEqual(5);
  });

  test('时间窗口相对传入的 now 变化', () => {
    const early = buildDefaultBoards(new Date('2026-01-15T00:00:00Z'));
    const later = buildDefaultBoards(new Date('2026-06-15T00:00:00Z'));

    expect(early[0].query).toContain('created:>2026-01-08');
    expect(later[0].query).toContain('created:>2026-06-08');
    expect(early[0].query).not.toEqual(later[0].query);
    expect(later[1].query).toContain('created:>2026-05-16');
    expect(later[2].query).toContain('created:>2026-03-17');
  });
});
