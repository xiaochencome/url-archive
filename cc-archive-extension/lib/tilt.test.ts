// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  TILT_ACTIVE_CLASS,
  attachTilt,
  createTiltBinder,
  clampTilt,
  computeTilt,
  formatLayerTransform,
  formatTiltTransform,
  neutralTilt,
  prefersReducedMotion,
  type TiltState,
} from './tilt';

/** 便于构造越界状态做 clamp 测试 */
function stateWith(overrides: Partial<TiltState>): TiltState {
  return { ...neutralTilt(), ...overrides };
}

/** jsdom 不做布局，需要手动给出元素尺寸与位置 */
function stubRect(element: HTMLElement, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

/** jsdom 没有 PointerEvent，用 MouseEvent 承载坐标即可被 pointermove 监听捕获 */
function dispatchPointer(element: HTMLElement, type: string, clientX = 0, clientY = 0): void {
  element.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
}

const originalMatchMedia = window.matchMedia;

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  document.body.innerHTML = '';
});

describe('computeTilt', () => {
  test('指针位于中心时旋转接近 0，高光居中', () => {
    const state = computeTilt(100, 50, { width: 200, height: 100 });

    expect(state.rotateX).toBeCloseTo(0, 6);
    expect(state.rotateY).toBeCloseTo(0, 6);
    expect(state.highlightX).toBeCloseTo(50, 6);
    expect(state.highlightY).toBeCloseTo(50, 6);
    expect(state.shadowX).toBeCloseTo(0, 6);
    expect(state.shadowY).toBeCloseTo(0, 6);
    expect(state.active).toBe(true);
  });

  test('四角给出正确的符号与幅度', () => {
    const rect = { width: 200, height: 100 };
    // 约定：指针靠上 => rotateX 为正（顶边向后倒）；指针靠右 => rotateY 为正（右边向后倒）
    const topLeft = computeTilt(0, 0, rect);
    expect(topLeft.rotateX).toBeCloseTo(12, 6);
    expect(topLeft.rotateY).toBeCloseTo(-12, 6);

    const topRight = computeTilt(200, 0, rect);
    expect(topRight.rotateX).toBeCloseTo(12, 6);
    expect(topRight.rotateY).toBeCloseTo(12, 6);

    const bottomLeft = computeTilt(0, 100, rect);
    expect(bottomLeft.rotateX).toBeCloseTo(-12, 6);
    expect(bottomLeft.rotateY).toBeCloseTo(-12, 6);

    const bottomRight = computeTilt(200, 100, rect);
    expect(bottomRight.rotateX).toBeCloseTo(-12, 6);
    expect(bottomRight.rotateY).toBeCloseTo(12, 6);
  });

  test('半程位置得到一半幅度', () => {
    const state = computeTilt(150, 25, { width: 200, height: 100 });

    expect(state.rotateX).toBeCloseTo(6, 6);
    expect(state.rotateY).toBeCloseTo(6, 6);
    expect(state.highlightX).toBeCloseTo(75, 6);
    expect(state.highlightY).toBeCloseTo(25, 6);
  });

  test('指针远离元素时旋转不超过 maxTiltDeg', () => {
    const rect = { width: 200, height: 100 };
    const far = computeTilt(-5000, 5000, rect);

    expect(far.rotateX).toBeCloseTo(-12, 6);
    expect(far.rotateY).toBeCloseTo(-12, 6);
    expect(Math.abs(far.rotateX)).toBeLessThanOrEqual(12);
    expect(Math.abs(far.rotateY)).toBeLessThanOrEqual(12);

    const custom = computeTilt(5000, -5000, rect, { maxTiltDeg: 5 });
    expect(custom.rotateX).toBeCloseTo(5, 6);
    expect(custom.rotateY).toBeCloseTo(5, 6);
  });

  test('阴影位移与指针方向相反', () => {
    const rect = { width: 200, height: 100 };
    const right = computeTilt(200, 50, rect);
    expect(right.shadowX).toBeCloseTo(-18, 6);

    const left = computeTilt(0, 50, rect);
    expect(left.shadowX).toBeCloseTo(18, 6);

    const down = computeTilt(100, 100, rect);
    expect(down.shadowY).toBeCloseTo(-18, 6);

    const up = computeTilt(100, 0, rect);
    expect(up.shadowY).toBeCloseTo(18, 6);
  });

  test('高光百分比始终落在 0..100', () => {
    const rect = { width: 200, height: 100 };
    const samples = [
      computeTilt(-9999, -9999, rect),
      computeTilt(9999, 9999, rect),
      computeTilt(0, 0, rect),
      computeTilt(200, 100, rect),
    ];

    for (const state of samples) {
      expect(state.highlightX).toBeGreaterThanOrEqual(0);
      expect(state.highlightX).toBeLessThanOrEqual(100);
      expect(state.highlightY).toBeGreaterThanOrEqual(0);
      expect(state.highlightY).toBeLessThanOrEqual(100);
    }

    expect(computeTilt(-9999, -9999, rect).highlightX).toBe(0);
    expect(computeTilt(9999, 9999, rect).highlightX).toBe(100);
  });

  test('尺寸为零或非法时返回静止状态且无 NaN/Infinity', () => {
    const zeroWidth = computeTilt(10, 10, { width: 0, height: 100 });
    const zeroHeight = computeTilt(10, 10, { width: 200, height: 0 });
    const negative = computeTilt(10, 10, { width: -200, height: -100 });
    const notANumber = computeTilt(Number.NaN, 10, { width: 200, height: 100 });

    for (const state of [zeroWidth, zeroHeight, negative, notANumber]) {
      expect(state).toEqual(neutralTilt());
    }

    for (const state of [zeroWidth, zeroHeight, negative, notANumber]) {
      for (const value of Object.values(state)) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe('neutralTilt', () => {
  test('静止状态无旋转、缩放为 1、高光居中、未激活', () => {
    expect(neutralTilt()).toEqual({
      rotateX: 0,
      rotateY: 0,
      scale: 1,
      shadowX: 0,
      shadowY: 0,
      highlightX: 50,
      highlightY: 50,
      liftZ: 0,
      textZ: 0,
      active: false,
    });
  });
});

describe('clampTilt', () => {
  test('把越界字段钳制到安全区间', () => {
    const clamped = clampTilt(
      stateWith({
        rotateX: 999,
        rotateY: -999,
        scale: 5,
        shadowX: -400,
        shadowY: 400,
        highlightX: -20,
        highlightY: 250,
        liftZ: 900,
        textZ: -900,
        active: true,
      }),
    );

    expect(clamped.rotateX).toBe(12);
    expect(clamped.rotateY).toBe(-12);
    expect(clamped.scale).toBe(1.04);
    expect(clamped.shadowX).toBe(-18);
    expect(clamped.shadowY).toBe(18);
    expect(clamped.highlightX).toBe(0);
    expect(clamped.highlightY).toBe(100);
    expect(clamped.liftZ).toBe(14);
    expect(clamped.textZ).toBe(0);
    expect(clamped.active).toBe(true);
  });

  test('非有限值回退到中性值', () => {
    const clamped = clampTilt(
      stateWith({
        rotateX: Number.NaN,
        rotateY: Number.POSITIVE_INFINITY,
        scale: Number.NaN,
        shadowX: Number.NEGATIVE_INFINITY,
      }),
    );

    expect(clamped.rotateX).toBe(0);
    expect(clamped.rotateY).toBe(0);
    expect(clamped.scale).toBe(1);
    expect(clamped.shadowX).toBe(0);
  });

  test('自定义上限同样生效', () => {
    const clamped = clampTilt(
      stateWith({ rotateX: 40, shadowX: 50, liftZ: 50 }),
      { maxTiltDeg: 6, shadowOffsetPx: 4, liftPx: 2 },
    );

    expect(clamped.rotateX).toBe(6);
    expect(clamped.shadowX).toBe(4);
    expect(clamped.liftZ).toBe(2);
  });
});

describe('formatTiltTransform', () => {
  test('输出稳定且包含 perspective 与 rotateX/rotateY/scale', () => {
    const state = computeTilt(200, 0, { width: 200, height: 100 });
    const output = formatTiltTransform(state);

    expect(output).toBe('perspective(900px) rotateX(12deg) rotateY(12deg) scale(1.04)');
    expect(formatTiltTransform(state)).toBe(output);
    expect(output).toContain('perspective(900px)');
    expect(output).toContain('rotateX(');
    expect(output).toContain('rotateY(');
    expect(output).toContain('scale(');
  });

  test('perspectivePx 为 0 时省略 perspective()', () => {
    const output = formatTiltTransform(neutralTilt(), { perspectivePx: 0 });

    expect(output).toBe('rotateX(0deg) rotateY(0deg) scale(1)');
    expect(output).not.toContain('perspective');
  });

  test('数字保留两位小数', () => {
    const output = formatTiltTransform(stateWith({ rotateX: 3.14159, rotateY: -2.71828, scale: 1.005 }));

    expect(output).toBe('perspective(900px) rotateX(3.14deg) rotateY(-2.72deg) scale(1)');
  });
});

describe('formatLayerTransform', () => {
  test('生成 translateZ 字符串', () => {
    expect(formatLayerTransform(14)).toBe('translateZ(14px)');
    expect(formatLayerTransform(27.5)).toBe('translateZ(27.5px)');
    expect(formatLayerTransform(Number.NaN)).toBe('translateZ(0px)');
  });
});

describe('prefersReducedMotion', () => {
  test('无 matchMedia 时安全返回 false', () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;

    expect(prefersReducedMotion()).toBe(false);
  });

  test('matchMedia 命中时返回 true', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;

    expect(prefersReducedMotion()).toBe(true);
  });
});

describe('attachTilt', () => {
  test('指针移动时写入 CSS 自定义属性并切换激活类', () => {
    const element = document.createElement('div');
    stubRect(element, 200, 100);
    document.body.append(element);

    const dispose = attachTilt(element);
    dispatchPointer(element, 'pointerenter');
    dispatchPointer(element, 'pointermove', 200, 50);

    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(true);
    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('12deg');
    expect(element.style.getPropertyValue('--tilt-rotate-x')).toBe('0deg');
    expect(element.style.getPropertyValue('--tilt-shadow-x')).toBe('-18px');
    expect(element.style.getPropertyValue('--tilt-highlight-x')).toBe('100%');
    expect(element.style.getPropertyValue('--tilt-lift-z')).toBe('14px');
    expect(element.style.getPropertyValue('--tilt-text-z')).toBe('28px');

    // 指针真的离开矩形（坐标在外）才复位
    dispatchPointer(element, 'pointerleave', 400, 400);
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(false);
    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('0deg');
    expect(element.style.getPropertyValue('--tilt-highlight-x')).toBe('50%');

    dispose();
  });

  test('变换导致的「假 pointerleave」不会复位（修复抖动）', () => {
    const element = document.createElement('div');
    stubRect(element, 200, 100);
    document.body.append(element);

    const dispose = attachTilt(element);
    dispatchPointer(element, 'pointerenter');
    dispatchPointer(element, 'pointermove', 200, 50);
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(true);

    // 元素倾斜后自身转走，浏览器会补一个 pointerleave，
    // 但指针坐标其实仍在未变换的矩形内 —— 这属于假离开，必须忽略，
    // 否则会进入「复位 → 转回 → 再倾斜 → 再离开」的抖动循环。
    dispatchPointer(element, 'pointerleave', 100, 50);
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(true);
    expect(element.style.getPropertyValue('--tilt-rotate-y')).not.toBe('0deg');

    // 同一位置的 pointermove 也不应触发复位
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 100, clientY: 50, bubbles: true }));
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(true);

    // 真正移出矩形后才复位
    document.dispatchEvent(new MouseEvent('pointermove', { clientX: 500, clientY: 500, bubbles: true }));
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(false);
    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('0deg');

    dispose();
  });

  test('基准矩形只在进入时测量一次，移动不会重新测量（避免正反馈）', () => {
    const element = document.createElement('div');
    stubRect(element, 200, 100);
    document.body.append(element);

    const spy = vi.spyOn(element, 'getBoundingClientRect');
    const dispose = attachTilt(element);
    dispatchPointer(element, 'pointerenter');
    expect(spy).toHaveBeenCalledTimes(1);

    // 后续多次移动都不应再读 rect（否则变换后的盒子会污染归一化）
    dispatchPointer(element, 'pointermove', 100, 50);
    dispatchPointer(element, 'pointermove', 150, 60);
    dispatchPointer(element, 'pointermove', 50, 20);
    expect(spy).toHaveBeenCalledTimes(1);

    dispose();
  });

  test('清理函数会移除监听并复位元素状态', () => {
    const element = document.createElement('div');
    stubRect(element, 200, 100);
    document.body.append(element);

    const dispose = attachTilt(element);
    dispatchPointer(element, 'pointermove', 200, 50);
    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('12deg');

    dispose();
    // 清理时已复位
    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('0deg');
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(false);

    // 清理后事件不再影响元素
    dispatchPointer(element, 'pointermove', 0, 0);
    dispatchPointer(element, 'pointerenter');
    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('0deg');
    expect(element.style.getPropertyValue('--tilt-highlight-x')).toBe('50%');
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(false);
  });

  test('偏好减少动效时完全不接管元素', () => {
    window.matchMedia = vi.fn(() => ({ matches: true })) as unknown as typeof window.matchMedia;
    const element = document.createElement('div');
    stubRect(element, 200, 100);
    document.body.append(element);

    const dispose = attachTilt(element);
    dispatchPointer(element, 'pointerenter');
    dispatchPointer(element, 'pointermove', 200, 50);

    expect(element.style.getPropertyValue('--tilt-rotate-y')).toBe('');
    expect(element.style.getPropertyValue('--tilt-highlight-x')).toBe('');
    expect(element.classList.contains(TILT_ACTIVE_CLASS)).toBe(false);
    expect(() => dispose()).not.toThrow();
  });

  test('每次事件只读取一次 getBoundingClientRect', () => {
    const element = document.createElement('div');
    stubRect(element, 200, 100);
    document.body.append(element);

    const spy = vi.spyOn(element, 'getBoundingClientRect');
    const dispose = attachTilt(element);
    // 首次 move 需要建立基准矩形，读一次
    dispatchPointer(element, 'pointermove', 100, 50);
    expect(spy).toHaveBeenCalledTimes(1);

    // 之后的移动全部复用缓存，不再读取
    dispatchPointer(element, 'pointermove', 120, 60);
    dispatchPointer(element, 'pointermove', 80, 40);
    expect(spy).toHaveBeenCalledTimes(1);

    dispose();
  });
});

describe('createTiltBinder', () => {
  const makeRow = (): HTMLElement => {
    const el = document.createElement('div');
    stubRect(el, 200, 100);
    document.body.append(el);
    return el;
  };

  test('bind 之后指针移动会倾斜', () => {
    const el = makeRow();
    const binder = createTiltBinder();
    binder.bind([el], { maxTiltDeg: 12 });

    dispatchPointer(el, 'pointermove', 190, 5);

    expect(el.classList.contains('is-tilting')).toBe(true);
    expect(el.style.getPropertyValue('--tilt-rotate-y')).not.toBe('0deg');
    binder.dispose();
  });

  test('重复 bind 同一批元素后依然有效（回归：3D 倾斜第二次绑定后失效）', () => {
    const el = makeRow();
    const binder = createTiltBinder();
    binder.bind([el]);
    binder.bind([el]);
    binder.bind([el]);

    dispatchPointer(el, 'pointermove', 10, 90);

    expect(el.classList.contains('is-tilting')).toBe(true);
    expect(el.style.getPropertyValue('--tilt-rotate-x')).not.toBe('0deg');
    binder.dispose();
  });

  test('重复 bind 不会累积监听器：一次移动只写一次状态', () => {
    const el = makeRow();
    const binder = createTiltBinder();
    binder.bind([el]);
    binder.bind([el]);
    const seen: string[] = [];
    const observer = new MutationObserver(() => seen.push(el.style.getPropertyValue('--tilt-rotate-y')));
    observer.observe(el, { attributes: true, attributeFilter: ['style'] });
    dispatchPointer(el, 'pointermove', 190, 50);
    observer.takeRecords();
    observer.disconnect();
    expect(seen.length).toBeLessThanOrEqual(1);
    binder.dispose();
  });

  test('dispose 解绑，并且元素回到静止态', () => {
    const el = makeRow();
    const binder = createTiltBinder();
    binder.bind([el]);
    dispatchPointer(el, 'pointermove', 190, 5);
    binder.dispose();
    expect(el.classList.contains('is-tilting')).toBe(false);
    expect(el.style.getPropertyValue('--tilt-rotate-x')).toBe('0deg');

    dispatchPointer(el, 'pointermove', 10, 10);
    expect(el.classList.contains('is-tilting')).toBe(false);
  });

  test('bind 会接管上一批元素：旧元素不再响应，新元素正常', () => {
    const first = makeRow();
    const second = makeRow();
    const binder = createTiltBinder();
    binder.bind([first]);
    binder.bind([second]);

    dispatchPointer(first, 'pointermove', 190, 5);
    expect(first.classList.contains('is-tilting')).toBe(false);

    dispatchPointer(second, 'pointermove', 190, 5);
    expect(second.classList.contains('is-tilting')).toBe(true);
    binder.dispose();
  });

  test('空集合也安全', () => {
    const binder = createTiltBinder();
    expect(() => binder.bind([])).not.toThrow();
    expect(() => binder.dispose()).not.toThrow();
  });
});
