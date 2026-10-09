/**
 * 用户在仪表盘收藏的 GitHub 项目。
 * 存储沿用仓库约定：chrome.storage.local；读写都先做防御性归一化，
 * 保证坏数据不会污染 UI，也保证测试可以桩掉 chrome。
 */

const KEY = 'github_projects';

/** 收藏项目在 chrome.storage.local 中的键 */
export const GITHUB_PROJECTS_KEY = KEY;

export interface GithubProject {
  id: string;            // 稳定标识：由 repo fullName 小写派生
  fullName: string;      // "owner/name"
  owner: string;
  name: string;
  description: string;
  url: string;           // https://github.com/owner/name
  stars: number;
  forks: number;
  language: string;
  topics: string[];
  avatarUrl: string;
  note: string;          // 用户备注，默认 ''
  tags: string[];        // 用户标签，默认 []
  savedAt: string;       // ISO
  starredByMe: boolean;  // 用户标星，默认 false
}

/** 趋势模块 TrendingRepo 的结构子集：只做结构适配，不产生 import 耦合 */
export interface GithubRepoLike {
  fullName: string;
  owner?: string;
  name?: string;
  description?: string;
  url?: string;
  stars?: number;
  forks?: number;
  language?: string;
  topics?: string[];
  avatarUrl?: string;
}

/** 新增收藏的输入：字段都可缺省，缺失部分会尽量从 fullName/url 推导 */
export type GithubProjectInput = Partial<GithubRepoLike>;

/** fullName -> 稳定 id：去空白后小写 */
export function githubProjectId(fullName: string): string {
  return fullName.trim().toLowerCase();
}

/** 从 GitHub 仓库地址解析出 owner/name；非 github 地址返回空串 */
function fullNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') return '';
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return '';
    return `${parts[0]}/${parts[1]}`;
  } catch {
    return '';
  }
}

/** 可用的仓库地址：必须能解析且为 http/https */
function isHttpUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 防御性归一化单个项目：
 * - fullName 与 url 至少要能凑出来，否则返回 null
 * - id 始终由 fullName 派生，保证同一仓库 id 稳定
 * - 数字走安全非负整数；字符串 trim；topics/tags 去重
 */
export function normalizeGithubProject(value: unknown): GithubProject | null {
  if (!isRecord(value)) return null;

  let fullName = toText(value.fullName);
  let owner = toText(value.owner);
  let name = toText(value.name);
  let url = toText(value.url);

  // 先用 fullName 补 owner/name
  const slash = fullName.indexOf('/');
  if (slash > 0) {
    owner = owner || fullName.slice(0, slash);
    name = name || fullName.slice(slash + 1);
  }

  // fullName 缺失时，依次尝试 owner/name、再从 url 推导
  if (!fullName && owner && name) fullName = `${owner}/${name}`;
  if (!fullName && url) fullName = fullNameFromUrl(url);

  // fullName 只有单段（缺 owner）时，再用 url 补一次
  if (fullName && !fullName.includes('/')) {
    const fromUrl = fullNameFromUrl(url);
    if (fromUrl) {
      fullName = fromUrl;
    } else if (owner && name) {
      fullName = `${owner}/${name}`;
    } else {
      return null;
    }
  }
  if (!fullName) return null;

  const split = fullName.indexOf('/');
  owner = owner || fullName.slice(0, split);
  name = name || fullName.slice(split + 1) || fullName;
  if (!owner || !name) return null;

  // 地址缺失或不可用时，回退到规范的仓库地址
  if (!isHttpUrl(url)) url = `https://github.com/${fullName}`;

  return {
    id: githubProjectId(fullName),
    fullName,
    owner,
    name,
    description: toText(value.description),
    url,
    stars: toNonNegativeInt(value.stars),
    forks: toNonNegativeInt(value.forks),
    language: toText(value.language),
    topics: uniqueStrings(value.topics),
    avatarUrl: toText(value.avatarUrl),
    note: toText(value.note),
    tags: uniqueStrings(value.tags),
    savedAt: toText(value.savedAt) || new Date().toISOString(),
    starredByMe: value.starredByMe === true,
  };
}

/** 归一化列表：丢弃畸形项，按 id 去重（先出现的优先） */
export function normalizeGithubProjects(value: unknown): GithubProject[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const projects: GithubProject[] = [];
  for (const item of list) {
    const project = normalizeGithubProject(item);
    if (!project || seen.has(project.id)) continue;
    seen.add(project.id);
    projects.push(project);
  }
  return projects;
}

/** 从趋势仓库适配成可保存的项目；结构类型，调用方无需 import 趋势模块 */
export function githubProjectFromRepo(repo: GithubRepoLike): GithubProject {
  const project = normalizeGithubProject(repo);
  if (!project) throw new Error('无法识别 GitHub 仓库：缺少 fullName 或 url');
  return project;
}

export async function loadGithubProjects(): Promise<GithubProject[]> {
  if (!hasStorage()) return [];
  const got = await chrome.storage.local.get(GITHUB_PROJECTS_KEY);
  return normalizeGithubProjects(got[GITHUB_PROJECTS_KEY]);
}

export async function saveGithubProjects(list: GithubProject[]): Promise<GithubProject[]> {
  const next = normalizeGithubProjects(list);
  if (hasStorage()) await chrome.storage.local.set({ [GITHUB_PROJECTS_KEY]: next });
  return next;
}

/**
 * 新增收藏：同一仓库已存在时直接返回已有项且 added=false，绝不重复；
 * 否则把新项目插到列表最前面。
 */
export async function addGithubProject(
  input: GithubProjectInput,
): Promise<{ project: GithubProject; added: boolean }> {
  const candidate = normalizeGithubProject(input);
  if (!candidate) throw new Error('无法识别 GitHub 仓库：缺少 fullName 或 url');

  const list = await loadGithubProjects();
  const existing = list.find((project) => project.id === candidate.id);
  if (existing) return { project: existing, added: false };

  const next = [candidate, ...list];
  await saveGithubProjects(next);
  return { project: candidate, added: true };
}

/** 更新备注/标签/标星；找不到 id 返回 null */
export async function updateGithubProject(
  id: string,
  patch: Partial<Pick<GithubProject, 'note' | 'tags' | 'starredByMe'>>,
): Promise<GithubProject | null> {
  const list = await loadGithubProjects();
  const index = list.findIndex((project) => project.id === id);
  if (index < 0) return null;

  const current = list[index];
  const updated: GithubProject = {
    ...current,
    note: patch.note !== undefined ? patch.note.trim() : current.note,
    tags: patch.tags !== undefined ? uniqueStrings(patch.tags) : current.tags,
    starredByMe: patch.starredByMe !== undefined ? patch.starredByMe === true : current.starredByMe,
  };
  const next = [...list];
  next[index] = updated;
  await saveGithubProjects(next);
  return updated;
}

/** 删除收藏；不存在返回 false */
export async function removeGithubProject(id: string): Promise<boolean> {
  const list = await loadGithubProjects();
  const next = list.filter((project) => project.id !== id);
  if (next.length === list.length) return false;
  await saveGithubProjects(next);
  return true;
}

/** 测试可桩掉 chrome；无 storage 时读写降级为内存语义（读空、不抛错） */
function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage) && Boolean(chrome.storage.local);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 安全非负整数：非法/负数/小数都收敛到 >= 0 的整数 */
function toNonNegativeInt(value: unknown): number {
  const raw = typeof value === 'string' ? Number(value.trim()) : value;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, Math.floor(raw));
}

/** 去空白 + 去重；忽略大小写，保留首次出现的原始写法 */
function uniqueStrings(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
}
