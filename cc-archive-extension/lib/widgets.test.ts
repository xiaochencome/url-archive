import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  defaultWidgets,
  loadWidgets,
  normalizeWidgets,
  reorderWidgets,
  resolveWidgetBoards,
  saveWidgets,
  WIDGETS_KEY,
} from './widgets';
import type { WidgetConfig } from './widgets';

let store: Record<string, unknown>;

beforeEach(() => {
  store = {};
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: store[key] })),
        set: vi.fn(async (obj: Record<string, unknown>) => { Object.assign(store, obj); }),
      },
    },
  };
});

function widget(overrides: Partial<WidgetConfig> = {}): WidgetConfig {
  return {
    id: 'github-trending',
    kind: 'github-trending',
    title: 'GitHub 趋势',
    enabled: true,
    order: 0,
    boardIds: [],
    ...overrides,
  };
}

describe('defaultWidgets', () => {
  test('默认一个启用的 GitHub 趋势部件且跟随全部榜单', () => {
    expect(defaultWidgets()).toEqual([
      {
        id: 'github-trending',
        kind: 'github-trending',
        title: 'GitHub 趋势',
        enabled: true,
        order: 0,
        boardIds: [],
      },
    ]);
  });

  test('每次返回新数组，避免共享引用', () => {
    expect(defaultWidgets()).not.toBe(defaultWidgets());
  });
});

describe('normalizeWidgets', () => {
  test('非数组回退默认', () => {
    expect(normalizeWidgets(null)).toEqual(defaultWidgets());
    expect(normalizeWidgets({})).toEqual(defaultWidgets());
    expect(normalizeWidgets('x')).toEqual(defaultWidgets());
  });

  test('空数组回退默认', () => {
    expect(normalizeWidgets([])).toEqual(defaultWidgets());
  });

  test('全部畸形时回退默认', () => {
    expect(normalizeWidgets([null, {}, { id: 'x' }, { kind: 'github-trending' }, 42]))
      .toEqual(defaultWidgets());
  });

  test('丢弃未知 kind', () => {
    const list = normalizeWidgets([widget({ kind: 'weather' as never })]);
    expect(list).toEqual(defaultWidgets());
  });

  test('去空白、按 order 排序、补齐缺省标题', () => {
    const list = normalizeWidgets([
      { id: ' b ', kind: 'github-trending', order: 2 },
      { id: 'a', kind: 'github-trending', title: '  ', order: 1 },
    ]);
    expect(list.map((item) => item.id)).toEqual(['a', 'b']);
    expect(list.map((item) => item.order)).toEqual([1, 2]);
    expect(list[0].title).toBe('GitHub 趋势');
  });

  test('按 id 去重且先出现优先', () => {
    const list = normalizeWidgets([
      widget({ id: 'a', title: '第一份', order: 0 }),
      widget({ id: 'a', title: '第二份', order: 1 }),
    ]);
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('第一份');
  });

  test('enabled 缺省为 true，非布尔值收敛为布尔', () => {
    const list = normalizeWidgets([
      widget({ id: 'a', enabled: undefined as never, order: 0 }),
      widget({ id: 'b', enabled: 'yes' as never, order: 1 }),
    ]);
    expect(list[0].enabled).toBe(true);
    expect(list[1].enabled).toBe(false);
  });

  test('boardIds 去重去空并忽略非字符串', () => {
    const list = normalizeWidgets([
      widget({ boardIds: ['weekly', 'weekly', ' ', 'monthly', 42 as never] }),
    ]);
    expect(list[0].boardIds).toEqual(['weekly', 'monthly']);
  });

  test('order 非法值回退 0', () => {
    const list = normalizeWidgets([widget({ order: 'x' as never })]);
    expect(list[0].order).toBe(0);
    expect(normalizeWidgets([widget({ order: '3' as never })])[0].order).toBe(3);
    expect(normalizeWidgets([widget({ order: -2 })])[0].order).toBe(-2);
  });
});

describe('loadWidgets / saveWidgets', () => {
  test('无数据时加载默认', async () => {
    await expect(loadWidgets()).resolves.toEqual(defaultWidgets());
  });

  test('保存归一化后的列表', async () => {
    const saved = await saveWidgets([
      widget({ id: 'a', order: 1, boardIds: ['weekly'] }),
      widget({ id: 'b', order: 0 }),
    ]);
    expect(saved.map((item) => item.id)).toEqual(['b', 'a']);
    expect(store[WIDGETS_KEY]).toEqual(saved);
  });

  test('畸形存储载荷回退默认', async () => {
    store[WIDGETS_KEY] = 'broken';
    await expect(loadWidgets()).resolves.toEqual(defaultWidgets());

    store[WIDGETS_KEY] = [null, { id: 'x', kind: 'nope' }];
    await expect(loadWidgets()).resolves.toEqual(defaultWidgets());
  });

  test('保存空列表回退默认', async () => {
    await expect(saveWidgets([])).resolves.toEqual(defaultWidgets());
  });
});

describe('resolveWidgetBoards', () => {
  const boards = [
    { id: 'weekly', enabled: true },
    { id: 'monthly', enabled: false },
    { id: 'yearly', enabled: true },
  ];

  test('boardIds 为空时返回全部已启用榜单', () => {
    expect(resolveWidgetBoards(widget({ boardIds: [] }), boards)).toEqual(['weekly', 'yearly']);
  });

  test('指定 boardIds 时取交集并保持 boardIds 顺序', () => {
    expect(resolveWidgetBoards(widget({ boardIds: ['yearly', 'weekly'] }), boards))
      .toEqual(['yearly', 'weekly']);
  });

  test('忽略未知 id 并保留已禁用的指定榜单', () => {
    expect(resolveWidgetBoards(widget({ boardIds: ['monthly', 'nope'] }), boards))
      .toEqual(['monthly']);
  });

  test('空榜单返回空', () => {
    expect(resolveWidgetBoards(widget(), [])).toEqual([]);
    expect(resolveWidgetBoards(widget({ boardIds: ['weekly'] }), [])).toEqual([]);
  });
});

describe('reorderWidgets', () => {
  const list = [
    widget({ id: 'a', order: 0 }),
    widget({ id: 'b', order: 1 }),
    widget({ id: 'c', order: 2 }),
  ];

  test('上移一位并重排 order', () => {
    const next = reorderWidgets(list, 'b', -1);
    expect(next.map((item) => item.id)).toEqual(['b', 'a', 'c']);
    expect(next.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  test('下移一位并重排 order', () => {
    const next = reorderWidgets(list, 'b', 1);
    expect(next.map((item) => item.id)).toEqual(['a', 'c', 'b']);
    expect(next.map((item) => item.order)).toEqual([0, 1, 2]);
  });

  test('顶部上移被钳制', () => {
    const next = reorderWidgets(list, 'a', -1);
    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  test('底部下移被钳制', () => {
    const next = reorderWidgets(list, 'c', 1);
    expect(next.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  test('未知 id 返回按 order 排好的副本', () => {
    const unordered = [widget({ id: 'b', order: 5 }), widget({ id: 'a', order: 1 })];
    const next = reorderWidgets(unordered, 'nope', 1);
    expect(next.map((item) => item.id)).toEqual(['a', 'b']);
  });

  test('不修改入参', () => {
    const snapshot = list.map((item) => ({ ...item }));
    reorderWidgets(list, 'b', -1);
    expect(list).toEqual(snapshot);
  });

  test('空数组返回空', () => {
    expect(reorderWidgets([], 'a', 1)).toEqual([]);
  });

  test('单元素越界保持原样', () => {
    const single = [widget({ id: 'a', order: 0 })];
    expect(reorderWidgets(single, 'a', -1).map((item) => item.id)).toEqual(['a']);
    expect(reorderWidgets(single, 'a', 1).map((item) => item.id)).toEqual(['a']);
  });
});

describe('无 chrome 环境降级', () => {
  test('缺少 chrome 时读写不抛错', async () => {
    const original = (globalThis as any).chrome;
    delete (globalThis as any).chrome;
    try {
      await expect(loadWidgets()).resolves.toEqual(defaultWidgets());
      const saved = await saveWidgets([widget({ id: 'x' })]);
      expect(saved.map((item) => item.id)).toEqual(['x']);
    } finally {
      (globalThis as any).chrome = original;
    }
  });
});

describe('WIDGETS_KEY', () => {
  test('导出键名稳定', () => {
    expect(WIDGETS_KEY).toBe('dashboard_widgets');
  });
});
