import { describe, expect, test } from 'vitest';
import {
  buildTagStats,
  groupCardsByDomain,
  pickFrequentBookmarks,
  sortCards,
  tagGroups,
} from './tag-organizer';
import type { TagCard } from './tag-organizer';

function card(overrides: Partial<TagCard> = {}): TagCard {
  return {
    url: 'https://example.com/a',
    title: 'A',
    domain: 'example.com',
    source: 'clip',
    tags: [],
    clipped: '2026-01-01T00:00:00.000Z',
    lastVisited: '',
    ...overrides,
  };
}

describe('buildTagStats', () => {
  test('空数组返回空结果', () => {
    expect(buildTagStats([])).toEqual([]);
  });

  test('统计计数与来源分布', () => {
    const stats = buildTagStats([
      card({ tags: ['前端'], source: 'clip' }),
      card({ url: 'https://b.com', tags: ['前端'], source: 'bookmark' }),
      card({ url: 'https://c.com', tags: ['前端'], source: 'bookmark' }),
    ]);
    expect(stats).toEqual([
      {
        tag: '前端',
        count: 3,
        clipCount: 1,
        bookmarkCount: 2,
        lastUsed: '2026-01-01T00:00:00.000Z',
      },
    ]);
  });

  test('大小写不敏感计数，展示出现最多的原始写法', () => {
    const stats = buildTagStats([
      card({ tags: ['React'] }),
      card({ url: 'https://b.com', tags: ['react'] }),
      card({ url: 'https://c.com', tags: ['REACT'] }),
      card({ url: 'https://d.com', tags: ['React'] }),
    ]);
    expect(stats).toHaveLength(1);
    expect(stats[0].tag).toBe('React');
    expect(stats[0].count).toBe(4);
  });

  test('展示写法出现次数相同时保留首次出现的写法', () => {
    const stats = buildTagStats([
      card({ tags: ['vue'] }),
      card({ url: 'https://b.com', tags: ['Vue'] }),
    ]);
    expect(stats[0].tag).toBe('vue');
  });

  test('lastUsed 取 clipped 与 lastVisited 的最大值', () => {
    const stats = buildTagStats([
      card({ tags: ['t'], clipped: '2026-01-01T00:00:00.000Z' }),
      card({
        url: 'https://b.com',
        tags: ['t'],
        clipped: '2026-01-02T00:00:00.000Z',
        lastVisited: '2026-03-01T00:00:00.000Z',
      }),
    ]);
    expect(stats[0].lastUsed).toBe('2026-03-01T00:00:00.000Z');
  });

  test('忽略空白标签', () => {
    const stats = buildTagStats([card({ tags: ['  ', '', 'ok'] })]);
    expect(stats.map((stat) => stat.tag)).toEqual(['ok']);
  });

  test('按 count 降序，再按 lastUsed 降序，再按名称', () => {
    const stats = buildTagStats([
      card({ tags: ['a', 'b'] }),
      card({ url: 'https://b.com', tags: ['b', 'c'], lastVisited: '2026-05-01T00:00:00.000Z' }),
      card({ url: 'https://c.com', tags: ['c'], clipped: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(stats.map((stat) => stat.tag)).toEqual(['c', 'b', 'a']);
  });

  test('minCount 过滤低频标签', () => {
    const cards = [
      card({ tags: ['hot'] }),
      card({ url: 'https://b.com', tags: ['hot', 'cold'] }),
    ];
    expect(buildTagStats(cards, { minCount: 2 }).map((stat) => stat.tag)).toEqual(['hot']);
    expect(buildTagStats(cards, { minCount: 5 })).toEqual([]);
  });

  test('limit 截断结果', () => {
    const cards = [card({ tags: ['a', 'b', 'c', 'd'] })];
    expect(buildTagStats(cards, { limit: 2 })).toHaveLength(2);
    expect(buildTagStats(cards, { limit: 0 })).toEqual([]);
  });
});

describe('tagGroups', () => {
  function stat(tag: string): { tag: string; count: number; clipCount: number; bookmarkCount: number; lastUsed: string } {
    return { tag, count: 1, clipCount: 1, bookmarkCount: 0, lastUsed: '' };
  }

  test('ASCII 字母按大写分组，其余归 #', () => {
    const groups = tagGroups([stat('apple'), stat('Banana'), stat('中文'), stat('123'), stat('#hash')]);
    expect(groups.map((group) => group.letter)).toEqual(['A', 'B', '#']);
    expect(groups[0].tags.map((item) => item.tag)).toEqual(['apple']);
    expect(groups[2].tags.map((item) => item.tag)).toEqual(['中文', '123', '#hash']);
  });

  test('A-Z 在前，# 最后', () => {
    const groups = tagGroups([stat('zoo'), stat('中文'), stat('Alpha')]);
    expect(groups.map((group) => group.letter)).toEqual(['A', 'Z', '#']);
  });

  test('maxGroups 截断且默认为 12', () => {
    const many = Array.from({ length: 30 }, (_, index) => stat(String.fromCharCode(97 + (index % 26))));
    expect(tagGroups(many).length).toBeLessThanOrEqual(12);
    expect(tagGroups(many, { maxGroups: 2 })).toHaveLength(2);
  });

  test('空输入返回空数组', () => {
    expect(tagGroups([])).toEqual([]);
  });
});

describe('sortCards', () => {
  const cards: TagCard[] = [
    card({ url: 'https://b.com', title: '香蕉', domain: 'b.com', clipped: '2026-02-01T00:00:00.000Z' }),
    card({ url: 'https://a.com', title: 'Apple', domain: 'a.com', clipped: '2026-01-01T00:00:00.000Z' }),
    card({ url: 'https://c.com', title: '苹果', domain: 'c.com', clipped: '2026-03-01T00:00:00.000Z' }),
  ];

  test('不修改入参数组', () => {
    const input = [...cards];
    sortCards(input, 'recent');
    sortCards(input, 'title');
    sortCards(input, 'frequent', { frequentOrder: ['https://c.com'] });
    expect(input).toEqual(cards);
  });

  test('recent：lastVisited 优先，其次 clipped，新的在前', () => {
    const sorted = sortCards([
      card({ url: 'https://a.com', clipped: '2026-01-01T00:00:00.000Z' }),
      card({ url: 'https://b.com', clipped: '2026-01-02T00:00:00.000Z', lastVisited: '2026-02-01T00:00:00.000Z' }),
      card({ url: 'https://c.com', clipped: '2026-01-03T00:00:00.000Z', lastVisited: '2026-06-01T00:00:00.000Z' }),
    ], 'recent');
    expect(sorted.map((item) => item.url)).toEqual(['https://c.com', 'https://b.com', 'https://a.com']);
  });

  test('title：按 zh 数字感知排序', () => {
    const sorted = sortCards([
      card({ title: 'item10' }),
      card({ title: 'item2' }),
      card({ title: 'item1' }),
    ], 'title');
    expect(sorted.map((item) => item.title)).toEqual(['item1', 'item2', 'item10']);
  });

  test('domain：先域名再标题', () => {
    const sorted = sortCards([
      card({ url: 'https://b.com/1', domain: 'b.com', title: 'B' }),
      card({ url: 'https://a.com/2', domain: 'a.com', title: 'Z' }),
      card({ url: 'https://a.com/1', domain: 'a.com', title: 'A' }),
    ], 'domain');
    expect(sorted.map((item) => item.url)).toEqual([
      'https://a.com/1',
      'https://a.com/2',
      'https://b.com/1',
    ]);
  });

  test('frequent：已知 url 按顺序，未知保持相对顺序并排在其后', () => {
    const sorted = sortCards([
      card({ url: 'https://x.com' }),
      card({ url: 'https://a.com' }),
      card({ url: 'https://y.com' }),
      card({ url: 'https://b.com' }),
    ], 'frequent', { frequentOrder: ['https://b.com', 'https://a.com'] });
    expect(sorted.map((item) => item.url)).toEqual([
      'https://b.com',
      'https://a.com',
      'https://x.com',
      'https://y.com',
    ]);
  });

  test('frequent：无 frequentOrder 时全部视为未知，按最近使用', () => {
    const sorted = sortCards([
      card({ url: 'https://a.com', clipped: '2026-01-01T00:00:00.000Z' }),
      card({ url: 'https://b.com', clipped: '2026-02-01T00:00:00.000Z' }),
    ], 'frequent');
    expect(sorted.map((item) => item.url)).toEqual(['https://b.com', 'https://a.com']);
  });

  test('manual：保持给定顺序', () => {
    const sorted = sortCards(cards, 'manual');
    expect(sorted.map((item) => item.url)).toEqual(cards.map((item) => item.url));
  });

  test('空数组返回空数组', () => {
    expect(sortCards([], 'recent')).toEqual([]);
  });
});

describe('pickFrequentBookmarks', () => {
  test('空数组返回空', () => {
    expect(pickFrequentBookmarks([])).toEqual([]);
  });

  test('默认最多 12 条', () => {
    const cards = Array.from({ length: 20 }, (_, index) =>
      card({ url: `https://e.com/${index}`, title: `t${index}`, domain: `d${index}.com` }));
    expect(pickFrequentBookmarks(cards)).toHaveLength(12);
    expect(pickFrequentBookmarks(cards, { limit: 3 })).toHaveLength(3);
  });

  test('回访过的书签得分更高', () => {
    const picked = pickFrequentBookmarks([
      card({ url: 'https://a.com', title: 'A', source: 'clip' }),
      card({ url: 'https://b.com', title: 'B', source: 'bookmark', lastVisited: '2026-06-01T00:00:00.000Z' }),
    ]);
    expect(picked[0].url).toBe('https://b.com');
  });

  test('revived 次数提升排名且封顶', () => {
    const picked = pickFrequentBookmarks([
      card({ url: 'https://a.com', title: 'A', revived: 0 }),
      card({ url: 'https://b.com', title: 'B', revived: 5 }),
    ]);
    expect(picked[0].url).toBe('https://b.com');

    const capped = pickFrequentBookmarks([
      card({ url: 'https://a.com', title: 'A', revived: 20 }),
      card({ url: 'https://b.com', title: 'B', revived: 500 }),
    ]);
    // 封顶后两者 revived 得分相同，靠标题破平
    expect(capped.map((item) => item.url)).toEqual(['https://a.com', 'https://b.com']);
  });

  test('域名重复次数提升排名', () => {
    const picked = pickFrequentBookmarks([
      card({ url: 'https://a.com/1', title: 'A1', domain: 'a.com' }),
      card({ url: 'https://a.com/2', title: 'A2', domain: 'a.com' }),
      card({ url: 'https://a.com/3', title: 'A3', domain: 'a.com' }),
      card({ url: 'https://b.com/1', title: 'B1', domain: 'b.com' }),
    ], { limit: 1 });
    expect(picked[0].domain).toBe('a.com');
  });

  test('标签重复次数提升排名', () => {
    const picked = pickFrequentBookmarks([
      card({ url: 'https://a.com', title: 'A', domain: 'a.com', tags: ['react'] }),
      card({ url: 'https://b.com', title: 'B', domain: 'b.com', tags: ['react'] }),
      card({ url: 'https://c.com', title: 'C', domain: 'c.com', tags: ['react'] }),
      card({ url: 'https://d.com', title: 'D', domain: 'd.com', tags: ['go'] }),
    ], { limit: 1 });
    expect(picked[0].tags).toEqual(['react']);
  });

  test('minScore 过滤低分项', () => {
    const cards = [
      card({ url: 'https://a.com', title: 'A', domain: 'a.com' }),
      card({ url: 'https://b.com', title: 'B', domain: 'b.com', lastVisited: '2026-06-01T00:00:00.000Z' }),
    ];
    const picked = pickFrequentBookmarks(cards, { minScore: 40 });
    expect(picked.map((item) => item.url)).toEqual(['https://b.com']);
  });

  test('同分按标题稳定破平', () => {
    const picked = pickFrequentBookmarks([
      card({ url: 'https://b.com', title: 'B', domain: 'b.com' }),
      card({ url: 'https://a.com', title: 'A', domain: 'a.com' }),
    ]);
    expect(picked.map((item) => item.title)).toEqual(['A', 'B']);
  });

  test('不修改入参顺序', () => {
    const cards = [
      card({ url: 'https://b.com', title: 'B' }),
      card({ url: 'https://a.com', title: 'A' }),
    ];
    const snapshot = [...cards];
    pickFrequentBookmarks(cards);
    expect(cards).toEqual(snapshot);
  });
});

describe('groupCardsByDomain', () => {
  test('空数组返回空', () => {
    expect(groupCardsByDomain([])).toEqual([]);
  });

  test('按数量降序再按域名排序', () => {
    const groups = groupCardsByDomain([
      card({ url: 'https://a.com/1', domain: 'a.com' }),
      card({ url: 'https://b.com/1', domain: 'b.com' }),
      card({ url: 'https://a.com/2', domain: 'a.com' }),
    ]);
    expect(groups.map((group) => group.domain)).toEqual(['a.com', 'b.com']);
    expect(groups[0].count).toBe(2);
    expect(groups[0].cards).toHaveLength(2);
  });

  test('数量相同时按域名升序', () => {
    const groups = groupCardsByDomain([
      card({ url: 'https://b.com', domain: 'b.com' }),
      card({ url: 'https://a.com', domain: 'a.com' }),
    ]);
    expect(groups.map((group) => group.domain)).toEqual(['a.com', 'b.com']);
  });

  test('空域名归入「未知」', () => {
    const groups = groupCardsByDomain([card({ domain: '   ' })]);
    expect(groups[0].domain).toBe('未知');
  });

  test('limit 截断分组', () => {
    const groups = groupCardsByDomain([
      card({ url: 'https://a.com', domain: 'a.com' }),
      card({ url: 'https://b.com', domain: 'b.com' }),
    ], { limit: 1 });
    expect(groups).toHaveLength(1);
  });
});
