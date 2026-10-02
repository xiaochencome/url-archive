/**
 * 启动器：一键启动本地应用并打开对应网页。
 *
 * 用途：有些本机服务要先在终端起进程、再开浏览器。
 * 这里把「启动命令 + 要打开的网址」配成一条快捷方式，点一下就跑完整个流程。
 *
 * 纯逻辑模块（无 DOM），便于单测。
 */

/** 一条启动项 */
export interface LauncherItem {
  id: string;
  /** 显示名，如 "本机工作台" */
  name: string;
  /** 要在登录 shell 里执行的命令，如 "open -a Obsidian" */
  command: string;
  /** 启动后打开的网址（可选） */
  url: string;
  /** 图标用的首字母（自动取 name 首字） */
  icon: string;
  /** 启动后等待多少毫秒再打开网址（给服务留启动时间） */
  delayMs: number;
}

export const LAUNCHER_KEY = 'workbench_launchers';

/** 命令长度上限，避免异常超长串 */
export const MAX_COMMAND_LENGTH = 500;

/** 等待时间范围（ms） */
export const MIN_DELAY = 0;
export const MAX_DELAY = 60000;

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** 归一化单条启动项，非法返回 null */
export function normalizeLauncher(value: unknown): LauncherItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = str(raw.name).trim();
  const command = str(raw.command).trim().slice(0, MAX_COMMAND_LENGTH);
  if (!name || !command) return null;

  const url = str(raw.url).trim();
  // 网址要么为空，要么必须是 http(s)
  if (url && !/^https?:\/\//i.test(url)) return null;

  const rawDelay = typeof raw.delayMs === 'number' ? raw.delayMs : Number(str(raw.delayMs, '0'));
  const delayMs = Number.isFinite(rawDelay)
    ? Math.min(MAX_DELAY, Math.max(MIN_DELAY, Math.round(rawDelay)))
    : 1200;

  return {
    id: str(raw.id).trim() || `launcher-${name}-${command}`.slice(0, 80),
    name: name.slice(0, 40),
    command,
    url,
    icon: (str(raw.icon).trim() || name.slice(0, 1)).slice(0, 2),
    delayMs,
  };
}

/** 归一化列表：去重（按 id）、丢弃非法项 */
export function normalizeLaunchers(value: unknown): LauncherItem[] {
  if (!Array.isArray(value)) return [];
  const out: LauncherItem[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const norm = normalizeLauncher(item);
    if (!norm || seen.has(norm.id)) continue;
    seen.add(norm.id);
    out.push(norm);
  }
  return out;
}

export function createLauncher(input: {
  name: string;
  command: string;
  url?: string;
  delayMs?: number;
  id?: string;
}): LauncherItem | null {
  return normalizeLauncher({ ...input, id: input.id ?? `l-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
}

export function addLauncher(list: LauncherItem[], item: LauncherItem): LauncherItem[] {
  if (list.some((x) => x.id === item.id)) return [...list];
  return [...list, item];
}

export function removeLauncher(list: LauncherItem[], id: string): LauncherItem[] {
  return list.filter((x) => x.id !== id);
}

export function updateLauncher(
  list: LauncherItem[],
  id: string,
  patch: Partial<Omit<LauncherItem, 'id'>>,
): LauncherItem[] {
  return list.map((item) => {
    if (item.id !== id) return item;
    const merged = normalizeLauncher({ ...item, ...patch, id });
    return merged ?? item;
  });
}

/** 默认启动器条目：不预置任何命令 —— 本机命令属于用户自己的环境。 */
export function defaultLaunchers(): LauncherItem[] {
  return normalizeLaunchers([]);
}

export async function loadLaunchers(): Promise<LauncherItem[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  try {
    const got = await chrome.storage.local.get(LAUNCHER_KEY);
    return normalizeLaunchers(got?.[LAUNCHER_KEY]);
  } catch {
    return [];
  }
}

export async function saveLaunchers(list: LauncherItem[]): Promise<LauncherItem[]> {
  const clean = normalizeLaunchers(list);
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return clean;
  try {
    await chrome.storage.local.set({ [LAUNCHER_KEY]: clean });
  } catch {
    // 存储失败时保留内存态
  }
  return clean;
}

/** 危险命令黑名单：避免误配置把系统搞坏 */
const BLOCKED = [
  /rm\s+-rf\s+[~/]/i,
  /\bsudo\s+rm\b/i,
  /:\(\)\s*\{.*\};\s*:/,
  /\bmkfs\b/i,
  /\bdd\s+if=.*of=\/dev\//i,
  />\s*\/dev\/(disk|sd|nvme)/i,
  /\bshutdown\b|\breboot\b/i,
];

/** 命令是否安全（仅做明显危险模式拦截，不做白名单限制） */
export function isCommandAllowed(command: string): boolean {
  const c = command.trim();
  if (!c) return false;
  return !BLOCKED.some((re) => re.test(c));
}
