import { describe, expect, test } from 'vitest';
import {
  REASON_DEFAULT_KEEP,
  REASON_DEFAULT_REMOVE,
  escapeRegExp,
  flattenBookmarks,
  planCleanup,
  shouldKeepBookmark,
  summarizeReasons,
} from './bookmark-cleaner';
import type { BookmarkDecision, BookmarkNodeLike, CleanupPlan } from './bookmark-cleaner';

/** 造一个书签节点（url 型） */
function leaf(id: string, title: string, url: string): BookmarkNodeLike {
  return { id, title, url };
}

/** 造一个文件夹节点 */
function folder(id: string, title: string, children: BookmarkNodeLike[]): BookmarkNodeLike {
  return { id, title, children };
}

/** 单条决策，便于手工拼 CleanupPlan */
function decision(id: string, reason: string, keep = false): BookmarkDecision {
  return { id, title: `t-${id}`, url: `https://${id}.example`, folder: '', keep, reason };
}

describe('flattenBookmarks', () => {
  test('空输入返回空数组', () => {
    expect(flattenBookmarks([])).toEqual([]);
  });

  test('递归拍平嵌套文件夹并记录完整路径', () => {
    const tree: BookmarkNodeLike[] = [
      folder('1', 'Bookmarks Bar', [
        folder('2', 'study', [
          leaf('10', 'Khan Academy', 'https://www.khanacademy.org/'),
          leaf('11', 'Quizlet', 'https://quizlet.com/'),
        ]),
        leaf('12', 'Hacker News', 'https://news.ycombinator.com/'),
      ]),
    ];

    const flat = flattenBookmarks(tree);

    expect(flat.map((item) => item.id)).toEqual(['10', '11', '12']);
    expect(flat.map((item) => item.folder)).toEqual([
      'Bookmarks Bar / study',
      'Bookmarks Bar / study',
      'Bookmarks Bar',
    ]);
    expect(flat[0]).toEqual({
      id: '10',
      title: 'Khan Academy',
      url: 'https://www.khanacademy.org/',
      folder: 'Bookmarks Bar / study',
    });
  });

  test('跳过文件夹节点，只产出带 url 的节点', () => {
    const tree = [folder('1', 'empty-folder', []), folder('2', 'outer', [folder('3', 'inner', [])])];
    expect(flattenBookmarks(tree)).toEqual([]);
  });

  test('容忍缺失 title / url / children，不抛异常', () => {
    const tree: BookmarkNodeLike[] = [
      { id: '1' }, // 无 title、无 url、无 children → 丢弃
      { id: '2', url: 'https://no-title.example/' }, // 无 title
      { id: '3', title: '   ', url: 'https://blank-title.example/' }, // 空白 title
      { id: '4', title: '只有标题没有链接' },
      { id: '5', title: '有子节点但无 url', children: [{ id: '6', url: 'https://nested.example/' }] },
    ];

    const flat = flattenBookmarks(tree);

    expect(flat.map((item) => item.id)).toEqual(['2', '3', '6']);
    expect(flat[0]?.title).toBe('');
    expect(flat[1]?.title).toBe('');
    // 无 url 的节点被当作文件夹，其标题进入子节点的路径
    expect(flat[2]?.folder).toBe('有子节点但无 url');
  });

  test('带 url 的节点不再向下递归（与 bookmarks.ts 行为一致）', () => {
    const tree: BookmarkNodeLike[] = [
      { id: '1', title: '既是链接又是文件夹', url: 'https://both.example/', children: [leaf('2', 'child', 'https://child.example/')] },
    ];
    expect(flattenBookmarks(tree).map((item) => item.id)).toEqual(['1']);
  });
});

/**
 * 保护清单：这些是用户真实在用的升学 / 学业 / 账号资源，必须全部保留。
 * 每条独立断言，避免一条失败掩盖其他条目。
 */
const PROTECTED: [string, string, string][] = [
  ['Naviance', 'Naviance Student', 'https://student.naviance.com/'],
  ['Common App', 'Common App', 'https://www.commonapp.org/'],
  ['使用 Common App 申请大学', '使用 Common App 申请大学', 'https://apply.commonapp.org/'],
  ['Khan Academy SAT', 'Khan Academy | SAT 备考', 'https://www.khanacademy.org/sat'],
  ['Khan Academy Precalculus', 'Khan Academy | Precalculus', 'https://www.khanacademy.org/math/precalculus'],
  ['Quizlet', 'Quizlet', 'https://quizlet.com/latest'],
  ['Studocu', 'Studocu', 'https://www.studocu.com/en-us/'],
  ['Mathway', 'Mathway | Algebra Problem Solver', 'https://www.mathway.com/Algebra'],
  ['Desmos', 'Desmos | Graphing Calculator', 'https://www.desmos.com/calculator'],
  ['TOEFL', 'TOEFL iBT 备考', 'https://www.toefl.com/'],
  ['Scoir', 'Scoir', 'https://www.scoir.com/'],
  ['NoodleTools', 'NoodleTools', 'https://www.noodletools.com/'],
  ['VitalSource Bookshelf', 'VitalSource Bookshelf', 'https://bookshelf.vitalsource.com/'],
  ['BYU tutoring', 'BYU Tutoring', 'https://tutoring.byu.edu/'],
  ['Canvas / Instructure', 'Canvas', 'https://canvas.instructure.com/'],
  ['Pearson / mylabschool', 'myLabSchool', 'https://mylabschool.pearson.com/'],
  ['Google Mail', 'Google Mail', 'https://mail.google.com/'],
  ['iCloud', 'iCloud', 'https://www.icloud.com/'],
  ['OneDrive', 'OneDrive', 'https://onedrive.live.com/'],
  ['Notion', 'Notion', 'https://www.notion.so/'],
  ['Obsidian Publish', 'Obsidian Publish', 'https://publish.obsidian.md/'],
  ['利基大学奖学金', '利基大学奖学金', 'https://www.niche.com/colleges/scholarships/'],
  ['控制面板', '控制面板', 'https://account.microsoft.com/'],
];

describe('shouldKeepBookmark — 保护规则', () => {
  test.each(PROTECTED)('%s 必须保留', (_label, title, url) => {
    const verdict = shouldKeepBookmark({ title, url, folder: '' });
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toContain('保护');
  });

  test(`保护条目共 ${PROTECTED.length} 条，且全部命中保护规则`, () => {
    expect(PROTECTED.length).toBeGreaterThanOrEqual(12);
    const kept = PROTECTED.filter(([, title, url]) => shouldKeepBookmark({ title, url, folder: '' }).keep);
    expect(kept).toHaveLength(PROTECTED.length);
  });

  test('保护信号也可以来自文件夹路径', () => {
    const verdict = shouldKeepBookmark({
      title: '某份资料',
      url: 'https://example.com/whatever',
      folder: 'Bookmarks Bar/school/升学',
    });
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toBe('命中保护：升学/学业资源');
  });

  test('保护优先于删除：标题含「下载」但域名是 naviance.com 仍保留', () => {
    const verdict = shouldKeepBookmark({
      title: 'Naviance 客户端下载',
      url: 'https://student.naviance.com/download',
      folder: 'Bookmarks Bar/下载',
    });
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toBe('命中保护：升学/学业资源');
  });

  test('保护优先于删除：标题含「破解」但域名是 quizlet.com 仍保留', () => {
    const verdict = shouldKeepBookmark({
      title: 'Quizlet 破解版题库',
      url: 'https://quizlet.com/zh-cn',
      folder: '',
    });
    expect(verdict.keep).toBe(true);
    expect(verdict.reason).toBe('命中保护：升学/学业资源');
  });
});

/** 删除清单：真实数据里的低价值站点与关键词 */
const REMOVED: [string, string, string][] = [
  ['macbl', 'macbl 破解软件', 'https://macbl.com/'],
  ['maclub123', 'maclub123', 'https://maclub123.com/'],
  ['macwk', 'MacWk - 精品MAC应用分享', 'https://macwk.com/'],
  ['appstorrent', 'Appstorrent', 'https://appstorrent.ru/'],
  ['cmacked', 'CMacked', 'https://cmacked.com/'],
  ['minorpatch', 'MinorPatch', 'https://minorpatch.com/'],
  ['mac-gm', 'mac-gm', 'https://mac-gm.com/'],
  ['macxzb', 'macxzb 下载站', 'https://macxzb.com/'],
  ['zhiniw', 'zhiniw', 'https://zhiniw.com/'],
  ['macz.com', 'macz', 'https://macz.com/'],
  ['xmac.app', 'xmac', 'https://xmac.app/'],
  ['hanzier', 'hanzier', 'https://hanzier.com/'],
  ['233heji', '233heji', 'https://233heji.com/'],
  ['haitu.tv', '海兔影视', 'https://haitu.tv/'],
  ['sflix', 'Sflix', 'https://sflix.to/'],
  ['target', 'Target : Expect More. Pay Less.', 'https://www.target.com/'],
  ['walmart', 'Walmart.com', 'https://www.walmart.com/'],
  ['ebay', 'eBay', 'https://www.ebay.com/'],
  ['shein', 'SHEIN', 'https://www.shein.com/'],
  ['expedia', 'Expedia', 'https://www.expedia.com/'],
  ['craigslist', 'craigslist', 'https://sfbay.craigslist.org/'],
  ['baidu', '百度一下，你就知道', 'https://www.baidu.com/'],
  ['sogou', '搜狗搜索', 'https://www.sogou.com/'],
  ['so.com', '360搜索', 'https://www.so.com/'],
  ['cn.bing', '必应', 'https://cn.bing.com/'],
  ['baike.baidu', '百度百科', 'https://baike.baidu.com/'],
  ['sina', '新浪首页', 'https://www.sina.com.cn/'],
  ['youtube', 'YouTube', 'https://www.youtube.com/'],
  ['bilibili', '哔哩哔哩 (゜-゜)つロ 干杯~', 'https://www.bilibili.com/'],
  ['spotify', 'Spotify - Web Player', 'https://open.spotify.com/'],
];

const REMOVED_KEYWORDS: [string, string][] = [
  ['破解', '某某软件 破解 版'],
  ['Crack', 'Adobe Photoshop Crack'],
  ['下载', '某工具 下载'],
  ['绿色版', '某某 绿色版'],
  ['全DLC', '某某游戏 全DLC'],
  ['影视', '某某影视'],
  ['影院', '星辰影院'],
  ['壁纸', '高清壁纸站'],
  ['游戏', '某某游戏'],
  ['单机', '单机游戏大全'],
];

describe('shouldKeepBookmark — 删除规则', () => {
  test.each(REMOVED)('%s 必须删除', (_label, title, url) => {
    const verdict = shouldKeepBookmark({ title, url, folder: '' });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toContain('低价值');
  });

  test.each(REMOVED_KEYWORDS)('标题关键词 %s 命中删除规则', (_label, title) => {
    const verdict = shouldKeepBookmark({ title, url: 'https://example.com/page', folder: '' });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toContain('低价值');
  });

  test(`删除条目共 ${REMOVED.length} 条（要求至少 10），且全部被删除`, () => {
    expect(REMOVED.length).toBeGreaterThanOrEqual(10);
    const removed = REMOVED.filter(([, title, url]) => !shouldKeepBookmark({ title, url, folder: '' }).keep);
    expect(removed).toHaveLength(REMOVED.length);
  });

  test('删除信号也可以来自文件夹路径', () => {
    const verdict = shouldKeepBookmark({
      title: '某站点',
      url: 'https://example.com/',
      folder: 'Bookmarks Bar/购物',
    });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toBe('低价值：购物/消费平台');
  });
});

describe('shouldKeepBookmark — 默认分支', () => {
  test('未命中任何规则时默认删除', () => {
    const verdict = shouldKeepBookmark({
      title: '个人博客首页',
      url: 'https://example.com/',
      folder: '杂项',
    });
    expect(verdict.keep).toBe(false);
    expect(verdict.reason).toBe(REASON_DEFAULT_REMOVE);
  });

  test('planCleanup 默认删掉未命中项', () => {
    const plan = planCleanup([leaf('1', '个人博客首页', 'https://example.com/')]);
    expect(plan.remove).toHaveLength(1);
    expect(plan.remove[0]?.reason).toBe(REASON_DEFAULT_REMOVE);
  });

  test('defaultKeep: true 时未命中项改为保留', () => {
    const plan = planCleanup([leaf('1', '个人博客首页', 'https://example.com/')], { defaultKeep: true });
    expect(plan.keep).toHaveLength(1);
    expect(plan.keep[0]?.reason).toBe(REASON_DEFAULT_KEEP);
    expect(plan.remove).toHaveLength(0);
  });

  test('defaultKeep: true 不会拯救显式命中删除规则的条目', () => {
    const plan = planCleanup(
      [
        leaf('1', '个人博客首页', 'https://example.com/'),
        leaf('2', 'MacWk - 精品MAC应用分享', 'https://macwk.com/'),
      ],
      { defaultKeep: true },
    );
    expect(plan.keep.map((item) => item.id)).toEqual(['1']);
    expect(plan.remove.map((item) => item.id)).toEqual(['2']);
    expect(plan.remove[0]?.reason).toBe('低价值：破解软件站');
  });
});

describe('planCleanup — 计划与汇总', () => {
  test('decisions / keep / remove 三视图自洽', () => {
    const plan = planCleanup([
      folder('1', 'Bookmarks Bar', [
        leaf('10', 'Khan Academy', 'https://www.khanacademy.org/'),
        leaf('11', 'MacWk', 'https://macwk.com/'),
      ]),
      leaf('12', '个人博客', 'https://example.com/'),
    ]);

    expect(plan.summary.total).toBe(3);
    expect(plan.summary.kept).toBe(1);
    expect(plan.summary.removed).toBe(2);
    expect(plan.decisions).toHaveLength(3);
    expect(plan.keep).toHaveLength(1);
    expect(plan.remove).toHaveLength(2);
    expect(plan.keep[0]?.id).toBe('10');
    expect(plan.remove.map((item) => item.id)).toEqual(['11', '12']);
    // 每条 decision 都带完整上下文，方便 UI 展示
    expect(plan.keep[0]?.folder).toBe('Bookmarks Bar');
  });

  test('空输入：removedPercent 为 0，且不是 NaN', () => {
    const plan = planCleanup([]);
    expect(plan.decisions).toEqual([]);
    expect(plan.keep).toEqual([]);
    expect(plan.remove).toEqual([]);
    expect(plan.summary).toEqual({ total: 0, kept: 0, removed: 0, removedPercent: 0 });
    expect(Number.isNaN(plan.summary.removedPercent)).toBe(false);
  });

  test('removedPercent 是四舍五入后的整数', () => {
    // 3 条里删 2 条 → 66.67% → 67
    const plan = planCleanup([
      leaf('1', 'Khan Academy', 'https://www.khanacademy.org/'),
      leaf('2', 'MacWk', 'https://macwk.com/'),
      leaf('3', '个人博客', 'https://example.com/'),
    ]);
    expect(plan.summary.removedPercent).toBe(67);
    expect(Number.isInteger(plan.summary.removedPercent)).toBe(true);
  });

  test('全保留与全删除的边界百分比', () => {
    const allKeep = planCleanup([
      leaf('1', 'Khan Academy', 'https://www.khanacademy.org/'),
      leaf('2', 'Quizlet', 'https://quizlet.com/'),
    ]);
    expect(allKeep.summary.removedPercent).toBe(0);
    expect(allKeep.summary.kept).toBe(2);

    const allRemove = planCleanup([
      leaf('1', 'MacWk', 'https://macwk.com/'),
      leaf('2', 'YouTube', 'https://www.youtube.com/'),
    ]);
    expect(allRemove.summary.removedPercent).toBe(100);
    expect(allRemove.summary.removed).toBe(2);
  });

  test('任何规模的输入，removedPercent 都是 0~100 的整数', () => {
    for (let total = 1; total <= 20; total += 1) {
      const nodes = Array.from({ length: total }, (_unused, index) =>
        leaf(String(index), index % 3 === 0 ? 'Khan Academy' : 'MacWk', index % 3 === 0 ? 'https://www.khanacademy.org/' : 'https://macwk.com/'),
      );
      const percent = planCleanup(nodes).summary.removedPercent;
      expect(Number.isInteger(percent)).toBe(true);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
    }
  });
});

describe('summarizeReasons', () => {
  test('按理由归组计数并按数量降序', () => {
    const plan: CleanupPlan = {
      decisions: [],
      keep: [],
      remove: [
        decision('a', '低价值：破解软件站'),
        decision('b', '低价值：破解软件站'),
        decision('c', '低价值：破解软件站'),
        decision('d', '低价值：购物/消费平台'),
        decision('e', '低价值：购物/消费平台'),
        decision('f', REASON_DEFAULT_REMOVE),
      ],
      summary: { total: 6, kept: 0, removed: 6, removedPercent: 100 },
    };

    expect(summarizeReasons(plan)).toEqual([
      { reason: '低价值：破解软件站', count: 3 },
      { reason: '低价值：购物/消费平台', count: 2 },
      { reason: REASON_DEFAULT_REMOVE, count: 1 },
    ]);
  });

  test('数量相同时按理由稳定排序，不依赖插入顺序', () => {
    const plan: CleanupPlan = {
      decisions: [],
      keep: [],
      remove: [decision('a', '低价值：影视/流媒体站'), decision('b', '低价值：破解软件站')],
      summary: { total: 2, kept: 0, removed: 2, removedPercent: 100 },
    };
    const first = summarizeReasons(plan);
    const second = summarizeReasons({ ...plan, remove: [...plan.remove].reverse() });
    expect(first).toEqual(second);
    expect(first.map((entry) => entry.count)).toEqual([1, 1]);
  });

  test('只看删除项，保留项不计入', () => {
    const plan = planCleanup([
      leaf('1', 'Khan Academy', 'https://www.khanacademy.org/'),
      leaf('2', 'MacWk', 'https://macwk.com/'),
    ]);
    const reasons = summarizeReasons(plan);
    expect(reasons).toEqual([{ reason: '低价值：破解软件站', count: 1 }]);
  });

  test('没有删除项时返回空数组', () => {
    expect(summarizeReasons(planCleanup([]))).toEqual([]);
  });
});

describe('escapeRegExp / 正则元字符', () => {
  test('转义所有正则元字符', () => {
    expect(escapeRegExp('foo.bar')).toBe('foo\\.bar');
    expect(escapeRegExp('a+b(c)[d]{e}^$|\\')).toBe('a\\+b\\(c\\)\\[d\\]\\{e\\}\\^\\$\\|\\\\');
  });

  test('含 . 的域名按字面量匹配：macz.com 命中，maczXcom.com 不命中', () => {
    expect(shouldKeepBookmark({ title: 'macz', url: 'https://macz.com/', folder: '' }).reason).toBe(
      '低价值：破解软件站',
    );
    // 若 '.' 未转义，这里会被当成通配符而误删
    expect(shouldKeepBookmark({ title: 'macz', url: 'https://maczxcom.com/', folder: '' }).reason).toBe(
      REASON_DEFAULT_REMOVE,
    );
  });

  test('域名 foo.bar 不会抛异常，并按默认规则处理', () => {
    expect(() => shouldKeepBookmark({ title: '某页面', url: 'https://foo.bar/page', folder: '' })).not.toThrow();
    const verdict = shouldKeepBookmark({ title: '某页面', url: 'https://foo.bar/page', folder: '' });
    expect(verdict).toEqual({ keep: false, reason: REASON_DEFAULT_REMOVE });
  });

  test('URL 含特殊字符 / 非法 URL 都不抛异常', () => {
    const weird = [
      'https://example.com/?q=a+b&x=[1]&y=(2)',
      'https://example.com/a|b^c$d',
      'not a url at all',
      '',
      '   ',
    ];
    for (const url of weird) {
      expect(() => shouldKeepBookmark({ title: '标题', url, folder: '' })).not.toThrow();
    }
  });

  test('ASCII 词按词边界匹配，不会误伤包含该子串的正常域名', () => {
    // sat 不应命中 saturday.com；sina 不应命中 cosina.example
    expect(shouldKeepBookmark({ title: '周末计划', url: 'https://saturday.com/', folder: '' }).reason).toBe(
      REASON_DEFAULT_REMOVE,
    );
    expect(shouldKeepBookmark({ title: '某站点', url: 'https://cosina.example/', folder: '' }).reason).toBe(
      REASON_DEFAULT_REMOVE,
    );
  });
});
