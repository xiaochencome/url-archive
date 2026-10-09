/**
 * 新标签页工作台的便签（memo / sticky notes）。
 * 存储沿用仓库约定：chrome.storage.local；读写都先做防御性归一化，
 * 保证坏数据不会污染 UI，也保证测试可以桩掉 chrome。
 * 除 loadMemos / saveMemos 外全部是纯函数，不触碰 DOM、不读全局时间以外的状态。
 */

const KEY = 'workbench_memos';

/** 便签列表在 chrome.storage.local 中的键 */
export const MEMOS_KEY = KEY;

/** 便签底色：固定小调色板 */
export type MemoColor = 'yellow' | 'pink' | 'blue' | 'green' | 'purple' | 'gray';

/** 调色板展示顺序（第一个也是默认色） */
export const MEMO_COLORS: MemoColor[] = ['yellow', 'pink', 'blue', 'green', 'purple', 'gray'];

/** 正文最大长度：按 UTF-16 码元计，与 String.prototype.slice 一致 */
export const MAX_MEMO_LENGTH = 2000;

/** 未知/非法底色回退到调色板首项 */
const DEFAULT_COLOR: MemoColor = 'yellow';

export interface Memo {
  id: string;
  text: string;
  createdAt: string;   // ISO
  updatedAt: string;   // ISO
  pinned: boolean;
  color: MemoColor;
  done: boolean;       // 把便签当作可勾选的待办
}

/** 新建便签的输入：只有正文必填 */
export interface MemoInput {
  text: string;
  color?: MemoColor;
  pinned?: boolean;
}

/** 可更新的字段；其余字段（id/时间戳）由模块维护 */
export type MemoPatch = Partial<Pick<Memo, 'text' | 'pinned' | 'color' | 'done'>>;

/** 统计口径：open = total - done，永远是有限整数 */
export interface MemoStats {
  total: number;
  done: number;
  open: number;
  pinned: number;
}

/**
 * 新建便签：
 * - 正文 trim 后截断到 MAX_MEMO_LENGTH（空正文不抛错，交给 normalizeMemo 把关）
 * - createdAt / updatedAt 都取自注入的 now（默认当前时间）
 * - done 恒为 false，color 非法时回退默认色
 */
export function createMemo(input: MemoInput, now: Date = new Date()): Memo {
  const stamp = safeIso(now);
  return {
    id: createMemoId(now),
    text: capText(toText(input?.text)),
    createdAt: stamp,
    updatedAt: stamp,
    pinned: input?.pinned === true,
    color: isMemoColor(input?.color) ? input.color : DEFAULT_COLOR,
    done: false,
  };
}

/**
 * 防御性归一化单条便签：
 * - 非对象、正文 trim 后为空 → null
 * - id 缺失/非字符串时补一个稳定 id
 * - 时间戳缺失或无法解析 → 回退 now
 * - pinned/done 只认真正的 true，其余一律 false
 * - 未知底色回退默认色，正文截断到 MAX_MEMO_LENGTH
 */
export function normalizeMemo(value: unknown, now: Date = new Date()): Memo | null {
  if (!isRecord(value)) return null;

  const text = capText(toText(value.text));
  if (!text) return null;

  return {
    id: toText(value.id) || createMemoId(now),
    text,
    createdAt: isoOr(value.createdAt, now),
    updatedAt: isoOr(value.updatedAt, now),
    pinned: value.pinned === true,
    color: isMemoColor(value.color) ? value.color : DEFAULT_COLOR,
    done: value.done === true,
  };
}

/** 归一化列表：非数组返回 []，丢弃畸形项，按 id 去重（先出现者优先） */
export function normalizeMemos(value: unknown, now: Date = new Date()): Memo[] {
  const list: unknown[] = Array.isArray(value) ? value : [];
  const seen = new Set<string>();
  const memos: Memo[] = [];
  for (const item of list) {
    const memo = normalizeMemo(item, now);
    if (!memo || seen.has(memo.id)) continue;
    seen.add(memo.id);
    memos.push(memo);
  }
  return memos;
}

/**
 * 排序：置顶优先，其次 updatedAt 新的在前。
 * 纯函数：返回新数组，不修改入参；键相同时用原始下标兜底，保证稳定。
 */
export function sortMemos(memos: Memo[]): Memo[] {
  return memos
    .map((memo, index) => ({ memo, index }))
    .sort((a, b) => {
      if (a.memo.pinned !== b.memo.pinned) return a.memo.pinned ? -1 : 1;
      const diff = timeOf(b.memo.updatedAt) - timeOf(a.memo.updatedAt);
      if (diff !== 0) return diff;
      return a.index - b.index;
    })
    .map((entry) => entry.memo);
}

/**
 * 更新一条便签：永远返回新数组，绝不修改入参（未命中的元素保持原引用）。
 * - 未知 id 视为 no-op，但仍返回新数组
 * - 正文 trim + 截断；补丁正文为空白时忽略该字段，维持「正文非空」不变量
 * - 非法底色忽略该字段
 * - 只有正文/底色/完成态真正变化时才推进 updatedAt；置顶属于展示状态，不推进
 */
export function updateMemo(
  memos: Memo[],
  id: string,
  patch: MemoPatch,
  now: Date = new Date(),
): Memo[] {
  const stamp = safeIso(now);
  return memos.map((memo) => {
    if (memo.id !== id) return memo;

    const patchedText = patch.text !== undefined ? capText(toText(patch.text)) : memo.text;
    const text = patchedText || memo.text;
    const color: MemoColor = isMemoColor(patch.color) ? patch.color : memo.color;
    const pinned = patch.pinned !== undefined ? patch.pinned === true : memo.pinned;
    const done = patch.done !== undefined ? patch.done === true : memo.done;

    const changed = text !== memo.text || color !== memo.color || done !== memo.done;
    return { ...memo, text, color, pinned, done, updatedAt: changed ? stamp : memo.updatedAt };
  });
}

/** 删除一条便签：返回新数组，id 不存在时内容不变 */
export function removeMemo(memos: Memo[], id: string): Memo[] {
  return memos.filter((memo) => memo.id !== id);
}

/** 勾选/取消勾选：推进 updatedAt；id 不存在时返回新数组但内容不变 */
export function toggleMemoDone(memos: Memo[], id: string, now: Date = new Date()): Memo[] {
  const current = memos.find((memo) => memo.id === id);
  if (!current) return [...memos];
  return updateMemo(memos, id, { done: !current.done }, now);
}

/** 置顶/取消置顶：按 updateMemo 的约定不推进 updatedAt */
export function toggleMemoPinned(memos: Memo[], id: string, now: Date = new Date()): Memo[] {
  const current = memos.find((memo) => memo.id === id);
  if (!current) return [...memos];
  return updateMemo(memos, id, { pinned: !current.pinned }, now);
}

/** 统计：总数/已完成/未完成/置顶；空输入全为 0，不会出现 NaN */
export function memoStats(memos: Memo[]): MemoStats {
  const list: unknown[] = Array.isArray(memos) ? memos : [];
  let done = 0;
  let pinned = 0;
  for (const item of list) {
    const memo = item as Partial<Memo> | null | undefined;
    if (memo?.done === true) done += 1;
    if (memo?.pinned === true) pinned += 1;
  }
  const total = list.length;
  return { total, done, open: total - done, pinned };
}

/** 读存储：无 chrome 或数据损坏时返回 []，绝不抛错 */
export async function loadMemos(): Promise<Memo[]> {
  if (!hasStorage()) return [];
  try {
    const got = await chrome.storage.local.get(MEMOS_KEY);
    const raw: unknown = got[MEMOS_KEY];
    return normalizeMemos(raw);
  } catch {
    return [];
  }
}

/** 写存储：先归一化；无 chrome 或写入失败时只返回归一化结果，绝不抛错 */
export async function saveMemos(memos: Memo[]): Promise<Memo[]> {
  const next = normalizeMemos(memos);
  if (!hasStorage()) return next;
  try {
    await chrome.storage.local.set({ [MEMOS_KEY]: next });
  } catch {
    // 存储失败不影响调用方拿到归一化结果
  }
  return next;
}

/** 测试可桩掉 chrome；无 storage 时读写降级为内存语义（读空、写不抛错） */
function hasStorage(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function capText(text: string): string {
  return text.length > MAX_MEMO_LENGTH ? text.slice(0, MAX_MEMO_LENGTH) : text;
}

function isMemoColor(value: unknown): value is MemoColor {
  return typeof value === 'string' && (MEMO_COLORS as string[]).includes(value);
}

/** 时间戳：字符串能解析就用其 ISO 形式，否则回退 fallback */
function isoOr(value: unknown, fallback: Date): string {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text) {
      const time = Date.parse(text);
      if (Number.isFinite(time)) return new Date(time).toISOString();
    }
  }
  return safeIso(fallback);
}

/** Date -> ISO；非法 Date（含 undefined）回退当前时间，避免 toISOString 抛错 */
function safeIso(date: Date | undefined): string {
  const time = date instanceof Date ? date.getTime() : Number.NaN;
  return new Date(Number.isFinite(time) ? time : Date.now()).toISOString();
}

function timeOf(iso: string): number {
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : 0;
}

/** 自增序号：保证退化分支下同一毫秒内的两次调用也不会撞 id */
let idSeed = 0;

/** 稳定唯一 id：优先 crypto.randomUUID，退化时用时间戳 + 序号 + 随机串 */
function createMemoId(now: Date): string {
  try {
    const uuid = globalThis.crypto?.randomUUID?.();
    if (uuid) return uuid;
  } catch {
    // 非安全上下文下可能不可用，走退化分支
  }
  idSeed += 1;
  const time = now instanceof Date && Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  return `memo-${time.toString(36)}-${idSeed.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
