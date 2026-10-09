/**
 * 书签清理决策层（纯函数）。
 *
 * 真实数据背景：用户浏览器里约 151 条书签，绝大多数再也不会打开，
 * 但 Chrome 对这批书签的 `date_last_used` 全是 "0"——也就是**没有任何使用历史**。
 * 因此「最近是否访问过」在这里完全不可用，只能靠**内容特征**（域名 / 标题 / 所在文件夹）判断。
 *
 * 本模块只负责「留哪条、删哪条」的纯决策，方便单测；
 * 真正的 `chrome.bookmarks.remove()` 由调用方执行（本文件不碰 chrome.*，也不碰 DOM）。
 *
 * 两条设计原则：
 *   1. **保护优先**：保护规则先跑，命中即保留，即使同时命中删除规则
 *      （例如标题里带「下载」但域名是 naviance.com 的升学资源）。
 *   2. **默认清理**：没命中任何规则的走默认分支，默认是「删」——用户明确要求激进清理（~95%）。
 *      调用方可用 `planCleanup(nodes, { defaultKeep: true })` 切到保守模式。
 */

/** Chrome bookmarks API 的节点最小结构（文件夹只有 children，书签才有 url） */
export interface BookmarkNodeLike {
  id: string;
  title?: string;
  url?: string;
  children?: BookmarkNodeLike[];
}

/** 拍平后的书签（文件夹已折算成路径字符串） */
export interface FlatBookmark {
  id: string;
  title: string;
  url: string;
  folder: string;
}

/** 单条书签的处置决定 */
export interface BookmarkDecision {
  id: string;
  title: string;
  url: string;
  folder: string;
  /** "Bookmarks Bar/study" 风格的文件夹路径 */
  keep: boolean;
  /** 人类可读的中文理由，用于 UI 展示 */
  reason: string;
}

/** 一次清理的完整计划 */
export interface CleanupPlan {
  decisions: BookmarkDecision[];
  keep: BookmarkDecision[];
  remove: BookmarkDecision[];
  summary: {
    total: number;
    kept: number;
    removed: number;
    removedPercent: number;
  };
}

export interface CleanupOptions {
  /** 未命中任何规则时是否保留。默认 false（激进清理），传 true 则切到保守模式 */
  defaultKeep?: boolean;
}

/** 未命中保护规则、按默认策略删除 */
export const REASON_DEFAULT_REMOVE = '未命中保护规则（默认清理）';
/** 未命中任何规则、按保守策略保留 */
export const REASON_DEFAULT_KEEP = '未命中清理规则（保守保留）';

interface Rule {
  /** 命中该规则时给出的中文理由 */
  reason: string;
  words: string[];
  /** 预编译匹配器（无 /g，可安全复用 test()） */
  matcher: RegExp;
}

/** 纯 ASCII 词用词边界匹配；中文/含空格词没有词边界概念，直接子串匹配 */
const ASCII_TOKEN = /^[a-z0-9][a-z0-9.+#-]*$/i;

/**
 * 转义正则元字符。
 * 域名里的 `.` 必须转义，否则 `macz.com` 会连 `mac-z.com` 一起命中。
 */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 由字面量数组拼出匹配器。
 *
 * 注意：JS 没有 `re.VERBOSE`，正则字面量里的空格和换行都是**有效字符**，
 * 所以这里绝不把规则写成多行缩进的正则字面量，而是用数组 + escapeRegExp 拼接，
 * 保证「词表」就是唯一的真相来源。
 */
function buildMatcher(words: string[]): RegExp {
  const parts = words.map((word) => {
    const escaped = escapeRegExp(word);
    // ASCII 词加非字母数字边界，避免 sat 命中 saturday、sina 命中 cosina
    return ASCII_TOKEN.test(word) ? `(^|[^a-z0-9])${escaped}(?=[^a-z0-9]|$)` : escaped;
  });
  return new RegExp(parts.join('|'), 'i');
}

function rule(reason: string, words: string[]): Rule {
  return { reason, words, matcher: buildMatcher(words) };
}

/**
 * 保护规则（按顺序匹配，先命中先算）。
 * 这些是用户真正在用的升学 / 学业 / 账号资源，宁可错留不可错删。
 */
const PROTECTION_RULES: Rule[] = [
  rule('命中保护：升学/学业资源', [
    // 美国大学申请与升学辅导
    'naviance',
    'commonapp',
    'common app',
    'scoir',
    'noodletools',
    'collegeboard',
    '奖学金',
    '升学',
    '申请大学',
    '大学申请',
    '大学',
    '学院',
    '学校',
    '学业',
    // 学业工具与题库
    'khanacademy',
    'khan academy',
    'quizlet',
    'studocu',
    'mathway',
    'desmos',
    'toefl',
    'precalculus',
    'sat',
    '备考',
    '考试',
    '作业',
    '课程',
    '图书馆',
    '学费',
    // 教材与教学平台
    'vitalsource',
    'byu',
    'canvas',
    'instructure',
    'pearson',
    'mylabschool',
    '教育',
  ]),
  rule('命中保护：账号与云服务', [
    'mail.google',
    'gmail',
    'icloud',
    'onedrive',
    'notion',
    'obsidian',
  ]),
  rule('命中保护：常用系统入口', ['控制面板']),
  // 内网 / 本机 / 自建服务：这些是用户自己部署的东西，域名规则永远匹配不到，
  // 但价值极高（用户自己部署的看板/服务一旦被清掉是不可恢复的）。
  rule('命中保护：内网/自建服务', [
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '.local',
    '.lan',
    '.internal',
    '.home',
    '.ts.net',      // Tailscale
    '192.168.',
    '10.0.',
    '10.1.',
    '172.16.',
    '172.17.',
    '172.18.',
    '172.19.',
    '172.2',
    '172.30.',
    '172.31.',
    'tailscale',
    '内网',
    '局域网',
    '自建',
  ]),
];

/**
 * 删除规则（保护规则之后才跑）。
 * 覆盖用户列出的真实垃圾站：破解软件站、影视站、购物、重复搜索引擎、随手可搜回的视频音乐。
 */
const DELETION_RULES: Rule[] = [
  rule('低价值：破解软件站', [
    'macbl',
    'maclub123',
    'macwk',
    'appstorrent',
    'cmacked',
    'minorpatch',
    'mac-gm',
    'macxzb',
    'zhiniw',
    'macz.com',
    'xmac.app',
    'hanzier',
    '233heji',
    '破解',
    'crack',
    '绿色版',
    '全dlc',
    '激活工具',
    '激活码',
    '盗版',
    '白嫖',
  ]),
  rule('低价值：影视/流媒体站', [
    'haitu.tv',
    'sflix',
    '影视',
    '影院',
    '追剧',
    '在线观看',
    '免费电影',
    '电视剧',
    '动漫',
  ]),
  rule('低价值：购物/消费平台', [
    'target',
    'walmart',
    'ebay',
    'shein',
    'expedia',
    'craigslist',
    '淘宝',
    '京东',
    '拼多多',
    '亚马逊',
    '购物',
    '优惠券',
    '打折',
  ]),
  rule('低价值：重复搜索引擎/门户', [
    'baidu',
    'sogou',
    'so.com',
    'cn.bing',
    'bing',
    'baike.baidu',
    'sina',
    '百度',
    '搜狗',
    '搜索引擎',
    '百科',
    '门户',
  ]),
  rule('低价值：可随时重找的视频/音乐', [
    'youtube',
    'youtu.be',
    'bilibili',
    'spotify',
    '哔哩哔哩',
    '优酷',
    '爱奇艺',
    '网易云音乐',
    '音乐',
    '视频',
  ]),
  rule('低价值：泛资源/下载/娱乐', [
    '下载',
    '全dlc',
    '壁纸',
    '游戏',
    '单机',
    '磁力',
    '种子',
    '资源站',
    '网盘资源',
  ]),
];

/** 从 URL 取主机名；解析失败时退化成整串小写，保证任何输入都不会抛异常 */
function extractDomain(url: string): string {
  const trimmed = (url ?? '').trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

/**
 * 拍平书签树：深度优先，记录文件夹路径，跳过文件夹节点（没有 url 的），字段缺失也不报错。
 * 与 `lib/bookmarks.ts` 的遍历保持一致：带 url 的节点只产出书签，不再往下递归。
 */
export function flattenBookmarks(nodes: BookmarkNodeLike[]): FlatBookmark[] {
  const flat: FlatBookmark[] = [];
  walkBookmarks(nodes, [], flat);
  return flat;
}

function walkBookmarks(
  nodes: BookmarkNodeLike[] | undefined,
  folders: string[],
  out: FlatBookmark[],
): void {
  if (!nodes) return;
  for (const node of nodes) {
    if (!node) continue;
    const title = node.title?.trim() ?? '';
    const url = node.url?.trim() ?? '';

    if (url) {
      out.push({ id: node.id ?? '', title, url, folder: folders.filter(Boolean).join(' / ') });
      continue;
    }

    if (node.children?.length) {
      walkBookmarks(node.children, [...folders, title], out);
    }
  }
}

/**
 * 核心规则：这条书签该留还是该删。
 *
 * 匹配范围同时包含 **域名 + 标题 + 文件夹路径**：
 * 比如书签躺在「购物」文件夹里，哪怕标题看不出来也该删。
 */
export function shouldKeepBookmark(item: {
  title: string;
  url: string;
  folder: string;
}): { keep: boolean; reason: string } {
  const domain = extractDomain(item.url);
  // 用空格连接，保证 ASCII 词的词边界不会被相邻字段粘住
  const haystack = [domain, item.title ?? '', item.folder ?? ''].join(' ');

  // 1) 保护优先：命中即保留，不再看删除规则
  for (const current of PROTECTION_RULES) {
    if (current.matcher.test(haystack)) {
      return { keep: true, reason: current.reason };
    }
  }

  // 2) 再判删除
  for (const current of DELETION_RULES) {
    if (current.matcher.test(haystack)) {
      return { keep: false, reason: current.reason };
    }
  }

  // 3) 默认分支：激进清理
  return { keep: false, reason: REASON_DEFAULT_REMOVE };
}

/**
 * 生成清理计划：拍平 → 逐条决策 → 汇总。
 *
 * @param options.defaultKeep 未命中规则时改为保留（保守模式），默认 false
 */
export function planCleanup(nodes: BookmarkNodeLike[], options: CleanupOptions = {}): CleanupPlan {
  const defaultKeep = options.defaultKeep ?? false;

  const decisions: BookmarkDecision[] = flattenBookmarks(nodes).map((item) => {
    const verdict = shouldKeepBookmark(item);
    // 保守模式只翻转「未命中规则」的默认分支，显式命中删除规则的仍然删
    if (defaultKeep && !verdict.keep && verdict.reason === REASON_DEFAULT_REMOVE) {
      return { ...item, keep: true, reason: REASON_DEFAULT_KEEP };
    }
    return { ...item, keep: verdict.keep, reason: verdict.reason };
  });

  const keep = decisions.filter((decision) => decision.keep);
  const remove = decisions.filter((decision) => !decision.keep);
  const total = decisions.length;

  return {
    decisions,
    keep,
    remove,
    summary: {
      total,
      kept: keep.length,
      removed: remove.length,
      // 空输入不能除以零：显式返回 0，避免 NaN
      removedPercent: total > 0 ? Math.round((remove.length / total) * 100) : 0,
    },
  };
}

/**
 * 按理由归组删除项并计数，供 UI 展示「为什么删了这些」。
 * 按数量降序；数量相同时按理由字典序，保证输出稳定可测。
 */
export function summarizeReasons(plan: CleanupPlan): { reason: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const decision of plan.remove) {
    counts.set(decision.reason, (counts.get(decision.reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason, 'zh'));
}
