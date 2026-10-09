/**
 * 书签清洗与归类。
 *
 * 浏览器书签往往积累成百上千条，其中绝大多数再也不会被打开。这个模块做三件事：
 *   1. 给每条书签打「重要度」分数（是否真的用过、是否亲手剪藏、是否有备注、域名是否高频）；
 *   2. 按分数裁掉长尾（默认只保留前 10%）；
 *   3. 把留下的按少数几个主类归拢，供新标签页以列表形式展示。
 *
 * 纯函数，无 chrome / DOM 依赖，便于单测。
 */

/** 归类结果的主类（刻意保持粗粒度，避免分类过碎） */
export type CuratedCategoryId =
  | 'study'
  | 'local'
  | 'ai'
  | 'dev'
  | 'design'
  | 'tools'
  | 'learn'
  | 'media'
  | 'life'
  | 'other';

export interface CuratedCategory {
  id: CuratedCategoryId;
  label: string;
  /** 该类下的书签，已按重要度降序 */
  items: CuratedBookmark[];
}

/** 参与评分的书签最小结构（与 SavedClip 兼容） */
export interface CuratorInput {
  url: string;
  title: string;
  domain: string;
  source?: 'clip' | 'bookmark';
  folder?: string;
  summary?: string;
  tags?: string[];
  keywords?: string[];
  why?: string;
  clipped?: string;
  revived?: number;
  lastVisited?: string;
}

export interface CuratedBookmark extends CuratorInput {
  /** 重要度总分（越高越重要） */
  score: number;
  category: CuratedCategoryId;
  /** 人类可读的保留原因，用于 hover 详情 */
  reasons: string[];
}

export interface CurateOptions {
  /** 保留比例，0~1，默认 0.1（即裁掉约 90%） */
  keepRatio?: number;
  /** 保留数量上限，默认 120 */
  maxItems?: number;
  /** 每类最多展示条数，默认 14 */
  perCategory?: number;
  /** 低于该分数一律丢弃，默认 0 */
  minScore?: number;
  /** 参考时间（默认 now），用于计算「最近使用」 */
  now?: Date;
}

/** 类目展示顺序与名称 */
const CATEGORY_META: { id: CuratedCategoryId; label: string }[] = [
  { id: 'study', label: '学业与升学' },
  { id: 'local', label: '内网与自建服务' },
  { id: 'ai', label: 'AI 与模型' },
  { id: 'dev', label: '开发与代码' },
  { id: 'design', label: '设计与灵感' },
  { id: 'tools', label: '工具与服务' },
  { id: 'learn', label: '学习与文档' },
  { id: 'media', label: '影音与内容' },
  { id: 'life', label: '生活与其他' },
  { id: 'other', label: '未分类' },
];

/** 域名 → 主类。只收录高频站点，命中不了再走关键词判断 */
const DOMAIN_CATEGORY: Record<string, CuratedCategoryId> = {
  // 学业 / 升学（这类站点在用户的收藏里占比最高，必须有专门归类）
  'instructure.com': 'study',
  'canvas.instructure.com': 'study',
  'pearson.com': 'study',
  'mylabschool.pearson.com': 'study',
  'plus.pearson.com': 'study',
  'naviance.com': 'study',
  'student.naviance.com': 'study',
  'commonapp.org': 'study',
  'collegeboard.org': 'study',
  'scoir.com': 'study',
  'app.scoir.com': 'study',
  'khanacademy.org': 'study',
  'quizlet.com': 'study',
  'studocu.com': 'study',
  'mathway.com': 'study',
  'desmos.com': 'study',
  'noodletools.com': 'study',
  'vitalsource.com': 'study',
  'online.vitalsource.com': 'study',
  'login.vitalsource.com': 'study',
  'byu.edu': 'study',
  'success.byu.edu': 'study',
  'cereg.byu.edu': 'study',
  'ets.org': 'study',
  'niche.com': 'study',
  'follettsoftware.com': 'study',
  'turnitin.com': 'study',
  'collegeboard.com': 'study',
  'sharepoint.com': 'study',
  'vziq-my.sharepoint.com': 'study',
  'github.com': 'dev',
  'gitlab.com': 'dev',
  'stackoverflow.com': 'dev',
  'developer.mozilla.org': 'learn',
  'npmjs.com': 'dev',
  'vercel.com': 'dev',
  'cloudflare.com': 'dev',
  'linear.app': 'tools',
  'figma.com': 'design',
  'dribbble.com': 'design',
  'behance.net': 'design',
  'awwwards.com': 'design',
  'lapaninja.com': 'design',
  'pinterest.com': 'design',
  'openai.com': 'ai',
  'anthropic.com': 'ai',
  'claude.ai': 'ai',
  'kimi.com': 'ai',
  'chatgpt.com': 'ai',
  'huggingface.co': 'ai',
  'zhihu.com': 'learn',
  'juejin.cn': 'dev',
  'csdn.net': 'dev',
  'bilibili.com': 'media',
  'youtube.com': 'media',
  'youtu.be': 'media',
  'spotify.com': 'media',
  'netflix.com': 'media',
  'notion.so': 'tools',
  'obsidian.md': 'tools',
  'icloud.com': 'tools',
  'gumroad.com': 'tools',
  'microsoft.com': 'tools',
  'live.com': 'tools',
  'google.com': 'tools',
  'producthunt.com': 'tools',
  'taobao.com': 'life',
  'jd.com': 'life',
  'amazon.com': 'life',
  'xiaohongshu.com': 'life',
  'douban.com': 'life',
};

/**
 * 内网 / 本机 / 自建服务：localhost、私有网段、.local、Tailscale 域名等。
 * 这些是用户自己跑的服务，价值高且不该被当垃圾清掉，单独归一类。
 */
export function isLocalServiceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1') return true;
    if (host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal') || host.endsWith('.home')) return true;
    if (host.endsWith('.ts.net')) return true;              // Tailscale
    if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host)) return true; // Tailscale CGNAT
    // 带非标准端口的自建服务（如 :3000 / :8080 / :27125）
    if (parsed.port && !['80', '443', ''].includes(parsed.port)) return true;
    return false;
  } catch {
    return false;
  }
}

/** 关键词 → 主类（按优先级从上到下匹配） */
const KEYWORD_CATEGORY: { id: CuratedCategoryId; words: string[] }[] = [
  { id: 'study', words: ['sat', 'psat', 'act', 'toefl', 'ap ', 'ib ', 'gpa', 'transcript', 'scholarship',
    '奖学金', '升学', '申请', '大学', '课程', '作业', '成绩', '学分', '选课', '考试', '复习',
    'common app', 'naviance', 'scoir', 'college', 'university', 'school', 'academy',
    'quizlet', 'studocu', 'mathway', 'desmos', 'khan', 'vitalsource', 'noodletools',
    'canvas', 'instructure', 'pearson', 'textbook', 'flashcard', 'practice test'] },
  { id: 'ai', words: ['ai', 'gpt', 'llm', '大模型', '模型', 'prompt', '智能体', 'agent', 'claude', 'openai', '深度学习', '机器学习'] },
  { id: 'dev', words: ['开发', '代码', '编程', '前端', '后端', '框架', 'api', 'github', 'react', 'vue', 'python', 'javascript', 'typescript', 'rust', 'golang', '数据库', '部署', 'docker'] },
  { id: 'design', words: ['设计', 'ui', 'ux', '灵感', '配色', '插画', '图标', '字体', '海报', '交互', '视觉', '落地页'] },
  { id: 'learn', words: ['教程', '文档', '学习', '课程', '指南', '手册', 'wiki', '书籍', '论文', '知识',
    'z-library', 'zlib', '电子书', '图书馆', 'library', 'ebook'] },
  { id: 'media', words: ['视频', '音乐', '影视', '播客', '电影', '动画', '剧', '音频',
    'bilibili', '哔哩', 'youtube', 'spotify', 'netflix'] },
  { id: 'tools', words: ['工具', '效率', '插件', '软件', '在线', '转换', '生成器', '下载', '自动化',
    'notion', 'obsidian', 'icloud', '云盘', '网盘', '笔记', '待办', '看板', '模板',
    '词典', 'thesaurus', 'dictionary', '工作台', 'dashboard'] },
  { id: 'life', words: ['购物', '生活', '旅行', '健康', '美食', '理财', '银行', '政务', '办事', '社保', '公积金'] },
];

/**
 * 关键词命中判断。
 * 纯 ASCII 短词（ai / ui / ux / api / vue / rust / wiki…）必须按词边界匹配，
 * 否则 `email` 会因为包含 "ai"、`build` 会因为包含 "ui" 被误分类。
 * 中文词没有词边界概念，直接用 includes。
 */
function matchesKeyword(haystack: string, word: string): boolean {
  if (!/^[a-z0-9+#.]+$/.test(word)) return haystack.includes(word);
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(haystack);
}

/** 明显没价值/已失效的标题模式，直接判为噪声 */
const NOISE_PATTERNS = [
  /^(new tab|新标签页)$/i,
  /^(untitled|无标题|未命名)$/i,
  /^(登录|login|sign in)$/i,
  /^(404|not found|页面不存在|访问出错)/i,
  /^(百度一下|search)$/i,
];

/**
 * 追踪参数：精确名 + 前缀名分开判断。
 * 之前用单个正则前缀匹配，会把 `refresh`（撞 `ref`）、`fromage`（撞 `from`）
 * 这类正常参数一并删掉，导致不同页面被误判为同一 URL。
 */
const TRACKING_PARAM_EXACT = new Set([
  'ref', 'from', 'spm', 'source', 'fbclid', 'gclid', 'scene', '_t', 'share',
  'share_source', 'share_medium', 'share_plat', 'share_tag', 'wt_mc',
]);
const TRACKING_PARAM_PREFIX = ['utm_', 'share_', 'spm_', 'ref_', 'mc_', 'pk_'];

function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (TRACKING_PARAM_EXACT.has(lower)) return true;
  return TRACKING_PARAM_PREFIX.some((prefix) => lower.startsWith(prefix));
}

/**
 * 归一化 URL：去掉追踪参数与末尾斜杠，用于去重。
 */
export function normalizeCuratorUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    const drop = [...parsed.searchParams.keys()].filter(isTrackingParam);
    for (const key of drop) parsed.searchParams.delete(key);
    const query = parsed.searchParams.toString();
    const path = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin}${path}${query ? `?${query}` : ''}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

/** 解析时间字符串为时间戳，非法返回 0 */
function parseTime(value: string | undefined): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

function daysBetween(from: number, to: number): number {
  return (to - from) / 86400000;
}

/**
 * 给单条书签打分。分数由若干可解释的信号相加，便于在 hover 详情里说明「为什么保留」。
 */
export function scoreBookmark(item: CuratorInput, now = new Date()): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const nowMs = now.getTime();

  const visited = parseTime(item.lastVisited);
  const added = parseTime(item.clipped);

  // 1) 最近使用过：最强信号
  if (visited) {
    // 未来时间戳（时钟漂移/书签导入异常）按「刚刚」处理，避免落进 ≤7 天分支产生误导
    const days = Math.max(0, daysBetween(visited, nowMs));
    if (days <= 7) {
      score += 60;
      reasons.push('最近一周访问过');
    } else if (days <= 30) {
      score += 40;
      reasons.push('最近一个月访问过');
    } else if (days <= 90) {
      score += 22;
      reasons.push('近三个月访问过');
    } else if (days <= 365) {
      score += 10;
      reasons.push('一年内访问过');
    } else {
      score += 2;
    }
  }

  // 2) 被回访过（CC Archive 自己的记录）
  const revived = item.revived ?? 0;
  if (revived > 0) {
    score += Math.min(revived * 6, 24);
    reasons.push(`回访过 ${revived} 次`);
  }

  // 3) 亲手剪藏的比批量导入的书签更有价值
  if ((item.source ?? 'clip') === 'clip') {
    score += 18;
    reasons.push('亲手剪藏');
  }

  // 4) 有备注/摘要说明当时是有意留的
  if ((item.why ?? '').trim()) {
    score += 12;
    reasons.push('写过备注');
  }
  if ((item.summary ?? '').trim()) {
    score += 6;
  }

  // 5) 标签丰富说明被整理过
  const tagCount = (item.tags ?? []).length + (item.keywords ?? []).length;
  if (tagCount >= 4) {
    score += 8;
    reasons.push('标签完整');
  } else if (tagCount >= 2) {
    score += 4;
  }

  // 6) 标题质量
  //
  // 注意：标题等于 URL **不是**噪声。用户在「添加书签」里只填网址时，
  // 浏览器/扩展就会把 URL 当标题（这是最常见的情况），
  // 早期把它按 NOISE_PATTERNS 扣 25 分，导致刚加的书签直接在工作台消失。
  // 这里只对「真正无意义的占位标题」扣分，URL 型标题按普通短标题处理。
  const title = (item.title ?? '').trim();
  const looksLikeUrl = /^https?:\/\//i.test(title);
  const domain = (item.domain ?? '').toLowerCase().replace(/^www\./, '');
  const titleIsDomain = title.toLowerCase().replace(/^www\./, '') === domain;

  if (!title) {
    score -= 12;
  } else if (looksLikeUrl || titleIsDomain) {
    // 标题就是网址/域名：不加分也不重罚（用户可能只是懒得起名）
    score += 0;
    reasons.push('标题为网址');
  } else if (NOISE_PATTERNS.some((re) => re.test(title))) {
    score -= 25;
  } else if (title.length >= 6) {
    score += 4;
  }

  // 7) 收录时间：太老的且从未访问过，价值递减
  if (added && !visited) {
    const age = daysBetween(added, nowMs);
    if (age > 365) {
      score -= 8;
      reasons.push('收录超过一年未访问');
    }
  }

  // 8) 文件夹深度：收藏夹栏（浅层）通常是真正在用的
  const folder = (item.folder ?? '').trim();
  if (folder) {
    const depth = folder.split('/').length;
    if (depth <= 1) {
      score += 6;
    } else if (depth >= 3) {
      score -= 3;
    }
  }

  return { score, reasons };
}

/** 判定书签属于哪个主类 */
export function categorize(item: CuratorInput): CuratedCategoryId {
  // 内网/自建服务优先级最高：这类 URL 用域名规则永远匹配不到
  if (isLocalServiceUrl(item.url)) return 'local';

  const domain = item.domain.toLowerCase().replace(/^www\./, '');
  const direct = DOMAIN_CATEGORY[domain];
  if (direct) return direct;

  // 域名后缀匹配（如 sub.github.com）
  for (const [known, category] of Object.entries(DOMAIN_CATEGORY)) {
    if (domain.endsWith(`.${known}`)) return category;
  }

  const haystack = [
    item.title ?? '',
    item.folder ?? '',
    ...(item.tags ?? []),
    ...(item.keywords ?? []),
    item.summary ?? '',
  ].join(' ').toLowerCase();

  for (const { id, words } of KEYWORD_CATEGORY) {
    if (words.some((word) => matchesKeyword(haystack, word))) return id;
  }

  return 'other';
}

/**
 * 清洗 + 归类。
 *
 * 默认只保留约 10%（`keepRatio`），这正是「移除 90% 不重要书签」的实现；
 * 结果按主类分组，每组内按重要度降序，空类不返回。
 */
export function curateBookmarks(
  items: CuratorInput[],
  options: CurateOptions = {},
): CuratedCategory[] {
  const keepRatio = clampRatio(options.keepRatio ?? 0.1);
  const maxItems = Math.max(0, options.maxItems ?? 120);
  const perCategory = Math.max(1, options.perCategory ?? 14);
  const minScore = options.minScore ?? 0;
  const now = options.now ?? new Date();

  // 先按归一化 URL 去重，同一条只保留分数最高的那份
  const best = new Map<string, CuratedBookmark>();
  for (const item of items) {
    if (!item.url || !/^https?:/i.test(item.url)) continue;
    const { score, reasons } = scoreBookmark(item, now);
    const entry: CuratedBookmark = {
      ...item,
      score,
      reasons,
      category: categorize(item),
    };
    const key = normalizeCuratorUrl(item.url);
    const existing = best.get(key);
    if (!existing || entry.score > existing.score) best.set(key, entry);
  }

  const all = [...best.values()].sort(compareCurated);

  // 计算保留条数：比例与上限取较小者，且至少保留少量，避免全部清空
  const byRatio = Math.ceil(all.length * keepRatio);
  const keep = Math.max(1, Math.min(byRatio, maxItems, all.length));

  const kept = all
    .filter((item) => item.score >= minScore)
    .slice(0, keep);

  // 按主类分组，保持 CATEGORY_META 的顺序
  const groups = new Map<CuratedCategoryId, CuratedBookmark[]>();
  for (const item of kept) {
    const list = groups.get(item.category) ?? [];
    list.push(item);
    groups.set(item.category, list);
  }

  return CATEGORY_META
    .map(({ id, label }) => ({
      id,
      label,
      items: (groups.get(id) ?? []).slice(0, perCategory),
    }))
    .filter((group) => group.items.length > 0);
}

/** 排序：分数降序 → 最近使用降序 → 标题 */
function compareCurated(a: CuratedBookmark, b: CuratedBookmark): number {
  if (b.score !== a.score) return b.score - a.score;
  const av = parseTime(a.lastVisited) || parseTime(a.clipped);
  const bv = parseTime(b.lastVisited) || parseTime(b.clipped);
  if (bv !== av) return bv - av;
  return (a.title || a.url).localeCompare(b.title || b.url, 'zh');
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0.1;
  return Math.min(1, Math.max(0.01, value));
}

/** 统计清洗前后数量，用于向用户说明「裁掉了多少」 */
export function curationSummary(total: number, categories: CuratedCategory[]): {
  total: number;
  kept: number;
  removed: number;
  removedPercent: number;
} {
  const kept = categories.reduce((sum, group) => sum + group.items.length, 0);
  const removed = Math.max(0, total - kept);
  return {
    total,
    kept,
    removed,
    removedPercent: total > 0 ? Math.round((removed / total) * 100) : 0,
  };
}
