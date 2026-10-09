import { describe, expect, test } from 'vitest';
import {
  categorize,
  curateBookmarks,
  curationSummary,
  normalizeCuratorUrl,
  scoreBookmark,
} from './curator';
import type {
  CuratedBookmark,
  CuratedCategory,
  CuratedCategoryId,
  CuratorInput,
} from './curator';

/** 固定参考时间，避免「最近访问」随真实时钟漂移导致用例不稳定 */
const NOW = new Date('2026-09-24T00:00:00.000Z');

/** 生成相对 NOW 的 ISO 时间串 */
function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

/** 默认一条「正常」的剪藏书签，用例只覆盖关心的字段 */
function bookmark(overrides: Partial<CuratorInput> = {}): CuratorInput {
  return {
    url: 'https://example.com/a',
    title: '一份普通但可读的标题',
    domain: 'example.com',
    source: 'clip',
    ...overrides,
  };
}

/** 已清洗书签（用于 curationSummary 这类只关心结构的用例） */
function curated(overrides: Partial<CuratedBookmark> = {}): CuratedBookmark {
  return {
    ...bookmark(),
    score: 50,
    category: 'other',
    reasons: [],
    ...overrides,
  };
}

function category(id: CuratedCategoryId, count: number): CuratedCategory {
  return {
    id,
    label: id,
    items: Array.from({ length: count }, () => curated({ category: id })),
  };
}

/** 汇总所有类目下的条目数 */
function totalItems(groups: CuratedCategory[]): number {
  return groups.reduce((sum, group) => sum + group.items.length, 0);
}

describe('normalizeCuratorUrl', () => {
  test('去掉 hash 片段', () => {
    expect(normalizeCuratorUrl('https://example.com/a#section')).toBe('https://example.com/a');
    expect(normalizeCuratorUrl('https://example.com/a#')).toBe('https://example.com/a');
  });

  test('去掉追踪参数但保留有意义的参数', () => {
    expect(normalizeCuratorUrl('https://example.com/?q=hello&fbclid=abc&ref=xyz&gclid=1&spm=a.b'))
      .toBe('https://example.com?q=hello');
    expect(normalizeCuratorUrl('https://example.com/a/?utm_source=x&utm_medium=y&id=3'))
      .toBe('https://example.com/a?id=3');
    expect(normalizeCuratorUrl('https://example.com/a?_t=9&scene=1&share_id=5&source=s'))
      .toBe('https://example.com/a');
  });

  test('去掉路径末尾斜杠', () => {
    expect(normalizeCuratorUrl('https://example.com/a/')).toBe('https://example.com/a');
    expect(normalizeCuratorUrl('https://example.com/a///')).toBe('https://example.com/a');
    expect(normalizeCuratorUrl('https://example.com/')).toBe('https://example.com');
  });

  test('结果统一小写', () => {
    expect(normalizeCuratorUrl('HTTPS://Example.COM/Path/')).toBe('https://example.com/path');
    expect(normalizeCuratorUrl('https://example.com/a?q=Hello')).toBe('https://example.com/a?q=hello');
  });

  test('去掉首尾空白', () => {
    expect(normalizeCuratorUrl('  https://Example.com/Path/  ')).toBe('https://example.com/path');
  });

  test('非法 URL 返回小写去空白的回退值且不抛错', () => {
    expect(normalizeCuratorUrl('not a url')).toBe('not a url');
    expect(normalizeCuratorUrl('  Not A URL  ')).toBe('not a url');
    expect(normalizeCuratorUrl('example.com')).toBe('example.com');
    expect(normalizeCuratorUrl('')).toBe('');
    // ftp 不是 http(s)，但 URL 可解析，因此原样归一化而不是走 catch
    expect(normalizeCuratorUrl('ftp://example.com/a')).toBe('ftp://example.com/a');
  });

  test('只删真正的追踪参数，同前缀的合法参数（refresh/fromage/sources）保留', () => {
    // 修复前：/^(utm_|ref|spm|from|...)/ 无词边界，refresh 撞 ref、fromage 撞 from 被误删。
    // 现在改为「精确名集合 + 前缀集合」判断，这三个都应保留。
    expect(normalizeCuratorUrl('https://example.com/a?refresh=1&fromage=2&sources=keep'))
      .toBe('https://example.com/a?refresh=1&fromage=2&sources=keep');
  });

  test('仍然会删掉真正的追踪参数', () => {
    expect(normalizeCuratorUrl('https://example.com/a?utm_source=x&ref=y&spm=z&fbclid=q&id=3'))
      .toBe('https://example.com/a?id=3');
  });
});

describe('scoreBookmark', () => {
  test('最近访问 + 备注 + 标签的剪藏远高于从未访问、无标题的导入书签', () => {
    const rich = scoreBookmark(bookmark({
      lastVisited: daysAgo(1),
      why: '当时在写方案',
      tags: ['a', 'b', 'c', 'd'],
    }), NOW);
    const poor = scoreBookmark({
      url: 'https://imported.example/x',
      title: '',
      domain: 'imported.example',
      source: 'bookmark',
    }, NOW);

    // 60（一周内）+ 18（剪藏）+ 12（备注）+ 8（标签）+ 4（标题质量）
    expect(rich.score).toBe(102);
    // -12（空标题）
    expect(poor.score).toBe(-12);
    expect(rich.score).toBeGreaterThan(poor.score);
  });

  test('时效分层：7 天内 > 30 天内 > 90 天内', () => {
    const week = scoreBookmark(bookmark({ lastVisited: daysAgo(3) }), NOW);
    const month = scoreBookmark(bookmark({ lastVisited: daysAgo(30) }), NOW);
    const quarter = scoreBookmark(bookmark({ lastVisited: daysAgo(90) }), NOW);

    expect(week.score).toBe(82);
    expect(month.score).toBe(62);
    expect(quarter.score).toBe(44);
    expect(week.score).toBeGreaterThan(month.score);
    expect(month.score).toBeGreaterThan(quarter.score);
  });

  test('revived 计数加分且封顶', () => {
    const few = scoreBookmark(bookmark({ revived: 3 }), NOW);
    const many = scoreBookmark(bookmark({ revived: 100 }), NOW);
    const four = scoreBookmark(bookmark({ revived: 4 }), NOW);

    expect(few.score).toBe(40);
    expect(many.score).toBe(46);
    // 4 次即达到上限 24 分，100 次不会无限拉高
    expect(four.score).toBe(46);
    expect(many.score - few.score).toBe(6);
  });

  test('revived 为 0 / 缺省时不加分', () => {
    expect(scoreBookmark(bookmark({ revived: 0 }), NOW).score).toBe(22);
    expect(scoreBookmark(bookmark(), NOW).score).toBe(22);
  });

  test('source 为 clip 时高于 bookmark（其余相同）', () => {
    const clip = scoreBookmark(bookmark({ source: 'clip' }), NOW);
    const imported = scoreBookmark(bookmark({ source: 'bookmark' }), NOW);
    expect(clip.score - imported.score).toBe(18);
  });

  test('why 备注加分', () => {
    const withWhy = scoreBookmark(bookmark({ why: '留着做参考' }), NOW);
    const without = scoreBookmark(bookmark(), NOW);
    expect(withWhy.score - without.score).toBe(12);
    expect(withWhy.reasons).toContain('写过备注');
    // 纯空白不算备注
    expect(scoreBookmark(bookmark({ why: '   ' }), NOW).score).toBe(without.score);
  });

  test('噪声标题低于正常描述性标题', () => {
    const normal = scoreBookmark(bookmark({ title: '一篇值得保留的文章' }), NOW);
    const noiseTitles = ['登录', '404 Not Found', '新标签页', 'https://example.com/a', 'Untitled'];
    for (const title of noiseTitles) {
      expect(scoreBookmark(bookmark({ title }), NOW).score).toBeLessThan(normal.score);
    }
    // 标题与域名相同按「无标题」处理，也比正常标题低
    expect(scoreBookmark(bookmark({ title: 'example.com' }), NOW).score).toBeLessThan(normal.score);
    // 空标题同样更低
    expect(scoreBookmark(bookmark({ title: '' }), NOW).score).toBeLessThan(normal.score);
  });

  test('reasons 是数组，且最近访问会产生含时效说明的原因', () => {
    const recent = scoreBookmark(bookmark({ lastVisited: daysAgo(2) }), NOW);
    expect(Array.isArray(recent.reasons)).toBe(true);
    expect(recent.reasons.some((reason) => reason.includes('最近一周'))).toBe(true);

    const older = scoreBookmark(bookmark({ lastVisited: daysAgo(200) }), NOW);
    expect(older.reasons.some((reason) => reason.includes('一年内'))).toBe(true);

    // source 默认视为 clip，因此「无访问 + 导入」才会完全无理由
    const none = scoreBookmark({
      url: 'https://x.com/1',
      title: '标题',
      domain: 'x.com',
      source: 'bookmark',
    }, NOW);
    expect(none.reasons).toEqual([]);
  });

  test('没有 lastVisited 也没有 revived 仍返回有限数字', () => {
    const result = scoreBookmark({
      url: 'https://x.com/1',
      title: '正常标题',
      domain: 'x.com',
      source: 'bookmark',
    }, NOW);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(Number.isNaN(result.score)).toBe(false);
  });

  test('非法时间串按未访问处理', () => {
    const result = scoreBookmark(bookmark({ lastVisited: 'not-a-date', clipped: 'bad' }), NOW);
    expect(result.score).toBe(22);
    expect(result.reasons).toEqual(['亲手剪藏']);
  });

  test('收录超过一年且从未访问会扣分', () => {
    const old = scoreBookmark(bookmark({ clipped: daysAgo(400) }), NOW);
    const fresh = scoreBookmark(bookmark({ clipped: daysAgo(10) }), NOW);
    expect(old.score).toBe(14);
    expect(fresh.score).toBe(22);
    expect(old.reasons).toContain('收录超过一年未访问');
  });

  test('文件夹深度：浅层加分、深层扣分', () => {
    const shallow = scoreBookmark(bookmark({ folder: '收藏夹栏' }), NOW);
    const middle = scoreBookmark(bookmark({ folder: 'A/B' }), NOW);
    const deep = scoreBookmark(bookmark({ folder: 'A/B/C' }), NOW);
    expect(shallow.score).toBe(28);
    expect(middle.score).toBe(22);
    expect(deep.score).toBe(19);
  });
});

describe('categorize', () => {
  test('已知域名映射到对应主类', () => {
    expect(categorize(bookmark({ domain: 'github.com' }))).toBe('dev');
    expect(categorize(bookmark({ domain: 'figma.com' }))).toBe('design');
    expect(categorize(bookmark({ domain: 'openai.com' }))).toBe('ai');
    expect(categorize(bookmark({ domain: 'bilibili.com' }))).toBe('media');
    expect(categorize(bookmark({ domain: 'taobao.com' }))).toBe('life');
  });

  test('子域名命中已知主域', () => {
    expect(categorize(bookmark({ domain: 'gist.github.com' }))).toBe('dev');
    expect(categorize(bookmark({ domain: 'foo.github.com' }))).toBe('dev');
    expect(categorize(bookmark({ domain: 'mail.taobao.com' }))).toBe('life');
  });

  test('www. 前缀被剥离后再匹配', () => {
    expect(categorize(bookmark({ domain: 'www.figma.com' }))).toBe('design');
    expect(categorize(bookmark({ domain: 'WWW.FIGMA.COM' }))).toBe('design');
  });

  test('未知域名走关键词回退', () => {
    expect(categorize(bookmark({ domain: 'unknown.example', title: '教程与文档' }))).toBe('learn');
    expect(categorize(bookmark({ domain: 'unknown.example', title: '设计灵感收集' }))).toBe('design');
    expect(categorize(bookmark({ domain: 'unknown.example', title: '随便什么内容' }))).toBe('other');
  });

  test('关键词按固定优先级匹配，dev 先于 learn', () => {
    // 观察：KEYWORD_CATEGORY 自上而下取首个命中，dev 排在 learn 之前，
    // 所以同时含「框架」与「教程」的标题会归到 dev 而不是 learn。如实记录实现现状。
    expect(categorize(bookmark({ domain: 'unknown.example', title: '某框架教程' }))).toBe('dev');
  });

  test('关键词回退也会看标签、文件夹与摘要', () => {
    expect(categorize(bookmark({ domain: 'unknown.example', title: 'x', tags: ['教程'] }))).toBe('learn');
    expect(categorize(bookmark({ domain: 'unknown.example', title: 'x', folder: '开发/前端' }))).toBe('dev');
    expect(categorize(bookmark({ domain: 'unknown.example', title: 'x', summary: '一段视频合集' }))).toBe('media');
  });

  test('什么都没命中时返回 other', () => {
    expect(categorize(bookmark({ domain: 'unknown.example', title: 'x' }))).toBe('other');
    expect(categorize(bookmark({ domain: 'unknown.example', title: '' }))).toBe('other');
    // notgithub.com 不满足 `.github.com` 后缀，也不会误判为 dev
    expect(categorize(bookmark({ domain: 'notgithub.com', title: 'x' }))).toBe('other');
  });

  test('英文短词按词边界匹配，不会因 email/build 等子串误伤', () => {
    // 修复前：ai 用 includes 匹配，"email client" 因含子串 "ai" 被判为 AI 类。
    // 现在 ASCII 关键词走词边界正则，email / build 不再误命中 ai / ui。
    expect(categorize(bookmark({ domain: 'mail.example', title: 'email client' }))).toBe('other');
    expect(categorize(bookmark({ domain: 'site.example', title: 'build a house' }))).toBe('other');
    // 真正的 AI 仍然能命中
    expect(categorize(bookmark({ domain: 'x.example', title: 'AI 绘画工具' }))).toBe('ai');
    expect(categorize(bookmark({ domain: 'x.example', title: 'GPT 使用技巧' }))).toBe('ai');
  });
});

describe('curateBookmarks', () => {
  test('默认只保留约 10%', () => {
    const items: CuratorInput[] = [
      ...Array.from({ length: 10 }, (_, index) => bookmark({
        url: `https://example.com/keep-${index}`,
        title: `重要书签 ${index}`,
        lastVisited: daysAgo(1),
      })),
      ...Array.from({ length: 90 }, (_, index) => bookmark({
        url: `https://example.com/drop-${index}`,
        title: `普通书签 ${index}`,
      })),
    ];
    const groups = curateBookmarks(items, { now: NOW });
    // ceil(100 * 0.1) = 10
    expect(totalItems(groups)).toBe(10);
    // 保留下来的必须都是高分那批
    for (const group of groups) {
      for (const item of group.items) {
        expect(item.url).toContain('/keep-');
        expect(item.score).toBe(82);
      }
    }
  });

  test('保留数量遵循 ceil(N * keepRatio)', () => {
    const make = (count: number): CuratorInput[] =>
      Array.from({ length: count }, (_, index) =>
        bookmark({ url: `https://example.com/p-${count}-${index}`, title: `页面 ${index}` }));
    expect(totalItems(curateBookmarks(make(20), { now: NOW }))).toBe(2);
    expect(totalItems(curateBookmarks(make(11), { now: NOW }))).toBe(2);
    expect(totalItems(curateBookmarks(make(10), { now: NOW }))).toBe(1);
    expect(totalItems(curateBookmarks(make(99), { now: NOW }))).toBe(10);
    expect(totalItems(curateBookmarks(make(101), { now: NOW }))).toBe(11);
  });

  test('极小输入也至少保留 1 条', () => {
    const three: CuratorInput[] = [
      bookmark({ url: 'https://example.com/1', title: '页面一' }),
      bookmark({ url: 'https://example.com/2', title: '页面二' }),
      bookmark({ url: 'https://example.com/3', title: '页面三' }),
    ];
    expect(totalItems(curateBookmarks(three, { now: NOW }))).toBe(1);
    expect(totalItems(curateBookmarks([bookmark()], { now: NOW }))).toBe(1);
  });

  test('空输入返回空数组', () => {
    expect(curateBookmarks([], { now: NOW })).toEqual([]);
  });

  test('返回条目数不超过 maxItems', () => {
    const items = Array.from({ length: 50 }, (_, index) =>
      bookmark({ url: `https://example.com/m-${index}`, title: `页面 ${index}` }));
    const groups = curateBookmarks(items, { keepRatio: 1, maxItems: 5, now: NOW });
    expect(totalItems(groups)).toBe(5);
  });

  test('maxItems 为 0 时仍会保留 1 条（下限覆盖了上限）', () => {
    // 观察：keep = Math.max(1, Math.min(byRatio, maxItems, all.length))，
    // 因此 maxItems=0 实际仍返回 1 条，严格来说突破了「不超过 maxItems」的约定。
    // 属于实现现状，测试如实记录，不修改源码。
    const items = Array.from({ length: 10 }, (_, index) =>
      bookmark({ url: `https://example.com/z-${index}`, title: `页面 ${index}` }));
    expect(totalItems(curateBookmarks(items, { keepRatio: 1, maxItems: 0, now: NOW }))).toBe(1);
  });

  test('perCategory 限制每类条数', () => {
    const devItems = Array.from({ length: 5 }, (_, index) => bookmark({
      url: `https://github.com/org/repo-${index}`,
      title: `代码仓库 ${index}`,
      domain: 'github.com',
      lastVisited: daysAgo(index + 1),
    }));
    const designItems = Array.from({ length: 5 }, (_, index) => bookmark({
      url: `https://figma.com/file/${index}`,
      title: `设计稿件 ${index}`,
      domain: 'figma.com',
      lastVisited: daysAgo(index + 1),
    }));

    const groups = curateBookmarks([...devItems, ...designItems], {
      keepRatio: 1,
      maxItems: 100,
      perCategory: 2,
      now: NOW,
    });

    const dev = groups.find((group) => group.id === 'dev');
    const design = groups.find((group) => group.id === 'design');
    expect(dev?.items).toHaveLength(2);
    expect(design?.items).toHaveLength(2);
  });

  test('结果按类分组，且每个返回的类都非空', () => {
    const groups = curateBookmarks([
      bookmark({ url: 'https://github.com/a', domain: 'github.com', title: '代码仓库' }),
      bookmark({ url: 'https://openai.com/a', domain: 'openai.com', title: 'AI 平台' }),
      bookmark({ url: 'https://unknown.example/a', domain: 'unknown.example', title: '随便页面' }),
    ], { keepRatio: 1, maxItems: 100, now: NOW });

    expect(groups.length).toBeGreaterThan(0);
    for (const group of groups) {
      expect(group.items.length).toBeGreaterThan(0);
      for (const item of group.items) {
        expect(item.category).toBe(group.id);
      }
    }
    // 没有重复类目
    const ids = groups.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('类目按模块固定的展示顺序出现', () => {
    const groups = curateBookmarks([
      bookmark({ url: 'https://taobao.com/a', domain: 'taobao.com', title: '购物页面' }),
      bookmark({ url: 'https://bilibili.com/a', domain: 'bilibili.com', title: '视频内容' }),
      bookmark({ url: 'https://zhihu.com/a', domain: 'zhihu.com', title: '学习问答' }),
      bookmark({ url: 'https://notion.so/a', domain: 'notion.so', title: '工具页面' }),
      bookmark({ url: 'https://figma.com/a', domain: 'figma.com', title: '设计文件' }),
      bookmark({ url: 'https://github.com/a', domain: 'github.com', title: '代码仓库' }),
      bookmark({ url: 'https://openai.com/a', domain: 'openai.com', title: 'AI 平台' }),
      bookmark({ url: 'https://unknown.example/a', domain: 'unknown.example', title: '随便页面' }),
    ], { keepRatio: 1, maxItems: 100, now: NOW });

    expect(groups.map((group) => group.id)).toEqual([
      'ai',
      'dev',
      'design',
      'tools',
      'learn',
      'media',
      'life',
      'other',
    ]);
  });

  test('同一类目内按分数降序', () => {
    const groups = curateBookmarks([
      bookmark({ url: 'https://github.com/1', domain: 'github.com', title: '代码仓库 1', lastVisited: daysAgo(1) }),
      bookmark({ url: 'https://github.com/2', domain: 'github.com', title: '代码仓库 2', lastVisited: daysAgo(30) }),
      bookmark({ url: 'https://github.com/3', domain: 'github.com', title: '代码仓库 3', lastVisited: daysAgo(90) }),
    ], { keepRatio: 1, maxItems: 100, now: NOW });

    const dev = groups.find((group) => group.id === 'dev');
    expect(dev?.items.map((item) => item.score)).toEqual([82, 62, 44]);
  });

  test('重复 URL 折叠为一条，保留分数更高的那份', () => {
    const groups = curateBookmarks([
      bookmark({ url: 'https://example.com/a', title: '低分重复项' }),
      bookmark({ url: 'https://example.com/a/?utm_source=x', title: '高分重复项', lastVisited: daysAgo(1) }),
      bookmark({ url: 'https://example.com/a#section', title: '另一个重复项', tags: ['x'] }),
    ], { keepRatio: 1, maxItems: 100, now: NOW });

    expect(totalItems(groups)).toBe(1);
    expect(groups[0].items[0].title).toBe('高分重复项');
    // 折叠后仍保留原始 URL，而不是归一化后的 key
    expect(groups[0].items[0].url).toBe('https://example.com/a/?utm_source=x');
  });

  test('非 http(s) 或空 URL 被丢弃', () => {
    const groups = curateBookmarks([
      bookmark({ url: 'javascript:alert(1)', title: '脚本页面' }),
      bookmark({ url: 'ftp://example.com/a', title: 'FTP 资源' }),
      bookmark({ url: '', title: '空 URL 页面' }),
      bookmark({ url: 'https://example.com/ok', title: '正常页面' }),
    ], { keepRatio: 1, maxItems: 100, now: NOW });

    expect(totalItems(groups)).toBe(1);
    expect(groups[0].items[0].url).toBe('https://example.com/ok');
  });

  test('keepRatio 被钳制：0 或负数仍保留，5 不会超过全部', () => {
    const fifty = Array.from({ length: 50 }, (_, index) =>
      bookmark({ url: `https://example.com/k-${index}`, title: `页面 ${index}` }));
    const twenty = Array.from({ length: 20 }, (_, index) =>
      bookmark({ url: `https://example.com/j-${index}`, title: `页面 ${index}` }));
    // 放宽上限，单独验证 keepRatio 本身的钳制（否则会被 perCategory / maxItems 截断）
    const wide = { maxItems: 1000, perCategory: 1000, now: NOW };

    // 下限 0.01：ceil(50 * 0.01) = 1
    expect(totalItems(curateBookmarks(fifty, { keepRatio: 0, ...wide }))).toBe(1);
    expect(totalItems(curateBookmarks(fifty, { keepRatio: -3, ...wide }))).toBe(1);
    // 上限 1：20 条全部保留
    expect(totalItems(curateBookmarks(twenty, { keepRatio: 5, ...wide }))).toBe(20);
    // 非有限值回退到默认 0.1
    expect(totalItems(curateBookmarks(twenty, { keepRatio: Number.NaN, ...wide }))).toBe(2);
  });

  test('minScore 过滤低分项', () => {
    const groups = curateBookmarks([
      bookmark({ url: 'https://example.com/hot', title: '热门页面', lastVisited: daysAgo(1) }),
      bookmark({ url: 'https://example.com/cold', title: '冷门页面' }),
    ], { keepRatio: 1, maxItems: 100, minScore: 50, now: NOW });

    expect(totalItems(groups)).toBe(1);
    expect(groups[0].items[0].url).toBe('https://example.com/hot');
  });

  test('不修改入参数组', () => {
    const items = [
      bookmark({ url: 'https://example.com/b', title: '页面 B' }),
      bookmark({ url: 'https://example.com/a', title: '页面 A' }),
    ];
    const snapshot = [...items];
    curateBookmarks(items, { keepRatio: 1, maxItems: 100, now: NOW });
    expect(items).toEqual(snapshot);
  });

  test('与 curationSummary 组合得到 90% 移除率', () => {
    const items: CuratorInput[] = [
      ...Array.from({ length: 10 }, (_, index) => bookmark({
        url: `https://example.com/keep-${index}`,
        title: `重要书签 ${index}`,
        lastVisited: daysAgo(1),
      })),
      ...Array.from({ length: 90 }, (_, index) => bookmark({
        url: `https://example.com/drop-${index}`,
        title: `普通书签 ${index}`,
      })),
    ];
    const summary = curationSummary(items.length, curateBookmarks(items, { now: NOW }));
    expect(summary).toEqual({ total: 100, kept: 10, removed: 90, removedPercent: 90 });
  });
});

describe('curationSummary', () => {
  test('已知用例的 kept / removed / removedPercent', () => {
    const summary = curationSummary(10, [
      category('dev', 3),
      category('ai', 1),
    ]);
    expect(summary).toEqual({ total: 10, kept: 4, removed: 6, removedPercent: 60 });
  });

  test('空输入不做除零运算', () => {
    expect(curationSummary(0, [])).toEqual({
      total: 0,
      kept: 0,
      removed: 0,
      removedPercent: 0,
    });
  });

  test('total 为 0 但仍有条目时 removed 不为负', () => {
    expect(curationSummary(0, [category('other', 1)])).toEqual({
      total: 0,
      kept: 1,
      removed: 0,
      removedPercent: 0,
    });
  });

  test('kept 超过 total 时 removed 归零', () => {
    expect(curationSummary(2, [category('dev', 5)])).toEqual({
      total: 2,
      kept: 5,
      removed: 0,
      removedPercent: 0,
    });
  });

  test('removedPercent 四舍五入到整数', () => {
    // 3 条里保留 2 条 → 33.33% → 33
    expect(curationSummary(3, [category('dev', 2)]).removedPercent).toBe(33);
    // 3 条里保留 1 条 → 66.67% → 67
    expect(curationSummary(3, [category('dev', 1)]).removedPercent).toBe(67);
  });
});
