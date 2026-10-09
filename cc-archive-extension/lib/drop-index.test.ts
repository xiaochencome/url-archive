import { describe, expect, test } from 'vitest';
import { DROP_DEAD_ZONE, computeDropIndex } from './panel-layout';

/** 面板矩形（与源码入参结构一致） */
type Rect = { left: number; top: number; right: number; bottom: number };

/** 上一次的插入判定（与源码 previous 结构一致） */
type Previous = { index: number; before: boolean };

/** 指针坐标 */
type Pointer = { x: number; y: number };

/** 以「左上角 + 宽高」构造矩形，比直接写 right / bottom 更接近真实布局语义 */
function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, right: left + width, bottom: top + height };
}

/** 同一行内从左到右排列的矩形（宽度逐个给出，起点 x = 0） */
function row(top: number, height: number, widths: number[]): Rect[] {
  let x = 0;
  return widths.map((width) => {
    const r = rect(x, top, width, height);
    x += width;
    return r;
  });
}

/** 同一列内自上而下排列的矩形（每项为 [top, height]，起点 x = 0） */
function column(width: number, bands: [number, number][]): Rect[] {
  return bands.map(([top, height]) => rect(0, top, width, height));
}

/** 指针坐标 */
function at(x: number, y: number): Pointer {
  return { x, y };
}

/** 模拟真实拖拽里 last 的传递：before 表示「插在该下标对应的矩形之前」 */
function previousAt(index: number, total: number): Previous {
  return { index, before: index <= total - 1 };
}

/** 矩形横向中心（源码用 left + (right - left) / 2 计算） */
function centerX(r: Rect): number {
  return r.left + (r.right - r.left) / 2;
}

/** 矩形纵向中心 */
function centerY(r: Rect): number {
  return (r.top + r.bottom) / 2;
}

/** 三行单列：400×100，行间留 20px 空隙 */
const COLUMN: Rect[] = column(400, [
  [0, 100],
  [120, 100],
  [240, 100],
]);

/** 2×2 网格：每格 300×100，行间留 20px 空隙 */
const GRID: Rect[] = [...row(0, 100, [300, 300]), ...row(120, 100, [300, 300])];

/** 三行、每行宽度与高度都不相同（用于验证「不同宽高」的多行布局） */
const MIXED: Rect[] = [
  ...row(0, 80, [200, 400, 200]),
  ...row(100, 120, [600, 200]),
  ...row(240, 60, [800]),
];

/** 某个「纵向带」里最后一个矩形的下标（用于断言「插到本行之后」） */
function bandEndIndex(rects: Rect[], start: number): number {
  let end = start;
  for (let i = start + 1; i < rects.length; i += 1) {
    if (rects[i].top > rects[end].bottom) break;
    end = i;
  }
  return end;
}

/** 把一段扫描结果压成「相邻差值」序列 */
function deltas(values: number[]): number[] {
  return values.slice(1).map((value, i) => value - values[i]);
}

/**
 * 每个「纵向带」（同一行的矩形区间）里第一个矩形的下标。
 *
 * 源码在遇到第一个纵向命中的矩形时就直接 return，所以同一行里只有这个矩形
 * 真正参与横向判定，它后面的同行矩形只能通过 i + 1 被选中。
 */
function bandStartIndices(rects: Rect[]): number[] {
  const starts: number[] = [];
  let bandBottom = -Infinity;
  for (let i = 0; i < rects.length; i += 1) {
    if (rects[i].top > bandBottom) {
      starts.push(i);
      bandBottom = rects[i].bottom;
    }
    bandBottom = Math.max(bandBottom, rects[i].bottom);
  }
  return starts;
}

describe('DROP_DEAD_ZONE', () => {
  test('死区是 10px', () => {
    expect(DROP_DEAD_ZONE).toBe(10);
    expect(typeof DROP_DEAD_ZONE).toBe('number');
  });

  test('死区宽度确实由 DROP_DEAD_ZONE 决定：|x - 中心| <= 10 落入死区，11px 才出界', () => {
    // 每个矩形的纵向中心都取真实中心，横向分别取 ±10 / ±11
    for (let i = 0; i < COLUMN.length; i += 1) {
      const r = COLUMN[i];
      const cx = centerX(r);
      const cy = centerY(r);
      expect(computeDropIndex(COLUMN, at(cx - DROP_DEAD_ZONE, cy))).toBe(i);
      expect(computeDropIndex(COLUMN, at(cx + DROP_DEAD_ZONE, cy))).toBe(i);
      expect(computeDropIndex(COLUMN, at(cx - DROP_DEAD_ZONE - 1, cy))).toBe(i);
      expect(computeDropIndex(COLUMN, at(cx + DROP_DEAD_ZONE + 1, cy))).toBe(i + 1);
    }
  });

  test('注意：死区边界是闭区间（±10px 都算死区），实际死区宽 21px', () => {
    const cx = centerX(COLUMN[1]);
    const cy = centerY(COLUMN[1]);
    const inside = [cx - 10, cx - 9, cx, cx + 9, cx + 10];
    for (const x of inside) expect(computeDropIndex(COLUMN, at(x, cy))).toBe(1);
    // 只有严格超过 10px 才走出死区
    expect(computeDropIndex(COLUMN, at(cx - 10.01, cy))).toBe(1);
    expect(computeDropIndex(COLUMN, at(cx + 10.01, cy))).toBe(2);
  });
});

describe('computeDropIndex：基础插入位置', () => {
  test('空 rects 一律返回 0', () => {
    expect(computeDropIndex([], at(0, 0))).toBe(0);
    expect(computeDropIndex([], at(999, 999))).toBe(0);
    expect(computeDropIndex([], at(-999, -999))).toBe(0);
  });

  test('空 rects 时越界的 previous 也不会抛异常，仍返回 0', () => {
    expect(computeDropIndex([], at(0, 0), { index: 5, before: true })).toBe(0);
    expect(computeDropIndex([], at(0, 0), { index: -1, before: false })).toBe(0);
    expect(computeDropIndex([], at(0, 0), null)).toBe(0);
  });

  test('指针在所有矩形上方 → 0', () => {
    expect(computeDropIndex(COLUMN, at(200, -1))).toBe(0);
    expect(computeDropIndex(COLUMN, at(99999, -100))).toBe(0);
    expect(computeDropIndex(GRID, at(400, -5))).toBe(0);
    expect(computeDropIndex(GRID, at(0, -0.001))).toBe(0);
  });

  test('指针在所有矩形上方时 previous 被完全忽略（上方优先返回 0）', () => {
    expect(computeDropIndex(COLUMN, at(200, -1), { index: 2, before: false })).toBe(0);
    expect(computeDropIndex(COLUMN, at(200, -1), { index: 3, before: true })).toBe(0);
  });

  test('指针在所有矩形下方 → rects.length', () => {
    expect(computeDropIndex(COLUMN, at(0, 341))).toBe(3);
    expect(computeDropIndex(COLUMN, at(0, 1e6))).toBe(3);
    expect(computeDropIndex(GRID, at(0, 1000))).toBe(4);
    expect(computeDropIndex([COLUMN[0]], at(0, 101))).toBe(1);
  });

  test('指针在所有矩形下方时 previous 也被忽略', () => {
    expect(computeDropIndex(COLUMN, at(0, 1e6), { index: 0, before: true })).toBe(3);
    expect(computeDropIndex(COLUMN, at(0, 1e6), { index: 1, before: false })).toBe(3);
  });

  test('纵向落在矩形内、横向在中心左侧（超出死区）→ 该矩形下标', () => {
    for (let i = 0; i < COLUMN.length; i += 1) {
      const r = COLUMN[i];
      const cy = centerY(r);
      expect(computeDropIndex(COLUMN, at(centerX(r) - DROP_DEAD_ZONE - 1, cy))).toBe(i);
      expect(computeDropIndex(COLUMN, at(-1000, cy))).toBe(i);
    }
    expect(computeDropIndex(COLUMN, at(189, 50))).toBe(0);
    expect(computeDropIndex(COLUMN, at(189, 170))).toBe(1);
    expect(computeDropIndex(COLUMN, at(189, 290))).toBe(2);
  });

  test('纵向落在矩形内、横向在中心右侧（超出死区）→ 该矩形下标 + 1', () => {
    for (let i = 0; i < COLUMN.length; i += 1) {
      const r = COLUMN[i];
      const cy = centerY(r);
      expect(computeDropIndex(COLUMN, at(centerX(r) + DROP_DEAD_ZONE + 1, cy))).toBe(i + 1);
      expect(computeDropIndex(COLUMN, at(1000, cy))).toBe(i + 1);
    }
    expect(computeDropIndex(COLUMN, at(211, 50))).toBe(1);
    expect(computeDropIndex(COLUMN, at(211, 170))).toBe(2);
    expect(computeDropIndex(COLUMN, at(211, 290))).toBe(3);
  });

  test('指针在纵向空隙里 → 紧随其后那个矩形的下标', () => {
    for (const y of [100.5, 101, 110, 119, 119.9]) expect(computeDropIndex(COLUMN, at(0, y))).toBe(1);
    for (const y of [220.5, 221, 230, 239, 239.9]) expect(computeDropIndex(COLUMN, at(0, y))).toBe(2);
    // 2×2 网格：第一行与第二行之间
    for (const y of [100.5, 110, 119.9]) expect(computeDropIndex(GRID, at(0, y))).toBe(2);
  });

  test('空隙里按「本行第一个矩形」的中心线判定左右', () => {
    // 单列布局每行只有一个矩形，所以行内比较退化为「中心线左右」：
    // 中心线左侧插到它之前，右侧插到它之后。
    expect(computeDropIndex(COLUMN, at(-1000, 110))).toBe(1);
    expect(computeDropIndex(COLUMN, at(0, 110))).toBe(1);
    expect(computeDropIndex(COLUMN, at(199, 110))).toBe(1);   // 死区内
    expect(computeDropIndex(COLUMN, at(200, 110))).toBe(1);   // 正好中心
    expect(computeDropIndex(COLUMN, at(201, 110))).toBe(1);   // 死区内
    expect(computeDropIndex(COLUMN, at(400, 110))).toBe(2);   // 超出右侧

    expect(computeDropIndex(COLUMN, at(-1000, 230))).toBe(2);
    expect(computeDropIndex(COLUMN, at(200, 230))).toBe(2);
    expect(computeDropIndex(COLUMN, at(400, 230))).toBe(3);
  });

  test('注意：纵向边界是闭区间 —— y 正好等于 bottom 时仍算「落在该矩形内」', () => {
    const r = COLUMN[0];
    // y === r.bottom 时走横向判定（不是空隙）
    expect(computeDropIndex(COLUMN, at(0, r.bottom))).toBe(0);
    expect(computeDropIndex(COLUMN, at(399, r.bottom))).toBe(1);
    // 只多 0.5px 就掉进空隙，判定变为「下一个矩形」
    expect(computeDropIndex(COLUMN, at(0, r.bottom + 0.5))).toBe(1);
    // y === r.top 同样算落在该矩形内
    expect(computeDropIndex(COLUMN, at(0, COLUMN[1].top))).toBe(1);
    expect(computeDropIndex(COLUMN, at(399, COLUMN[1].top))).toBe(2);
  });

  test('相邻矩形紧贴（无空隙）时共享边界由横向位置决定', () => {
    const touching: Rect[] = [rect(0, 0, 400, 100), rect(0, 100, 400, 100)];
    expect(computeDropIndex(touching, at(0, 100))).toBe(0);
    expect(computeDropIndex(touching, at(399, 100))).toBe(1);
    expect(computeDropIndex(touching, at(0, 100.001))).toBe(1);
  });

  test('返回值一定是 0..rects.length 之间的整数', () => {
    for (const rects of [COLUMN, GRID, MIXED]) {
      for (let x = -600; x <= 1400; x += 37) {
        for (let y = -300; y <= 900; y += 41) {
          const index = computeDropIndex(rects, at(x, y));
          expect(Number.isInteger(index)).toBe(true);
          expect(index).toBeGreaterThanOrEqual(0);
          expect(index).toBeLessThanOrEqual(rects.length);
        }
      }
    }
  });
});

describe('computeDropIndex：死区行为', () => {
  test('死区内且没有 previous → 稳定地按「插在该矩形之前」处理（返回 i）', () => {
    for (let i = 0; i < COLUMN.length; i += 1) {
      const r = COLUMN[i];
      const cy = centerY(r);
      expect(computeDropIndex(COLUMN, at(centerX(r), cy))).toBe(i);
      expect(computeDropIndex(COLUMN, at(centerX(r) - 5, cy))).toBe(i);
      expect(computeDropIndex(COLUMN, at(centerX(r) + 5, cy))).toBe(i);
    }
  });

  test('死区内且 previous 命中该下标 → 沿用 previous.before', () => {
    const cy = centerY(COLUMN[1]);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 1, before: true })).toBe(1);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 1, before: false })).toBe(2);
    expect(computeDropIndex(COLUMN, at(195, cy), { index: 1, before: true })).toBe(1);
    expect(computeDropIndex(COLUMN, at(205, cy), { index: 1, before: false })).toBe(2);
  });

  test('死区内且 previous 命中 i + 1 → 固定返回 i + 1（before 真/假都一样）', () => {
    const cy = centerY(COLUMN[1]);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 2, before: true })).toBe(2);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 2, before: false })).toBe(2);
    // 最后一个矩形：i + 1 正好等于 rects.length，不会越界
    expect(computeDropIndex(COLUMN, at(200, centerY(COLUMN[2])), { index: 3, before: false })).toBe(3);
  });

  test('死区内且 previous 不匹配 → 回退到「返回 i」', () => {
    const cy = centerY(COLUMN[1]);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 0, before: true })).toBe(1);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 0, before: false })).toBe(1);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: 99, before: true })).toBe(1);
    expect(computeDropIndex(COLUMN, at(200, cy), { index: -3, before: false })).toBe(1);
  });

  test('previous 为 null / undefined 时等同没有 previous', () => {
    const cy = centerY(COLUMN[1]);
    expect(computeDropIndex(COLUMN, at(200, cy), null)).toBe(1);
    expect(computeDropIndex(COLUMN, at(200, cy), undefined)).toBe(1);
  });

  test('previous 为越界 / 非整数 / NaN 时不抛异常，且回退到真实行为', () => {
    const cy = centerY(COLUMN[1]);
    const wild: Previous[] = [
      { index: -100, before: true },
      { index: 1000, before: false },
      { index: 1.5, before: true },
      { index: 2.5, before: false },
      { index: NaN, before: true },
      { index: -0, before: true },
    ];
    for (const previous of wild) {
      expect(() => computeDropIndex(COLUMN, at(200, cy), previous)).not.toThrow();
      expect(computeDropIndex(COLUMN, at(200, cy), previous)).toBe(1);
    }
  });

  test('注意：previous.before 按「真值」使用，运行时的非布尔值会被静默接受', () => {
    const cy = centerY(COLUMN[1]);
    const truthy = { index: 1, before: 'yes' as unknown as boolean };
    const falsy = { index: 1, before: '' as unknown as boolean };
    expect(computeDropIndex(COLUMN, at(200, cy), truthy)).toBe(1);
    expect(computeDropIndex(COLUMN, at(200, cy), falsy)).toBe(2);
  });

  test('死区之外 previous 不再参与判定（横向位置优先）', () => {
    const cy = centerY(COLUMN[1]);
    expect(computeDropIndex(COLUMN, at(189, cy), { index: 1, before: false })).toBe(1);
    expect(computeDropIndex(COLUMN, at(211, cy), { index: 1, before: true })).toBe(2);
    expect(computeDropIndex(COLUMN, at(-500, cy), { index: 2, before: false })).toBe(1);
    expect(computeDropIndex(COLUMN, at(900, cy), { index: 0, before: true })).toBe(2);
  });

  test('previous 只会把结果稳定在同一条边界上，不会推出 0..length 之外', () => {
    for (let i = 0; i < COLUMN.length; i += 1) {
      const cy = centerY(COLUMN[i]);
      for (const before of [true, false]) {
        for (const index of [i, i + 1, i - 1, 0, COLUMN.length]) {
          const result = computeDropIndex(COLUMN, at(centerX(COLUMN[i]), cy), { index, before });
          expect(Number.isInteger(result)).toBe(true);
          expect(result).toBeGreaterThanOrEqual(0);
          expect(result).toBeLessThanOrEqual(COLUMN.length);
        }
      }
    }
  });
});

describe('computeDropIndex：稳定性（回归：鼠标微动不该换位置）', () => {
  test('从死区右侧起步后，在中心附近 ±1px 抖动 80 帧，结果完全不变', () => {
    const cy = centerY(COLUMN[1]);
    const start = computeDropIndex(COLUMN, at(centerX(COLUMN[1]) + DROP_DEAD_ZONE + 1, cy));
    expect(start).toBe(2);

    let previous: Previous | null = previousAt(start, COLUMN.length);
    const seen = new Set<number>();
    for (let frame = 0; frame < 80; frame += 1) {
      const x = frame % 2 === 0 ? centerX(COLUMN[1]) - 1 : centerX(COLUMN[1]) + 1;
      const index = computeDropIndex(COLUMN, at(x, cy), previous);
      previous = previousAt(index, COLUMN.length);
      seen.add(index);
    }
    expect([...seen]).toEqual([2]);
  });

  test('从死区左侧起步后，±2px 抖动同样不换位置', () => {
    const cy = centerY(COLUMN[1]);
    const start = computeDropIndex(COLUMN, at(centerX(COLUMN[1]) - DROP_DEAD_ZONE - 1, cy));
    expect(start).toBe(1);

    let previous: Previous | null = previousAt(start, COLUMN.length);
    const seen = new Set<number>();
    for (let frame = 0; frame < 80; frame += 1) {
      const x = frame % 2 === 0 ? centerX(COLUMN[1]) - 2 : centerX(COLUMN[1]) + 2;
      const index = computeDropIndex(COLUMN, at(x, cy), previous);
      previous = previousAt(index, COLUMN.length);
      seen.add(index);
    }
    expect([...seen]).toEqual([1]);
  });

  test('越过死区边界时索引只变化 1（1px 移动不会跨档）', () => {
    const cy = centerY(COLUMN[1]);
    expect(computeDropIndex(COLUMN, at(210, cy))).toBe(1);
    expect(computeDropIndex(COLUMN, at(211, cy))).toBe(2);
    expect(computeDropIndex(COLUMN, at(190, cy))).toBe(1);
    expect(computeDropIndex(COLUMN, at(189, cy))).toBe(1);
  });

  test('单列布局逐像素向下扫描：索引单调不减、每步最多 +1、终点是 rects.length', () => {
    const values: number[] = [];
    let previous: Previous | null = null;
    for (let y = -10; y <= 360; y += 1) {
      const index = computeDropIndex(COLUMN, at(centerX(COLUMN[0]), y), previous);
      previous = previousAt(index, COLUMN.length);
      values.push(index);
    }

    expect(deltas(values).every((delta) => delta >= 0)).toBe(true);
    expect(deltas(values).every((delta) => delta <= 1)).toBe(true);
    expect([...new Set(values)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    expect(values[values.length - 1]).toBe(COLUMN.length);
  });

  test('2×2 网格按阅读顺序走完整布局：索引单调不减、每步最多 +1', () => {
    const values: number[] = [];
    let previous: Previous | null = null;
    for (const r of GRID) {
      const y = centerY(r);
      for (let x = r.left; x <= r.right; x += 1) {
        const index = computeDropIndex(GRID, at(x, y), previous);
        previous = previousAt(index, GRID.length);
        values.push(index);
      }
    }
    // 走完之后把指针移到整个布局下方
    const tail = computeDropIndex(GRID, at(0, 1000), previous);

    expect(deltas(values).every((delta) => delta >= 0)).toBe(true);
    expect(deltas(values).every((delta) => delta <= 1)).toBe(true);
    expect(tail).toBe(GRID.length);
    expect(tail).toBeGreaterThanOrEqual(values[values.length - 1]);
  });

  test('注意：纵向扫描左侧列时索引以 2 递增（0 → 2 → 4）——同一行右侧矩形被跳过', () => {
    // x = 100 落在左列中心（150）的死区之外，指针纵向命中 rect i 就返回 i，
    // 于是跳过同一行右侧那个矩形，索引直接从 0 到 2、再到 4。属于真实契约。
    const values: number[] = [];
    let previous: Previous | null = null;
    for (let y = -10; y <= 260; y += 1) {
      const index = computeDropIndex(GRID, at(100, y), previous);
      previous = previousAt(index, GRID.length);
      values.push(index);
    }

    expect(deltas(values).every((delta) => delta >= 0)).toBe(true);
    expect(deltas(values).every((delta) => delta <= 2)).toBe(true);
    expect([...new Set(values)].sort((a, b) => a - b)).toEqual([0, 2, 4]);
    expect(values[values.length - 1]).toBe(GRID.length);
  });

  test('一行内的每个落点都可到达（修复「有空间却拖不进去」）', () => {
    // 修复前：源码在第一个纵向命中的矩形处就 return，同一行里后面的矩形
    // 永远无法被选中，2×2 网格扫描只能得到 {0,1}。
    // 修复后按行分组、行内逐个比较，{0,1,2} 全部可达。
    const seen = new Set<number>();
    for (let x = -200; x <= 1400; x += 1) seen.add(computeDropIndex(GRID, at(x, centerY(GRID[0]))));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2]);
  });
});

describe('computeDropIndex：多行且宽高不一', () => {
  test('三行不同宽高：每行的左右判定都落在该行的矩形上', () => {
    expect(computeDropIndex(MIXED, at(89, 40))).toBe(0);
    expect(computeDropIndex(MIXED, at(111, 40))).toBe(1);
    expect(computeDropIndex(MIXED, at(289, 160))).toBe(3);
    expect(computeDropIndex(MIXED, at(311, 160))).toBe(4);
    expect(computeDropIndex(MIXED, at(389, 270))).toBe(5);
    expect(computeDropIndex(MIXED, at(411, 270))).toBe(6);
  });

  test('行高不同 → 空隙位置不同：第一行下方 1px 直接跳到第二行首矩形', () => {
    // 第一行 bottom = 80，第二行 top = 100
    expect(computeDropIndex(MIXED, at(0, 80))).toBe(0);
    expect(computeDropIndex(MIXED, at(0, 81))).toBe(3);
    expect(computeDropIndex(MIXED, at(0, 90))).toBe(3);
    expect(computeDropIndex(MIXED, at(0, 230))).toBe(5);
  });

  test('按矩形中心走阅读顺序：索引单调不减（不同宽高也不回退）', () => {
    const centers: Pointer[] = MIXED.map((r) => at(centerX(r), centerY(r)));
    const values: number[] = [];
    let previous: Previous | null = null;
    for (const pointer of centers) {
      const index = computeDropIndex(MIXED, pointer, previous);
      previous = previousAt(index, MIXED.length);
      values.push(index);
    }

    // 修复后行内每个矩形都能命中，所以沿阅读顺序走中心是严格 +1 的
    expect(values).toEqual([0, 1, 2, 3, 4, 5]);
    expect(deltas(values).every((delta) => delta >= 0)).toBe(true);
    expect(deltas(values).every((delta) => delta <= 1)).toBe(true);
  });

  test('每个矩形的纵向中心都稳定落在自己的判定上', () => {
    // 注意：只有每行的「第一个」矩形参与横向判定；同一行里靠后的矩形
    // 永远无法通过纵向命中被选中（源码在第一个命中处就 return 了）。
    const bandStarts = bandStartIndices(MIXED);
    expect(bandStarts).toEqual([0, 3, 5]);

    for (const i of bandStarts) {
      const r = MIXED[i];
      const cy = centerY(r);
      expect(computeDropIndex(MIXED, at(centerX(r) - DROP_DEAD_ZONE - 1, cy))).toBe(i);
      expect(computeDropIndex(MIXED, at(centerX(r) + DROP_DEAD_ZONE + 1, cy))).toBe(i + 1);
      expect(computeDropIndex(MIXED, at(centerX(r), cy))).toBe(i);
      expect(computeDropIndex(MIXED, at(-1e6, cy))).toBe(i);
      // 最右侧超出整行 → 插到「本行最后一个矩形」之后
      const rowEnd = bandEndIndex(MIXED, i) + 1;
      expect(computeDropIndex(MIXED, at(1e6, cy))).toBe(rowEnd);
    }

    // 修复后：同一行里每个矩形都参与横向判定，指针落在谁的中心附近就返回它的下标。
    for (const i of [1, 2, 4]) {
      const r = MIXED[i];
      expect(computeDropIndex(MIXED, at(centerX(r), centerY(r)))).toBe(i);
    }
    // 具体值：第二行第二个矩形中心 x = 700 → 4
    expect(computeDropIndex(MIXED, at(700, 160))).toBe(4);
    // 第一行第二个矩形中心 x = 400 → 1
    expect(computeDropIndex(MIXED, at(400, 40))).toBe(1);
    // 第一行第三个矩形中心 x = 700 → 2（修复前永远到不了）
    expect(computeDropIndex(MIXED, at(700, 40))).toBe(2);
  });
});

describe('computeDropIndex：退化与异常输入', () => {
  test('完全重叠的矩形不会抛异常', () => {
    // 退化输入：三个矩形完全重合。行内比较会逐个跳过（x 始终在中心右侧），
    // 最终落到「本行最后一个之后」，不会抛异常。
    const a = rect(0, 0, 200, 100);
    const overlap: Rect[] = [a, { ...a }, { ...a }];
    expect(() => computeDropIndex(overlap, at(10, 50))).not.toThrow();
    expect(computeDropIndex(overlap, at(10, 50))).toBe(0);
    expect(computeDropIndex(overlap, at(190, 50))).toBe(3);
  });

  test('零尺寸矩形（0×0）只在正好落在那个点上时才算命中', () => {
    const point: Rect[] = [rect(100, 100, 0, 0)];
    expect(computeDropIndex(point, at(100, 100))).toBe(0);
    expect(computeDropIndex(point, at(200, 100))).toBe(1);
    expect(computeDropIndex(point, at(100, 99))).toBe(0);
    expect(computeDropIndex(point, at(100, 101))).toBe(1);
  });

  test('零宽矩形：死区退化为中心点左右各 10px', () => {
    const zeroWidth: Rect[] = [rect(100, 0, 0, 100)];
    expect(computeDropIndex(zeroWidth, at(89, 50))).toBe(0);
    expect(computeDropIndex(zeroWidth, at(90, 50))).toBe(0);
    expect(computeDropIndex(zeroWidth, at(100, 50))).toBe(0);
    expect(computeDropIndex(zeroWidth, at(110, 50))).toBe(0);
    expect(computeDropIndex(zeroWidth, at(111, 50))).toBe(1);
  });

  test('零高矩形：只在正好落在那条线上时算命中', () => {
    const zeroHeight: Rect[] = [rect(0, 100, 400, 0)];
    expect(computeDropIndex(zeroHeight, at(100, 100))).toBe(0);
    expect(computeDropIndex(zeroHeight, at(300, 100))).toBe(1);
    expect(computeDropIndex(zeroHeight, at(100, 99.5))).toBe(0);
    expect(computeDropIndex(zeroHeight, at(100, 100.5))).toBe(1);
  });

  test('反转矩形（top > bottom）不抛异常，按源码分支顺序给出确定结果', () => {
    const inverted: Rect[] = [rect(0, 100, 200, -50), rect(0, 200, 200, 100)];
    expect(inverted[0].top).toBeGreaterThan(inverted[0].bottom);
    expect(() => computeDropIndex(inverted, at(0, 70))).not.toThrow();
    expect(computeDropIndex(inverted, at(0, 70))).toBe(0); // y < top → 插到它前面
    expect(computeDropIndex(inverted, at(0, 150))).toBe(1); // 落在 top 与 bottom 之间 → 跳过
    expect(computeDropIndex(inverted, at(0, 400))).toBe(2);
  });

  test('负宽矩形（right < left）不抛异常，中心线按公式计算', () => {
    const negative: Rect[] = [rect(100, 0, -100, 100)];
    expect(negative[0].right).toBeLessThan(negative[0].left);
    expect(centerX(negative[0])).toBe(50);
    expect(computeDropIndex(negative, at(49, 50))).toBe(0);
    expect(computeDropIndex(negative, at(61, 50))).toBe(1);
    expect(computeDropIndex(negative, at(0, 50))).toBe(0);
  });

  test('NaN 坐标不抛异常（行定位回退到最后一行）', () => {
    // y 为 NaN 时所有 `<= bottom` 比较都是 false，行定位回退到最后一行；
    // 行为确定、不抛异常，但值取决于横向坐标。
    expect(computeDropIndex(COLUMN, at(NaN, NaN))).toBe(2);
    expect(computeDropIndex(COLUMN, at(0, NaN))).toBe(2);
    expect(computeDropIndex(COLUMN, at(399, NaN))).toBe(3);
    // y 正常时不受影响
    expect(computeDropIndex(COLUMN, at(NaN, 170))).toBe(1);
  });

  test('注意：矩形的 left / right 为 NaN 时横向比较全部失败，落到死区分支', () => {
    const broken: Rect[] = [rect(NaN, 0, 100, 100), rect(0, 120, 400, 100)];
    expect(computeDropIndex(broken, at(0, 50))).toBe(0);
    expect(computeDropIndex(broken, at(9999, 50))).toBe(0);
    expect(computeDropIndex(broken, at(0, 150))).toBe(1);
  });

  test('无穷坐标不抛异常：-Infinity 视为上方，+Infinity 视为下方', () => {
    expect(computeDropIndex(COLUMN, at(0, -Infinity))).toBe(0);
    expect(computeDropIndex(COLUMN, at(0, Infinity))).toBe(3);
    expect(computeDropIndex(COLUMN, at(Infinity, Infinity))).toBe(3);
    expect(computeDropIndex(COLUMN, at(-Infinity, 50))).toBe(0);
    expect(computeDropIndex(COLUMN, at(Infinity, 50))).toBe(1);
  });

  test('注意：源码信任 rects 的数组顺序，不做几何排序（顺序传错就按错序判定）', () => {
    const unsorted: Rect[] = [rect(0, 200, 400, 100), rect(0, 0, 400, 100)];
    expect(computeDropIndex(unsorted, at(0, 50))).toBe(0); // y < 第一个矩形的 top
    expect(computeDropIndex(unsorted, at(399, 250))).toBe(1); // 命中数组里的第一个矩形
    expect(computeDropIndex(unsorted, at(0, 1000))).toBe(2);
  });

  test('不修改入参（冻结的 rects / pointer / previous 同样可用）', () => {
    const frozenRects = Object.freeze(COLUMN.map((r) => Object.freeze({ ...r })));
    const frozenPointer = Object.freeze(at(211, 170));
    const frozenPrevious = Object.freeze({ index: 1, before: true });
    expect(() => computeDropIndex(frozenRects as Rect[], frozenPointer, frozenPrevious)).not.toThrow();
    expect(computeDropIndex(frozenRects as Rect[], frozenPointer, frozenPrevious)).toBe(2);
    expect(frozenRects[1]).toEqual(COLUMN[1]);
  });

  test('单矩形布局：上方 0、左半 0、右半 1、下方 1', () => {
    const single: Rect[] = [rect(0, 0, 400, 100)];
    expect(computeDropIndex(single, at(200, -1))).toBe(0);
    expect(computeDropIndex(single, at(100, 50))).toBe(0);
    expect(computeDropIndex(single, at(300, 50))).toBe(1);
    expect(computeDropIndex(single, at(200, 101))).toBe(1);
  });

  test('大矩形数组：结果始终落在 0..length 且判定与「命中下标」一致', () => {
    const many: Rect[] = column(300, Array.from({ length: 40 }, (_, i) => [i * 120, 100]));
    for (let i = 0; i < many.length; i += 1) {
      const cy = centerY(many[i]);
      expect(computeDropIndex(many, at(149, cy))).toBe(i);
      expect(computeDropIndex(many, at(151, cy))).toBe(i);
      expect(computeDropIndex(many, at(0, cy))).toBe(i);
      expect(computeDropIndex(many, at(299, cy))).toBe(i + 1);
    }
    expect(computeDropIndex(many, at(0, -1))).toBe(0);
    expect(computeDropIndex(many, at(0, many[many.length - 1].bottom + 1))).toBe(many.length);
  });
});
