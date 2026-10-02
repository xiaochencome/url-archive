/**
 * 标签整理：把仪表盘卡片按标签/域名/常用度重新组织，纯函数，无 chrome / DOM 依赖。
 * 卡片只取结构子集，避免与 dashboard.ts 互相 import。
 */

/** 卡片最小结构：与 DashboardCard 兼容但保持解耦 */
export interface TagCard {
  url: string;
  title: string;
  domain: string;
  source: 'clip' | 'bookmark';
  tags: string[];
  clipped: string;
  lastVisited: string;
  folder?: string;
  revived?: number;
}

export interface TagStat {
  tag: string;
  count: number;
  clipCount: number;      // source === 'clip' 的卡片数
  bookmarkCount: number;  // source === 'bookmark' 的卡片数
  lastUsed: string;       // 其卡片中 clipped/lastVisited 的最大值，无则 ''
}

export type CardSortKey = 'recent' | 'title' | 'domain' | 'frequent' | 'manual';

/** 统计标签：大小写不敏感计数，展示出现次数最多的原始写法 */
export function buildTagStats(
  cards: TagCard[],
  options: { minCount?: number; limit?: number } = {},
): TagStat[] {
  const minCount = options.minCount ?? 1;
  const limit = options.limit ?? 40;

  const buckets = new Map<string, {
    display: Map<string, number>;  // 原始写法 -> 出现次数，用于挑展示写法
    count: number;
    clipCount: number;
    bookmarkCount: number;
    lastUsed: string;
  }>();

  for (const card of cards) {
    const lastUsed = cardLastUsed(card);
    for (const rawTag of card.tags) {
      const tag = rawTag.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const bucket = buckets.get(key) ?? {
        display: new Map<string, number>(),
        count: 0,
        clipCount: 0,
        bookmarkCount: 0,
        lastUsed: '',
      };
      bucket.count += 1;
      if (card.source === 'bookmark') bucket.bookmarkCount += 1;
      else bucket.clipCount += 1;
      if (lastUsed > bucket.lastUsed) bucket.lastUsed = lastUsed;
      bucket.display.set(tag, (bucket.display.get(tag) ?? 0) + 1);
      buckets.set(key, bucket);
    }
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.count >= minCount)
    .map((bucket) => ({
      tag: pickDisplay(bucket.display),
      count: bucket.count,
      clipCount: bucket.clipCount,
      bookmarkCount: bucket.bookmarkCount,
      lastUsed: bucket.lastUsed,
    }))
    .sort(compareTagStats)
    .slice(0, limit);
}

/** 展示写法：出现次数最多者优先，次数相同时保留首次出现的写法 */
function pickDisplay(display: Map<string, number>): string {
  let best = '';
  let bestCount = -1;
  for (const [text, count] of display) {
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return best;
}

function compareTagStats(a: TagStat, b: TagStat): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.lastUsed !== b.lastUsed) return b.lastUsed.localeCompare(a.lastUsed);
  return a.tag.localeCompare(b.tag, 'zh');
}

/**
 * 分组：ASCII 字母按大写字母成组；其余（CJK、数字、符号）统一归入 '#'。
 * 组顺序 A-Z 在前，'#' 最后。
 */
export function tagGroups(
  stats: TagStat[],
  options: { maxGroups?: number } = {},
): { letter: string; tags: TagStat[] }[] {
  const maxGroups = options.maxGroups ?? 12;
  const buckets = new Map<string, TagStat[]>();

  for (const stat of stats) {
    const letter = groupKey(stat.tag);
    const bucket = buckets.get(letter);
    if (bucket) bucket.push(stat);
    else buckets.set(letter, [stat]);
  }

  return [...buckets.entries()]
    .map(([letter, tags]) => ({ letter, tags }))
    .sort((a, b) => compareGroupKeys(a.letter, b.letter))
    .slice(0, Math.max(0, maxGroups));
}

function groupKey(tag: string): string {
  const first = tag.trim().charAt(0);
  return /^[a-zA-Z]$/.test(first) ? first.toUpperCase() : '#';
}

function compareGroupKeys(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '#') return 1;
  if (b === '#') return -1;
  return a.localeCompare(b);
}

/** 排序卡片：返回新数组，绝不修改入参 */
export function sortCards<T extends TagCard>(
  cards: T[],
  sort: CardSortKey,
  options: { frequentOrder?: string[] } = {},
): T[] {
  const list = [...cards];
  switch (sort) {
    case 'title':
      return list.sort((a, b) =>
        a.title.localeCompare(b.title, 'zh', { numeric: true }));
    case 'domain':
      return list.sort((a, b) =>
        a.domain.localeCompare(b.domain, 'zh') || a.title.localeCompare(b.title, 'zh', { numeric: true }));
    case 'frequent': {
      const order = new Map<string, number>();
      (options.frequentOrder ?? []).forEach((url, index) => {
        if (!order.has(url)) order.set(url, index);
      });
      return list
        .map((card, index) => ({ card, index }))
        .sort((a, b) => {
          const ai = order.get(a.card.url);
          const bi = order.get(b.card.url);
          if (ai !== undefined && bi !== undefined) return ai - bi;
          if (ai !== undefined) return -1;
          if (bi !== undefined) return 1;
          // 未知 url 保持原有相对顺序，其后按最近使用
          const byRecent = compareRecent(a.card, b.card);
          return byRecent !== 0 ? byRecent : a.index - b.index;
        })
        .map((item) => item.card);
    }
    case 'manual':
      return list;
    case 'recent':
    default:
      return list.sort(compareRecent);
  }
}

/** 最近使用：lastVisited 优先，否则用 clipped；新的在前 */
function compareRecent(a: TagCard, b: TagCard): number {
  return cardLastUsed(b).localeCompare(cardLastUsed(a));
}

function cardLastUsed(card: TagCard): string {
  return card.lastVisited || card.clipped || '';
}

/**
 * 常用书签评分（纯函数、确定性）：
 *   score = (有 lastVisited ? 40 : 0)
 *         + min(revived, 20) * 3            // 回访次数，封顶避免老数据霸榜
 *         + (source === 'bookmark' ? 20 : 0) // 优先浏览器书签
 *         + 域名重复次数 * 4                 // 同站收藏越多说明越常去
 *         + 标签重复次数 * 2                 // 同类主题越多说明越常用
 * 分数相同按标题（zh 排序）稳定破平；返回前 limit 个（默认 12）。
 */
export function pickFrequentBookmarks(
  cards: TagCard[],
  options: { limit?: number; minScore?: number } = {},
): TagCard[] {
  const limit = options.limit ?? 12;
  const minScore = options.minScore ?? 0;

  const domainCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  for (const card of cards) {
    domainCounts.set(card.domain, (domainCounts.get(card.domain) ?? 0) + 1);
    for (const tag of uniqueTags(card.tags)) {
      const key = tag.toLowerCase();
      tagCounts.set(key, (tagCounts.get(key) ?? 0) + 1);
    }
  }

  return cards
    .map((card) => ({ card, score: frequentScore(card, domainCounts, tagCounts) }))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.card.title.localeCompare(b.card.title, 'zh', { numeric: true }))
    .slice(0, Math.max(0, limit))
    .map((item) => item.card);
}

function frequentScore(
  card: TagCard,
  domainCounts: Map<string, number>,
  tagCounts: Map<string, number>,
): number {
  const recency = card.lastVisited ? 40 : 0;
  const revived = Math.min(Math.max(0, card.revived ?? 0), 20) * 3;
  const bookmarkBonus = card.source === 'bookmark' ? 20 : 0;
  const domainScore = (domainCounts.get(card.domain) ?? 0) * 4;
  const tagScore = uniqueTags(card.tags)
    .reduce((sum, tag) => sum + (tagCounts.get(tag.toLowerCase()) ?? 0), 0) * 2;
  return recency + revived + bookmarkBonus + domainScore + tagScore;
}

function uniqueTags(tags: string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))];
}

/** 按域名聚合：先按卡片数降序，再按域名排序 */
export function groupCardsByDomain(
  cards: TagCard[],
  options: { limit?: number } = {},
): { domain: string; count: number; cards: TagCard[] }[] {
  const buckets = new Map<string, TagCard[]>();
  for (const card of cards) {
    const domain = card.domain.trim() || '未知';
    const bucket = buckets.get(domain);
    if (bucket) bucket.push(card);
    else buckets.set(domain, [card]);
  }

  const groups = [...buckets.entries()]
    .map(([domain, group]) => ({ domain, count: group.length, cards: group }))
    .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain, 'zh'));

  return options.limit === undefined ? groups : groups.slice(0, Math.max(0, options.limit));
}
