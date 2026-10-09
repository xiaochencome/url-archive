import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createMemo,
  loadMemos,
  MAX_MEMO_LENGTH,
  MEMO_COLORS,
  MEMOS_KEY,
  memoStats,
  normalizeMemo,
  normalizeMemos,
  removeMemo,
  saveMemos,
  sortMemos,
  toggleMemoDone,
  toggleMemoPinned,
  updateMemo,
} from './memo';
import type { Memo, MemoColor } from './memo';

/** chrome.storage.local 的最小桩：与 github-projects.test.ts 保持同一风格 */
interface ChromeStub {
  storage: {
    local: {
      get: (key: string) => Promise<Record<string, unknown>>;
      set: (obj: Record<string, unknown>) => Promise<void>;
    };
  };
}

/** 用独立别名挂载桩，避免和 @types/chrome 的全局声明打架 */
const chromeHost = globalThis as unknown as { chrome?: ChromeStub };

let store: Record<string, unknown>;

const NOW = new Date('2026-01-02T03:04:05.000Z');
const NOW_ISO = '2026-01-02T03:04:05.000Z';

beforeEach(() => {
  store = {};
  chromeHost.chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
      },
    },
  };
});

/** 造一条合法便签数据（未归一化），字段可覆盖 */
function raw(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'memo-1',
    text: '买牛奶',
    createdAt: NOW_ISO,
    updatedAt: NOW_ISO,
    pinned: false,
    color: 'yellow',
    done: false,
    ...overrides,
  };
}

/** 深拷贝，用于断言纯函数没有改动入参 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function memo(overrides: Partial<Memo> = {}): Memo {
  return { ...(normalizeMemo(raw()) as Memo), ...overrides };
}

describe('常量', () => {
  test('导出键名与调色板稳定', () => {
    expect(MEMOS_KEY).toBe('workbench_memos');
    expect(MEMO_COLORS).toEqual(['yellow', 'pink', 'blue', 'green', 'purple', 'gray']);
    expect(MAX_MEMO_LENGTH).toBe(2000);
  });
});

describe('createMemo', () => {
  test('trim 正文并使用注入的时间戳', () => {
    const created = createMemo({ text: '  写周报  ' }, NOW);
    expect(created.text).toBe('写周报');
    expect(created.createdAt).toBe(NOW_ISO);
    expect(created.updatedAt).toBe(NOW_ISO);
  });

  test('默认值：done=false、pinned=false、颜色为调色板首项', () => {
    const created = createMemo({ text: 'x' }, NOW);
    expect(created.done).toBe(false);
    expect(created.pinned).toBe(false);
    expect(created.color).toBe('yellow');
  });

  test('尊重传入的 color 与 pinned', () => {
    const created = createMemo({ text: 'x', color: 'blue', pinned: true }, NOW);
    expect(created.color).toBe('blue');
    expect(created.pinned).toBe(true);
  });

  test('非法颜色回退默认色', () => {
    const created = createMemo({ text: 'x', color: 'chartreuse' as MemoColor }, NOW);
    expect(created.color).toBe('yellow');
  });

  test('正文截断到 MAX_MEMO_LENGTH', () => {
    const created = createMemo({ text: 'a'.repeat(MAX_MEMO_LENGTH + 50) }, NOW);
    expect(created.text).toHaveLength(MAX_MEMO_LENGTH);
  });

  test('连续两次调用 id 不同', () => {
    const a = createMemo({ text: '一' }, NOW);
    const b = createMemo({ text: '二' }, NOW);
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });

  test('不传 now 时使用当前时间', () => {
    const before = Date.now();
    const created = createMemo({ text: 'x' });
    const after = Date.now();
    const time = Date.parse(created.createdAt);
    expect(time).toBeGreaterThanOrEqual(before);
    expect(time).toBeLessThanOrEqual(after);
  });
});

describe('normalizeMemo', () => {
  test('合法数据原样往返', () => {
    const value = raw({ text: '  待办  ', pinned: true, color: 'pink', done: true });
    const result = normalizeMemo(value, NOW);
    expect(result).toEqual({
      id: 'memo-1',
      text: '待办',
      createdAt: NOW_ISO,
      updatedAt: NOW_ISO,
      pinned: true,
      color: 'pink',
      done: true,
    });
  });

  test('空正文或纯空白正文返回 null', () => {
    expect(normalizeMemo(raw({ text: '' }), NOW)).toBeNull();
    expect(normalizeMemo(raw({ text: '   ' }), NOW)).toBeNull();
    expect(normalizeMemo(raw({ text: 42 }), NOW)).toBeNull();
    expect(normalizeMemo(raw({ text: null }), NOW)).toBeNull();
  });

  test('垃圾输入返回 null', () => {
    expect(normalizeMemo(null, NOW)).toBeNull();
    expect(normalizeMemo(undefined, NOW)).toBeNull();
    expect(normalizeMemo('买牛奶', NOW)).toBeNull();
    expect(normalizeMemo(42, NOW)).toBeNull();
    expect(normalizeMemo([], NOW)).toBeNull();
    expect(normalizeMemo({}, NOW)).toBeNull();
  });

  test('未知颜色回退默认色', () => {
    expect(normalizeMemo(raw({ color: 'chartreuse' }), NOW)?.color).toBe('yellow');
    expect(normalizeMemo(raw({ color: 7 }), NOW)?.color).toBe('yellow');
    expect(normalizeMemo(raw({ color: undefined }), NOW)?.color).toBe('yellow');
  });

  test('缺失或非法时间戳回退 now', () => {
    const missing = normalizeMemo({ text: 'x' }, NOW);
    expect(missing?.createdAt).toBe(NOW_ISO);
    expect(missing?.updatedAt).toBe(NOW_ISO);

    const broken = normalizeMemo({ text: 'x', createdAt: 'not-a-date', updatedAt: '' }, NOW);
    expect(broken?.createdAt).toBe(NOW_ISO);
    expect(broken?.updatedAt).toBe(NOW_ISO);

    const valid = normalizeMemo({ text: 'x', createdAt: '2025-05-06T07:08:09.000Z' }, NOW);
    expect(valid?.createdAt).toBe('2025-05-06T07:08:09.000Z');
    expect(valid?.updatedAt).toBe(NOW_ISO);
  });

  test('非布尔 pinned/done 一律收敛为 false，仅 true 为真', () => {
    const coerced = normalizeMemo(raw({ pinned: 'yes', done: 1 }), NOW);
    expect(coerced?.pinned).toBe(false);
    expect(coerced?.done).toBe(false);

    const truthy = normalizeMemo(raw({ pinned: true, done: true }), NOW);
    expect(truthy?.pinned).toBe(true);
    expect(truthy?.done).toBe(true);
  });

  test('缺失 id 时补一个非空 id，非法 id 同样补齐', () => {
    const missing = normalizeMemo({ text: 'x' }, NOW);
    expect(missing?.id).toBeTruthy();
    const blank = normalizeMemo(raw({ id: '   ' }), NOW);
    expect(blank?.id).toBeTruthy();
  });

  test('超长正文被截断', () => {
    const result = normalizeMemo(raw({ text: 'b'.repeat(MAX_MEMO_LENGTH + 10) }), NOW);
    expect(result?.text).toHaveLength(MAX_MEMO_LENGTH);
  });
});

describe('normalizeMemos', () => {
  test('归一化数组并丢弃畸形项', () => {
    const list = normalizeMemos([raw(), null, 'x', {}, 42, raw({ id: 'memo-2', text: '第二' })], NOW);
    expect(list.map((item) => item.id)).toEqual(['memo-1', 'memo-2']);
  });

  test('按 id 去重且先出现者优先', () => {
    const list = normalizeMemos([
      raw({ text: '第一份' }),
      raw({ id: 'memo-1', text: '第二份' }),
    ], NOW);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('第一份');
  });

  test('非数组输入返回空数组', () => {
    expect(normalizeMemos(null, NOW)).toEqual([]);
    expect(normalizeMemos(undefined, NOW)).toEqual([]);
    expect(normalizeMemos({}, NOW)).toEqual([]);
    expect(normalizeMemos('x', NOW)).toEqual([]);
  });
});

describe('sortMemos', () => {
  test('置顶优先，组内按 updatedAt 新的在前', () => {
    const list = [
      memo({ id: 'a', pinned: false, updatedAt: '2026-01-03T00:00:00.000Z' }),
      memo({ id: 'b', pinned: true, updatedAt: '2026-01-01T00:00:00.000Z' }),
      memo({ id: 'c', pinned: false, updatedAt: '2026-01-05T00:00:00.000Z' }),
      memo({ id: 'd', pinned: true, updatedAt: '2026-01-04T00:00:00.000Z' }),
    ];
    expect(sortMemos(list).map((item) => item.id)).toEqual(['d', 'b', 'c', 'a']);
  });

  test('时间相同时保持原相对顺序（稳定）', () => {
    const list = [
      memo({ id: 'a', updatedAt: NOW_ISO }),
      memo({ id: 'b', updatedAt: NOW_ISO }),
      memo({ id: 'c', updatedAt: NOW_ISO }),
    ];
    expect(sortMemos(list).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  test('非法 updatedAt 视为最旧，不抛错', () => {
    const list = [
      memo({ id: 'bad', updatedAt: 'not-a-date' }),
      memo({ id: 'good', updatedAt: NOW_ISO }),
    ];
    expect(sortMemos(list).map((item) => item.id)).toEqual(['good', 'bad']);
  });

  test('不修改入参且返回新数组', () => {
    const list = [
      memo({ id: 'a', updatedAt: '2026-01-03T00:00:00.000Z' }),
      memo({ id: 'b', updatedAt: '2026-01-05T00:00:00.000Z' }),
    ];
    const snapshot = clone(list);
    const sorted = sortMemos(list);
    expect(sorted).not.toBe(list);
    expect(list).toEqual(snapshot);
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
  });
});

describe('updateMemo', () => {
  test('更新正文并推进 updatedAt，返回新数组且不改动入参', () => {
    const list = [memo({ id: 'a', text: '旧' })];
    const snapshot = clone(list);
    const next = updateMemo(list, 'a', { text: '  新  ' }, new Date('2026-02-02T00:00:00.000Z'));

    expect(next).not.toBe(list);
    expect(next[0].text).toBe('新');
    expect(next[0].updatedAt).toBe('2026-02-02T00:00:00.000Z');
    expect(list).toEqual(snapshot);
  });

  test('未知 id 是 no-op：内容不变但仍返回新数组', () => {
    const list = [memo({ id: 'a' })];
    const snapshot = clone(list);
    const next = updateMemo(list, 'nope', { text: 'x' }, NOW);
    expect(next).not.toBe(list);
    expect(next).toEqual(snapshot);
    expect(list).toEqual(snapshot);
  });

  test('改颜色/完成态推进 updatedAt，置顶不推进', () => {
    const base = new Date('2026-03-03T00:00:00.000Z');
    const later = new Date('2026-03-04T00:00:00.000Z');
    const list = [memo({ id: 'a', color: 'yellow', done: false, pinned: false })];

    const recolored = updateMemo(list, 'a', { color: 'green' }, later);
    expect(recolored[0].updatedAt).toBe('2026-03-04T00:00:00.000Z');

    const done = updateMemo(list, 'a', { done: true }, later);
    expect(done[0].updatedAt).toBe('2026-03-04T00:00:00.000Z');

    const pinned = updateMemo(list, 'a', { pinned: true }, later);
    expect(pinned[0].updatedAt).toBe(NOW_ISO);
    expect(pinned[0].pinned).toBe(true);

    const untouched = updateMemo(list, 'a', {}, later);
    expect(untouched[0].updatedAt).toBe(NOW_ISO);
    expect(untouched[0]).toEqual(list[0]);
    expect(base.getTime()).toBeLessThan(later.getTime());
  });

  test('正文未变化时不推进 updatedAt，非法颜色被忽略', () => {
    const list = [memo({ id: 'a', text: '同一段' })];
    const same = updateMemo(list, 'a', { text: '同一段' }, new Date('2026-04-04T00:00:00.000Z'));
    expect(same[0].updatedAt).toBe(NOW_ISO);

    const badColor = updateMemo(list, 'a', { color: 'chartreuse' as MemoColor }, new Date('2026-04-04T00:00:00.000Z'));
    expect(badColor[0].color).toBe('yellow');
    expect(badColor[0].updatedAt).toBe(NOW_ISO);
  });

  test('正文截断且空白补丁不会清空正文', () => {
    const list = [memo({ id: 'a', text: '原文' })];
    const long = updateMemo(list, 'a', { text: 'c'.repeat(MAX_MEMO_LENGTH + 5) }, NOW);
    expect(long[0].text).toHaveLength(MAX_MEMO_LENGTH);

    const blank = updateMemo(list, 'a', { text: '   ' }, NOW);
    expect(blank[0].text).toBe('原文');
  });

  test('只影响命中的那条', () => {
    const list = [memo({ id: 'a', text: 'A' }), memo({ id: 'b', text: 'B' })];
    const next = updateMemo(list, 'b', { text: 'B2' }, NOW);
    expect(next[0]).toBe(list[0]);
    expect(next[1].text).toBe('B2');
  });
});

describe('removeMemo', () => {
  test('删除命中项且不改动入参', () => {
    const list = [memo({ id: 'a' }), memo({ id: 'b' })];
    const snapshot = clone(list);
    const next = removeMemo(list, 'a');
    expect(next.map((item) => item.id)).toEqual(['b']);
    expect(list).toEqual(snapshot);
  });

  test('id 不存在时内容不变', () => {
    const list = [memo({ id: 'a' })];
    const next = removeMemo(list, 'nope');
    expect(next).toHaveLength(1);
    expect(next[0]).toBe(list[0]);
  });
});

describe('toggleMemoDone / toggleMemoPinned', () => {
  test('toggleMemoDone 往返切换并推进 updatedAt', () => {
    const list = [memo({ id: 'a', done: false })];
    const snapshot = clone(list);
    const on = toggleMemoDone(list, 'a', new Date('2026-05-05T00:00:00.000Z'));
    expect(on[0].done).toBe(true);
    expect(on[0].updatedAt).toBe('2026-05-05T00:00:00.000Z');
    expect(list).toEqual(snapshot);

    const off = toggleMemoDone(on, 'a', new Date('2026-05-06T00:00:00.000Z'));
    expect(off[0].done).toBe(false);
    expect(off[0].updatedAt).toBe('2026-05-06T00:00:00.000Z');
  });

  test('toggleMemoPinned 往返切换且不改动入参', () => {
    const list = [memo({ id: 'a', pinned: false })];
    const snapshot = clone(list);
    const on = toggleMemoPinned(list, 'a', NOW);
    expect(on[0].pinned).toBe(true);
    expect(list).toEqual(snapshot);

    const off = toggleMemoPinned(on, 'a', NOW);
    expect(off[0].pinned).toBe(false);
  });

  test('未知 id 返回新数组但内容不变', () => {
    const list = [memo({ id: 'a' })];
    const snapshot = clone(list);
    const done = toggleMemoDone(list, 'nope', NOW);
    const pinned = toggleMemoPinned(list, 'nope', NOW);
    expect(done).not.toBe(list);
    expect(pinned).not.toBe(list);
    expect(done).toEqual(snapshot);
    expect(pinned).toEqual(snapshot);
  });
});

describe('memoStats', () => {
  test('统计总数/完成/未完成/置顶', () => {
    const list = [
      memo({ id: 'a', done: true, pinned: true }),
      memo({ id: 'b', done: false, pinned: true }),
      memo({ id: 'c', done: false, pinned: false }),
    ];
    expect(memoStats(list)).toEqual({ total: 3, done: 1, open: 2, pinned: 2 });
  });

  test('空输入全为 0 且不产生 NaN', () => {
    const stats = memoStats([]);
    expect(stats).toEqual({ total: 0, done: 0, open: 0, pinned: 0 });
    for (const value of Object.values(stats)) {
      expect(Number.isNaN(value)).toBe(false);
      expect(Number.isFinite(value)).toBe(true);
    }
  });
});

describe('storage 读写', () => {
  test('无数据时加载为空数组', async () => {
    await expect(loadMemos()).resolves.toEqual([]);
  });

  test('保存时归一化、去重并写入存储', async () => {
    const saved = await saveMemos([
      normalizeMemo(raw({ text: '第一份' }), NOW) as Memo,
      normalizeMemo(raw({ text: '重复' }), NOW) as Memo,
      { id: 'x', text: '   ' } as unknown as Memo,
    ]);
    expect(saved).toHaveLength(1);
    expect(saved[0].text).toBe('第一份');
    expect(store[MEMOS_KEY]).toEqual(saved);
  });

  test('保存后再加载可往返', async () => {
    const created = createMemo({ text: '待读清单', color: 'purple', pinned: true }, NOW);
    await saveMemos([created]);
    await expect(loadMemos()).resolves.toEqual([created]);
  });

  test('loadMemos 对畸形存储载荷保持防御', async () => {
    store[MEMOS_KEY] = 'not-an-array';
    await expect(loadMemos()).resolves.toEqual([]);

    store[MEMOS_KEY] = [null, { text: '只有正文' }, 42];
    const list = await loadMemos();
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('只有正文');
    expect(list[0].color).toBe('yellow');
  });

  test('存储读抛错时 loadMemos 返回空数组', async () => {
    chromeHost.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => { throw new Error('storage 坏了'); }),
          set: vi.fn(async () => { /* noop */ }),
        },
      },
    };
    await expect(loadMemos()).resolves.toEqual([]);
  });

  test('存储写抛错时 saveMemos 仍返回归一化结果', async () => {
    chromeHost.chrome = {
      storage: {
        local: {
          get: vi.fn(async () => ({})),
          set: vi.fn(async () => { throw new Error('写入失败'); }),
        },
      },
    };
    const list = [normalizeMemo(raw(), NOW) as Memo];
    await expect(saveMemos(list)).resolves.toEqual(list);
  });
});

describe('无 chrome 环境降级', () => {
  test('缺少 chrome 时读写不抛错', async () => {
    const original = chromeHost.chrome;
    delete chromeHost.chrome;
    try {
      await expect(loadMemos()).resolves.toEqual([]);
      const list = await saveMemos([normalizeMemo(raw(), NOW) as Memo]);
      expect(list).toHaveLength(1);
      expect(list[0].text).toBe('买牛奶');
    } finally {
      chromeHost.chrome = original;
    }
  });

  test('storage 存在但缺少 local 时同样降级', async () => {
    const original = chromeHost.chrome;
    chromeHost.chrome = { storage: {} } as unknown as ChromeStub;
    try {
      await expect(loadMemos()).resolves.toEqual([]);
      await expect(saveMemos([])).resolves.toEqual([]);
    } finally {
      chromeHost.chrome = original;
    }
  });
});

describe('Memo 类型', () => {
  test('归一化结果满足接口', () => {
    const value: Memo = normalizeMemo(raw(), NOW) as Memo;
    expect(typeof value.id).toBe('string');
    expect(typeof value.text).toBe('string');
    expect(typeof value.createdAt).toBe('string');
    expect(typeof value.updatedAt).toBe('string');
    expect(typeof value.pinned).toBe('boolean');
    expect(typeof value.done).toBe('boolean');
    expect(MEMO_COLORS).toContain(value.color);
  });
});
