import { describe, expect, test } from 'vitest';
import {
  DEFAULT_PANEL_ORDER,
  FULL_ROW_MIN_SPAN,
  GROUP_PANEL_PREFIX,
  MAX_FREE_COORD,
  MAX_FREE_SIZE,
  MAX_PANEL_HEIGHT,
  MAX_ROW_SPAN,
  MAX_SPAN,
  MIN_FREE_COORD,
  MIN_FREE_H,
  MIN_FREE_W,
  MIN_PANEL_HEIGHT,
  MIN_ROW_SPAN,
  MIN_SPAN,
  PANEL_GRID_COLUMNS,
  PANEL_LABELS,
  SPAN_PRESETS,
  cyclePanelSpan,
  defaultPanelLayout,
  isGroupPanel,
  isPanelVisible,
  moveNextTo,
  movePanel,
  normalizePanelLayout,
  packMasonry,
  panelListForSettings,
  planSnapColumns,
  resetPanelLayout,
  setLayoutMode,
  setPanelBox,
  setPanelColStart,
  setPanelHeight,
  setPanelRowSpan,
  setPanelSpan,
  spanPercent,
  toColStart,
  toHeight,
  toPanelBox,
  toRowSpan,
  toSpan,
  togglePanelHidden,
  type PanelBox,
  type PanelLayout,
  type PanelLayoutMode,
  type PanelState,
  type SnapItem,
} from './panel-layout';

/** 全部静态面板 id（源码 DEFAULT_PANEL_ORDER 的真实内容） */
const ALL_IDS = [...DEFAULT_PANEL_ORDER];

/** 某个 id 的默认宽度（取自 defaultPanelLayout 的真实行为，不硬编码数字） */
function defaultSpan(id: string): number {
  return defaultPanelLayout([id]).spans[id];
}

/** 某个 id 的默认列起点（同上，取自 defaultPanelLayout） */
function defaultColStart(id: string): number {
  return defaultPanelLayout([id]).colStarts[id];
}

/**
 * 默认占整行（span = 12）的静态面板。
 *
 * 改成两列布局后，源码的 DEFAULT_FULL_WIDTH 已经是空集，所以这里也按
 * defaultPanelLayout 的真实行为推导，而不是手写一份会过期的名单。
 */
const FULL_WIDTH_PANELS = ALL_IDS.filter((id) => defaultSpan(id) === PANEL_GRID_COLUMNS);

/** 默认半宽（span = 6）的静态面板：除整行集合之外的全部 */
const HALF_WIDTH_PANELS = ALL_IDS.filter((id) => !FULL_WIDTH_PANELS.includes(id));

/** 默认被钉住列起点（colStart !== 0）的静态面板，按 defaultPanelLayout 推导 */
const PINNED_COL_START_PANELS = ALL_IDS.filter((id) => defaultColStart(id) !== 0);

/** 动态书签分组面板的示例 id */
const GROUP_IDS = ['group-ai', 'group-dev'];

/** 快照：用于「入参未被修改」的断言 */
function snapshot(layout: PanelLayout): string {
  return JSON.stringify(layout);
}

/** 某个 id 在 order 里出现的次数 */
function countIn(layout: PanelLayout, id: string): number {
  return layout.order.filter((value) => value === id).length;
}

/** 断言给定的每个 id 在 order 里恰好出现一次 */
function expectEachOnce(layout: PanelLayout, ids: string[]): void {
  for (const id of ids) expect(countIn(layout, id)).toBe(1);
}

/** 把设置列表映射成 PanelState，同时校验两个导出类型的结构兼容性 */
function toStates(layout: PanelLayout): PanelState[] {
  return panelListForSettings(layout).map(({ id, span, height, hidden }) => ({ id, span, height, hidden }));
}

/** 把设置列表映射成「id → rowSpan」，用于断言行跨度 */
function rowSpanMap(layout: PanelLayout): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of panelListForSettings(layout)) map[item.id] = item.rowSpan;
  return map;
}

/** 把设置列表映射成「id → colStart」，用于断言显式列起点 */
function colStartMap(layout: PanelLayout): Record<string, number> {
  const map: Record<string, number> = {};
  for (const item of panelListForSettings(layout)) map[item.id] = item.colStart;
  return map;
}

/** 注入任意（可能非法）rowSpan 值：专门用于验证运行时的兜底行为 */
function withRowSpans(layout: PanelLayout, rowSpans: Record<string, unknown>): PanelLayout {
  return { ...layout, rowSpans: rowSpans as unknown as Record<string, number> };
}

/** 注入任意（可能非法）colStart 值：专门用于验证运行时的兜底行为 */
function withColStarts(layout: PanelLayout, colStarts: Record<string, unknown>): PanelLayout {
  return { ...layout, colStarts: colStarts as unknown as Record<string, number> };
}

/**
 * 一个手工构造的、带自定义 span / height / hidden 的布局（默认吸附模式，无自由坐标）。
 *
 * 注意 rowSpans / colStarts 必须放在 `...overrides` 之后：overrides 是 Partial<PanelLayout>，
 * 展开会让这两个字段变成「可选」，直接放进字面量里会丢掉必填字段的类型信息
 * （TS2322）。放到后面既满足必填约束，又保证调用方显式传入时能覆盖。
 */
function makeLayout(overrides: Partial<PanelLayout> = {}): PanelLayout {
  return {
    mode: 'snap',
    order: ['clockBlock', 'memoBlock', 'localBlock'],
    positions: {},
    spans: { clockBlock: 6, memoBlock: 4, localBlock: 12 },
    heights: { clockBlock: 0, memoBlock: 0, localBlock: 0 },
    hidden: [],
    ...overrides,
    rowSpans: overrides.rowSpans ?? { clockBlock: 1, memoBlock: 1, localBlock: 1 },
    colStarts: overrides.colStarts ?? { clockBlock: 0, memoBlock: 0, localBlock: 0 },
  };
}

/** 一个手工构造的、自由模式布局：order 与 makeLayout 一致，但带 positions */
function makeFreeLayout(overrides: Partial<PanelLayout> = {}): PanelLayout {
  return makeLayout({
    mode: 'free',
    positions: {
      clockBlock: { x: 0, y: 0, w: 320, h: 160 },
      memoBlock: { x: 340, y: 0, w: 200, h: 120 },
    },
    ...overrides,
  });
}

/** 一个合法的自由坐标盒（用作 setPanelBox 的正常入参） */
const VALID_BOX: PanelBox = { x: 10, y: 20, w: 300, h: 200 };

/** 注入任意（可能非法）span 值：专门用于验证运行时的兜底行为 */
function withSpans(layout: PanelLayout, spans: Record<string, unknown>): PanelLayout {
  return { ...layout, spans: spans as unknown as Record<string, number> };
}

/** 注入任意（可能非法）height 值 */
function withHeights(layout: PanelLayout, heights: Record<string, unknown>): PanelLayout {
  return { ...layout, heights: heights as unknown as Record<string, number> };
}

describe('网格与区间常量', () => {
  test('基准网格是 12 列', () => {
    expect(PANEL_GRID_COLUMNS).toBe(12);
  });

  test('MIN_SPAN / MAX_SPAN 是 2 / 12，且 MAX_SPAN 等于网格列数', () => {
    expect(MIN_SPAN).toBe(2);
    expect(MAX_SPAN).toBe(12);
    expect(MAX_SPAN).toBe(PANEL_GRID_COLUMNS);
    expect(MIN_SPAN).toBeLessThan(MAX_SPAN);
  });

  test('高度区间是 80 ~ 2000（px）', () => {
    expect(MIN_PANEL_HEIGHT).toBe(80);
    expect(MAX_PANEL_HEIGHT).toBe(2000);
    expect(MIN_PANEL_HEIGHT).toBeLessThan(MAX_PANEL_HEIGHT);
  });

  test('SPAN_PRESETS 是 [3,4,6,8,12] 且严格递增、全部落在合法区间内', () => {
    expect(SPAN_PRESETS).toEqual([3, 4, 6, 8, 12]);
    expect(SPAN_PRESETS).toHaveLength(5);
    for (let i = 0; i < SPAN_PRESETS.length; i += 1) {
      expect(toSpan(SPAN_PRESETS[i])).toBe(SPAN_PRESETS[i]);
      if (i > 0) expect(SPAN_PRESETS[i]).toBeGreaterThan(SPAN_PRESETS[i - 1]);
    }
    expect(SPAN_PRESETS[SPAN_PRESETS.length - 1]).toBe(MAX_SPAN);
  });

  test('SPAN_PRESETS 里没有 MIN_SPAN(2)：2 列只能靠手动设置得到', () => {
    expect(SPAN_PRESETS).not.toContain(MIN_SPAN);
  });

  test('行跨度区间是 1 ~ 6（吸附网格里「1×2」「2×2」的高度）', () => {
    expect(MIN_ROW_SPAN).toBe(1);
    expect(MAX_ROW_SPAN).toBe(6);
    expect(MIN_ROW_SPAN).toBeLessThan(MAX_ROW_SPAN);
    // 行跨度与列跨度是两个独立区间：列最小 2、行最小 1
    expect(MIN_ROW_SPAN).not.toBe(MIN_SPAN);
    expect(MAX_ROW_SPAN).not.toBe(MAX_SPAN);
  });

  test('GROUP_PANEL_PREFIX 是 group-', () => {
    expect(GROUP_PANEL_PREFIX).toBe('group-');
  });
});

describe('isGroupPanel', () => {
  test('group- 前缀的 id 判为分组面板', () => {
    expect(isGroupPanel('group-ai')).toBe(true);
    expect(isGroupPanel('group-dev')).toBe(true);
    expect(isGroupPanel('group-')).toBe(true);
    expect(isGroupPanel('group-中文分组')).toBe(true);
  });

  test('其它 id 一律不是分组面板', () => {
    for (const id of [...ALL_IDS, '', 'group', 'Group-ai', 'groupBlock', 'xgroup-ai', 'my-group-ai', 'GROUP-']) {
      expect(isGroupPanel(id)).toBe(false);
    }
  });

  test('注意：只做前缀匹配，group-a-b 之类多段 id 同样为真', () => {
    expect(isGroupPanel('group-a-b')).toBe(true);
  });

  test('非字符串输入安全返回 false（不再抛 TypeError）', () => {
    // 修复前：直接调用 id.startsWith，非字符串会抛 TypeError
    expect(isGroupPanel(42 as unknown as string)).toBe(false);
    expect(isGroupPanel(null as unknown as string)).toBe(false);
    expect(isGroupPanel(undefined as unknown as string)).toBe(false);
  });
});

describe('PANEL_LABELS', () => {
  test('键集合与 DEFAULT_PANEL_ORDER 完全一致（新增静态面板必须同时补中文名）', () => {
    expect(Object.keys(PANEL_LABELS).sort()).toEqual([...ALL_IDS].sort());
    expect(Object.keys(PANEL_LABELS)).toHaveLength(ALL_IDS.length);
  });

  test('每个静态面板的中文名与源码一致', () => {
    expect(PANEL_LABELS).toEqual({
      launcherBlock: '启动器',
      clockBlock: '时间',
      memoBlock: '备忘',
      localBlock: '内网与自建服务',
      frequentBlock: '常用书签',
      tagBlock: '标签整理',
      widgetBlock: 'GitHub 趋势榜',
      githubBlock: 'GitHub 项目',
    });
  });

  test('不再包含已删除的 curatedBlock（书签分组改为动态面板）', () => {
    expect(PANEL_LABELS.curatedBlock).toBeUndefined();
    expect('curatedBlock' in PANEL_LABELS).toBe(false);
  });

  test('分组面板 id 在静态表里取不到标签（由调用方动态提供）', () => {
    for (const id of GROUP_IDS) expect(PANEL_LABELS[id]).toBeUndefined();
  });

  test('每个标签都是非空字符串', () => {
    for (const id of ALL_IDS) {
      expect(typeof PANEL_LABELS[id]).toBe('string');
      expect(PANEL_LABELS[id].trim().length).toBeGreaterThan(0);
    }
  });
});

describe('DEFAULT_PANEL_ORDER', () => {
  test('顺序与源码一致', () => {
    expect(DEFAULT_PANEL_ORDER).toEqual([
      'launcherBlock',
      'clockBlock',
      'memoBlock',
      'localBlock',
      'frequentBlock',
      'tagBlock',
      'widgetBlock',
      'githubBlock',
    ]);
    expect(DEFAULT_PANEL_ORDER[0]).toBe('launcherBlock');
  });

  test('没有重复 id，也没有动态分组 id', () => {
    expect(new Set(DEFAULT_PANEL_ORDER).size).toBe(DEFAULT_PANEL_ORDER.length);
    for (const id of DEFAULT_PANEL_ORDER) expect(isGroupPanel(id)).toBe(false);
  });

  test('整行集合与半宽集合正好切分全部静态面板', () => {
    expect([...FULL_WIDTH_PANELS, ...HALF_WIDTH_PANELS].sort()).toEqual([...ALL_IDS].sort());
    expect(new Set([...FULL_WIDTH_PANELS, ...HALF_WIDTH_PANELS]).size).toBe(ALL_IDS.length);
    for (const id of FULL_WIDTH_PANELS) expect(ALL_IDS).toContain(id);
    for (const id of HALF_WIDTH_PANELS) expect(ALL_IDS).toContain(id);
  });

  test('不再包含 curatedBlock', () => {
    expect(DEFAULT_PANEL_ORDER).not.toContain('curatedBlock');
  });
});

describe('toSpan', () => {
  test('接受 MIN_SPAN..MAX_SPAN 的整数并原样返回', () => {
    for (let n = MIN_SPAN; n <= MAX_SPAN; n += 1) expect(toSpan(n)).toBe(n);
    expect(toSpan(MIN_SPAN)).toBe(2);
    expect(toSpan(MAX_SPAN)).toBe(12);
  });

  test('接受纯整数字符串（含首尾空白与多余前导零）', () => {
    expect(toSpan('2')).toBe(2);
    expect(toSpan('6')).toBe(6);
    expect(toSpan('12')).toBe(12);
    expect(toSpan(' 2 ')).toBe(2);
    expect(toSpan('\t12\n')).toBe(12);
    expect(toSpan('006')).toBe(6);
    expect(toSpan('0012')).toBe(12);
    // 前导零再多也走 Number() 解析，仍得到 12
    expect(toSpan('0000000000000000000012')).toBe(12);
  });

  test('带符号前缀不再被接受（只有纯数字串合法）', () => {
    expect(toSpan('+3')).toBeNull();
    expect(toSpan('-3')).toBeNull();
  });

  test('越界整数返回 null', () => {
    for (const value of [0, 1, -1, 13, 99, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(toSpan(value)).toBeNull();
    }
    for (const value of ['0', '1', '-1', '13', '99', '00013']) expect(toSpan(value)).toBeNull();
  });

  test('非有限数字返回 null', () => {
    expect(toSpan(NaN)).toBeNull();
    expect(toSpan(Infinity)).toBeNull();
    expect(toSpan(-Infinity)).toBeNull();
  });

  test('空串 / 纯空白 / 非数字字符串返回 null', () => {
    for (const value of ['', ' ', '  ', '\t', 'abc', 'null', 'undefined', 'NaN', '1 2']) {
      expect(toSpan(value)).toBeNull();
    }
  });

  test('null / undefined / 布尔 / 对象 / 数组返回 null', () => {
    for (const value of [null, undefined, {}, { span: 3 }, true, false, [], [2], [2, 3]]) {
      expect(toSpan(value)).toBeNull();
    }
  });

  test('带 toString 的对象不会被强转放行', () => {
    // 源码刻意不用 parseInt(String(v))：否则 {toString:()=>'4'} 会悄悄变成 4
    expect(toSpan({ toString: () => '4' })).toBeNull();
    expect(toSpan({ valueOf: () => 6 })).toBeNull();
  });

  test('小数（数字路径）按 Math.round 取整', () => {
    expect(toSpan(2.4)).toBe(2);
    expect(toSpan(2.5)).toBe(3);
    expect(toSpan(3.4)).toBe(3);
    expect(toSpan(5.5)).toBe(6);
    expect(toSpan(11.4)).toBe(11);
    expect(toSpan(11.5)).toBe(12);
    expect(toSpan(12.4)).toBe(12);
  });

  test('取整之后越界仍然返回 null', () => {
    expect(toSpan(1.4)).toBeNull(); // Math.round(1.4) === 1 < MIN_SPAN
    expect(toSpan(12.5)).toBeNull(); // Math.round(12.5) === 13 > MAX_SPAN
    expect(toSpan(0.5)).toBeNull();
    expect(toSpan(-0.4)).toBeNull();
    expect(toSpan(-0)).toBeNull();
    expect(toSpan(Number.EPSILON)).toBeNull();
  });

  test('带小数的字符串视为非法（字符串路径要求纯整数）', () => {
    expect(toSpan('2.9')).toBeNull();
    expect(toSpan('3.9')).toBeNull();
    expect(toSpan('2.0')).toBeNull();
    // 数字路径仍然四舍五入
    expect(toSpan(2.9)).toBe(3);
    expect(toSpan(3.9)).toBe(4);
  });

  test('带尾随垃圾 / 科学计数法 / 十六进制的字符串一律判非法', () => {
    expect(toSpan('3abc')).toBeNull();
    expect(toSpan('4px')).toBeNull();
    expect(toSpan('1e2')).toBeNull();
    expect(toSpan('0x4')).toBeNull();
    expect(toSpan('3,4')).toBeNull();
  });

  test('合法输入满足幂等：toSpan(toSpan(x)) === toSpan(x)', () => {
    for (const value of [2, 3, 6, 12, '2', '12', 4.6]) {
      const once = toSpan(value);
      expect(once).not.toBeNull();
      expect(toSpan(once)).toBe(once);
    }
  });
});

describe('toRowSpan', () => {
  test('接受 MIN_ROW_SPAN..MAX_ROW_SPAN 的整数并原样返回', () => {
    for (let n = MIN_ROW_SPAN; n <= MAX_ROW_SPAN; n += 1) expect(toRowSpan(n)).toBe(n);
    expect(toRowSpan(MIN_ROW_SPAN)).toBe(1);
    expect(toRowSpan(MAX_ROW_SPAN)).toBe(6);
  });

  test('0 是「自动」：数字 0 与字符串 0 都返回 0（不再是非法值）', () => {
    // 变更前 0 非法；现在 0 表示「由 UI 按内容实际高度换算行数」
    expect(toRowSpan(0)).toBe(0);
    expect(toRowSpan('0')).toBe(0);
    expect(toRowSpan(' 0 ')).toBe(0);
    expect(toRowSpan('000')).toBe(0);
    expect(Object.is(toRowSpan(0), 0)).toBe(true);
  });

  test('0 与 MIN_ROW_SPAN 之间的整数仍非法（只有精确的 0 是自动）', () => {
    // MIN_ROW_SPAN = 1，所以没有整数夹在中间；这里锁定「0 是唯一的自动值」
    expect(toRowSpan(MIN_ROW_SPAN)).toBe(1);
    expect(toRowSpan(0)).toBe(0);
    expect(toRowSpan(0)).not.toBe(MIN_ROW_SPAN);
  });

  test('接受纯整数字符串（含首尾空白与多余前导零）', () => {
    expect(toRowSpan('1')).toBe(1);
    expect(toRowSpan('3')).toBe(3);
    expect(toRowSpan('6')).toBe(6);
    expect(toRowSpan(' 2 ')).toBe(2);
    expect(toRowSpan('\t6\n')).toBe(6);
    expect(toRowSpan('006')).toBe(6);
    expect(toRowSpan('0000000000000000000002')).toBe(2);
  });

  test('越界整数返回 null（0 已被「自动」占用，不再是非法值）', () => {
    for (const value of [-1, 7, 99, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(toRowSpan(value)).toBeNull();
    }
    for (const value of ['-1', '7', '99', '00007']) expect(toRowSpan(value)).toBeNull();
  });

  test('NaN / Infinity / -Infinity 返回 null', () => {
    expect(toRowSpan(NaN)).toBeNull();
    expect(toRowSpan(Infinity)).toBeNull();
    expect(toRowSpan(-Infinity)).toBeNull();
  });

  test('空串 / 纯空白 / 非数字字符串返回 null', () => {
    for (const value of ['', ' ', '  ', '\t', 'abc', 'null', 'undefined', 'NaN', '1 2']) {
      expect(toRowSpan(value)).toBeNull();
    }
  });

  test('带符号前缀 / 带小数点的字符串视为非法（字符串路径要求纯整数）', () => {
    expect(toRowSpan('+3')).toBeNull();
    expect(toRowSpan('-3')).toBeNull();
    expect(toRowSpan('2.9')).toBeNull();
    expect(toRowSpan('1.0')).toBeNull();
  });

  test('带尾随垃圾 / 科学计数法 / 十六进制的字符串一律判非法', () => {
    expect(toRowSpan('3abc')).toBeNull();
    expect(toRowSpan('2px')).toBeNull();
    expect(toRowSpan('1e2')).toBeNull();
    expect(toRowSpan('0x2')).toBeNull();
    expect(toRowSpan('1,2')).toBeNull();
  });

  test('null / undefined / 布尔 / 对象 / 数组返回 null', () => {
    for (const value of [null, undefined, {}, { rowSpan: 3 }, true, false, [], [2], [2, 3]]) {
      expect(toRowSpan(value)).toBeNull();
    }
  });

  test('带 toString / valueOf 的对象不会被强转放行', () => {
    // 与 toSpan 一致：刻意不用 parseInt(String(v))，否则 {toString:()=>'4'} 会悄悄变成 4
    expect(toRowSpan({ toString: () => '4' })).toBeNull();
    expect(toRowSpan({ valueOf: () => 2 })).toBeNull();
  });

  test('小数（数字路径）按 Math.round 取整', () => {
    expect(toRowSpan(1.4)).toBe(1);
    expect(toRowSpan(1.5)).toBe(2);
    expect(toRowSpan(2.4)).toBe(2);
    expect(toRowSpan(2.5)).toBe(3);
    expect(toRowSpan(5.5)).toBe(6);
    expect(toRowSpan(6.4)).toBe(6);
  });

  test('取整之后越界仍然返回 null', () => {
    expect(toRowSpan(6.5)).toBeNull(); // Math.round(6.5) === 7 > MAX_ROW_SPAN
    expect(toRowSpan(7.4)).toBeNull();
  });

  test('负值一律判非法（不再因 -0 而静默变成「自动」）', () => {
    // 修复前：Math.round(-0.4) === -0，而 -0 === 0，于是 -0.4 被当成「自动」。
    // 现在先在取整前判原始值是否为负，负数一律 null。
    expect(toRowSpan(-0.4)).toBeNull();
    expect(toRowSpan(-0.6)).toBeNull();
    expect(toRowSpan(-1)).toBeNull();
    // 精确的 0 仍然是「自动」
    expect(toRowSpan(0)).toBe(0);
    expect(toRowSpan(Number.EPSILON)).toBe(0);
  });

  test('注意：0.4 取整成 0 → 变成「自动」；0.5 进位成 1 → 合法的单行高', () => {
    // Math.round 语义：0.4 → 0（现在合法，等于自动）、0.5 → 1
    expect(toRowSpan(0.4)).toBe(0);
    expect(toRowSpan(0.5)).toBe(1);
  });

  test('合法输入满足幂等：toRowSpan(toRowSpan(x)) === toRowSpan(x)', () => {
    for (const value of [0, 1, 3, 6, '1', '6', 2.6]) {
      const once = toRowSpan(value);
      expect(once).not.toBeNull();
      expect(toRowSpan(once)).toBe(once);
    }
  });

  test('与 toSpan 的区间不同：1 合法而 12 非法（toSpan 恰好相反）', () => {
    expect(toRowSpan(1)).toBe(1);
    expect(toSpan(1)).toBeNull();
    // 行跨度最大 6，列跨度最大 12
    expect(toRowSpan(12)).toBeNull();
    expect(toSpan(12)).toBe(12);
    // 7 在列区间内、在行区间外
    expect(toRowSpan(7)).toBeNull();
    expect(toSpan(7)).toBe(7);
    // 0 对 toRowSpan 合法（自动）、对 toSpan 非法
    expect(toRowSpan(0)).toBe(0);
    expect(toSpan(0)).toBeNull();
  });
});

describe('toColStart', () => {
  test('0 表示「自动排布」，原样返回 0', () => {
    expect(toColStart(0)).toBe(0);
    expect(Object.is(toColStart(0), 0)).toBe(true);
  });

  test('接受 1..PANEL_GRID_COLUMNS 的整数并原样返回', () => {
    for (let n = 1; n <= PANEL_GRID_COLUMNS; n += 1) expect(toColStart(n)).toBe(n);
    expect(toColStart(1)).toBe(1);
    expect(toColStart(PANEL_GRID_COLUMNS)).toBe(12);
  });

  test('接受纯整数字符串（含首尾空白与多余前导零）', () => {
    expect(toColStart('0')).toBe(0);
    expect(toColStart('1')).toBe(1);
    expect(toColStart('7')).toBe(7);
    expect(toColStart('12')).toBe(12);
    expect(toColStart(' 7 ')).toBe(7);
    expect(toColStart('\t12\n')).toBe(12);
    expect(toColStart('007')).toBe(7);
    expect(toColStart('0000000000000000000012')).toBe(12);
  });

  test('0 的邻域非法值一律返回 null（-1 / 13 都是越界）', () => {
    for (const value of [-1, 13, 99, -99, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(toColStart(value)).toBeNull();
    }
    for (const value of ['-1', '13', '99', '00013']) expect(toColStart(value)).toBeNull();
  });

  test('NaN / Infinity / -Infinity 返回 null', () => {
    expect(toColStart(NaN)).toBeNull();
    expect(toColStart(Infinity)).toBeNull();
    expect(toColStart(-Infinity)).toBeNull();
  });

  test('空串 / 纯空白 / 非数字字符串返回 null', () => {
    for (const value of ['', ' ', '  ', '\t', 'abc', 'null', 'undefined', 'NaN', '1 2']) {
      expect(toColStart(value)).toBeNull();
    }
  });

  test('数组 / 带 toString 的对象不会被强转放行', () => {
    for (const value of [[], [1], [1, 2], [0], { toString: () => '2' }, { valueOf: () => 3 }]) {
      expect(toColStart(value)).toBeNull();
    }
    // 与 toSpan 一致：刻意不用 parseInt(String(v))
    expect(toColStart({ toString: () => '2' })).toBeNull();
  });

  test('null / undefined / 布尔 / 普通对象返回 null', () => {
    for (const value of [null, undefined, {}, { colStart: 3 }, true, false]) {
      expect(toColStart(value)).toBeNull();
    }
  });

  test("带小数的字符串视为非法（'2.9' → null，字符串路径要求纯整数）", () => {
    expect(toColStart('2.9')).toBeNull();
    expect(toColStart('1.0')).toBeNull();
    expect(toColStart('0.0')).toBeNull();
    expect(toColStart('+3')).toBeNull();
    expect(toColStart('-3')).toBeNull();
    expect(toColStart('3abc')).toBeNull();
    expect(toColStart('1e2')).toBeNull();
    expect(toColStart('0x2')).toBeNull();
  });

  test('小数（数字路径）按 Math.round 取整后再判区间', () => {
    expect(toColStart(1.4)).toBe(1);
    expect(toColStart(1.5)).toBe(2);
    expect(toColStart(6.4)).toBe(6);
    expect(toColStart(11.5)).toBe(12);
    // 取整到 0 → 自动
    expect(toColStart(0.4)).toBe(0);
    expect(toColStart(0.5)).toBe(1);
    // 取整之后越界仍然 null
    expect(toColStart(12.5)).toBeNull(); // → 13
    expect(toColStart(13.4)).toBeNull();
  });

  test('负值一律判非法', () => {
    expect(toColStart(-0.4)).toBeNull();
    expect(toColStart(-0.6)).toBeNull();
    expect(toColStart(-1)).toBeNull();
    expect(toColStart(0)).toBe(0);
    expect(Object.is(toColStart(0), 0)).toBe(true);
  });

  test('合法输入满足幂等：toColStart(toColStart(x)) === toColStart(x)', () => {
    for (const value of [0, 1, 7, 12, '0', '7', '12', 2.6]) {
      const once = toColStart(value);
      expect(once).not.toBeNull();
      expect(toColStart(once)).toBe(once);
    }
  });

  test('与 toSpan / toRowSpan 的区间都不同：0 合法、1 合法、13 非法', () => {
    expect(toColStart(0)).toBe(0);
    expect(toSpan(0)).toBeNull();
    expect(toRowSpan(0)).toBe(0); // 恰好与 toColStart 一致：0 都是「自动」
    // 1 在列起点与行跨度里合法，在列宽里非法
    expect(toColStart(1)).toBe(1);
    expect(toRowSpan(1)).toBe(1);
    expect(toSpan(1)).toBeNull();
    // 13 三个函数全部拒绝
    expect(toColStart(13)).toBeNull();
    expect(toSpan(13)).toBeNull();
    expect(toRowSpan(13)).toBeNull();
    // 12 在列起点与列宽里合法，在行跨度里非法
    expect(toColStart(12)).toBe(12);
    expect(toSpan(12)).toBe(12);
    expect(toRowSpan(12)).toBeNull();
  });
});

describe('toHeight', () => {
  test('0 表示自适应，原样返回 0', () => {
    expect(toHeight(0)).toBe(0);
    expect(toHeight('0')).toBe(0);
    expect(toHeight(' 0 ')).toBe(0);
  });

  test('负数高度一律非法（不再被当作自适应）', () => {
    // 修复前：-0.4 会被四舍五入成 0 从而变成「自适应」，语义很反直觉
    expect(toHeight(-0.4)).toBeNull();
    expect(toHeight(-1)).toBeNull();
    expect(toHeight(-999)).toBeNull();
    // 精确的 0 仍是自适应，且返回字面量 0
    expect(toHeight(0)).toBe(0);
    expect(Object.is(toHeight(0), 0)).toBe(true);
  });

  test('小数高度按四舍五入后判定，不再出现 0.4 与 0.5 一合法一非法的割裂', () => {
    // 修复前：0.4 → 自适应(0)，0.5 → null，边界极不对称
    expect(toHeight(0.4)).toBeNull();
    expect(toHeight(0.5)).toBeNull();
    expect(toHeight(1)).toBeNull();
    // 达到最小高度的小数可以正常取整
    expect(toHeight(79.6)).toBe(80);
    expect(toHeight(320.4)).toBe(320);
  });

  test('接受 MIN_PANEL_HEIGHT..MAX_PANEL_HEIGHT 的整数', () => {
    expect(toHeight(MIN_PANEL_HEIGHT)).toBe(80);
    expect(toHeight(120)).toBe(120);
    expect(toHeight(MAX_PANEL_HEIGHT)).toBe(2000);
    for (let n = MIN_PANEL_HEIGHT; n <= MAX_PANEL_HEIGHT; n += 137) expect(toHeight(n)).toBe(n);
  });

  test('接受纯整数字符串', () => {
    expect(toHeight('80')).toBe(80);
    expect(toHeight('2000')).toBe(2000);
    expect(toHeight(' 640 ')).toBe(640);
    expect(toHeight('0600')).toBe(600);
  });

  test('越界值返回 null（不含 0）', () => {
    for (const value of [1, 79, -1, 2001, 99999, Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]) {
      expect(toHeight(value)).toBeNull();
    }
    for (const value of ['1', '79', '-80', '2001']) expect(toHeight(value)).toBeNull();
  });

  test('小数按 Math.round 取整后再判区间', () => {
    expect(toHeight(79.6)).toBe(80);
    expect(toHeight(80.4)).toBe(80);
    expect(toHeight(1999.6)).toBe(2000);
    expect(toHeight(2000.4)).toBe(2000);
    expect(toHeight(2000.6)).toBeNull(); // 取整成 2001 → 越界
    expect(toHeight(79.4)).toBeNull(); // 取整成 79 → 越界
  });

  test('非有限数字返回 null', () => {
    expect(toHeight(NaN)).toBeNull();
    expect(toHeight(Infinity)).toBeNull();
    expect(toHeight(-Infinity)).toBeNull();
  });

  test('空串 / 带小数点的字符串 / 带垃圾的字符串返回 null', () => {
    for (const value of ['', ' ', 'abc', '80px', '80.5', '1e3', '+80', '-0', '0x50']) {
      expect(toHeight(value)).toBeNull();
    }
  });

  test('null / undefined / 布尔 / 对象 / 数组返回 null', () => {
    for (const value of [null, undefined, {}, { height: 300 }, true, false, [], [300]]) {
      expect(toHeight(value)).toBeNull();
    }
    expect(toHeight({ toString: () => '300' })).toBeNull();
  });

  test('与 toSpan 不同：0 是合法值，且最小值不是同一个量级', () => {
    expect(toSpan(0)).toBeNull();
    expect(toHeight(0)).toBe(0);
    expect(toSpan(80)).toBeNull();
    expect(toHeight(80)).toBe(80);
  });
});

describe('自由模式常量', () => {
  test('MIN_FREE_W = 60，MIN_FREE_H = 40（白板式：面板可以很小）', () => {
    // 变更前是 120 / 60；放宽后旧测试里的 119 / 59 已不再是「低于下界」的值
    expect(MIN_FREE_W).toBe(60);
    expect(MIN_FREE_H).toBe(40);
    expect(MIN_FREE_W).toBeGreaterThan(0);
    expect(MIN_FREE_H).toBeGreaterThan(0);
  });

  test('MIN_FREE_COORD = -10000，是负坐标下界（自由模式允许往左 / 往上摆）', () => {
    expect(MIN_FREE_COORD).toBe(-10000);
    expect(MIN_FREE_COORD).toBeLessThan(0);
    expect(MAX_FREE_COORD).toBeGreaterThan(0);
    // 注意：区间并不对称 —— 负方向只留了 10000，正方向有 20000
    expect(MIN_FREE_COORD).not.toBe(-MAX_FREE_COORD);
  });

  test('PanelLayoutMode 有 snap / masonry / free 三个取值', () => {
    // 注意：除 snap / free 外源码还定义了 'masonry'（瀑布流），
    // 本用例此前只列了两个取值，断言虽通过但漏掉了真实成员。
    const modes: PanelLayoutMode[] = ['snap', 'masonry', 'free'];
    expect(modes).toHaveLength(3);
    // 类型层面保证只有这三个字面量；运行时 setLayoutMode 对三者都放行
    for (const mode of modes) expect(setLayoutMode(makeLayout(), mode).mode).toBe(mode);
  });
});

describe('toPanelBox', () => {
  test('合法盒子原样往返（整数）', () => {
    expect(toPanelBox({ x: 0, y: 0, w: MIN_FREE_W, h: MIN_FREE_H })).toEqual({ x: 0, y: 0, w: 60, h: 40 });
    expect(toPanelBox({ x: 12, y: 34, w: 300, h: 200 })).toEqual({ x: 12, y: 34, w: 300, h: 200 });
    // 上界之内的大坐标仍然接受
    expect(toPanelBox({ x: 9000, y: 8000, w: 9000, h: 8000 })).toEqual({ x: 9000, y: 8000, w: 9000, h: 8000 });
  });

  test('合法输入幂等：toPanelBox(toPanelBox(x)) 与一次结果一致', () => {
    for (const input of [
      { x: 0, y: 0, w: MIN_FREE_W, h: MIN_FREE_H },
      { x: 10.4, y: 20.6, w: 320.5, h: 160.4 },
      { x: '10', y: '20', w: '320', h: '160' },
    ]) {
      const once = toPanelBox(input);
      expect(once).not.toBeNull();
      expect(toPanelBox(once)).toEqual(once);
    }
  });

  test('null / undefined / 非对象一律拒绝', () => {
    for (const value of [
      null,
      undefined,
      'x',
      '',
      42,
      0,
      NaN,
      Infinity,
      true,
      false,
      () => ({ x: 0, y: 0, w: 200, h: 100 }),
    ]) {
      expect(toPanelBox(value)).toBeNull();
    }
  });

  test('数组被拒绝（typeof [] 是 object，但 isRecord 显式排除数组）', () => {
    expect(toPanelBox([])).toBeNull();
    expect(toPanelBox([0, 0, 200, 100])).toBeNull();
    expect(toPanelBox([{ x: 0, y: 0, w: 200, h: 100 }])).toBeNull();
  });

  test('字段缺失被拒绝（四个字段缺一不可）', () => {
    expect(toPanelBox({})).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: 200 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, w: 200, h: 100 })).toBeNull();
    expect(toPanelBox({ y: 0, w: 200, h: 100 })).toBeNull();
  });

  test('多余字段被忽略，返回值只有 x / y / w / h', () => {
    expect(toPanelBox({ x: 0, y: 0, w: 200, h: 100, z: 5, id: 'clockBlock', hidden: true })).toEqual({
      x: 0,
      y: 0,
      w: 200,
      h: 100,
    });
  });

  test('负 x / 负 y 现在被接受（白板式：可以往左 / 往上摆）', () => {
    // 变更前一律拒绝负坐标；现在只挡 MIN_FREE_COORD 以下的异常极值
    expect(toPanelBox({ x: -1, y: 0, w: 200, h: 100 })).toEqual({ x: -1, y: 0, w: 200, h: 100 });
    expect(toPanelBox({ x: 0, y: -1, w: 200, h: 100 })).toEqual({ x: 0, y: -1, w: 200, h: 100 });
    expect(toPanelBox({ x: -1, y: -1, w: 200, h: 100 })).toEqual({ x: -1, y: -1, w: 200, h: 100 });
    // 深负坐标只要在下界之内同样合法
    expect(toPanelBox({ x: -5000, y: -5000, w: 200, h: 100 })).toEqual({ x: -5000, y: -5000, w: 200, h: 100 });
    // 超过下界（-1e6 < MIN_FREE_COORD）仍然被拒绝
    expect(toPanelBox({ x: -1e6, y: 0, w: 200, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: -1e6, w: 200, h: 100 })).toBeNull();
  });

  test('负坐标边界：MIN_FREE_COORD 接受，MIN_FREE_COORD - 1 拒绝', () => {
    expect(toPanelBox({ x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: 200, h: 100 })).toEqual({
      x: MIN_FREE_COORD,
      y: MIN_FREE_COORD,
      w: 200,
      h: 100,
    });
    expect(toPanelBox({ x: MIN_FREE_COORD - 1, y: 0, w: 200, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: MIN_FREE_COORD - 1, w: 200, h: 100 })).toBeNull();
    // 只有其中一个坐标越界也整体拒绝
    expect(toPanelBox({ x: MIN_FREE_COORD, y: MIN_FREE_COORD - 1, w: 200, h: 100 })).toBeNull();
    expect(toPanelBox({ x: MIN_FREE_COORD - 1, y: MIN_FREE_COORD, w: 200, h: 100 })).toBeNull();
  });

  test('负宽高由下界检查兜住（w / h 都低于下界）', () => {
    expect(toPanelBox({ x: 0, y: 0, w: -200, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: 200, h: -100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: 0, h: 0 })).toBeNull();
  });

  test('小数负坐标取整后仍在下界之内，照常接受；-0 被归一为 0', () => {
    // 变更前：Math.round(-0.4) === -0，而 -0 < 0 是 false，这类值会绕过下界检查。
    // 现在负坐标本身就是合法值，所以真正的边界变成了「取整后是否低于 MIN_FREE_COORD」。
    expect(toPanelBox({ x: -0.4, y: -0.4, w: 200, h: 100 })).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(toPanelBox({ x: -0.6, y: 0, w: 200, h: 100 })).toEqual({ x: -1, y: 0, w: 200, h: 100 });
    expect(toPanelBox({ x: 0, y: -1, w: 200, h: 100 })).toEqual({ x: 0, y: -1, w: 200, h: 100 });
    // 下界之下的负坐标（取整后）依然被拒绝
    expect(toPanelBox({ x: MIN_FREE_COORD - 0.6, y: 0, w: 200, h: 100 })).toBeNull();

    // 显式 -0 被归一成真正的 0，Object.is 层面也不再是 -0
    const box = toPanelBox({ x: -0, y: -0, w: 200, h: 100 });
    expect(box).toEqual({ x: 0, y: 0, w: 200, h: 100 });
    expect(Object.is(box?.x, -0)).toBe(false);
    expect(Object.is(box?.y, -0)).toBe(false);
  });

  test('负坐标往返幂等：负坐标结果再次传入仍然一致', () => {
    for (const input of [
      { x: -1, y: -1, w: MIN_FREE_W, h: MIN_FREE_H },
      { x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: 200, h: 100 },
      { x: -320.4, y: -200.6, w: 320.5, h: 160.4 },
    ]) {
      const once = toPanelBox(input);
      expect(once).not.toBeNull();
      expect(toPanelBox(once)).toEqual(once);
    }
  });

  test('负坐标只挡下界，不挡负值本身：-1 / -9999 全部接受', () => {
    for (const n of [-1, -2, -100, -9999, MIN_FREE_COORD]) {
      expect(toPanelBox({ x: n, y: 0, w: 200, h: 100 })).toEqual({ x: n, y: 0, w: 200, h: 100 });
      expect(toPanelBox({ x: 0, y: n, w: 200, h: 100 })).toEqual({ x: 0, y: n, w: 200, h: 100 });
    }
  });

  test('w 低于 MIN_FREE_W 被拒绝，恰好等于下界则合法', () => {
    expect(toPanelBox({ x: 0, y: 0, w: MIN_FREE_W - 1, h: MIN_FREE_H })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: 59, h: MIN_FREE_H })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: MIN_FREE_W, h: MIN_FREE_H })).toEqual({ x: 0, y: 0, w: 60, h: 40 });
  });

  test('h 低于 MIN_FREE_H 被拒绝，恰好等于下界则合法', () => {
    expect(toPanelBox({ x: 0, y: 0, w: MIN_FREE_W, h: MIN_FREE_H - 1 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: MIN_FREE_W, h: 39 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: MIN_FREE_W, h: MIN_FREE_H })).toEqual({ x: 0, y: 0, w: 60, h: 40 });
  });

  test('小数按 Math.round 取整（数字路径）', () => {
    expect(toPanelBox({ x: 10.4, y: 20.5, w: 300.4, h: 200.6 })).toEqual({ x: 10, y: 21, w: 300, h: 201 });
    expect(toPanelBox({ x: 0.4, y: 0.6, w: 120.4, h: 60.4 })).toEqual({ x: 0, y: 1, w: 120, h: 60 });
  });

  test('先取整再判下界：59.6 → 60 合法，59.4 → 59 非法', () => {
    expect(toPanelBox({ x: 0, y: 0, w: 59.6, h: 39.5 })).toEqual({ x: 0, y: 0, w: 60, h: 40 });
    expect(toPanelBox({ x: 0, y: 0, w: 59.4, h: 40 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: 60, h: 39.4 })).toBeNull();
  });

  test('NaN / Infinity / -Infinity 被拒绝（任一字段都不行）', () => {
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(toPanelBox({ x: bad, y: 0, w: 200, h: 100 })).toBeNull();
      expect(toPanelBox({ x: 0, y: bad, w: 200, h: 100 })).toBeNull();
      expect(toPanelBox({ x: 0, y: 0, w: bad, h: 100 })).toBeNull();
      expect(toPanelBox({ x: 0, y: 0, w: 200, h: bad })).toBeNull();
    }
  });

  test('纯整数字符串字段被接受（与 toSpan / toHeight 的字符串路径一致）', () => {
    expect(toPanelBox({ x: '10', y: '20', w: '300', h: '200' })).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    expect(toPanelBox({ x: ' 0 ', y: '\t0\n', w: '0120', h: '0060' })).toEqual({ x: 0, y: 0, w: 120, h: 60 });
  });

  test('非纯整数的字符串字段被拒绝', () => {
    for (const bad of ['10.5', '+10', '-10', '1e3', '0x64', 'abc', '', ' ', '120px', '1 20', '120,0']) {
      expect(toPanelBox({ x: 0, y: 0, w: bad, h: '100' })).toBeNull();
      expect(toPanelBox({ x: bad, y: 0, w: 200, h: 100 })).toBeNull();
    }
  });

  test('布尔 / 对象 / 数组 / null 字段不会被强转放行', () => {
    expect(toPanelBox({ x: 0, y: 0, w: true, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: false, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: [200], h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: { toString: () => '200' }, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: { valueOf: () => 200 }, h: 100 })).toBeNull();
    expect(toPanelBox({ x: null, y: 0, w: 200, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: undefined, w: 200, h: 100 })).toBeNull();
  });

  test('超出上界的坐标与尺寸被拒绝', () => {
    // 修复前无上界，MAX_SAFE_INTEGER 级坐标会被原样接受，
    // 异常存档能把面板推到看不见的地方。
    expect(toPanelBox({ x: 1e6, y: 1e6, w: 1e6, h: 1e6 })).toBeNull();
    expect(toPanelBox({ x: Number.MAX_SAFE_INTEGER, y: 0, w: 200, h: 100 })).toBeNull();
    expect(toPanelBox({ x: 0, y: 0, w: MAX_FREE_SIZE + 1, h: 100 })).toBeNull();
    expect(toPanelBox({ x: MAX_FREE_COORD + 1, y: 0, w: 200, h: 100 })).toBeNull();
    // 恰好等于上界仍可接受
    expect(toPanelBox({ x: MAX_FREE_COORD, y: 0, w: 200, h: 100 })).not.toBeNull();
  });

  test('返回的是新对象，与入参不共享引用', () => {
    const input = { x: 10, y: 20, w: 300, h: 200 };
    const box = toPanelBox(input);
    expect(box).not.toBe(input);
    expect(box).toEqual({ x: 10, y: 20, w: 300, h: 200 });
    if (box) box.x = 999;
    expect(input.x).toBe(10);
  });

  test('Date / Map 之类「是对象但没有坐标字段」的输入返回 null', () => {
    expect(toPanelBox(new Date())).toBeNull();
    expect(toPanelBox(new Map())).toBeNull();
    expect(toPanelBox(Object.create(null))).toBeNull();
  });
});

describe('defaultPanelLayout', () => {
  test('包含全部已知 id，且顺序与 DEFAULT_PANEL_ORDER 完全一致', () => {
    const layout = defaultPanelLayout(ALL_IDS);
    expect(layout.order).toEqual(ALL_IDS);
    expectEachOnce(layout, ALL_IDS);
    expect(layout.order).toHaveLength(DEFAULT_PANEL_ORDER.length);
  });

  test('不传参数时等同于传入 DEFAULT_PANEL_ORDER', () => {
    expect(defaultPanelLayout()).toEqual(defaultPanelLayout(ALL_IDS));
    expect(defaultPanelLayout().order).toEqual(ALL_IDS);
  });

  test('spans：默认全部半宽 6（两列布局下不再有默认整行面板）', () => {
    const layout = defaultPanelLayout(ALL_IDS);
    // DEFAULT_FULL_WIDTH 现在是空集 → 所有静态面板默认都是半宽
    expect(FULL_WIDTH_PANELS).toEqual([]);
    for (const id of ALL_IDS) expect(layout.spans[id]).toBe(6);
    for (const id of FULL_WIDTH_PANELS) expect(layout.spans[id]).toBe(PANEL_GRID_COLUMNS);
    for (const id of HALF_WIDTH_PANELS) expect(layout.spans[id]).toBe(6);
  });

  test('分组面板默认半宽 6（不论是否在 DEFAULT_PANEL_ORDER 里）', () => {
    const layout = defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]);
    for (const id of GROUP_IDS) expect(layout.spans[id]).toBe(6);
  });

  test('所有面板的默认高度都是 0（自适应）', () => {
    const layout = defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]);
    expect(Object.keys(layout.heights).sort()).toEqual([...layout.order].sort());
    for (const id of layout.order) expect(layout.heights[id]).toBe(0);
  });

  test('hidden 是空数组', () => {
    expect(defaultPanelLayout(ALL_IDS).hidden).toEqual([]);
  });

  test('rowSpans：每个 id 都是 0（自动，由内容撑高），键集合与 order 完全一致', () => {
    const layout = defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]);
    expect(Object.keys(layout.rowSpans).sort()).toEqual([...layout.order].sort());
    for (const id of layout.order) expect(layout.rowSpans[id]).toBe(0);
    expect(Object.values(layout.rowSpans).every((n) => n === 0)).toBe(true);
  });

  test('colStarts：左列 local/clock、右列 widget/memo，其余自动', () => {
    const layout = defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]);
    // 源码 DEFAULT_COL_START：左列（1）localBlock / clockBlock，右列（7）widgetBlock / memoBlock
    expect(layout.colStarts.localBlock).toBe(1);
    expect(layout.colStarts.clockBlock).toBe(1);
    expect(layout.colStarts.widgetBlock).toBe(7);
    expect(layout.colStarts.memoBlock).toBe(7);
    // 被钉住的恰好是这四个（不多不少）
    expect([...PINNED_COL_START_PANELS].sort()).toEqual(['clockBlock', 'localBlock', 'memoBlock', 'widgetBlock']);
    for (const id of layout.order) {
      if (PINNED_COL_START_PANELS.includes(id)) continue;
      expect(layout.colStarts[id]).toBe(0);
    }
    // 时间占 1~6 列、备忘占 7~12 列 → 两者并排且顶部对齐
    expect(layout.spans.clockBlock).toBe(6);
    expect(layout.spans.memoBlock).toBe(6);
    expect(layout.colStarts.clockBlock + layout.spans.clockBlock).toBe(layout.colStarts.memoBlock);
  });

  test('colStarts 的键与 order 完全一致（子集场景也不产生多余键）', () => {
    const layout = defaultPanelLayout(['localBlock', 'tagBlock']);
    expect(Object.keys(layout.colStarts).sort()).toEqual(['localBlock', 'tagBlock']);
    // localBlock 被钉在左列第 1 列，tagBlock 未钉住 → 0
    expect(layout.colStarts.localBlock).toBe(1);
    expect(layout.colStarts.tagBlock).toBe(0);
    for (const id of layout.order) expect(layout.colStarts[id]).toBe(defaultColStart(id));
  });

  test('colStarts 的值一定是合法列起点（toColStart 原样放行）', () => {
    const layout = defaultPanelLayout([...ALL_IDS, ...GROUP_IDS, 'zzzBlock']);
    for (const id of layout.order) expect(toColStart(layout.colStarts[id])).toBe(layout.colStarts[id]);
  });

  test('colStarts 每次调用都是新对象，且改它不会污染后续调用', () => {
    const a = defaultPanelLayout(ALL_IDS);
    const b = defaultPanelLayout(ALL_IDS);
    expect(a.colStarts).not.toBe(b.colStarts);
    a.colStarts.clockBlock = 9;
    expect(defaultPanelLayout(ALL_IDS).colStarts.clockBlock).toBe(1);
  });

  test('rowSpans 每次调用都是新对象，且改它不会污染后续调用', () => {
    const a = defaultPanelLayout(ALL_IDS);
    const b = defaultPanelLayout(ALL_IDS);
    expect(a.rowSpans).not.toBe(b.rowSpans);
    a.rowSpans.clockBlock = 6;
    expect(defaultPanelLayout(ALL_IDS).rowSpans.clockBlock).toBe(0);
  });

  test('rowSpans 的键与 order 对应（子集场景也不产生多余键）', () => {
    const layout = defaultPanelLayout(['localBlock', 'tagBlock']);
    expect(Object.keys(layout.rowSpans).sort()).toEqual(['localBlock', 'tagBlock']);
    expect(layout.rowSpans.localBlock).toBe(0);
    expect(layout.rowSpans.tagBlock).toBe(0);
  });

  test('rowSpans 的值一定是合法行跨度（toRowSpan 原样放行）', () => {
    const layout = defaultPanelLayout([...ALL_IDS, ...GROUP_IDS, 'zzzBlock']);
    for (const id of layout.order) expect(toRowSpan(layout.rowSpans[id])).toBe(layout.rowSpans[id]);
  });

  test('mode 默认为 snap，positions 是空对象', () => {
    const layout = defaultPanelLayout(ALL_IDS);
    expect(layout.mode).toBe('snap');
    expect(layout.positions).toEqual({});
    expect(Object.keys(layout.positions)).toHaveLength(0);
    expect(defaultPanelLayout([]).mode).toBe('snap');
    expect(defaultPanelLayout([]).positions).toEqual({});
    expect(defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]).positions).toEqual({});
  });

  test('positions 每次调用都是新对象，且改它不会污染后续调用', () => {
    const a = defaultPanelLayout(ALL_IDS);
    const b = defaultPanelLayout(ALL_IDS);
    expect(a.positions).not.toBe(b.positions);
    a.positions.clockBlock = { x: 0, y: 0, w: 320, h: 160 };
    expect(defaultPanelLayout(ALL_IDS).positions).toEqual({});
  });

  test('positions 的键集合与 order 无关（默认一律为空，不预铺坐标）', () => {
    for (const ids of [[], ALL_IDS, ['clockBlock'], [...ALL_IDS, ...GROUP_IDS]]) {
      expect(defaultPanelLayout(ids).positions).toEqual({});
    }
  });

  test('knownIds 中不在 DEFAULT_PANEL_ORDER 的 id 追加到末尾，并保持传入顺序', () => {
    const layout = defaultPanelLayout([...ALL_IDS, 'zzzBlock', 'yyyBlock']);
    expect(layout.order.slice(0, DEFAULT_PANEL_ORDER.length)).toEqual(ALL_IDS);
    expect(layout.order.slice(-2)).toEqual(['zzzBlock', 'yyyBlock']);
    expectEachOnce(layout, [...ALL_IDS, 'zzzBlock', 'yyyBlock']);
    expect(layout.spans.zzzBlock).toBe(6);
    expect(layout.spans.yyyBlock).toBe(6);
  });

  test('未知 id 即便插在中间也只会落到末尾', () => {
    const layout = defaultPanelLayout(['zzzBlock', 'memoBlock', 'clockBlock']);
    expect(layout.order).toEqual(['clockBlock', 'memoBlock', 'zzzBlock']);
  });

  test('只保留 knownIds 里存在的默认面板', () => {
    const layout = defaultPanelLayout(['memoBlock', 'clockBlock']);
    expect(layout.order).toEqual(['clockBlock', 'memoBlock']);
    expect(layout.spans).toEqual({ clockBlock: 6, memoBlock: 6 });
    expect(layout.heights).toEqual({ clockBlock: 0, memoBlock: 0 });
  });

  test('spans / heights 的键与 order 完全对应（子集场景也不产生多余键）', () => {
    const layout = defaultPanelLayout(['localBlock', 'tagBlock']);
    expect(Object.keys(layout.spans).sort()).toEqual(['localBlock', 'tagBlock']);
    expect(Object.keys(layout.heights).sort()).toEqual(['localBlock', 'tagBlock']);
    // 两列布局下没有默认整行面板，localBlock 同样是半宽
    expect(layout.spans.localBlock).toBe(6);
    expect(layout.spans.tagBlock).toBe(6);
  });

  test('空 knownIds 不抛异常，返回空布局', () => {
    expect(() => defaultPanelLayout([])).not.toThrow();
    expect(defaultPanelLayout([])).toEqual({
      mode: 'snap',
      order: [],
      positions: {},
      spans: {},
      rowSpans: {},
      colStarts: {},
      heights: {},
      hidden: [],
    });
  });

  test('每次调用都返回新对象，互不共享引用', () => {
    const a = defaultPanelLayout(ALL_IDS);
    const b = defaultPanelLayout(ALL_IDS);
    expect(a).not.toBe(b);
    expect(a.order).not.toBe(b.order);
    expect(a.spans).not.toBe(b.spans);
    expect(a.rowSpans).not.toBe(b.rowSpans);
    expect(a.colStarts).not.toBe(b.colStarts);
    expect(a.heights).not.toBe(b.heights);
    expect(a.hidden).not.toBe(b.hidden);
  });

  test('返回的 order 不是 DEFAULT_PANEL_ORDER 本身', () => {
    expect(defaultPanelLayout(ALL_IDS).order).not.toBe(DEFAULT_PANEL_ORDER);
  });

  test('修改返回值不会污染模块级常量或后续调用', () => {
    const layout = defaultPanelLayout(ALL_IDS);
    layout.order.push('injectedBlock');
    layout.spans.clockBlock = 12;
    layout.rowSpans.clockBlock = 6;
    layout.colStarts.clockBlock = 9;
    layout.heights.clockBlock = 900;
    layout.hidden.push('clockBlock');

    expect(DEFAULT_PANEL_ORDER).toEqual(ALL_IDS);
    expect(defaultPanelLayout(ALL_IDS).order).toEqual(ALL_IDS);
    expect(defaultPanelLayout(ALL_IDS).spans.clockBlock).toBe(6);
    expect(defaultPanelLayout(ALL_IDS).rowSpans.clockBlock).toBe(0);
    expect(defaultPanelLayout(ALL_IDS).colStarts.clockBlock).toBe(1);
    expect(defaultPanelLayout(ALL_IDS).heights.clockBlock).toBe(0);
    expect(defaultPanelLayout(ALL_IDS).hidden).toEqual([]);
  });

  test('重复的未知 id 会被去重（与 normalizePanelLayout 行为一致）', () => {
    // 修复前：第二段只做 filter，重复的未知 id 会让 order 出现重复项，
    // 而 normalizePanelLayout 会去重 —— 两者不一致。
    const layout = defaultPanelLayout(['zzzBlock', 'zzzBlock']);
    expect(layout.order).toEqual(['zzzBlock']);
    expect(layout.spans).toEqual({ zzzBlock: 6 });
    expect(layout.heights).toEqual({ zzzBlock: 0 });
  });

  test('knownIds 里重复的默认面板只出现一次（第一段 filter 天然去重）', () => {
    const layout = defaultPanelLayout(['clockBlock', 'clockBlock', 'memoBlock']);
    expect(layout.order).toEqual(['clockBlock', 'memoBlock']);
    expect(layout.spans).toEqual({ clockBlock: 6, memoBlock: 6 });
  });
});

describe('normalizePanelLayout', () => {
  test('丢弃已经不再存在的面板 id', () => {
    const layout = normalizePanelLayout(
      { order: ['clockBlock', 'removedBlock', 'memoBlock'], spans: {}, hidden: [] },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.order).toEqual(['clockBlock', 'memoBlock']);
    expect(layout.spans).toEqual({ clockBlock: 6, memoBlock: 6 });
    expect(layout.heights).toEqual({ clockBlock: 0, memoBlock: 0 });
  });

  test('order 里的重复 id 只保留第一次出现', () => {
    const layout = normalizePanelLayout(
      { order: ['memoBlock', 'clockBlock', 'memoBlock', 'memoBlock'] },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.order).toEqual(['memoBlock', 'clockBlock']);
    expectEachOnce(layout, ['clockBlock', 'memoBlock']);
  });

  test('order 里的非字符串项被丢弃', () => {
    const layout = normalizePanelLayout(
      { order: ['clockBlock', 7, null, {}, undefined, ['memoBlock'], 'memoBlock'] },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.order).toEqual(['clockBlock', 'memoBlock']);
  });

  test('新增的已知面板被补到末尾（老布局不会把新模块藏起来）', () => {
    const layout = normalizePanelLayout(
      { order: ['memoBlock', 'clockBlock'], spans: { memoBlock: 4 }, hidden: ['memoBlock'] },
      ['clockBlock', 'memoBlock', 'localBlock', 'widgetBlock'],
    );
    expect(layout.order).toEqual(['memoBlock', 'clockBlock', 'localBlock', 'widgetBlock']);
    expectEachOnce(layout, ['clockBlock', 'memoBlock', 'localBlock', 'widgetBlock']);
    expect(layout.spans.memoBlock).toBe(4);
  });

  test('新补进来的面板使用默认宽度 / 高度 / 可见状态', () => {
    const layout = normalizePanelLayout({ order: ['clockBlock'] }, ALL_IDS);
    expect(layout.order).toEqual(['clockBlock', ...ALL_IDS.filter((id) => id !== 'clockBlock')]);
    expect(layout.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
    expect(layout.heights).toEqual(defaultPanelLayout(ALL_IDS).heights);
    expect(layout.hidden).toEqual([]);
    expectEachOnce(layout, ALL_IDS);
  });

  test('动态分组面板：作为已知 id 参与归一，默认半宽 6', () => {
    const layout = normalizePanelLayout({ order: ['group-ai'] }, [...ALL_IDS, ...GROUP_IDS]);
    expect(layout.order).toEqual(['group-ai', ...ALL_IDS, 'group-dev']);
    expect(layout.spans['group-ai']).toBe(6);
    expect(layout.spans['group-dev']).toBe(6);
    expect(layout.heights['group-ai']).toBe(0);
  });

  test('order 非数组（字符串 / 数字 / 对象 / 布尔 / null / undefined）时回退到完整默认顺序', () => {
    for (const order of ['nope', 42, { 0: 'clockBlock' }, true, null, undefined, () => 'clockBlock']) {
      const layout = normalizePanelLayout({ order }, ALL_IDS);
      expect(layout.order).toEqual(ALL_IDS);
      expect(layout.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
      expect(layout.heights).toEqual(defaultPanelLayout(ALL_IDS).heights);
    }
  });

  test('order 是空数组时补齐全部默认面板（含默认列起点）', () => {
    const layout = normalizePanelLayout({ order: [] }, ALL_IDS);
    expect(layout.order).toEqual(ALL_IDS);
    expect(layout.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
    expect(layout.rowSpans).toEqual(defaultPanelLayout(ALL_IDS).rowSpans);
    expect(layout.heights).toEqual(defaultPanelLayout(ALL_IDS).heights);
    expect(layout.hidden).toEqual([]);
    // 修复后：colStarts 缺失时回落到 fallback，所以与 defaultPanelLayout 一致
    expect(layout.colStarts).toEqual(defaultPanelLayout(ALL_IDS).colStarts);
    expect(layout.colStarts.clockBlock).toBe(1);
    expect(layout.colStarts.memoBlock).toBe(7);
  });

  test('order 全是未知 id 时仍然给出完整默认顺序', () => {
    const layout = normalizePanelLayout({ order: ['zzz', 'yyy'] }, ALL_IDS);
    expect(layout.order).toEqual(ALL_IDS);
    expect(layout.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
    expect(layout.hidden).toEqual([]);
  });

  test('spans 经 toSpan 归一：合法值保留，非法值回退到该面板的默认宽度', () => {
    const layout = normalizePanelLayout(
      {
        order: [...ALL_IDS],
        spans: {
          clockBlock: 2,
          memoBlock: '3',
          localBlock: 0,
          frequentBlock: 1,
          tagBlock: 13,
          widgetBlock: null,
          githubBlock: NaN,
        },
      },
      ALL_IDS,
    );
    expect(layout.spans.clockBlock).toBe(2); // 合法最小值保留
    expect(layout.spans.memoBlock).toBe(3); // 数字字符串合法
    expect(layout.spans.localBlock).toBe(defaultSpan('localBlock')); // 0 非法 → 默认半宽 6
    expect(layout.spans.frequentBlock).toBe(defaultSpan('frequentBlock')); // 1 < MIN_SPAN → 默认半宽 6
    expect(layout.spans.tagBlock).toBe(defaultSpan('tagBlock')); // 13 > MAX_SPAN → 默认半宽 6
    expect(layout.spans.widgetBlock).toBe(defaultSpan('widgetBlock')); // null 非法 → 默认半宽 6
    expect(layout.spans.githubBlock).toBe(defaultSpan('githubBlock')); // NaN 非法 → 默认半宽 6
  });

  test('spans 的小数走 Math.round 后仍合法则保留', () => {
    const layout = normalizePanelLayout(
      { order: ['clockBlock', 'memoBlock', 'localBlock'], spans: { clockBlock: 2.5, memoBlock: 5.6, localBlock: 3.4 } },
      ['clockBlock', 'memoBlock', 'localBlock'],
    );
    expect(layout.spans).toEqual({ clockBlock: 3, memoBlock: 6, localBlock: 3 });
  });

  test('spans 里的未知 id 被丢弃，非法 spans 容器按空对象处理', () => {
    const dropped = normalizePanelLayout(
      { order: ['clockBlock'], spans: { clockBlock: 8, zzzBlock: 12 } },
      ['clockBlock'],
    );
    expect(dropped.spans).toEqual({ clockBlock: 8 });

    for (const spans of ['x', 42, null, [], true, undefined, () => 1]) {
      const layout = normalizePanelLayout({ order: ['clockBlock'], spans }, ['clockBlock']);
      expect(layout.spans).toEqual({ clockBlock: 6 });
    }
  });

  test('spans 缺失时全部走默认宽度', () => {
    const layout = normalizePanelLayout({ order: [...ALL_IDS] }, ALL_IDS);
    expect(layout.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
  });

  test('spans 的键与最终 order 完全一致', () => {
    const layout = normalizePanelLayout(
      { order: ['memoBlock', 'zzz'], spans: { memoBlock: 4, zzz: 12, clockBlock: 2 } },
      ['clockBlock', 'memoBlock'],
    );
    expect(Object.keys(layout.spans).sort()).toEqual([...layout.order].sort());
    expect(Object.keys(layout.heights).sort()).toEqual([...layout.order].sort());
  });

  test('heights 经 toHeight 归一：0 与区间内保留，非法回退 0', () => {
    const layout = normalizePanelLayout(
      {
        order: [...ALL_IDS],
        heights: {
          clockBlock: 0,
          memoBlock: 300,
          localBlock: '640',
          frequentBlock: 79,
          tagBlock: 2001,
          widgetBlock: NaN,
          githubBlock: null,
        },
      },
      ALL_IDS,
    );
    expect(layout.heights.clockBlock).toBe(0);
    expect(layout.heights.memoBlock).toBe(300);
    expect(layout.heights.localBlock).toBe(640);
    expect(layout.heights.frequentBlock).toBe(0); // 79 < MIN_PANEL_HEIGHT
    expect(layout.heights.tagBlock).toBe(0); // 2001 > MAX_PANEL_HEIGHT
    expect(layout.heights.widgetBlock).toBe(0); // NaN
    expect(layout.heights.githubBlock).toBe(0); // null
  });

  test('缺失 heights 键的旧存档：全部高度回退为 0', () => {
    const legacy = { order: [...ALL_IDS], spans: { clockBlock: 4 } };
    const layout = normalizePanelLayout(legacy, ALL_IDS);
    expect(layout.spans.clockBlock).toBe(4);
    for (const id of layout.order) expect(layout.heights[id]).toBe(0);
  });

  test('heights 容器非法（字符串 / 数字 / 数组 / 布尔）时按空对象处理', () => {
    for (const heights of ['x', 42, null, [], true, () => 1]) {
      const layout = normalizePanelLayout({ order: ['clockBlock'], heights }, ['clockBlock']);
      expect(layout.heights).toEqual({ clockBlock: 0 });
    }
  });

  test('hidden 过滤掉未知 id、非字符串项，并去重', () => {
    const layout = normalizePanelLayout(
      { order: ['clockBlock', 'memoBlock'], hidden: ['memoBlock', 'zzzBlock', 'memoBlock', 7, null, {}] },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.hidden).toEqual(['memoBlock']);
  });

  test('hidden 保持原有的相对顺序', () => {
    const layout = normalizePanelLayout(
      { order: [...ALL_IDS], hidden: ['tagBlock', 'clockBlock', 'tagBlock'] },
      ALL_IDS,
    );
    expect(layout.hidden).toEqual(['tagBlock', 'clockBlock']);
  });

  test('hidden 非数组时视为空', () => {
    for (const hidden of ['memoBlock', 42, {}, true, null, undefined]) {
      const layout = normalizePanelLayout({ order: ['memoBlock'], hidden }, ['memoBlock']);
      expect(layout.hidden).toEqual([]);
    }
  });

  test('hidden 里的 id 一定属于最终 order', () => {
    const layout = normalizePanelLayout(
      { order: ['memoBlock'], hidden: ['memoBlock', 'clockBlock', 'zzz'] },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.hidden).toEqual(['memoBlock', 'clockBlock']);
    for (const id of layout.hidden) expect(layout.order).toContain(id);
  });

  test('null / undefined / 字符串 / 数字 / 布尔 / NaN / 函数 都返回可用的默认布局', () => {
    for (const garbage of [null, undefined, 'x', 42, true, NaN, '', 0, false, () => 'x']) {
      expect(normalizePanelLayout(garbage, ALL_IDS)).toEqual(defaultPanelLayout(ALL_IDS));
    }
  });

  test('空对象 {} 与空数组 [] 都返回可用的默认布局', () => {
    // [] 的 typeof 是 'object'，走「重建」分支；两条分支现在结果一致（含 colStarts）。
    for (const input of [{}, []]) {
      const layout = normalizePanelLayout(input, ALL_IDS);
      expect(layout.order).toEqual(defaultPanelLayout(ALL_IDS).order);
      expect(layout.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
      expect(layout.rowSpans).toEqual(defaultPanelLayout(ALL_IDS).rowSpans);
      expect(layout.heights).toEqual(defaultPanelLayout(ALL_IDS).heights);
      expect(layout.hidden).toEqual(defaultPanelLayout(ALL_IDS).hidden);
      expect(layout.colStarts).toEqual(defaultPanelLayout(ALL_IDS).colStarts);
    }
    expect(() => normalizePanelLayout([], ALL_IDS)).not.toThrow();
    expect(normalizePanelLayout(null, ALL_IDS).colStarts).toEqual(defaultPanelLayout(ALL_IDS).colStarts);
  });

  test('knownIds 为空时返回空布局而不抛异常', () => {
    expect(normalizePanelLayout({ order: ['clockBlock'], hidden: ['clockBlock'] }, [])).toEqual({
      mode: 'snap',
      order: [],
      positions: {},
      spans: {},
      rowSpans: {},
      colStarts: {},
      heights: {},
      hidden: [],
    });
    expect(normalizePanelLayout(null, [])).toEqual(defaultPanelLayout([]));
  });

  test('返回的对象与入参不共享引用', () => {
    const input = {
      order: ['memoBlock', 'clockBlock'],
      spans: { memoBlock: 4 },
      rowSpans: { memoBlock: 3 },
      colStarts: { memoBlock: 5 },
      heights: { memoBlock: 300 },
      hidden: ['clockBlock'],
    };
    const layout = normalizePanelLayout(input, ALL_IDS);
    expect(layout).not.toBe(input);
    expect(layout.order).not.toBe(input.order);
    expect(layout.spans).not.toBe(input.spans);
    expect(layout.rowSpans).not.toBe(input.rowSpans);
    expect(layout.colStarts).not.toBe(input.colStarts);
    expect(layout.heights).not.toBe(input.heights);
    expect(layout.hidden).not.toBe(input.hidden);
    expect(layout.rowSpans.memoBlock).toBe(3);
    expect(layout.colStarts.memoBlock).toBe(5);
  });

  test('每次调用都返回新对象（含 fallback 分支）', () => {
    expect(normalizePanelLayout(null, ALL_IDS)).not.toBe(normalizePanelLayout(null, ALL_IDS));
    expect(normalizePanelLayout({ order: [] }, ALL_IDS)).not.toBe(normalizePanelLayout({ order: [] }, ALL_IDS));
    const input = { order: ['memoBlock'] };
    expect(normalizePanelLayout(input, ALL_IDS)).not.toBe(normalizePanelLayout(input, ALL_IDS));
  });

  test('归一化过程不修改入参', () => {
    const input = {
      order: ['memoBlock', 'zzz', 'memoBlock'],
      spans: { memoBlock: 99 },
      heights: { memoBlock: 99999 },
      hidden: ['zzz'],
    };
    const before = JSON.stringify(input);
    normalizePanelLayout(input, ALL_IDS);
    expect(JSON.stringify(input)).toBe(before);
  });

  test('注意：knownIds 自带重复 id 时，补位循环会去重（seen 被同步更新）', () => {
    const layout = normalizePanelLayout({}, ['zzzBlock', 'zzzBlock']);
    expect(layout.order).toEqual(['zzzBlock']);
    expect(countIn(layout, 'zzzBlock')).toBe(1);
    expect(Object.keys(layout.spans)).toEqual(['zzzBlock']);
  });

  test('重复 id 若出现在入参 order 里同样被去重', () => {
    const layout = normalizePanelLayout({ order: ['zzzBlock'] }, ['zzzBlock', 'zzzBlock']);
    expect(layout.order).toEqual(['zzzBlock']);
  });

  test('真实旧版布局迁移：未知 id 被丢、新 id 补齐、宽度与隐藏状态保留', () => {
    const layout = normalizePanelLayout(
      {
        order: ['localBlock', 'removedBlock', 'clockBlock'],
        spans: { localBlock: 8, clockBlock: 3, removedBlock: 12 },
        heights: { localBlock: 480 },
        hidden: ['removedBlock', 'clockBlock', 'clockBlock'],
      },
      ALL_IDS,
    );
    expect(layout.order.slice(0, 2)).toEqual(['localBlock', 'clockBlock']);
    expectEachOnce(layout, ALL_IDS);
    expect(layout.spans.localBlock).toBe(8);
    expect(layout.spans.clockBlock).toBe(3);
    expect(layout.spans.memoBlock).toBe(6);
    expect(layout.spans.githubBlock).toBe(defaultSpan('githubBlock')); // 默认半宽 6
    expect(layout.heights.localBlock).toBe(480);
    expect(layout.heights.memoBlock).toBe(0);
    expect(layout.hidden).toEqual(['clockBlock']);
    expect(Object.prototype.hasOwnProperty.call(layout.spans, 'removedBlock')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(layout.heights, 'removedBlock')).toBe(false);
  });

  test('归一结果里的 span / height 一定落在合法区间内', () => {
    const layout = normalizePanelLayout(
      { order: [...ALL_IDS], spans: { clockBlock: -5, memoBlock: 1e9 }, heights: { clockBlock: -5, memoBlock: 1e9 } },
      ALL_IDS,
    );
    for (const id of layout.order) {
      expect(layout.spans[id]).toBeGreaterThanOrEqual(MIN_SPAN);
      expect(layout.spans[id]).toBeLessThanOrEqual(MAX_SPAN);
      expect(layout.heights[id]).toBeGreaterThanOrEqual(0);
      expect(layout.heights[id]).toBeLessThanOrEqual(MAX_PANEL_HEIGHT);
    }
  });

  test('rowSpans 经 toRowSpan 归一：合法值保留，非法值回退 0（自动）', () => {
    const layout = normalizePanelLayout(
      {
        order: [...ALL_IDS],
        rowSpans: {
          clockBlock: 2,
          memoBlock: '3',
          localBlock: 0,
          frequentBlock: 7,
          tagBlock: 1,
          widgetBlock: null,
          githubBlock: NaN,
        },
      },
      ALL_IDS,
    );
    expect(layout.rowSpans.clockBlock).toBe(2); // 合法值保留
    expect(layout.rowSpans.memoBlock).toBe(3); // 数字字符串合法
    expect(layout.rowSpans.localBlock).toBe(0); // 0 = 自动，合法值原样保留
    expect(layout.rowSpans.frequentBlock).toBe(0); // 7 > MAX_ROW_SPAN → 回退 0
    expect(layout.rowSpans.tagBlock).toBe(1); // 合法最小值保留
    expect(layout.rowSpans.widgetBlock).toBe(0); // null 非法 → 回退 0
    expect(layout.rowSpans.githubBlock).toBe(0); // NaN 非法 → 回退 0
  });

  test('rowSpans 缺失时全部回退为 0（旧存档没有这个键也能正常归一）', () => {
    const legacy = { order: [...ALL_IDS], spans: { clockBlock: 4 }, heights: { clockBlock: 300 } };
    const layout = normalizePanelLayout(legacy, ALL_IDS);
    expect(layout.spans.clockBlock).toBe(4);
    expect(layout.heights.clockBlock).toBe(300);
    for (const id of layout.order) expect(layout.rowSpans[id]).toBe(0);
    expect(Object.keys(layout.rowSpans).sort()).toEqual([...layout.order].sort());
  });

  test('rowSpans 容器非法（字符串 / 数字 / 数组 / 布尔 / 函数）时按空对象处理', () => {
    for (const rowSpans of ['x', 42, null, [], true, undefined, () => 1]) {
      const layout = normalizePanelLayout({ order: ['clockBlock'], rowSpans }, ['clockBlock']);
      expect(layout.rowSpans).toEqual({ clockBlock: 0 });
    }
  });

  test('rowSpans 的小数走 Math.round 后仍合法则保留', () => {
    const layout = normalizePanelLayout(
      {
        order: ['clockBlock', 'memoBlock', 'localBlock'],
        rowSpans: { clockBlock: 1.5, memoBlock: 5.6, localBlock: 3.4 },
      },
      ['clockBlock', 'memoBlock', 'localBlock'],
    );
    expect(layout.rowSpans).toEqual({ clockBlock: 2, memoBlock: 6, localBlock: 3 });
  });

  test('rowSpans 里的未知 id 被丢弃，键与最终 order 完全一致', () => {
    const layout = normalizePanelLayout(
      { order: ['memoBlock', 'zzz'], rowSpans: { memoBlock: 4, zzz: 6, clockBlock: 2 } },
      ['clockBlock', 'memoBlock'],
    );
    // order 是 ['memoBlock', 'clockBlock']：clockBlock 被补到末尾，所以它的 rowSpan 也被保留
    expect(layout.order).toEqual(['memoBlock', 'clockBlock']);
    expect(Object.keys(layout.rowSpans).sort()).toEqual([...layout.order].sort());
    expect(layout.rowSpans.memoBlock).toBe(4);
    expect(layout.rowSpans.clockBlock).toBe(2);
    // 不在 order 里的 zzz 被丢弃
    expect(Object.prototype.hasOwnProperty.call(layout.rowSpans, 'zzz')).toBe(false);
  });

  test('归一化不修改入参里的 rowSpans', () => {
    const input = { order: ['clockBlock'], rowSpans: { clockBlock: 99, ghost: 3 } };
    const before = JSON.stringify(input);
    const layout = normalizePanelLayout(input, ['clockBlock']);
    expect(JSON.stringify(input)).toBe(before);
    expect(layout.rowSpans).not.toBe(input.rowSpans);
    expect(layout.rowSpans).toEqual({ clockBlock: 0 });
  });

  test('rowSpans 往返幂等：再归一化一次结果不变', () => {
    const once = normalizePanelLayout({ order: [...ALL_IDS], rowSpans: { clockBlock: 4, memoBlock: 2 } }, ALL_IDS);
    expect(normalizePanelLayout(once, ALL_IDS).rowSpans).toEqual(once.rowSpans);
  });

  test('注意：rowSpans 的兜底常量是 0，不依赖 fallback.spans（与 spans 的回退策略不同）', () => {
    // spans 非法时会回退到该面板的默认宽度（6 或 12），rowSpans 一律回退 0（自动）
    const layout = normalizePanelLayout(
      { order: ['localBlock', 'clockBlock'], spans: { localBlock: 0, clockBlock: 0 }, rowSpans: { localBlock: 9, clockBlock: 9 } },
      ['localBlock', 'clockBlock'],
    );
    expect(layout.spans.localBlock).toBe(defaultSpan('localBlock')); // 非法 → 回退该面板默认宽度（6）
    expect(layout.spans.clockBlock).toBe(6); // 普通面板回退 6
    expect(layout.rowSpans.localBlock).toBe(0);
    expect(layout.rowSpans.clockBlock).toBe(0);
  });

  test('colStarts 经 toColStart 归一：合法值保留，非法值回退 0', () => {
    const layout = normalizePanelLayout(
      {
        order: [...ALL_IDS],
        colStarts: {
          clockBlock: 5,
          memoBlock: '7',
          localBlock: 0,
          frequentBlock: 13,
          tagBlock: 1,
          widgetBlock: null,
          githubBlock: NaN,
        },
      },
      ALL_IDS,
    );
    expect(layout.colStarts.clockBlock).toBe(5); // 合法值保留
    expect(layout.colStarts.memoBlock).toBe(7); // 数字字符串合法
    expect(layout.colStarts.localBlock).toBe(0); // 0 = 自动，合法值原样保留
    expect(layout.colStarts.frequentBlock).toBe(0); // 13 > PANEL_GRID_COLUMNS → 回退该面板默认列起点（frequentBlock 未钉住 → 0）
    expect(layout.colStarts.tagBlock).toBe(1); // 合法最小值保留
    expect(layout.colStarts.widgetBlock).toBe(defaultColStart('widgetBlock')); // null 非法 → 回退默认钉位 7
    expect(layout.colStarts.githubBlock).toBe(0); // NaN 非法 → 回退该面板默认列起点（未钉住 → 0）
  });

  test('旧存档没有 colStarts 键时回落到默认列起点', () => {
    // 修复前：缺失值一律 `?? 0`，老用户升级后会丢掉「时间/备忘并排」的默认布局。
    const layout = normalizePanelLayout({ order: [...ALL_IDS] }, ALL_IDS);
    expect(layout.colStarts.localBlock).toBe(1);
    expect(layout.colStarts.clockBlock).toBe(1);
    expect(layout.colStarts.widgetBlock).toBe(7);
    expect(layout.colStarts.memoBlock).toBe(7);
    for (const id of layout.order) {
      if (PINNED_COL_START_PANELS.includes(id)) continue;
      expect(layout.colStarts[id]).toBe(0);
    }
    expect(Object.keys(layout.colStarts).sort()).toEqual([...layout.order].sort());
  });

  test('colStarts 容器非法（字符串 / 数字 / 数组 / 布尔 / 函数）时按空对象处理', () => {
    for (const colStarts of ['x', 42, null, [], true, undefined, () => 1]) {
      const layout = normalizePanelLayout({ order: ['clockBlock'], colStarts }, ['clockBlock']);
      // clockBlock 有默认钉位（第 1 列），所以非法容器时回落到 fallback 的 1
      expect(layout.colStarts).toEqual({ clockBlock: 1 });
    }
  });

  test('colStarts 里的未知 id 被丢弃，键与最终 order 完全一致', () => {
    const layout = normalizePanelLayout(
      { order: ['memoBlock', 'zzz'], colStarts: { memoBlock: 4, zzz: 6, clockBlock: 2 } },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.order).toEqual(['memoBlock', 'clockBlock']);
    expect(Object.keys(layout.colStarts).sort()).toEqual([...layout.order].sort());
    expect(layout.colStarts.memoBlock).toBe(4);
    expect(layout.colStarts.clockBlock).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(layout.colStarts, 'zzz')).toBe(false);
  });

  test('colStarts 往返幂等：再归一化一次结果不变', () => {
    const once = normalizePanelLayout({ order: [...ALL_IDS], colStarts: { clockBlock: 1, memoBlock: 7 } }, ALL_IDS);
    expect(normalizePanelLayout(once, ALL_IDS).colStarts).toEqual(once.colStarts);
  });

  test('归一化不修改入参里的 colStarts', () => {
    const input = { order: ['clockBlock'], colStarts: { clockBlock: 99, ghost: 3 } };
    const before = JSON.stringify(input);
    const layout = normalizePanelLayout(input, ['clockBlock']);
    expect(JSON.stringify(input)).toBe(before);
    expect(layout.colStarts).not.toBe(input.colStarts);
    // 99 越界 → 回落到 fallback 的默认钉位 1
    expect(layout.colStarts).toEqual({ clockBlock: 1 });
  });

  test('归一结果里的 colStart 一定落在合法区间（0 或 1..12）', () => {
    const layout = normalizePanelLayout(
      { order: [...ALL_IDS], colStarts: { clockBlock: -5, memoBlock: 1e9, localBlock: 12 } },
      ALL_IDS,
    );
    for (const id of layout.order) {
      const col = layout.colStarts[id];
      expect(toColStart(col)).toBe(col);
      expect(col === 0 || (col >= 1 && col <= PANEL_GRID_COLUMNS)).toBe(true);
    }
  });
});

describe('normalizePanelLayout：mode 与 positions（自由模式）', () => {
  test('mode 缺失时默认为 snap', () => {
    expect(normalizePanelLayout({ order: [...ALL_IDS] }, ALL_IDS).mode).toBe('snap');
    expect(normalizePanelLayout({}, ALL_IDS).mode).toBe('snap');
    expect(normalizePanelLayout(null, ALL_IDS).mode).toBe('snap');
    expect(normalizePanelLayout(undefined, ALL_IDS).mode).toBe('snap');
  });

  test("mode: 'free' 被原样保留", () => {
    const layout = normalizePanelLayout({ mode: 'free', order: [...ALL_IDS] }, ALL_IDS);
    expect(layout.mode).toBe('free');
    expect(layout.order).toEqual(ALL_IDS);
  });

  test("mode: 'snap' 显式传入同样保留为 snap", () => {
    expect(normalizePanelLayout({ mode: 'snap', order: [...ALL_IDS] }, ALL_IDS).mode).toBe('snap');
  });

  test('垃圾 mode 一律回退到 snap（只有精确的 free 才是自由模式）', () => {
    for (const mode of [
      'FREE',
      'Free',
      'free ',
      ' free',
      'snap ',
      'grid',
      'absolute',
      '',
      'freee',
      42,
      0,
      1,
      true,
      false,
      null,
      undefined,
      NaN,
      {},
      [],
      ['free'],
      () => 'free',
      { toString: () => 'free' },
    ]) {
      expect(normalizePanelLayout({ mode, order: [...ALL_IDS] }, ALL_IDS).mode).toBe('snap');
    }
  });

  test('positions 缺失 / 非对象容器时为空对象', () => {
    for (const positions of [undefined, null, 'x', 42, [], true, () => ({})]) {
      const layout = normalizePanelLayout({ mode: 'free', order: ['clockBlock'], positions }, ['clockBlock']);
      expect(layout.positions).toEqual({});
    }
  });

  test('positions 只保留仍然存在于最终 order 里的 id', () => {
    const layout = normalizePanelLayout(
      {
        mode: 'free',
        order: ['clockBlock', 'memoBlock'],
        positions: {
          clockBlock: { x: 0, y: 0, w: 320, h: 160 },
          removedBlock: { x: 0, y: 200, w: 320, h: 160 },
        },
      },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.order).toEqual(['clockBlock', 'memoBlock']);
    expect(Object.keys(layout.positions)).toEqual(['clockBlock']);
    expect(layout.positions.clockBlock).toEqual({ x: 0, y: 0, w: 320, h: 160 });
  });

  test('positions 里针对「已补齐到末尾的新面板」的坐标同样被保留（只要 id 进了 order）', () => {
    const layout = normalizePanelLayout(
      {
        mode: 'free',
        order: ['clockBlock'],
        positions: { clockBlock: { x: 0, y: 0, w: 320, h: 160 }, memoBlock: { x: 400, y: 0, w: 200, h: 120 } },
      },
      ['clockBlock', 'memoBlock'],
    );
    expect(layout.order).toEqual(['clockBlock', 'memoBlock']);
    expect(Object.keys(layout.positions).sort()).toEqual(['clockBlock', 'memoBlock']);
  });

  test('非法 position 条目被丢弃（逐个字段校验，不整体放行）', () => {
    const layout = normalizePanelLayout(
      {
        mode: 'free',
        order: [...ALL_IDS],
        positions: {
          clockBlock: { x: 0, y: 0, w: 320, h: 160 },
          memoBlock: { x: MIN_FREE_COORD - 1, y: 0, w: 320, h: 160 },
          localBlock: { x: 0, y: 0, w: MIN_FREE_W - 1, h: 160 },
          frequentBlock: { x: 0, y: 0, w: 320, h: MIN_FREE_H - 1 },
          tagBlock: { x: 0, y: 0, w: 320 },
          widgetBlock: { x: NaN, y: 0, w: 320, h: 160 },
          githubBlock: { x: '0', y: '0', w: '320', h: '160' },
        },
      },
      ALL_IDS,
    );
    expect(Object.keys(layout.positions).sort()).toEqual(['clockBlock', 'githubBlock']);
    expect(layout.positions.clockBlock).toEqual({ x: 0, y: 0, w: 320, h: 160 });
    expect(layout.positions.githubBlock).toEqual({ x: 0, y: 0, w: 320, h: 160 });
  });

  test('注意：负坐标的 position 条目现在会被保留（旧存档里的「非法项」变成合法项）', () => {
    const layout = normalizePanelLayout(
      {
        mode: 'free',
        order: ['clockBlock', 'memoBlock'],
        positions: {
          clockBlock: { x: -320, y: -200, w: 320, h: 160 },
          memoBlock: { x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: MIN_FREE_W, h: MIN_FREE_H },
        },
      },
      ['clockBlock', 'memoBlock'],
    );
    expect(Object.keys(layout.positions).sort()).toEqual(['clockBlock', 'memoBlock']);
    expect(layout.positions.clockBlock).toEqual({ x: -320, y: -200, w: 320, h: 160 });
    expect(layout.positions.memoBlock).toEqual({
      x: MIN_FREE_COORD,
      y: MIN_FREE_COORD,
      w: MIN_FREE_W,
      h: MIN_FREE_H,
    });
  });

  test('positions 条目的额外字段被剥掉，存的是 toPanelBox 的纯净结果', () => {
    const layout = normalizePanelLayout(
      {
        mode: 'free',
        order: ['clockBlock'],
        positions: { clockBlock: { x: 10.4, y: 20.6, w: 300.5, h: 200.5, zIndex: 99 } },
      },
      ['clockBlock'],
    );
    expect(layout.positions.clockBlock).toEqual({ x: 10, y: 21, w: 301, h: 201 });
    expect(Object.keys(layout.positions.clockBlock)).toEqual(['x', 'y', 'w', 'h']);
  });

  test('positions 全部非法时结果为空对象，而不是回退整个布局', () => {
    const layout = normalizePanelLayout(
      { mode: 'free', order: ['clockBlock'], spans: { clockBlock: 3 }, positions: { clockBlock: 'nope' } },
      ['clockBlock'],
    );
    expect(layout.positions).toEqual({});
    expect(layout.mode).toBe('free');
    expect(layout.spans.clockBlock).toBe(3); // 其余字段照常归一
  });

  test('旧存档完全没有 positions 键也能正常归一（不抛异常、positions 为空）', () => {
    const legacy = { order: ['memoBlock', 'clockBlock'], spans: { memoBlock: 4 }, heights: { memoBlock: 300 } };
    const layout = normalizePanelLayout(legacy, ALL_IDS);
    expect(layout.mode).toBe('snap');
    expect(layout.positions).toEqual({});
    expect(layout.order.slice(0, 2)).toEqual(['memoBlock', 'clockBlock']);
    expect(layout.spans.memoBlock).toBe(4);
    expect(layout.heights.memoBlock).toBe(300);
  });

  test('注意：mode 为 free 但 positions 缺失时，mode 保持 free（不会因为无坐标就退回 snap）', () => {
    const layout = normalizePanelLayout({ mode: 'free', order: [...ALL_IDS] }, ALL_IDS);
    expect(layout.mode).toBe('free');
    expect(layout.positions).toEqual({});
  });

  test('注意：mode 为 snap 时 positions 依然会被解析并保留（源码不按 mode 过滤坐标）', () => {
    const layout = normalizePanelLayout(
      { mode: 'snap', order: ['clockBlock'], positions: { clockBlock: { x: 5, y: 5, w: 320, h: 160 } } },
      ['clockBlock'],
    );
    expect(layout.mode).toBe('snap');
    expect(layout.positions).toEqual({ clockBlock: { x: 5, y: 5, w: 320, h: 160 } });
  });

  test('positions 与 order 的键集合关系：positions ⊆ order', () => {
    const layout = normalizePanelLayout(
      {
        mode: 'free',
        order: ['memoBlock', 'zzz'],
        positions: {
          memoBlock: { x: 0, y: 0, w: 200, h: 100 },
          zzz: { x: 0, y: 0, w: 200, h: 100 },
          clockBlock: { x: 0, y: 0, w: 200, h: 100 },
        },
      },
      ['clockBlock', 'memoBlock'],
    );
    for (const id of Object.keys(layout.positions)) expect(layout.order).toContain(id);
    expect(Object.keys(layout.positions).sort()).toEqual(['clockBlock', 'memoBlock']);
  });

  test('归一化过程不修改入参里的 positions（含嵌套盒子）', () => {
    const input = {
      mode: 'free',
      order: ['clockBlock'],
      positions: { clockBlock: { x: 1, y: 2, w: 320, h: 160 }, ghost: { x: 3, y: 4, w: 200, h: 100 } },
    };
    const before = JSON.stringify(input);
    const layout = normalizePanelLayout(input, ['clockBlock']);
    expect(JSON.stringify(input)).toBe(before);
    expect(layout.positions).not.toBe(input.positions);
    expect(layout.positions.clockBlock).not.toBe(input.positions.clockBlock);
  });

  test('自由模式往返幂等：再归一化一次结果不变', () => {
    const once = normalizePanelLayout(
      { mode: 'free', order: ['memoBlock', 'clockBlock'], positions: { memoBlock: { x: 1, y: 2, w: 320, h: 160 } } },
      ALL_IDS,
    );
    expect(normalizePanelLayout(once, ALL_IDS)).toEqual(once);
  });

  test('knownIds 为空时自由模式也给出空布局', () => {
    expect(normalizePanelLayout({ mode: 'free', positions: { clockBlock: { x: 0, y: 0, w: 320, h: 160 } } }, [])).toEqual({
      mode: 'snap',
      order: [],
      positions: {},
      spans: {},
      rowSpans: {},
      colStarts: {},
      heights: {},
      hidden: [],
    });
  });
});

describe('setPanelBox', () => {
  const base = makeFreeLayout();

  test('为已知 id 设置盒子', () => {
    const next = setPanelBox(base, 'localBlock', VALID_BOX);
    expect(next.positions.localBlock).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });

  test('覆盖已有坐标（同 id 重复设置取最新值）', () => {
    const once = setPanelBox(base, 'clockBlock', { x: 0, y: 0, w: 200, h: 100 });
    const twice = setPanelBox(once, 'clockBlock', { x: 50, y: 60, w: 400, h: 300 });
    expect(twice.positions.clockBlock).toEqual({ x: 50, y: 60, w: 400, h: 300 });
    expect(Object.keys(twice.positions)).toHaveLength(2);
  });

  test('入参的盒子值经 toPanelBox 归一后写入（小数取整、字符串接受）', () => {
    const next = setPanelBox(base, 'localBlock', { x: 10.6, y: 20.4, w: 300.5, h: 200.5 });
    expect(next.positions.localBlock).toEqual({ x: 11, y: 20, w: 301, h: 201 });
    const fromStrings = setPanelBox(base, 'localBlock', {
      x: '10' as unknown as number,
      y: '20' as unknown as number,
      w: '300' as unknown as number,
      h: '200' as unknown as number,
    });
    expect(fromStrings.positions.localBlock).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(setPanelBox(base, 'zzzBlock', VALID_BOX)).toBe(base);
    const snap = makeLayout();
    expect(setPanelBox(snap, 'zzzBlock', VALID_BOX)).toBe(snap);
    expect(setPanelBox(snap, 'group-ghost', VALID_BOX)).toBe(snap);
  });

  test('非法盒子是空操作，返回同一引用（positions 完全不变）', () => {
    const invalid: unknown[] = [
      null,
      undefined,
      'x',
      42,
      true,
      [],
      [VALID_BOX],
      {},
      { x: 0, y: 0, w: 300 },
      { x: MIN_FREE_COORD - 1, y: 0, w: 300, h: 200 },
      { x: 0, y: MIN_FREE_COORD - 1, w: 300, h: 200 },
      { x: 0, y: 0, w: MIN_FREE_W - 1, h: 200 },
      { x: 0, y: 0, w: 300, h: MIN_FREE_H - 1 },
      { x: NaN, y: 0, w: 300, h: 200 },
      { x: 0, y: Infinity, w: 300, h: 200 },
    ];
    for (const box of invalid) {
      const next = setPanelBox(base, 'localBlock', box as unknown as PanelBox);
      expect(next).toBe(base);
      expect(next.positions).toEqual(base.positions);
    }
  });

  test('边界盒子（恰好等于最小宽高、且坐标为负下界）可以写入', () => {
    const next = setPanelBox(base, 'localBlock', { x: 0, y: 0, w: MIN_FREE_W, h: MIN_FREE_H });
    expect(next.positions.localBlock).toEqual({ x: 0, y: 0, w: 60, h: 40 });
    // 负坐标现在是合法值，边界同样可写入
    const negative = setPanelBox(base, 'localBlock', { x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: MIN_FREE_W, h: MIN_FREE_H });
    expect(negative.positions.localBlock).toEqual({ x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: 60, h: 40 });
  });

  test('不影响其他面板的坐标', () => {
    const next = setPanelBox(base, 'localBlock', VALID_BOX);
    expect(next.positions.clockBlock).toEqual(base.positions.clockBlock);
    expect(next.positions.memoBlock).toEqual(base.positions.memoBlock);
    expect(Object.keys(next.positions).sort()).toEqual(['clockBlock', 'localBlock', 'memoBlock']);
  });

  test('所有字段都返回独立副本，改动返回值不污染入参', () => {
    // 统一不可变约定后：每个返回新布局的函数都深拷贝全部 map / 数组字段，
    // 不再出现「只有自己负责的字段是副本、其余共享引用」的不一致。
    const dirty = makeLayout({
      hidden: ['memoBlock'],
      heights: { clockBlock: 300, memoBlock: 0, localBlock: 640 },
      colStarts: { clockBlock: 1, memoBlock: 7, localBlock: 0 },
    });
    const next = setPanelBox(dirty, 'localBlock', VALID_BOX);
    expect(next.mode).toBe(dirty.mode);
    expect(next.order).not.toBe(dirty.order);
    expect(next.spans).not.toBe(dirty.spans);
    expect(next.rowSpans).not.toBe(dirty.rowSpans);
    expect(next.colStarts).not.toBe(dirty.colStarts);
    expect(next.heights).not.toBe(dirty.heights);
    expect(next.hidden).not.toBe(dirty.hidden);
    expect(next.positions).not.toBe(dirty.positions);

    // 值仍然相等（只是引用独立）
    expect(next.order).toEqual(dirty.order);
    expect(next.spans).toEqual(dirty.spans);
    expect(next.rowSpans).toEqual(dirty.rowSpans);
    expect(next.colStarts).toEqual(dirty.colStarts);
    expect(next.heights).toEqual(dirty.heights);
    expect(next.hidden).toEqual(dirty.hidden);
  });

  test('不修改入参：布局与传入的盒子对象都不被改动', () => {
    const box = { x: 10, y: 20, w: 300, h: 200 };
    const beforeLayout = snapshot(base);
    const beforeBox = JSON.stringify(box);
    const next = setPanelBox(base, 'localBlock', box);
    expect(snapshot(base)).toBe(beforeLayout);
    expect(JSON.stringify(box)).toBe(beforeBox);
    // 返回的盒子也不是入参那个对象
    expect(next.positions.localBlock).not.toBe(box);
  });

  test('返回的 positions 与其中的盒子对象都是独立副本', () => {
    const next = setPanelBox(base, 'localBlock', VALID_BOX);
    expect(next).not.toBe(base);
    expect(next.positions).not.toBe(base.positions);
    // 修复后：未改动的盒子也是新对象，不再与入参共享引用
    expect(next.positions.clockBlock).not.toBe(base.positions.clockBlock);
    expect(next.positions.clockBlock).toEqual(base.positions.clockBlock);
    expect(next.positions.localBlock).not.toBe(base.positions.localBlock);
  });

  test('改动返回值的 positions 不影响入参（新设置的 id 是独立对象）', () => {
    const next = setPanelBox(base, 'localBlock', VALID_BOX);
    next.positions.localBlock.x = 999;
    expect(base.positions.localBlock).toBeUndefined();
  });

  test('改动返回值的盒子不会污染入参（修复浅拷贝污染）', () => {
    const next = setPanelBox(base, 'localBlock', VALID_BOX);
    const originalX = base.positions.clockBlock.x;
    next.positions.clockBlock.x = 888;
    // 修复前：入参会被连带改成 888
    expect(base.positions.clockBlock.x).toBe(originalX);
  });

  test('注意：新设置的盒子虽然是新对象，但入参盒子被改动时返回结果不受影响（值已复制）', () => {
    const box = { x: 10, y: 20, w: 300, h: 200 };
    const next = setPanelBox(base, 'localBlock', box);
    box.x = 777;
    expect(next.positions.localBlock.x).toBe(10);
  });

  test('在 snap 模式下也能设置坐标（源码不检查 mode）', () => {
    const next = setPanelBox(makeLayout(), 'clockBlock', VALID_BOX);
    expect(next.mode).toBe('snap');
    expect(next.positions.clockBlock).toEqual({ x: 10, y: 20, w: 300, h: 200 });
  });

  test('positions 为空的布局也能正常追加第一个坐标', () => {
    const empty = makeLayout({ positions: {} });
    expect(setPanelBox(empty, 'memoBlock', VALID_BOX).positions).toEqual({
      memoBlock: { x: 10, y: 20, w: 300, h: 200 },
    });
  });

  test('连续设置多个面板，每个 id 只有一个坐标', () => {
    let layout = makeLayout({ mode: 'free', positions: {} });
    for (const id of base.order) layout = setPanelBox(layout, id, VALID_BOX);
    expect(Object.keys(layout.positions).sort()).toEqual([...base.order].sort());
  });
});

describe('setLayoutMode', () => {
  test('snap → free 与 free → snap 双向切换', () => {
    const snap = makeLayout();
    const free = setLayoutMode(snap, 'free');
    expect(free.mode).toBe('free');
    expect(setLayoutMode(free, 'snap').mode).toBe('snap');
  });

  test('切换保留 order / positions / spans / heights / hidden', () => {
    const free = makeFreeLayout({ hidden: ['memoBlock'] });
    const snap = setLayoutMode(free, 'snap');
    expect(snap.order).toEqual(free.order);
    expect(snap.positions).toEqual(free.positions);
    expect(snap.spans).toEqual(free.spans);
    expect(snap.heights).toEqual(free.heights);
    expect(snap.hidden).toEqual(free.hidden);
  });

  test('设置成当前模式也返回新对象', () => {
    const base = makeLayout();
    const next = setLayoutMode(base, 'snap');
    expect(next).not.toBe(base);
    expect(next.mode).toBe('snap');
  });

  test('不修改入参，返回独立副本', () => {
    const base = makeFreeLayout();
    const before = snapshot(base);
    const next = setLayoutMode(base, 'snap');
    expect(snapshot(base)).toBe(before);
    expect(base.mode).toBe('free');
    expect(next).not.toBe(base);
    // 统一走 cloneLayout 后，positions 与其内部的盒子都是独立副本
    expect(next.positions).not.toBe(base.positions);
    expect(next.positions.clockBlock).not.toBe(base.positions.clockBlock);
  });

  test('切换模式不会丢坐标：切回 free 后 positions 仍在', () => {
    const free = makeFreeLayout();
    const roundTrip = setLayoutMode(setLayoutMode(free, 'snap'), 'free');
    expect(roundTrip.mode).toBe('free');
    expect(roundTrip.positions).toEqual(free.positions);
  });

  test('注意：运行时传入任意字符串都会被原样写入（源码不做校验）', () => {
    const layout = setLayoutMode(makeLayout(), 'grid' as unknown as PanelLayoutMode);
    expect(layout.mode).toBe('grid');
    // 但 normalizePanelLayout 会把它收回 snap
    expect(normalizePanelLayout(layout, ALL_IDS).mode).toBe('snap');
  });
});

describe('movePanel', () => {
  const base = makeLayout();

  test('在 order 内上移一位', () => {
    expect(movePanel(base, 'memoBlock', 0).order).toEqual(['memoBlock', 'clockBlock', 'localBlock']);
    expect(movePanel(base, 'localBlock', 1).order).toEqual(['clockBlock', 'localBlock', 'memoBlock']);
  });

  test('在 order 内下移一位', () => {
    expect(movePanel(base, 'clockBlock', 1).order).toEqual(['memoBlock', 'clockBlock', 'localBlock']);
    expect(movePanel(base, 'memoBlock', 2).order).toEqual(['clockBlock', 'localBlock', 'memoBlock']);
  });

  test('toIndex 以「移除该 id 之后的数组下标」为准（即最终下标）', () => {
    expect(movePanel(base, 'clockBlock', 2).order).toEqual(['memoBlock', 'localBlock', 'clockBlock']);
    expect(movePanel(base, 'localBlock', 0).order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
  });

  test('目标下标超出上界时夹到末尾', () => {
    expect(movePanel(base, 'clockBlock', 99).order).toEqual(['memoBlock', 'localBlock', 'clockBlock']);
    expect(movePanel(base, 'clockBlock', 3).order).toEqual(['memoBlock', 'localBlock', 'clockBlock']);
  });

  test('目标下标为负数时夹到开头', () => {
    expect(movePanel(base, 'localBlock', -5).order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
    expect(movePanel(base, 'localBlock', -0.5).order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
  });

  test('小数下标先截断取整再夹取', () => {
    expect(movePanel(base, 'memoBlock', 1.9).order).toEqual(['clockBlock', 'memoBlock', 'localBlock']);
    expect(movePanel(base, 'memoBlock', 2.9).order).toEqual(['clockBlock', 'localBlock', 'memoBlock']);
    expect(movePanel(base, 'memoBlock', -0.2).order).toEqual(['memoBlock', 'clockBlock', 'localBlock']);
  });

  test('越界 / 非有限下标既不丢面板也不产生重复', () => {
    for (const to of [-99, -1, 0, 1, 2, 3, 99, NaN, Infinity, -Infinity, 1.5]) {
      const moved = movePanel(base, 'memoBlock', to);
      expect(moved.order).toHaveLength(base.order.length);
      expectEachOnce(moved, base.order);
    }
  });

  test('NaN 目标下标被安全夹取到末尾，不会意外移到开头', () => {
    const moved = movePanel(base, 'localBlock', NaN);
    expect(moved.order[moved.order.length - 1]).toBe('localBlock');
    expect(new Set(moved.order).size).toBe(base.order.length);
  });

  test('注意：-Infinity 也被当作「移到末尾」（源码只判断 Number.isFinite）', () => {
    expect(movePanel(base, 'clockBlock', -Infinity).order).toEqual(['memoBlock', 'localBlock', 'clockBlock']);
    expect(movePanel(base, 'clockBlock', Infinity).order).toEqual(['memoBlock', 'localBlock', 'clockBlock']);
  });

  test('注意：源码用 Number(toIndex)，运行时传数字字符串也会被接受', () => {
    expect(movePanel(base, 'clockBlock', '2' as unknown as number).order).toEqual([
      'memoBlock',
      'localBlock',
      'clockBlock',
    ]);
    expect(movePanel(base, 'clockBlock', 'abc' as unknown as number).order).toEqual([
      'memoBlock',
      'localBlock',
      'clockBlock',
    ]);
  });

  test('移到末尾：越界与自身长度等价', () => {
    expect(movePanel(base, 'clockBlock', 2).order).toEqual(movePanel(base, 'clockBlock', 999).order);
  });

  test('移动未知 id 是空操作，返回同一引用', () => {
    const moved = movePanel(base, 'zzzBlock', 0);
    expect(moved).toBe(base);
    expect(moved.order).toEqual(base.order);
  });

  test('单元素 order 里移动任意下标都保持原位', () => {
    const single: PanelLayout = {
      mode: 'snap',
      order: ['memoBlock'],
      positions: {},
      spans: { memoBlock: 6 },
      rowSpans: { memoBlock: 1 },
      colStarts: { memoBlock: 0 },
      heights: { memoBlock: 0 },
      hidden: [],
    };
    for (const to of [-5, 0, 1, 99, NaN]) {
      expect(movePanel(single, 'memoBlock', to).order).toEqual(['memoBlock']);
    }
  });

  test('不修改入参对象', () => {
    const before = snapshot(base);
    movePanel(base, 'clockBlock', 2);
    expect(snapshot(base)).toBe(before);
  });

  test('返回的是独立副本，spans / rowSpans / heights / hidden 不与入参共享引用', () => {
    const moved = movePanel(base, 'clockBlock', 2);
    expect(moved).not.toBe(base);
    expect(moved.order).not.toBe(base.order);
    expect(moved.spans).not.toBe(base.spans);
    expect(moved.rowSpans).not.toBe(base.rowSpans);
    expect(moved.heights).not.toBe(base.heights);
    expect(moved.hidden).not.toBe(base.hidden);
    expect(moved.spans).toEqual(base.spans);
    expect(moved.rowSpans).toEqual(base.rowSpans);
    expect(moved.heights).toEqual(base.heights);
    expect(moved.hidden).toEqual(base.hidden);
  });

  test('rowSpans 被独立复制：改动返回值不影响入参', () => {
    const dirty = makeLayout({ rowSpans: { clockBlock: 3, memoBlock: 2, localBlock: 1 } });
    const moved = movePanel(dirty, 'clockBlock', 2);
    expect(moved.rowSpans).toEqual({ clockBlock: 3, memoBlock: 2, localBlock: 1 });
    moved.rowSpans.clockBlock = 6;
    expect(dirty.rowSpans.clockBlock).toBe(3);
  });

  test('改动返回值的 spans / heights / hidden 不影响入参', () => {
    const moved = movePanel(base, 'clockBlock', 2);
    moved.spans.clockBlock = 12;
    moved.rowSpans.clockBlock = 6;
    moved.heights.clockBlock = 900;
    moved.hidden.push('memoBlock');
    expect(base.spans.clockBlock).toBe(6);
    expect(base.rowSpans.clockBlock).toBe(1);
    expect(base.heights.clockBlock).toBe(0);
    expect(base.hidden).toEqual([]);
  });

  test('移动只改顺序，不动 span / height / hidden', () => {
    const dirty = makeLayout({ hidden: ['memoBlock'], heights: { clockBlock: 300, memoBlock: 0, localBlock: 640 } });
    const moved = movePanel(dirty, 'localBlock', 0);
    expect(moved.spans).toEqual(dirty.spans);
    expect(moved.heights).toEqual(dirty.heights);
    expect(moved.hidden).toEqual(['memoBlock']);
  });

  test('注意：被移动的 id 若在 order 里重复，移动会把它收敛成一个', () => {
    const dirty: PanelLayout = {
      mode: 'snap',
      order: ['clockBlock', 'memoBlock', 'clockBlock'],
      positions: {},
      spans: { clockBlock: 6, memoBlock: 6 },
      rowSpans: { clockBlock: 1, memoBlock: 1 },
      colStarts: { clockBlock: 0, memoBlock: 0 },
      heights: { clockBlock: 0, memoBlock: 0 },
      hidden: [],
    };
    const moved = movePanel(dirty, 'clockBlock', 1);
    expect(moved.order).toEqual(['memoBlock', 'clockBlock']);
    expect(countIn(moved, 'clockBlock')).toBe(1);
  });
});

describe('moveNextTo', () => {
  const base = makeLayout();
  // order: ['clockBlock', 'memoBlock', 'localBlock']

  test('before = true：插到锚点之前', () => {
    expect(moveNextTo(base, 'localBlock', 'clockBlock', true).order).toEqual([
      'localBlock',
      'clockBlock',
      'memoBlock',
    ]);
    expect(moveNextTo(base, 'clockBlock', 'memoBlock', true).order).toEqual([
      'clockBlock',
      'memoBlock',
      'localBlock',
    ]);
    // 插到自己原位之前的锚点前 → 位置不变
    expect(moveNextTo(base, 'memoBlock', 'localBlock', true).order).toEqual(base.order);
  });

  test('before = false：插到锚点之后', () => {
    expect(moveNextTo(base, 'clockBlock', 'memoBlock', false).order).toEqual([
      'memoBlock',
      'clockBlock',
      'localBlock',
    ]);
    expect(moveNextTo(base, 'clockBlock', 'localBlock', false).order).toEqual([
      'memoBlock',
      'localBlock',
      'clockBlock',
    ]);
    expect(moveNextTo(base, 'memoBlock', 'clockBlock', false).order).toEqual(base.order);
  });

  test('锚点在开头：向前/向后都能正确落位', () => {
    expect(moveNextTo(base, 'localBlock', 'clockBlock', true).order[0]).toBe('localBlock');
    expect(moveNextTo(base, 'localBlock', 'clockBlock', false).order).toEqual([
      'clockBlock',
      'localBlock',
      'memoBlock',
    ]);
  });

  test('锚点在末尾：向后插等于留在末尾，向前插则变成倒数第二', () => {
    expect(moveNextTo(base, 'clockBlock', 'localBlock', false).order).toEqual([
      'memoBlock',
      'localBlock',
      'clockBlock',
    ]);
    expect(moveNextTo(base, 'clockBlock', 'localBlock', true).order).toEqual([
      'memoBlock',
      'clockBlock',
      'localBlock',
    ]);
  });

  test('不丢 id 也不产生重复：任意拖动组合下 order 始终是同一集合', () => {
    for (const dragged of base.order) {
      for (const anchor of base.order) {
        for (const before of [true, false]) {
          const moved = moveNextTo(base, dragged, anchor, before);
          expect(moved.order).toHaveLength(base.order.length);
          expectEachOnce(moved, base.order);
          expect([...moved.order].sort()).toEqual([...base.order].sort());
        }
      }
    }
  });

  test('拖动未知 id 是空操作，返回同一引用', () => {
    expect(moveNextTo(base, 'zzzBlock', 'clockBlock', true)).toBe(base);
    expect(moveNextTo(base, 'group-ghost', 'memoBlock', false)).toBe(base);
  });

  test('锚点未知是空操作，返回同一引用（order 完全不变）', () => {
    const moved = moveNextTo(base, 'clockBlock', 'zzzBlock', true);
    expect(moved).toBe(base);
    expect(moved.order).toEqual(base.order);
  });

  test('两个 id 都未知同样是空操作', () => {
    expect(moveNextTo(base, 'zzzBlock', 'yyyBlock', true)).toBe(base);
  });

  test('draggedId === anchorId 是空操作（含未知 id 自身）', () => {
    expect(moveNextTo(base, 'clockBlock', 'clockBlock', true)).toBe(base);
    expect(moveNextTo(base, 'clockBlock', 'clockBlock', false)).toBe(base);
    expect(moveNextTo(base, 'zzzBlock', 'zzzBlock', true)).toBe(base);
  });

  test('隐藏面板留在原位：只改变被拖动面板的相对次序', () => {
    const withHidden = makeLayout({ hidden: ['memoBlock'] });
    const moved = moveNextTo(withHidden, 'localBlock', 'clockBlock', true);
    expect(moved.hidden).toEqual(['memoBlock']);
    // memoBlock 虽然被隐藏，仍然留在 order 里的原位（clockBlock 之后）
    expect(moved.order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
    expect(moved.order.indexOf('memoBlock')).toBe(2);
    expect(isPanelVisible(moved, 'memoBlock')).toBe(false);
  });

  test('拖动隐藏的面板同样有效（源码不看 hidden）', () => {
    const withHidden = makeLayout({ hidden: ['memoBlock'] });
    expect(moveNextTo(withHidden, 'memoBlock', 'clockBlock', true).order).toEqual([
      'memoBlock',
      'clockBlock',
      'localBlock',
    ]);
    expect(moveNextTo(withHidden, 'memoBlock', 'clockBlock', true).hidden).toEqual(['memoBlock']);
  });

  test('不修改入参（布局快照完全不变）', () => {
    const before = snapshot(base);
    moveNextTo(base, 'localBlock', 'clockBlock', true);
    moveNextTo(base, 'clockBlock', 'localBlock', false);
    expect(snapshot(base)).toBe(before);
  });

  test('返回的是独立副本：order / spans / rowSpans / colStarts / heights / positions / hidden 都不共享引用', () => {
    const free = makeFreeLayout();
    const moved = moveNextTo(free, 'localBlock', 'clockBlock', true);
    expect(moved).not.toBe(free);
    expect(moved.order).not.toBe(free.order);
    expect(moved.spans).not.toBe(free.spans);
    expect(moved.rowSpans).not.toBe(free.rowSpans);
    expect(moved.colStarts).not.toBe(free.colStarts);
    expect(moved.heights).not.toBe(free.heights);
    expect(moved.positions).not.toBe(free.positions);
    expect(moved.positions.clockBlock).not.toBe(free.positions.clockBlock);
    expect(moved.hidden).not.toBe(free.hidden);

    // 值仍然相等（只是引用独立）
    expect(moved.spans).toEqual(free.spans);
    expect(moved.rowSpans).toEqual(free.rowSpans);
    expect(moved.colStarts).toEqual(free.colStarts);
    expect(moved.heights).toEqual(free.heights);
    expect(moved.positions).toEqual(free.positions);
    expect(moved.hidden).toEqual(free.hidden);
  });

  test('改动返回值不影响入参（order / spans / colStarts / positions / hidden 全部隔离）', () => {
    const dirty = makeFreeLayout({ hidden: ['memoBlock'], colStarts: { clockBlock: 1, memoBlock: 7, localBlock: 0 } });
    const moved = moveNextTo(dirty, 'localBlock', 'clockBlock', true);
    moved.order.push('injected');
    moved.spans.clockBlock = 12;
    moved.rowSpans.clockBlock = 6;
    moved.colStarts.clockBlock = 9;
    moved.heights.clockBlock = 900;
    moved.hidden.push('localBlock');
    moved.positions.clockBlock.x = 999;

    expect(dirty.order).toEqual(['clockBlock', 'memoBlock', 'localBlock']);
    expect(dirty.spans.clockBlock).toBe(6);
    expect(dirty.rowSpans.clockBlock).toBe(1);
    expect(dirty.colStarts.clockBlock).toBe(1);
    expect(dirty.heights.clockBlock).toBe(0);
    expect(dirty.hidden).toEqual(['memoBlock']);
    expect(dirty.positions.clockBlock.x).toBe(0);
  });

  test('移动只改 order，不动 span / rowSpan / colStart / height / hidden', () => {
    const dirty = makeLayout({
      hidden: ['memoBlock'],
      heights: { clockBlock: 300, memoBlock: 0, localBlock: 640 },
      rowSpans: { clockBlock: 2, memoBlock: 3, localBlock: 4 },
      colStarts: { clockBlock: 1, memoBlock: 7, localBlock: 0 },
    });
    const moved = moveNextTo(dirty, 'localBlock', 'clockBlock', true);
    expect(moved.spans).toEqual(dirty.spans);
    expect(moved.rowSpans).toEqual(dirty.rowSpans);
    expect(moved.colStarts).toEqual(dirty.colStarts);
    expect(moved.heights).toEqual(dirty.heights);
    expect(moved.hidden).toEqual(['memoBlock']);
    expect(moved.mode).toBe(dirty.mode);
  });

  test('注意：被拖动的 id 若在 order 里重复，移动会把它收敛成一个', () => {
    const dirty: PanelLayout = {
      mode: 'snap',
      order: ['clockBlock', 'memoBlock', 'clockBlock'],
      positions: {},
      spans: { clockBlock: 6, memoBlock: 6 },
      rowSpans: { clockBlock: 1, memoBlock: 1 },
      colStarts: { clockBlock: 0, memoBlock: 0 },
      heights: { clockBlock: 0, memoBlock: 0 },
      hidden: [],
    };
    const moved = moveNextTo(dirty, 'clockBlock', 'memoBlock', false);
    expect(moved.order).toEqual(['memoBlock', 'clockBlock']);
    expect(countIn(moved, 'clockBlock')).toBe(1);
  });

  test('注意：before 按真值使用，运行时的非布尔值会被静默接受', () => {
    const truthy = moveNextTo(base, 'localBlock', 'clockBlock', 'yes' as unknown as boolean);
    const falsy = moveNextTo(base, 'localBlock', 'clockBlock', '' as unknown as boolean);
    expect(truthy.order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
    expect(falsy.order).toEqual(['clockBlock', 'localBlock', 'memoBlock']);
  });

  test('连续移动可以拼出任意排列，且每一步都不丢 id', () => {
    let layout = base;
    layout = moveNextTo(layout, 'localBlock', 'clockBlock', true);
    expect(layout.order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
    layout = moveNextTo(layout, 'memoBlock', 'localBlock', true);
    expect(layout.order).toEqual(['memoBlock', 'localBlock', 'clockBlock']);
    layout = moveNextTo(layout, 'clockBlock', 'memoBlock', true);
    expect(layout.order).toEqual(['clockBlock', 'memoBlock', 'localBlock']);
    expectEachOnce(layout, base.order);
  });
});

describe('统一不可变约定（cloneLayout）', () => {
  test('所有返回新布局的函数都独立复制 rowSpans / colStarts', () => {
    // 修复前：这些函数只重建了自己负责的那个 map，其余字段靠 `...layout` 浅展开，
    // 于是 rowSpans / colStarts 与入参共享引用；现在统一走 cloneLayout。
    const base = makeLayout({ colStarts: { clockBlock: 1, memoBlock: 7, localBlock: 0 } });
    for (const next of [
      setPanelSpan(base, 'clockBlock', 4),
      setPanelHeight(base, 'clockBlock', 300),
      cyclePanelSpan(base, 'clockBlock'),
      movePanel(base, 'clockBlock', 0),
      togglePanelHidden(base, 'clockBlock'),
      setPanelBox(base, 'clockBlock', VALID_BOX),
      setPanelColStart(base, 'clockBlock', 5),
      setPanelRowSpan(base, 'clockBlock', 3),
      moveNextTo(base, 'localBlock', 'clockBlock', true),
      setLayoutMode(base, 'free'),
    ]) {
      expect(next.rowSpans).not.toBe(base.rowSpans);
      expect(next.colStarts).not.toBe(base.colStarts);
      expect(next.spans).not.toBe(base.spans);
      expect(next.order).not.toBe(base.order);
      expect(next.heights).not.toBe(base.heights);
      expect(next.hidden).not.toBe(base.hidden);
      expect(next.positions).not.toBe(base.positions);
    }
    // 入参始终完好
    expect(base.colStarts).toEqual({ clockBlock: 1, memoBlock: 7, localBlock: 0 });
    expect(base.rowSpans).toEqual({ clockBlock: 1, memoBlock: 1, localBlock: 1 });
  });
});

describe('cyclePanelSpan', () => {
  const base = makeLayout();

  test('沿 SPAN_PRESETS 前进：3 → 4 → 6 → 8 → 12 → 3', () => {
    let layout = setPanelSpan(base, 'clockBlock', 3);
    const sequence: number[] = [];
    for (let step = 0; step < 5; step += 1) {
      layout = cyclePanelSpan(layout, 'clockBlock');
      sequence.push(layout.spans.clockBlock);
    }
    expect(sequence).toEqual([4, 6, 8, 12, 3]);
  });

  test('从任意预设档位出发，5 步后回到原档位', () => {
    for (const start of SPAN_PRESETS) {
      let layout = setPanelSpan(base, 'memoBlock', start);
      for (let step = 0; step < 5; step += 1) layout = cyclePanelSpan(layout, 'memoBlock');
      expect(layout.spans.memoBlock).toBe(start);
    }
  });

  test('每个档位的下一步都与源码 findIndex + 取模逻辑一致', () => {
    const expected: Record<number, number> = { 3: 4, 4: 6, 6: 8, 8: 12, 12: 3 };
    for (const start of SPAN_PRESETS) {
      const layout = setPanelSpan(base, 'memoBlock', start);
      expect(cyclePanelSpan(layout, 'memoBlock').spans.memoBlock).toBe(expected[start]);
    }
  });

  test('低于最小预设档位时前进到最小档', () => {
    const layout = setPanelSpan(base, 'memoBlock', 2);
    // 严格找「大于当前」的第一个预设值 → 3
    expect(cyclePanelSpan(layout, 'memoBlock').spans.memoBlock).toBe(3);
  });

  test('非预设档位一律前进到「下一个更大的预设」，不出现回绕倒退', () => {
    // 修复前用 findIndex(s => s >= current)，9/10/11 会回绕到 3（倒退）。
    // 现在用 find(s => s > current)，只有超过最大档位时才回绕到最小档。
    const expected: Record<number, number> = { 5: 6, 7: 8, 9: 12, 10: 12, 11: 12, 12: 3 };
    for (const start of [5, 7, 9, 10, 11, 12]) {
      const layout = setPanelSpan(base, 'memoBlock', start);
      expect(cyclePanelSpan(layout, 'memoBlock').spans.memoBlock).toBe(expected[start]);
    }
  });

  test('非法当前值先归一到该面板默认宽度再前进', () => {
    const cases: unknown[] = [0, 1, 13, -1, NaN, Infinity, -Infinity, '', 'abc', null, undefined, {}, []];
    for (const current of cases) {
      const layout = withSpans(base, { ...base.spans, clockBlock: current });
      // clockBlock 不是整行面板 → 默认 6 → 下一档 8
      expect(cyclePanelSpan(layout, 'clockBlock').spans.clockBlock).toBe(8);
    }
  });

  test('非法当前值 + 原先的整行面板：默认宽度同样是 6 → 前进到 8', () => {
    // 两列布局下 DEFAULT_FULL_WIDTH 为空集，localBlock 的默认宽度也是 6
    const layout = withSpans(base, { ...base.spans, localBlock: 0 });
    expect(defaultSpan('localBlock')).toBe(6);
    expect(cyclePanelSpan(layout, 'localBlock').spans.localBlock).toBe(8);
  });

  test('数字字符串当前值被 toSpan 归一后再前进', () => {
    expect(cyclePanelSpan(withSpans(base, { ...base.spans, clockBlock: '3' }), 'clockBlock').spans.clockBlock).toBe(4);
    expect(cyclePanelSpan(withSpans(base, { ...base.spans, clockBlock: '12' }), 'clockBlock').spans.clockBlock).toBe(3);
  });

  test('小数当前值先 Math.round 再前进', () => {
    expect(cyclePanelSpan(withSpans(base, { ...base.spans, clockBlock: 3.4 }), 'clockBlock').spans.clockBlock).toBe(4);
    expect(cyclePanelSpan(withSpans(base, { ...base.spans, clockBlock: 3.6 }), 'clockBlock').spans.clockBlock).toBe(6);
  });

  test('spans 里没有该 id 时也能切换（按默认宽度 6 → 8）', () => {
    const noSpan = withSpans(base, {});
    expect(cyclePanelSpan(noSpan, 'memoBlock').spans.memoBlock).toBe(8);
    // localBlock 的默认宽度同样是 6（不再有默认整行面板）→ 8
    expect(cyclePanelSpan(noSpan, 'localBlock').spans.localBlock).toBe(8);
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(cyclePanelSpan(base, 'zzzBlock')).toBe(base);
  });

  test('不影响其他面板的 span / height', () => {
    const dirty = makeLayout({ heights: { clockBlock: 300, memoBlock: 400, localBlock: 500 } });
    const next = cyclePanelSpan(dirty, 'clockBlock');
    expect(next.spans.memoBlock).toBe(dirty.spans.memoBlock);
    expect(next.spans.localBlock).toBe(dirty.spans.localBlock);
    expect(next.heights).toEqual(dirty.heights);
  });

  test('不修改入参，order / heights / hidden 保持原引用', () => {
    const before = snapshot(base);
    const next = cyclePanelSpan(base, 'clockBlock');
    expect(snapshot(base)).toBe(before);
    expect(next).not.toBe(base);
    expect(next.spans).not.toBe(base.spans);
    expect(next.order).not.toBe(base.order);
    expect(next.heights).not.toBe(base.heights);
    expect(next.hidden).not.toBe(base.hidden);
  });

  test('连续 5 次切换后回到起点（3 → … → 3）', () => {
    let layout = setPanelSpan(base, 'localBlock', 3);
    for (let step = 0; step < 5; step += 1) layout = cyclePanelSpan(layout, 'localBlock');
    expect(layout.spans.localBlock).toBe(3);
  });

  test('循环过程中 order / hidden 始终不变，且 span 始终合法', () => {
    let layout: PanelLayout = base;
    for (let step = 0; step < 7; step += 1) {
      layout = cyclePanelSpan(layout, 'localBlock');
      expect(layout.order).toEqual(base.order);
      expect(layout.hidden).toEqual(base.hidden);
      expect(toSpan(layout.spans.localBlock)).toBe(layout.spans.localBlock);
    }
  });
});

describe('setPanelSpan', () => {
  const base = makeLayout();

  test('MIN_SPAN..MAX_SPAN 都能直接设置', () => {
    for (let span = MIN_SPAN; span <= MAX_SPAN; span += 1) {
      expect(setPanelSpan(base, 'clockBlock', span).spans.clockBlock).toBe(span);
    }
  });

  test('数字字符串与合法小数被 toSpan 归一后写入', () => {
    expect(setPanelSpan(base, 'clockBlock', '6' as unknown as number).spans.clockBlock).toBe(6);
    expect(setPanelSpan(base, 'clockBlock', '12' as unknown as number).spans.clockBlock).toBe(12);
    expect(setPanelSpan(base, 'clockBlock', 5.4).spans.clockBlock).toBe(5);
    expect(setPanelSpan(base, 'clockBlock', 5.6).spans.clockBlock).toBe(6);
    expect(setPanelSpan(base, 'clockBlock', 11.5).spans.clockBlock).toBe(12);
  });

  test('非法值回退到该面板的默认宽度（普通面板 6）', () => {
    const invalid = [0, 1, 13, 99, -1, 12.5, NaN, Infinity, -Infinity, '', 'abc', '6.5', null, undefined, {}, []];
    for (const span of invalid) {
      const next = setPanelSpan(base, 'clockBlock', span as unknown as number);
      expect(next.spans.clockBlock).toBe(6);
    }
  });

  test('非法值回退到默认宽度：静态面板与分组面板都是 6（两列布局下无整行默认）', () => {
    expect(setPanelSpan(base, 'localBlock', 0).spans.localBlock).toBe(6);
    expect(setPanelSpan(makeLayout({ order: ['group-ai'] }), 'group-ai', NaN).spans['group-ai']).toBe(6);
  });

  test('设置成与当前相同的值也返回新对象', () => {
    const next = setPanelSpan(base, 'clockBlock', 6);
    expect(next.spans.clockBlock).toBe(6);
    expect(next).not.toBe(base);
    expect(next.spans).not.toBe(base.spans);
  });

  test('不影响其他面板，order / heights / hidden 保持原引用', () => {
    const next = setPanelSpan(base, 'memoBlock', 12);
    expect(next.spans.clockBlock).toBe(base.spans.clockBlock);
    expect(next.spans.localBlock).toBe(base.spans.localBlock);
    expect(next.spans.memoBlock).toBe(12);
    expect(next.order).not.toBe(base.order);
    expect(next.heights).not.toBe(base.heights);
    expect(next.hidden).not.toBe(base.hidden);
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(setPanelSpan(base, 'zzzBlock', 6)).toBe(base);
    expect(setPanelSpan(base, 'zzzBlock', 0)).toBe(base);
  });

  test('不修改入参', () => {
    const before = snapshot(base);
    setPanelSpan(base, 'memoBlock', 12);
    expect(snapshot(base)).toBe(before);
  });
});

describe('setPanelRowSpan', () => {
  const base = makeLayout();

  test('MIN_ROW_SPAN..MAX_ROW_SPAN 都能直接设置', () => {
    for (let rows = MIN_ROW_SPAN; rows <= MAX_ROW_SPAN; rows += 1) {
      expect(setPanelRowSpan(base, 'clockBlock', rows).rowSpans.clockBlock).toBe(rows);
    }
    expect(setPanelRowSpan(base, 'clockBlock', 2).rowSpans.clockBlock).toBe(2);
  });

  test('数字字符串与合法小数被 toRowSpan 归一后写入', () => {
    expect(setPanelRowSpan(base, 'clockBlock', '3' as unknown as number).rowSpans.clockBlock).toBe(3);
    expect(setPanelRowSpan(base, 'clockBlock', 2.4).rowSpans.clockBlock).toBe(2);
    expect(setPanelRowSpan(base, 'clockBlock', 2.6).rowSpans.clockBlock).toBe(3);
    expect(setPanelRowSpan(base, 'clockBlock', 5.5).rowSpans.clockBlock).toBe(6);
  });

  test('0 是合法值（自动），原样写入 0', () => {
    const tall = setPanelRowSpan(base, 'clockBlock', 5);
    expect(setPanelRowSpan(tall, 'clockBlock', 0).rowSpans.clockBlock).toBe(0);
    expect(setPanelRowSpan(base, 'clockBlock', '0' as unknown as number).rowSpans.clockBlock).toBe(0);
  });

  test('非法值一律回退为 0（自动）', () => {
    const invalid = [-1, 7, 99, 6.5, NaN, Infinity, -Infinity, '', 'abc', '2.9', '3abc', null, undefined, {}, []];
    for (const rows of invalid) {
      const next = setPanelRowSpan(base, 'clockBlock', rows as unknown as number);
      expect(next.rowSpans.clockBlock).toBe(0);
    }
  });

  test('注意：非法值回退 0（自动）而不是该面板的「默认行跨度」或 1', () => {
    // 与 setPanelSpan 不同：setPanelSpan 会按面板区分默认宽度，setPanelRowSpan 一律 0
    const tall = setPanelRowSpan(base, 'clockBlock', 5);
    expect(setPanelRowSpan(tall, 'clockBlock', 99).rowSpans.clockBlock).toBe(0);
    expect(setPanelRowSpan(tall, 'localBlock', NaN).rowSpans.localBlock).toBe(0);
    expect(setPanelRowSpan(tall, 'localBlock', -1).rowSpans.localBlock).toBe(0);
  });

  test('设置成与当前相同的值也返回新对象，rowSpans 是独立副本', () => {
    const next = setPanelRowSpan(base, 'clockBlock', 1);
    expect(next.rowSpans.clockBlock).toBe(1);
    expect(next).not.toBe(base);
    expect(next.rowSpans).not.toBe(base.rowSpans);
    expect(next.rowSpans).toEqual(base.rowSpans);
  });

  test('不影响其他面板的 rowSpan，其它字段是独立副本', () => {
    const next = setPanelRowSpan(base, 'memoBlock', 4);
    expect(next.rowSpans.clockBlock).toBe(base.rowSpans.clockBlock);
    expect(next.rowSpans.localBlock).toBe(base.rowSpans.localBlock);
    expect(next.rowSpans.memoBlock).toBe(4);
    expect(next.order).not.toBe(base.order);
    expect(next.spans).not.toBe(base.spans);
    expect(next.colStarts).not.toBe(base.colStarts);
    expect(next.heights).not.toBe(base.heights);
    expect(next.hidden).not.toBe(base.hidden);
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(setPanelRowSpan(base, 'zzzBlock', 3)).toBe(base);
    expect(setPanelRowSpan(base, 'zzzBlock', 0)).toBe(base);
    expect(setPanelRowSpan(base, 'group-ghost', 6)).toBe(base);
  });

  test('不修改入参：布局与 rowSpans 都不被改动', () => {
    const before = snapshot(base);
    const next = setPanelRowSpan(base, 'memoBlock', 4);
    expect(snapshot(base)).toBe(before);
    // 改动返回值不会污染入参
    next.rowSpans.memoBlock = 6;
    expect(base.rowSpans.memoBlock).toBe(1);
  });

  test('与 setPanelSpan / setPanelHeight 互不干扰', () => {
    const layout = setPanelRowSpan(setPanelSpan(setPanelHeight(base, 'memoBlock', 600), 'memoBlock', 8), 'memoBlock', 3);
    expect(layout.spans.memoBlock).toBe(8);
    expect(layout.heights.memoBlock).toBe(600);
    expect(layout.rowSpans.memoBlock).toBe(3);
  });

  test('连续设置多个面板，每个 id 只有一个行跨度', () => {
    let layout = base;
    for (const id of base.order) layout = setPanelRowSpan(layout, id, 2);
    expect(Object.keys(layout.rowSpans).sort()).toEqual([...base.order].sort());
    for (const id of base.order) expect(layout.rowSpans[id]).toBe(2);
  });
});

describe('setPanelColStart', () => {
  const base = makeLayout({ colStarts: { clockBlock: 1, memoBlock: 7, localBlock: 0 } });

  test('1..PANEL_GRID_COLUMNS 都能直接设置', () => {
    for (let col = 1; col <= PANEL_GRID_COLUMNS; col += 1) {
      expect(setPanelColStart(base, 'localBlock', col).colStarts.localBlock).toBe(col);
    }
  });

  test('0 表示自动，原样写入', () => {
    expect(setPanelColStart(base, 'clockBlock', 0).colStarts.clockBlock).toBe(0);
    expect(setPanelColStart(base, 'memoBlock', 0).colStarts.memoBlock).toBe(0);
  });

  test('数字字符串与合法小数被 toColStart 归一后写入', () => {
    expect(setPanelColStart(base, 'localBlock', '5' as unknown as number).colStarts.localBlock).toBe(5);
    expect(setPanelColStart(base, 'localBlock', 4.4).colStarts.localBlock).toBe(4);
    expect(setPanelColStart(base, 'localBlock', 4.6).colStarts.localBlock).toBe(5);
    expect(setPanelColStart(base, 'localBlock', 11.5).colStarts.localBlock).toBe(12);
  });

  test('非法值一律回退为 0（自动）', () => {
    const invalid = [-1, 13, 99, 12.5, NaN, Infinity, -Infinity, '', 'abc', '2.9', '3abc', null, undefined, {}, []];
    for (const col of invalid) {
      const next = setPanelColStart(base, 'clockBlock', col as unknown as number);
      expect(next.colStarts.clockBlock).toBe(0);
    }
  });

  test('注意：非法值回退 0，而不是该面板原本的列起点（不会恢复成默认的 1 / 7）', () => {
    // 源码是 `toColStart(col) ?? 0`，不读 defaultPanelLayout 的 DEFAULT_COL_START
    expect(setPanelColStart(base, 'clockBlock', 99).colStarts.clockBlock).toBe(0);
    expect(setPanelColStart(base, 'memoBlock', NaN).colStarts.memoBlock).toBe(0);
  });

  test('不影响其他面板的 colStart，其它字段是独立副本', () => {
    const next = setPanelColStart(base, 'localBlock', 5);
    expect(next.colStarts.clockBlock).toBe(1);
    expect(next.colStarts.memoBlock).toBe(7);
    expect(next.colStarts.localBlock).toBe(5);
    expect(next.order).not.toBe(base.order);
    expect(next.spans).not.toBe(base.spans);
    expect(next.rowSpans).not.toBe(base.rowSpans);
    expect(next.heights).not.toBe(base.heights);
    expect(next.hidden).not.toBe(base.hidden);
    expect(next.positions).not.toBe(base.positions);
  });

  test('设置成与当前相同的值也返回新对象，colStarts 是独立副本', () => {
    const next = setPanelColStart(base, 'clockBlock', 1);
    expect(next.colStarts.clockBlock).toBe(1);
    expect(next).not.toBe(base);
    expect(next.colStarts).not.toBe(base.colStarts);
    expect(next.colStarts).toEqual(base.colStarts);
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(setPanelColStart(base, 'zzzBlock', 3)).toBe(base);
    expect(setPanelColStart(base, 'zzzBlock', 0)).toBe(base);
    expect(setPanelColStart(base, 'group-ghost', 7)).toBe(base);
  });

  test('不修改入参：布局与 colStarts 都不被改动', () => {
    const before = snapshot(base);
    const next = setPanelColStart(base, 'memoBlock', 3);
    expect(snapshot(base)).toBe(before);
    // 改动返回值不会污染入参
    next.colStarts.memoBlock = 12;
    expect(base.colStarts.memoBlock).toBe(7);
  });

  test('与 setPanelSpan / setPanelRowSpan / setPanelHeight 互不干扰', () => {
    const layout = setPanelColStart(
      setPanelRowSpan(setPanelSpan(setPanelHeight(base, 'memoBlock', 600), 'memoBlock', 8), 'memoBlock', 3),
      'memoBlock',
      9,
    );
    expect(layout.colStarts.memoBlock).toBe(9);
    expect(layout.spans.memoBlock).toBe(8);
    expect(layout.rowSpans.memoBlock).toBe(3);
    expect(layout.heights.memoBlock).toBe(600);
  });

  test('连续设置多个面板，每个 id 只有一个列起点', () => {
    let layout = base;
    for (const id of base.order) layout = setPanelColStart(layout, id, 4);
    expect(Object.keys(layout.colStarts).sort()).toEqual([...base.order].sort());
    for (const id of base.order) expect(layout.colStarts[id]).toBe(4);
  });

  test('往返：设置后再归一化，值原样保留', () => {
    const layout = setPanelColStart(setPanelColStart(base, 'clockBlock', 1), 'memoBlock', 7);
    const reloaded = normalizePanelLayout(JSON.parse(JSON.stringify(layout)), base.order);
    expect(reloaded.colStarts).toEqual(layout.colStarts);
  });
});

describe('setPanelHeight', () => {
  const base = makeLayout();

  test('区间内的高度直接写入', () => {
    expect(setPanelHeight(base, 'clockBlock', MIN_PANEL_HEIGHT).heights.clockBlock).toBe(80);
    expect(setPanelHeight(base, 'clockBlock', 320).heights.clockBlock).toBe(320);
    expect(setPanelHeight(base, 'clockBlock', MAX_PANEL_HEIGHT).heights.clockBlock).toBe(2000);
  });

  test('0 表示自适应，是合法值', () => {
    const tall = setPanelHeight(base, 'clockBlock', 500);
    expect(setPanelHeight(tall, 'clockBlock', 0).heights.clockBlock).toBe(0);
  });

  test('数字字符串与小数被 toHeight 归一后写入', () => {
    expect(setPanelHeight(base, 'clockBlock', '640' as unknown as number).heights.clockBlock).toBe(640);
    expect(setPanelHeight(base, 'clockBlock', 79.6).heights.clockBlock).toBe(80);
    expect(setPanelHeight(base, 'clockBlock', 1999.7).heights.clockBlock).toBe(2000);
  });

  test('非法值一律回退为 0（自适应）', () => {
    const invalid = [1, 79, -1, 2001, 2000.6, NaN, Infinity, -Infinity, '', 'abc', '80.5', null, undefined, {}, []];
    for (const height of invalid) {
      const next = setPanelHeight(base, 'clockBlock', height as unknown as number);
      expect(next.heights.clockBlock).toBe(0);
    }
  });

  test('不影响其他面板，order / spans / hidden 保持原引用', () => {
    const next = setPanelHeight(base, 'memoBlock', 400);
    expect(next.heights.clockBlock).toBe(base.heights.clockBlock);
    expect(next.heights.localBlock).toBe(base.heights.localBlock);
    expect(next.heights.memoBlock).toBe(400);
    expect(next.order).not.toBe(base.order);
    expect(next.spans).not.toBe(base.spans);
    expect(next.hidden).not.toBe(base.hidden);
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(setPanelHeight(base, 'zzzBlock', 400)).toBe(base);
    expect(setPanelHeight(base, 'zzzBlock', 0)).toBe(base);
  });

  test('不修改入参', () => {
    const before = snapshot(base);
    setPanelHeight(base, 'memoBlock', 400);
    expect(snapshot(base)).toBe(before);
  });

  test('与 setPanelSpan 互不干扰', () => {
    const layout = setPanelHeight(setPanelSpan(base, 'memoBlock', 8), 'memoBlock', 600);
    expect(layout.spans.memoBlock).toBe(8);
    expect(layout.heights.memoBlock).toBe(600);
  });
});

describe('togglePanelHidden', () => {
  const base = makeLayout();

  test('隐藏一个可见面板', () => {
    expect(togglePanelHidden(base, 'memoBlock').hidden).toEqual(['memoBlock']);
  });

  test('显示一个已隐藏面板', () => {
    const hidden = makeLayout({ hidden: ['memoBlock', 'localBlock'] });
    expect(togglePanelHidden(hidden, 'memoBlock').hidden).toEqual(['localBlock']);
  });

  test('未知 id 是空操作，返回同一引用', () => {
    expect(togglePanelHidden(base, 'zzzBlock')).toBe(base);
  });

  test('连续切换两次回到原来的 hidden 集合', () => {
    const twice = togglePanelHidden(togglePanelHidden(base, 'memoBlock'), 'memoBlock');
    expect(twice.hidden).toEqual(base.hidden);
  });

  test('注意：连续切换两次后 hidden 数组顺序可能变化（集合相同、顺序不同）', () => {
    const hidden = makeLayout({ hidden: ['memoBlock', 'localBlock'] });
    const twice = togglePanelHidden(togglePanelHidden(hidden, 'memoBlock'), 'memoBlock');
    // 取消隐藏会 filter 掉元素，再次隐藏则 append 到末尾
    expect(twice.hidden).toEqual(['localBlock', 'memoBlock']);
    expect(twice.hidden).not.toEqual(hidden.hidden);
    expect([...twice.hidden].sort()).toEqual([...hidden.hidden].sort());
  });

  test('隐藏只做标记，不会把面板从 order 里删掉', () => {
    const next = togglePanelHidden(base, 'memoBlock');
    expect(next.order).toEqual(base.order);
    expect(next.spans).toEqual(base.spans);
    expect(next.heights).toEqual(base.heights);
  });

  test('hidden 里出现重复项时，一次取消隐藏会把重复项一起清掉', () => {
    const dirty = makeLayout({ hidden: ['memoBlock', 'memoBlock', 'localBlock'] });
    expect(togglePanelHidden(dirty, 'memoBlock').hidden).toEqual(['localBlock']);
  });

  test('不修改入参，spans / rowSpans / colStarts / heights / order 引用独立', () => {
    const before = snapshot(base);
    const next = togglePanelHidden(base, 'memoBlock');
    expect(snapshot(base)).toBe(before);
    expect(next).not.toBe(base);
    expect(next.hidden).not.toBe(base.hidden);
    expect(next.spans).not.toBe(base.spans);
    expect(next.rowSpans).not.toBe(base.rowSpans);
    expect(next.colStarts).not.toBe(base.colStarts);
    expect(next.heights).not.toBe(base.heights);
    expect(next.order).not.toBe(base.order);
    expect(next.rowSpans).toEqual(base.rowSpans);
    expect(next.colStarts).toEqual(base.colStarts);
  });

  test('rowSpans 被独立复制：改动返回值不影响入参', () => {
    const dirty = makeLayout({ rowSpans: { clockBlock: 4, memoBlock: 2, localBlock: 1 } });
    const next = togglePanelHidden(dirty, 'memoBlock');
    expect(next.rowSpans).toEqual({ clockBlock: 4, memoBlock: 2, localBlock: 1 });
    next.rowSpans.clockBlock = 6;
    expect(dirty.rowSpans.clockBlock).toBe(4);
  });

  test('反复隐藏不同面板会累积到 hidden 末尾', () => {
    const layout = togglePanelHidden(togglePanelHidden(base, 'clockBlock'), 'localBlock');
    expect(layout.hidden).toEqual(['clockBlock', 'localBlock']);
  });
});

describe('isPanelVisible', () => {
  test('尊重 hidden 列表', () => {
    const layout = makeLayout({ hidden: ['memoBlock'] });
    expect(isPanelVisible(layout, 'memoBlock')).toBe(false);
    expect(isPanelVisible(layout, 'clockBlock')).toBe(true);
    expect(isPanelVisible(layout, 'localBlock')).toBe(true);
  });

  test('注意：未出现在 order 里的未知 id 也被判为「可见」（只查 hidden，不查 order）', () => {
    expect(isPanelVisible(makeLayout(), 'zzzBlock')).toBe(true);
    expect(isPanelVisible(makeLayout({ hidden: ['zzzBlock'] }), 'zzzBlock')).toBe(false);
  });

  test('hidden 为空的布局里所有已知面板都可见', () => {
    const layout = defaultPanelLayout(ALL_IDS);
    for (const id of ALL_IDS) expect(isPanelVisible(layout, id)).toBe(true);
  });

  test('hidden 里有重复项时仍然不可见', () => {
    expect(isPanelVisible(makeLayout({ hidden: ['memoBlock', 'memoBlock'] }), 'memoBlock')).toBe(false);
  });

  test('与 togglePanelHidden 互为逆操作', () => {
    const layout = makeLayout({ hidden: ['memoBlock', 'localBlock'] });
    expect(isPanelVisible(layout, 'memoBlock')).toBe(false);
    const toggled = togglePanelHidden(layout, 'memoBlock');
    expect(isPanelVisible(toggled, 'memoBlock')).toBe(true);
    expect(isPanelVisible(toggled, 'localBlock')).toBe(false);
  });
});

describe('resetPanelLayout', () => {
  test('返回给定 id 的默认布局', () => {
    const reset = resetPanelLayout(ALL_IDS);
    expect(reset).toEqual(defaultPanelLayout(ALL_IDS));
    expect(reset.hidden).toEqual([]);
    expect(reset.order).toEqual(ALL_IDS);
  });

  test('重置会抹掉自定义顺序 / 宽度 / 高度 / 隐藏状态', () => {
    const custom = makeLayout({
      order: ['localBlock', 'clockBlock', 'memoBlock'],
      spans: { clockBlock: 3, memoBlock: 12, localBlock: 2 },
      heights: { clockBlock: 300, memoBlock: 400, localBlock: 500 },
      hidden: ['memoBlock'],
    });
    const reset = resetPanelLayout(ALL_IDS);
    expect(reset.order).toEqual(ALL_IDS);
    expect(reset.hidden).toEqual([]);
    expect(reset.spans).toEqual(defaultPanelLayout(ALL_IDS).spans);
    expect(reset.heights).toEqual(defaultPanelLayout(ALL_IDS).heights);
    expect(reset).not.toEqual(custom);
  });

  test('重置结果里全部面板都是半宽 6，高度全为 0', () => {
    const reset = resetPanelLayout(ALL_IDS);
    for (const id of ALL_IDS) expect(reset.spans[id]).toBe(6);
    for (const id of FULL_WIDTH_PANELS) expect(reset.spans[id]).toBe(PANEL_GRID_COLUMNS);
    for (const id of HALF_WIDTH_PANELS) expect(reset.spans[id]).toBe(6);
    for (const id of reset.order) expect(reset.heights[id]).toBe(0);
  });

  test('分组面板在重置后仍然是 6 列', () => {
    expect(resetPanelLayout(['group-ai']).spans['group-ai']).toBe(6);
  });

  test('支持子集与空数组', () => {
    expect(resetPanelLayout(['memoBlock']).order).toEqual(['memoBlock']);
    expect(resetPanelLayout(['memoBlock']).spans).toEqual({ memoBlock: 6 });
    expect(() => resetPanelLayout([])).not.toThrow();
    expect(resetPanelLayout([])).toEqual({
      mode: 'snap',
      order: [],
      positions: {},
      spans: {},
      rowSpans: {},
      colStarts: {},
      heights: {},
      hidden: [],
    });
  });

  test('重置不会改动模块级常量', () => {
    const before = [...DEFAULT_PANEL_ORDER];
    resetPanelLayout(['zzzBlock']);
    expect(DEFAULT_PANEL_ORDER).toEqual(before);
  });

  test('每次重置都返回新对象', () => {
    expect(resetPanelLayout(ALL_IDS)).not.toBe(resetPanelLayout(ALL_IDS));
  });
});

describe('panelListForSettings', () => {
  test('按 layout.order 的顺序返回条目', () => {
    const layout = makeLayout({ order: ['localBlock', 'clockBlock', 'memoBlock'] });
    expect(panelListForSettings(layout).map((item) => item.id)).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
  });

  test('label 取自 PANEL_LABELS，并带上 span / rowSpan / colStart / height / hidden', () => {
    const layout = makeLayout({ hidden: ['memoBlock'], colStarts: { clockBlock: 1, memoBlock: 7, localBlock: 0 } });
    expect(panelListForSettings(layout)).toEqual([
      { id: 'clockBlock', label: '时间', span: 6, rowSpan: 1, colStart: 1, height: 0, hidden: false },
      { id: 'memoBlock', label: '备忘', span: 4, rowSpan: 1, colStart: 7, height: 0, hidden: true },
      { id: 'localBlock', label: '内网与自建服务', span: 12, rowSpan: 1, colStart: 0, height: 0, hidden: false },
    ]);
  });

  test('传入 labels 时优先使用它，其次 PANEL_LABELS，最后回退到 id', () => {
    const layout = makeLayout({
      order: ['clockBlock', 'memoBlock', 'group-ai', 'zzzBlock'],
      spans: { clockBlock: 6, memoBlock: 6, 'group-ai': 6, zzzBlock: 6 },
      heights: { clockBlock: 0, memoBlock: 0, 'group-ai': 0, zzzBlock: 0 },
    });
    const items = panelListForSettings(layout, { clockBlock: '我的时间', 'group-ai': 'AI 分组' });
    expect(items.map((item) => item.label)).toEqual(['我的时间', '备忘', 'AI 分组', 'zzzBlock']);
  });

  test('labels 传空对象时全部回退到 PANEL_LABELS / id', () => {
    const items = panelListForSettings(defaultPanelLayout(ALL_IDS), {});
    for (const item of items) expect(item.label).toBe(PANEL_LABELS[item.id]);
  });

  test('注意：labels 里映射成空串不会被兜底（?? 只判 null/undefined，不判假值）', () => {
    const layout = makeLayout({ order: ['clockBlock'] });
    expect(panelListForSettings(layout, { clockBlock: '' })[0].label).toBe('');
    // 只有 null / undefined 才会继续往 PANEL_LABELS 回退
    expect(
      panelListForSettings(layout, { clockBlock: null as unknown as string })[0].label,
    ).toBe(PANEL_LABELS.clockBlock);
  });

  test('分组面板没有 label 时用 id 兜底', () => {
    const layout = makeLayout({ order: ['group-ai'], spans: { 'group-ai': 6 }, heights: { 'group-ai': 0 } });
    expect(panelListForSettings(layout)[0]).toEqual({
      id: 'group-ai',
      label: 'group-ai',
      span: 6,
      rowSpan: 0, // makeLayout 的默认 rowSpans 里没有 group-ai → ?? 0 兜底
      colStart: 0,
      height: 0,
      hidden: false,
    });
  });

  test('span 经 toSpan 归一，缺失或非法时按该面板默认宽度兜底', () => {
    const missing = withSpans(makeLayout(), {});
    expect(panelListForSettings(missing).map((item) => item.span)).toEqual([6, 6, defaultSpan('localBlock')]);

    const dirty = withSpans(makeLayout(), { clockBlock: 1, memoBlock: 0, localBlock: 99 });
    expect(panelListForSettings(dirty).map((item) => item.span)).toEqual([6, 6, defaultSpan('localBlock')]);
  });

  test('span 的合法值（含数字字符串与小数）原样呈现', () => {
    const layout = withSpans(makeLayout(), { clockBlock: '8', memoBlock: 2.6, localBlock: 3 });
    expect(panelListForSettings(layout).map((item) => item.span)).toEqual([8, 3, 3]);
  });

  test('height 经 toHeight 归一，缺失或非法时兜底为 0', () => {
    const missing = withHeights(makeLayout(), {});
    expect(panelListForSettings(missing).map((item) => item.height)).toEqual([0, 0, 0]);

    const dirty = withHeights(makeLayout(), { clockBlock: 79, memoBlock: 400, localBlock: '640' });
    expect(panelListForSettings(dirty).map((item) => item.height)).toEqual([0, 400, 640]);
  });

  test('空 order 返回空列表', () => {
    expect(
      panelListForSettings({
        mode: 'snap',
        order: [],
        positions: {},
        spans: {},
        rowSpans: {},
        colStarts: {},
        heights: {},
        hidden: [],
      }),
    ).toEqual([]);
  });

  test('默认布局下顺序、标签、宽度、高度、显隐、列起点全部一致', () => {
    const items = panelListForSettings(defaultPanelLayout(ALL_IDS));
    expect(items.map((item) => item.id)).toEqual(ALL_IDS);
    for (const item of items) {
      expect(item.hidden).toBe(false);
      expect(item.height).toBe(0);
      // 两列布局下所有面板默认半宽
      expect(item.span).toBe(6);
      expect(item.label).toBe(PANEL_LABELS[item.id]);
      // 默认布局里 rowSpans 全是 0（自动），colStarts 只有 local/clock/widget/memo 被钉列
      expect(item.rowSpan).toBe(0);
      expect(item.colStart).toBe(defaultColStart(item.id));
    }
  });

  test('order 里重复的 id 会产生重复条目（源码只做 map）', () => {
    const layout = makeLayout({ order: ['clockBlock', 'clockBlock'] });
    expect(panelListForSettings(layout).map((item) => item.id)).toEqual(['clockBlock', 'clockBlock']);
  });

  test('返回的条目结构与 PanelState 兼容', () => {
    const states: PanelState[] = toStates(makeLayout({ hidden: ['memoBlock'] }));
    expect(states).toEqual([
      { id: 'clockBlock', span: 6, height: 0, hidden: false },
      { id: 'memoBlock', span: 4, height: 0, hidden: true },
      { id: 'localBlock', span: 12, height: 0, hidden: false },
    ]);
  });

  test('不修改入参布局', () => {
    const layout = makeLayout({ hidden: ['memoBlock'] });
    const before = snapshot(layout);
    panelListForSettings(layout);
    expect(snapshot(layout)).toBe(before);
  });

  test('每次调用返回新的数组与条目对象', () => {
    const layout = makeLayout();
    const first = panelListForSettings(layout);
    first[0].span = 12;
    first.push({ id: 'x', label: 'x', span: 6, rowSpan: 1, colStart: 0, height: 0, hidden: false });
    expect(panelListForSettings(layout)).toHaveLength(layout.order.length);
    expect(panelListForSettings(layout)[0].span).toBe(6);
  });

  test('展示的 span / height 一定落在合法区间内', () => {
    const layout = withSpans(withHeights(makeLayout({ order: [...ALL_IDS] }), { clockBlock: 99999 }), {
      clockBlock: 99,
      memoBlock: -3,
    });
    for (const item of panelListForSettings(layout)) {
      expect(item.span).toBeGreaterThanOrEqual(MIN_SPAN);
      expect(item.span).toBeLessThanOrEqual(MAX_SPAN);
      expect(item.height).toBeGreaterThanOrEqual(0);
      expect(item.height).toBeLessThanOrEqual(MAX_PANEL_HEIGHT);
    }
  });

  test('条目字段包含 rowSpan 与 colStart，默认布局下 rowSpan 全是 0', () => {
    const items = panelListForSettings(defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]));
    for (const item of items) expect(item.rowSpan).toBe(0);
    expect(Object.keys(items[0])).toEqual(['id', 'label', 'span', 'rowSpan', 'colStart', 'height', 'hidden']);
  });

  test('rowSpan 经 toRowSpan 归一：合法值原样呈现', () => {
    const layout = withRowSpans(makeLayout(), { clockBlock: '3', memoBlock: 6, localBlock: 2 });
    expect(rowSpanMap(layout)).toEqual({ clockBlock: 3, memoBlock: 6, localBlock: 2 });
  });

  test('rowSpan 缺失或非法时回退为 0（?? 0 兜底）', () => {
    const missing = withRowSpans(makeLayout(), {});
    expect(panelListForSettings(missing).map((item) => item.rowSpan)).toEqual([0, 0, 0]);

    const dirty = withRowSpans(makeLayout(), { clockBlock: 7, memoBlock: 'abc', localBlock: 99 });
    expect(panelListForSettings(dirty).map((item) => item.rowSpan)).toEqual([0, 0, 0]);

    const nanAndNull = withRowSpans(makeLayout(), { clockBlock: NaN, memoBlock: null, localBlock: -1 });
    expect(panelListForSettings(nanAndNull).map((item) => item.rowSpan)).toEqual([0, 0, 0]);
  });

  test('rowSpan 为 0（自动）时原样呈现为 0', () => {
    const layout = withRowSpans(makeLayout(), { clockBlock: 0, memoBlock: '0', localBlock: 0 });
    expect(panelListForSettings(layout).map((item) => item.rowSpan)).toEqual([0, 0, 0]);
  });

  test('rowSpan 的小数走 Math.round 后仍合法则保留', () => {
    const layout = withRowSpans(makeLayout(), { clockBlock: 1.5, memoBlock: 5.6, localBlock: 2.4 });
    expect(panelListForSettings(layout).map((item) => item.rowSpan)).toEqual([2, 6, 2]);
  });

  test('rowSpans 里没有该 id 时按 0 呈现（分组面板同样适用）', () => {
    const layout = makeLayout({ order: ['group-ai'], spans: { 'group-ai': 6 }, heights: { 'group-ai': 0 }, rowSpans: {} });
    expect(panelListForSettings(layout)[0].rowSpan).toBe(0);
  });

  test('展示的 rowSpan 一定是合法行跨度（含 0 = 自动）', () => {
    const layout = withRowSpans(makeLayout({ order: [...ALL_IDS] }), { clockBlock: 999, memoBlock: -3 });
    for (const item of panelListForSettings(layout)) {
      expect(item.rowSpan).toBeGreaterThanOrEqual(0);
      expect(item.rowSpan).toBeLessThanOrEqual(MAX_ROW_SPAN);
      expect(toRowSpan(item.rowSpan)).toBe(item.rowSpan);
    }
  });

  test('colStart 经 toColStart 归一：合法值原样呈现', () => {
    const layout = withColStarts(makeLayout(), { clockBlock: '3', memoBlock: 7, localBlock: 0 });
    expect(colStartMap(layout)).toEqual({ clockBlock: 3, memoBlock: 7, localBlock: 0 });
  });

  test('colStart 缺失或非法时回退为 0（?? 0 兜底）', () => {
    const missing = withColStarts(makeLayout(), {});
    expect(panelListForSettings(missing).map((item) => item.colStart)).toEqual([0, 0, 0]);

    const dirty = withColStarts(makeLayout(), { clockBlock: 13, memoBlock: 'abc', localBlock: -1 });
    expect(panelListForSettings(dirty).map((item) => item.colStart)).toEqual([0, 0, 0]);

    const nanAndNull = withColStarts(makeLayout(), { clockBlock: NaN, memoBlock: null, localBlock: 12.5 });
    expect(panelListForSettings(nanAndNull).map((item) => item.colStart)).toEqual([0, 0, 0]);
  });

  test('colStart 的小数走 Math.round 后仍合法则保留', () => {
    const layout = withColStarts(makeLayout(), { clockBlock: 1.5, memoBlock: 6.6, localBlock: 2.4 });
    expect(panelListForSettings(layout).map((item) => item.colStart)).toEqual([2, 7, 2]);
  });

  test('展示的 colStart 一定落在合法区间（0 或 1..12）', () => {
    const layout = withColStarts(makeLayout({ order: [...ALL_IDS] }), { clockBlock: 999, memoBlock: -3 });
    for (const item of panelListForSettings(layout)) {
      expect(item.colStart).toBeGreaterThanOrEqual(0);
      expect(item.colStart).toBeLessThanOrEqual(PANEL_GRID_COLUMNS);
      expect(toColStart(item.colStart)).toBe(item.colStart);
    }
  });

  test('span 与 rowSpan 相互独立：改一个不影响另一个', () => {
    const layout = withRowSpans(withSpans(makeLayout(), { clockBlock: 12 }), { clockBlock: 6 });
    const item = panelListForSettings(layout)[0];
    expect(item.span).toBe(12);
    expect(item.rowSpan).toBe(6);
  });

  test('rowSpan / colStart 与 span 三者相互独立', () => {
    const layout = withColStarts(withRowSpans(withSpans(makeLayout(), { clockBlock: 4 }), { clockBlock: 2 }), {
      clockBlock: 9,
    });
    const item = panelListForSettings(layout)[0];
    expect(item.span).toBe(4);
    expect(item.rowSpan).toBe(2);
    expect(item.colStart).toBe(9);
  });

  test('注意：rowSpans 整个字段缺失时会抛 TypeError（与 spans / heights 缺失的行为一致）', () => {
    // panelListForSettings 直接读 layout.rowSpans[id]，不做 `?? {}` 兜底。
    // 这是模块既有约定：调用方必须先过 normalizePanelLayout / defaultPanelLayout。
    // spans / heights 缺失同样会抛，所以并非 rowSpans 独有的问题。
    const withoutRowSpans = { ...makeLayout(), rowSpans: undefined } as unknown as PanelLayout;
    expect(() => panelListForSettings(withoutRowSpans)).toThrow(TypeError);
    const withoutSpans = { ...makeLayout(), spans: undefined } as unknown as PanelLayout;
    expect(() => panelListForSettings(withoutSpans)).toThrow(TypeError);
    // colStarts 同理：新增字段也沿用同一约定
    const withoutColStarts = { ...makeLayout(), colStarts: undefined } as unknown as PanelLayout;
    expect(() => panelListForSettings(withoutColStarts)).toThrow(TypeError);
    // 先归一化再展示就不会有问题
    expect(() => panelListForSettings(normalizePanelLayout(withoutRowSpans, ALL_IDS))).not.toThrow();
    expect(() => panelListForSettings(normalizePanelLayout(withoutColStarts, ALL_IDS))).not.toThrow();
  });
});

describe('spanPercent', () => {
  test('按 PANEL_GRID_COLUMNS 计算百分比并四舍五入', () => {
    expect(spanPercent(12)).toBe(100);
    expect(spanPercent(6)).toBe(50);
    expect(spanPercent(3)).toBe(25);
    expect(spanPercent(4)).toBe(33); // 33.33 → 33
    expect(spanPercent(8)).toBe(67); // 66.67 → 67
    expect(spanPercent(2)).toBe(17); // 16.67 → 17
    expect(spanPercent(5)).toBe(42); // 41.67 → 42
  });

  test('全部合法档位的百分比都在 0..100 且与 span 正相关', () => {
    let previous = -1;
    for (let span = MIN_SPAN; span <= MAX_SPAN; span += 1) {
      const percent = spanPercent(span);
      expect(percent).toBeGreaterThanOrEqual(0);
      expect(percent).toBeLessThanOrEqual(100);
      expect(percent).toBeGreaterThanOrEqual(previous);
      previous = percent;
    }
    expect(spanPercent(MAX_SPAN)).toBe(100);
  });

  test('SPAN_PRESETS 的百分比与源码一致', () => {
    expect(SPAN_PRESETS.map(spanPercent)).toEqual([25, 33, 50, 67, 100]);
  });

  test('数字字符串被 toSpan 归一后参与计算', () => {
    expect(spanPercent('6' as unknown as number)).toBe(50);
    expect(spanPercent('12' as unknown as number)).toBe(100);
  });

  test('非法输入回退到默认 6 列 → 50%', () => {
    for (const span of [0, 1, 13, -1, NaN, Infinity, -Infinity, '', 'abc', null, undefined, {}, []]) {
      expect(spanPercent(span as unknown as number)).toBe(50);
    }
  });
});

describe('端到端：归一化 → 移动 → 调宽 → 调高 → 隐藏 → 重置', () => {
  test('一串操作后布局始终保持可用（每个 id 恰好一次、span / height 合法）', () => {
    const stored = {
      order: ['memoBlock', 'clockBlock', 'ghostBlock'],
      spans: { memoBlock: 3, clockBlock: 9 },
      rowSpans: { memoBlock: 2, clockBlock: 4 },
      hidden: ['ghostBlock'],
    };
    let layout = normalizePanelLayout(stored, [...ALL_IDS, ...GROUP_IDS]);

    // 旧存档里没有 heights 键 → 全部自适应
    for (const id of layout.order) expect(layout.heights[id]).toBe(0);

    layout = movePanel(layout, 'githubBlock', 0);
    layout = cyclePanelSpan(layout, 'widgetBlock');
    layout = setPanelSpan(layout, 'clockBlock', 4);
    layout = setPanelRowSpan(layout, 'memoBlock', 6);
    layout = setPanelHeight(layout, 'memoBlock', 500);
    layout = togglePanelHidden(layout, 'memoBlock');

    expectEachOnce(layout, layout.order);
    expect(layout.order[0]).toBe('githubBlock');
    expect(layout.order).toHaveLength(ALL_IDS.length + GROUP_IDS.length);
    expect(layout.spans.memoBlock).toBe(3);
    expect(layout.spans.clockBlock).toBe(4);
    expect(layout.spans.widgetBlock).toBe(8); // 默认 6 → 前进到 8
    expect(layout.rowSpans.memoBlock).toBe(6);
    expect(layout.rowSpans.clockBlock).toBe(4); // 旧存档值保留
    expect(layout.heights.memoBlock).toBe(500);
    expect(layout.hidden).toEqual(['memoBlock']);

    for (const item of panelListForSettings(layout)) {
      expect(item.span).toBeGreaterThanOrEqual(MIN_SPAN);
      expect(item.span).toBeLessThanOrEqual(MAX_SPAN);
      expect(item.height).toBeGreaterThanOrEqual(0);
      expect(item.height).toBeLessThanOrEqual(MAX_PANEL_HEIGHT);
      expect(item.hidden).toBe(!isPanelVisible(layout, item.id));
      expect(spanPercent(item.span)).toBeGreaterThanOrEqual(17);
      expect(item.rowSpan).toBeGreaterThanOrEqual(0);
      expect(item.rowSpan).toBeLessThanOrEqual(MAX_ROW_SPAN);
      expect(item.colStart).toBeGreaterThanOrEqual(0);
      expect(item.colStart).toBeLessThanOrEqual(PANEL_GRID_COLUMNS);
    }

    const reset = resetPanelLayout([...ALL_IDS, ...GROUP_IDS]);
    expect(reset).toEqual(defaultPanelLayout([...ALL_IDS, ...GROUP_IDS]));
    expect(reset.hidden).toEqual([]);
  });

  test('往返：归一化后的布局再归一化一次结果不变（幂等）', () => {
    const stored = { order: ['localBlock', 'clockBlock'], spans: { localBlock: 8 }, heights: { localBlock: 480 } };
    const once = normalizePanelLayout(stored, ALL_IDS);
    const twice = normalizePanelLayout(once, ALL_IDS);
    expect(twice).toEqual(once);
  });
});

describe('端到端：自由模式（切模式 → 摆位置 → 存档 → 重新归一化）', () => {
  test('切换到 free、逐个摆好坐标、存档后重新加载仍然完整', () => {
    const known = [...ALL_IDS, ...GROUP_IDS];
    let layout = defaultPanelLayout(known);
    expect(layout.mode).toBe('snap');
    expect(layout.positions).toEqual({});

    layout = setLayoutMode(layout, 'free');
    layout = setPanelBox(layout, 'clockBlock', { x: 0, y: 0, w: 320, h: 160 });
    layout = setPanelBox(layout, 'memoBlock', { x: 340, y: 0, w: 200, h: 120 });
    layout = setPanelBox(layout, 'group-ai', { x: 0, y: 180, w: 540, h: 300 });

    expect(layout.mode).toBe('free');
    expect(Object.keys(layout.positions).sort()).toEqual(['clockBlock', 'group-ai', 'memoBlock']);

    // 模拟「存盘再读盘」：JSON 往返 + 归一化
    const reloaded = normalizePanelLayout(JSON.parse(JSON.stringify(layout)), known);
    expect(reloaded.mode).toBe('free');
    expect(reloaded.order).toEqual(layout.order);
    expect(reloaded.positions).toEqual(layout.positions);
    expect(reloaded.spans).toEqual(layout.spans);
    expect(reloaded.heights).toEqual(layout.heights);
    expect(reloaded.hidden).toEqual(layout.hidden);
  });

  test('自由模式 + 隐藏 + 改尺寸可以共存，各字段互不干扰', () => {
    const known = [...ALL_IDS, ...GROUP_IDS];
    let layout = normalizePanelLayout({ mode: 'free', order: ['memoBlock', 'clockBlock'] }, known);
    layout = setPanelBox(layout, 'memoBlock', { x: 0, y: 0, w: 400, h: 250 });
    layout = setPanelSpan(layout, 'memoBlock', 8);
    layout = setPanelRowSpan(layout, 'memoBlock', 3);
    layout = setPanelHeight(layout, 'memoBlock', 600);
    layout = togglePanelHidden(layout, 'clockBlock');

    expect(layout.mode).toBe('free');
    expect(layout.positions.memoBlock).toEqual({ x: 0, y: 0, w: 400, h: 250 });
    expect(layout.spans.memoBlock).toBe(8);
    expect(layout.rowSpans.memoBlock).toBe(3);
    expect(layout.heights.memoBlock).toBe(600);
    expect(layout.hidden).toEqual(['clockBlock']);

    const reloaded = normalizePanelLayout(JSON.parse(JSON.stringify(layout)), known);
    expect(reloaded).toEqual(layout);
  });

  test('负坐标（白板式）能存盘并原样读回，小尺寸面板同样保留', () => {
    const known = [...ALL_IDS, ...GROUP_IDS];
    let layout = setLayoutMode(defaultPanelLayout(known), 'free');
    layout = setPanelBox(layout, 'clockBlock', { x: -320, y: -180, w: MIN_FREE_W, h: MIN_FREE_H });
    layout = setPanelBox(layout, 'memoBlock', { x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: 200, h: 120 });

    expect(layout.positions.clockBlock).toEqual({ x: -320, y: -180, w: 60, h: 40 });
    expect(layout.positions.memoBlock).toEqual({ x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: 200, h: 120 });

    const reloaded = normalizePanelLayout(JSON.parse(JSON.stringify(layout)), known);
    expect(reloaded.positions.clockBlock).toEqual({ x: -320, y: -180, w: 60, h: 40 });
    expect(reloaded.positions.memoBlock).toEqual({ x: MIN_FREE_COORD, y: MIN_FREE_COORD, w: 200, h: 120 });
    expect(reloaded.positions).toEqual(layout.positions);
  });

  test('重置布局会同时清掉自由坐标并回到 snap', () => {
    const known = [...ALL_IDS, ...GROUP_IDS];
    const free = setPanelBox(setLayoutMode(defaultPanelLayout(known), 'free'), 'clockBlock', {
      x: 0,
      y: 0,
      w: 320,
      h: 160,
    });
    const reset = resetPanelLayout(known);
    expect(reset.mode).toBe('snap');
    expect(reset.positions).toEqual({});
    expect(reset).not.toEqual(free);
  });

  test('自由模式下拖拽重排（movePanel / moveNextTo 语义）不影响坐标', () => {
    const free = makeFreeLayout();
    const moved = movePanel(free, 'localBlock', 0);
    expect(moved.order[0]).toBe('localBlock');
    expect(moved.positions).toEqual(free.positions);
    expect(moved.mode).toBe('free');

    const anchored = moveNextTo(free, 'localBlock', 'clockBlock', true);
    expect(anchored.order).toEqual(['localBlock', 'clockBlock', 'memoBlock']);
    expect(anchored.positions).toEqual(free.positions);
    expect(anchored.mode).toBe('free');
    expect(anchored.positions.clockBlock).not.toBe(free.positions.clockBlock);
  });
});

describe('planSnapColumns', () => {
  const item = (id: string, over: Partial<SnapItem> = {}): SnapItem => ({
    id,
    span: 6,
    h: 200,
    colStart: 0,
    ...over,
  });

  test('未指定列起点时先进左列，然后填更矮的一列（两列自然平衡）', () => {
    const plan = planSnapColumns([item('a'), item('b'), item('c')], 2);
    expect(plan.map((p) => [p.id, p.col])).toEqual([['a', 0], ['b', 1], ['c', 0]]);
  });

  test('高面板不会把另一列拉高：后续矮面板继续留在矮的那一列，空隙被填掉', () => {
    // 截图场景：左列两块矮面板，右列一块高面板 + 一块矮面板
    const plan = planSnapColumns([
      item('localBlock', { h: 150, colStart: 1 }),
      item('widgetBlock', { h: 700, colStart: 7 }),
      item('clockBlock', { h: 150, colStart: 1 }),
      item('memoBlock', { h: 150, colStart: 7 }),
    ], 2);
    expect(plan.find((p) => p.id === 'localBlock')?.col).toBe(0);
    expect(plan.find((p) => p.id === 'clockBlock')?.col).toBe(0);
    expect(plan.find((p) => p.id === 'widgetBlock')?.col).toBe(1);
    expect(plan.find((p) => p.id === 'memoBlock')?.col).toBe(1);
    // 关键：两块矮面板同在左列（纵向堆叠），不会被高面板那一行顶出空白
    expect(plan.filter((p) => p.col === 0).map((p) => p.id)).toEqual(['localBlock', 'clockBlock']);
  });

  test('列起点 1~6 钉左列、7~12 钉右列', () => {
    for (let c = 1; c <= 6; c += 1) {
      expect(planSnapColumns([item('x', { colStart: c })], 2)[0].col).toBe(0);
    }
    for (let c = 7; c <= PANEL_GRID_COLUMNS; c += 1) {
      expect(planSnapColumns([item('x', { colStart: c })], 2)[0].col).toBe(1);
    }
  });

  test('单列（窄屏）时所有面板都进第 0 列', () => {
    const plan = planSnapColumns([
      item('a', { colStart: 7 }),
      item('b', { colStart: 1 }),
      item('c'),
    ], 1);
    expect(plan.map((p) => p.col)).toEqual([0, 0, 0]);
    expect(plan.every((p) => !p.full)).toBe(true);
  });

  test('span >= 7 的面板标记为整行，且不参与列高度累计', () => {
    const plan = planSnapColumns([
      item('wide', { span: 12 }),
      item('a'),
      item('b'),
    ], 2);
    expect(plan[0]).toEqual({ id: 'wide', col: 0, full: true });
    expect(plan.slice(1).map((p) => p.col)).toEqual([0, 1]);
  });

  test('非法列数（0 / 负数 / 小数）退回单列，不抛异常', () => {
    for (const columns of [0, -3, 1.9]) {
      const plan = planSnapColumns([item('a'), item('b')], columns);
      expect(plan.map((p) => p.col)).toEqual([0, 0]);
    }
  });

  test('每个输入面板恰好被分配一次，顺序与输入一致', () => {
    const items = [item('a', { span: 12 }), item('b'), item('group-x'), item('c', { colStart: 9 })];
    const plan = planSnapColumns(items, 2);
    expect(plan.map((p) => p.id)).toEqual(['a', 'b', 'group-x', 'c']);
  });

  test('空输入得到空方案', () => {
    expect(planSnapColumns([], 2)).toEqual([]);
  });

  test('高度为 NaN / 负数按 0 处理，不会把列高累计算坏', () => {
    const plan = planSnapColumns([
      item('a', { h: Number.NaN }),
      item('b', { h: -500 }),
      item('c'),
    ], 2);
    // a（0）左列，b（0）右列，c 回到更矮的左列
    expect(plan.map((p) => p.col)).toEqual([0, 1, 0]);
  });

  test('FULL_ROW_MIN_SPAN 是整行判定的唯一门槛', () => {
    expect(FULL_ROW_MIN_SPAN).toBe(7);
    const plan = planSnapColumns([
      item('half', { span: FULL_ROW_MIN_SPAN - 1 }),
      item('full', { span: FULL_ROW_MIN_SPAN }),
    ], 2);
    expect(plan[0].full).toBe(false);
    expect(plan[1].full).toBe(true);
  });
});

describe('packMasonry 总高度', () => {
  test('空输入返回 0，不会因为减去 gap 变成负数', () => {
    expect(packMasonry([], 2, 300, 14)).toEqual({ placements: [], totalHeight: 0 });
  });

  test('单块面板的高度就是它自身高度（末尾不留 gap）', () => {
    expect(packMasonry([{ id: 'a', h: 200, span: 1 }], 2, 300, 14).totalHeight).toBe(200);
  });
});
