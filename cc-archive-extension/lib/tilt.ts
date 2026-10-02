/**
 * 3D 倾斜 / 鼠标视差：纯几何与状态层。
 *
 * 本模块只负责「指针位置 -> 变换数值」的计算，以及把数值写入元素上的 CSS 自定义属性；
 * 真正的视觉组合（transition、阴影、高光渐变）由调用方的 CSS 完成。
 *
 * 符号约定（与 CSS 右手坐标系一致：指针所在一侧向后倒）
 * - 指针靠上 => rotateX 为正（顶边向后远离观察者）
 * - 指针靠右 => rotateY 为正（右边向后远离观察者）
 * 因此 rotateX = -归一化 Y * maxTiltDeg，rotateY = +归一化 X * maxTiltDeg。
 */

/** 激活倾斜时挂在元素上的类名，供调用方在 CSS 中挂钩 */
export const TILT_ACTIVE_CLASS = 'is-tilting';

/** 元素上写入的 CSS 自定义属性（带单位，调用方可直接 var() 使用） */
const VAR_ROTATE_X = '--tilt-rotate-x';
const VAR_ROTATE_Y = '--tilt-rotate-y';
const VAR_SCALE = '--tilt-scale';
const VAR_SHADOW_X = '--tilt-shadow-x';
const VAR_SHADOW_Y = '--tilt-shadow-y';
const VAR_HIGHLIGHT_X = '--tilt-highlight-x';
const VAR_HIGHLIGHT_Y = '--tilt-highlight-y';
const VAR_LIFT_Z = '--tilt-lift-z';
const VAR_TEXT_Z = '--tilt-text-z';

const DEFAULT_MAX_TILT_DEG = 12;
const DEFAULT_SCALE = 1.04;
const DEFAULT_SHADOW_OFFSET_PX = 18;
const DEFAULT_LIFT_PX = 14;
const DEFAULT_TEXT_LIFT_PX = 28;
const DEFAULT_PERSPECTIVE_PX = 900;

export interface TiltOptions {
  maxTiltDeg?: number;
  scale?: number;
  /** 阴影位移上限（px），方向与指针相反 */
  shadowOffsetPx?: number;
  /** 图片 / 图标层 translateZ（px） */
  liftPx?: number;
  /** 文字 / 按钮层 translateZ（px） */
  textLiftPx?: number;
  /** 透视距离（px）；<= 0 时 formatTiltTransform 不输出 perspective() */
  perspectivePx?: number;
}

export interface TiltState {
  rotateX: number;
  rotateY: number;
  scale: number;
  /** 阴影 X 位移（px），与指针方向相反 */
  shadowX: number;
  /** 阴影 Y 位移（px），与指针方向相反 */
  shadowY: number;
  /** 高光 X 百分比（0..100），跟随指针 */
  highlightX: number;
  /** 高光 Y 百分比（0..100），跟随指针 */
  highlightY: number;
  liftZ: number;
  textZ: number;
  active: boolean;
}

/** 补齐默认值后的参数 */
interface ResolvedTiltOptions {
  maxTiltDeg: number;
  scale: number;
  shadowOffsetPx: number;
  liftPx: number;
  textLiftPx: number;
  perspectivePx: number;
}

/** 只接受非负有限数，否则回退默认值 */
function toNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function resolveTiltOptions(options: TiltOptions): ResolvedTiltOptions {
  const scale = options.scale;
  return {
    maxTiltDeg: toNonNegative(options.maxTiltDeg, DEFAULT_MAX_TILT_DEG),
    // 缩放必须为正，否则元素会翻转
    scale: typeof scale === 'number' && Number.isFinite(scale) && scale > 0 ? scale : DEFAULT_SCALE,
    shadowOffsetPx: toNonNegative(options.shadowOffsetPx, DEFAULT_SHADOW_OFFSET_PX),
    liftPx: toNonNegative(options.liftPx, DEFAULT_LIFT_PX),
    textLiftPx: toNonNegative(options.textLiftPx, DEFAULT_TEXT_LIFT_PX),
    perspectivePx: toNonNegative(options.perspectivePx, DEFAULT_PERSPECTIVE_PX),
  };
}

/** 把归一化坐标限制在 -1..1，避免指针远离元素时数值失控 */
function clampUnit(value: number): number {
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/** 通用数值钳制；非有限值回退到 fallback */
function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** 保留两位小数，保证输出字符串稳定可比 */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 宽高必须是正的有限数，否则无法归一化 */
function isUsableRect(rect: { width: number; height: number }): boolean {
  return (
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    rect.width > 0 &&
    rect.height > 0
  );
}

/**
 * 指针位置 -> 完整变换状态。
 *
 * pointerX / pointerY 为相对元素左上角的坐标；rect 只需宽高。
 * 宽高非法（0、负数、NaN）或指针坐标非有限数时返回静止状态，保证不产生 NaN / Infinity。
 */
export function computeTilt(
  pointerX: number,
  pointerY: number,
  rect: { width: number; height: number },
  options: TiltOptions = {},
): TiltState {
  if (!isUsableRect(rect) || !Number.isFinite(pointerX) || !Number.isFinite(pointerY)) {
    return neutralTilt(options);
  }

  const resolved = resolveTiltOptions(options);
  // 元素中心为 0，左 / 上为 -1，右 / 下为 +1；超出部分截断
  const normX = clampUnit((pointerX / rect.width) * 2 - 1);
  const normY = clampUnit((pointerY / rect.height) * 2 - 1);

  return {
    // 指针靠上（normY 为负）时 rotateX 为正：顶边向后倒
    rotateX: -normY * resolved.maxTiltDeg,
    // 指针靠右（normX 为正）时 rotateY 为正：右边向后倒
    rotateY: normX * resolved.maxTiltDeg,
    scale: resolved.scale,
    // 阴影与指针反向移动
    shadowX: -normX * resolved.shadowOffsetPx,
    shadowY: -normY * resolved.shadowOffsetPx,
    highlightX: ((normX + 1) / 2) * 100,
    highlightY: ((normY + 1) / 2) * 100,
    liftZ: resolved.liftPx,
    textZ: resolved.textLiftPx,
    active: true,
  };
}

/** 静止状态：无旋转、无缩放、阴影归零、高光居中、层级贴合、未激活 */
export function neutralTilt(options: TiltOptions = {}): TiltState {
  // 参数只影响激活态，静止态与 options 无关；保留形参以统一调用签名
  void options;
  return {
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
  };
}

/**
 * 把状态的每个数值字段钳制到安全区间：
 * 旋转 ±maxTiltDeg、缩放 [min(1, scale), max(1, scale)]、阴影 ±shadowOffsetPx、
 * 高光 0..100、层级 0..对应 lift 值；非有限值回退中性值。
 */
export function clampTilt(state: TiltState, options: TiltOptions = {}): TiltState {
  const resolved = resolveTiltOptions(options);
  const scaleMin = Math.min(1, resolved.scale);
  const scaleMax = Math.max(1, resolved.scale);

  return {
    rotateX: clampNumber(state.rotateX, -resolved.maxTiltDeg, resolved.maxTiltDeg, 0),
    rotateY: clampNumber(state.rotateY, -resolved.maxTiltDeg, resolved.maxTiltDeg, 0),
    scale: clampNumber(state.scale, scaleMin, scaleMax, 1),
    shadowX: clampNumber(state.shadowX, -resolved.shadowOffsetPx, resolved.shadowOffsetPx, 0),
    shadowY: clampNumber(state.shadowY, -resolved.shadowOffsetPx, resolved.shadowOffsetPx, 0),
    highlightX: clampNumber(state.highlightX, 0, 100, 50),
    highlightY: clampNumber(state.highlightY, 0, 100, 50),
    liftZ: clampNumber(state.liftZ, 0, resolved.liftPx, 0),
    textZ: clampNumber(state.textZ, 0, resolved.textLiftPx, 0),
    active: state.active === true,
  };
}

/** 生成卡片自身的 CSS transform；perspectivePx <= 0 时省略 perspective() */
export function formatTiltTransform(state: TiltState, options: TiltOptions = {}): string {
  const resolved = resolveTiltOptions(options);
  const safe = clampTilt(state, options);
  const parts: string[] = [];

  if (resolved.perspectivePx > 0) {
    parts.push(`perspective(${round2(resolved.perspectivePx)}px)`);
  }
  parts.push(`rotateX(${round2(safe.rotateX)}deg)`);
  parts.push(`rotateY(${round2(safe.rotateY)}deg)`);
  parts.push(`scale(${round2(safe.scale)})`);

  return parts.join(' ');
}

/** 生成视差图层的 CSS transform，例如 translateZ(14px) */
export function formatLayerTransform(z: number): string {
  const safeZ = Number.isFinite(z) ? z : 0;
  return `translateZ(${round2(safeZ)}px)`;
}

/** 用户是否偏好减少动效；SSR / 无 matchMedia 环境下安全返回 false */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/** 把状态写入元素：只设置 CSS 自定义属性与激活类，不覆盖元素自身的 transform */
function applyTiltState(element: HTMLElement, state: TiltState): void {
  const style = element.style;
  style.setProperty(VAR_ROTATE_X, `${round2(state.rotateX)}deg`);
  style.setProperty(VAR_ROTATE_Y, `${round2(state.rotateY)}deg`);
  style.setProperty(VAR_SCALE, `${round2(state.scale)}`);
  style.setProperty(VAR_SHADOW_X, `${round2(state.shadowX)}px`);
  style.setProperty(VAR_SHADOW_Y, `${round2(state.shadowY)}px`);
  style.setProperty(VAR_HIGHLIGHT_X, `${round2(state.highlightX)}%`);
  style.setProperty(VAR_HIGHLIGHT_Y, `${round2(state.highlightY)}%`);
  style.setProperty(VAR_LIFT_Z, `${round2(state.liftZ)}px`);
  style.setProperty(VAR_TEXT_Z, `${round2(state.textZ)}px`);

  if (state.active) {
    element.classList.add(TILT_ACTIVE_CLASS);
  } else {
    element.classList.remove(TILT_ACTIVE_CLASS);
  }
}

/**
 * 给元素绑定倾斜交互，返回清理函数。
 *
 * - 每次 pointermove 只读取一次 getBoundingClientRect，避免读写交替造成的布局抖动；
 * - 不使用 requestAnimationFrame 循环，事件内直接更新；
 * - pointerleave / pointercancel 复位为静止状态；
 * - 偏好减少动效时完全不接管元素，返回空清理函数；
 * - 清理函数移除全部监听并复位元素状态。
 */
export function attachTilt(element: HTMLElement, options: TiltOptions = {}): () => void {
  if (prefersReducedMotion()) {
    return () => undefined;
  }

  /**
   * 缓存的「未变换」几何。
   *
   * 这是修复抖动的关键：element.getBoundingClientRect() 返回的是**变换后**的盒子，
   * 元素一旦 rotate/scale，矩形就会随之变化，归一化结果被自己的上一次输出影响，
   * 形成正反馈（越倾越偏，越偏越倾）。所以只在 pointerenter 时量一次，
   * 之后在整个 hover 期间复用；滚动/缩放时通过事件失效缓存。
   */
  let cachedRect: { left: number; top: number; width: number; height: number } | null = null;

  const measure = (): void => {
    const r = element.getBoundingClientRect();
    // 记录变换前的尺寸：此时元素尚未加 is-tilting（transform 由变量驱动，
    // 静止态 scale=1 / rotate=0，因此这里量到的就是基准盒子）。
    cachedRect = { left: r.left, top: r.top, width: r.width, height: r.height };
  };

  const handleMove = (event: PointerEvent): void => {
    if (!cachedRect) measure();
    if (!cachedRect) return;
    const state = computeTilt(
      event.clientX - cachedRect.left,
      event.clientY - cachedRect.top,
      cachedRect,
      options,
    );
    applyTiltState(element, state);
  };

  const handleEnter = (): void => {
    measure();
    element.classList.add(TILT_ACTIVE_CLASS);
  };

  const handleReset = (): void => {
    cachedRect = null;
    applyTiltState(element, neutralTilt(options));
  };

  /** 指针是否真的在（未变换的）元素范围之外；留 2px 容差避免边界横跳 */
  const isOutside = (clientX: number, clientY: number): boolean => {
    if (!cachedRect) return true;
    const { left, top, width, height } = cachedRect;
    const pad = 2;
    return (
      clientX < left - pad ||
      clientX > left + width + pad ||
      clientY < top - pad ||
      clientY > top + height + pad
    );
  };

  /**
   * pointerleave 的「假离开」过滤。
   *
   * 抖动根因：元素倾斜后会从光标下转走，光标随即落到元素外 → 触发 pointerleave
   * → 复位 → 元素转回原位又命中光标 → pointerenter → 再次倾斜……如此往复，
   * 就是「一下选中、一下选不中」的一抖一抖。
   *
   * 修法：leave 触发时先看指针相对**未变换**基准矩形的位置。
   * 若指针仍在矩形内，说明这次 leave 是变换自身造成的假信号，忽略；
   * 只有指针真的在外面才复位。
   */
  const handleLeave = (event: PointerEvent): void => {
    if (!isOutside(event.clientX, event.clientY)) return;
    handleReset();
  };

  /**
   * 兜底：万一某次 leave 被当作假信号忽略、而指针此后再没进入元素，
   * 就靠 document 上的 pointermove 持续判定，确保最终一定会复位。
   */
  const handleDocumentMove = (event: PointerEvent): void => {
    if (!cachedRect || !element.classList.contains(TILT_ACTIVE_CLASS)) return;
    if (isOutside(event.clientX, event.clientY)) handleReset();
  };

  const invalidate = (): void => {
    // 滚动或窗口尺寸变化后基准盒子失效，下次进入时重新测量
    if (!element.classList.contains(TILT_ACTIVE_CLASS)) cachedRect = null;
  };

  element.addEventListener('pointermove', handleMove);
  element.addEventListener('pointerenter', handleEnter);
  element.addEventListener('pointerleave', handleLeave);
  element.addEventListener('pointercancel', handleReset);
  document.addEventListener('pointermove', handleDocumentMove, { passive: true });
  window.addEventListener('scroll', invalidate, { passive: true, capture: true });
  window.addEventListener('resize', invalidate, { passive: true });

  return () => {
    element.removeEventListener('pointermove', handleMove);
    element.removeEventListener('pointerenter', handleEnter);
    element.removeEventListener('pointerleave', handleLeave);
    element.removeEventListener('pointercancel', handleReset);
    document.removeEventListener('pointermove', handleDocumentMove);
    window.removeEventListener('scroll', invalidate, { capture: true });
    window.removeEventListener('resize', invalidate);
    cachedRect = null;
    applyTiltState(element, neutralTilt(options));
  };
}

/** 倾斜绑定管理器 */
export interface TiltBinder {
  /** 解除上一轮绑定，再给这批元素绑定新的倾斜 */
  bind: (elements: Iterable<HTMLElement>, options?: TiltOptions) => void;
  /** 解绑全部元素并让它们回到静止态 */
  dispose: () => void;
}

/**
 * 管理「一批元素」的倾斜绑定，供列表反复重渲染的场景使用。
 *
 * 这里刻意不提供「已绑定」标记：`dispose()` 会把监听器摘掉，但标记仍留在 DOM 节点上，
 * 于是下一次 bind 会跳过所有元素 —— 3D 倾斜就静默失效了（这个坑踩过，表现为
 * 「第一次渲染有倾斜，面板重排之后就没有了」）。bind 自身就是幂等的：
 * 每次都先解绑再重绑，不会累积监听器。
 */
export function createTiltBinder(): TiltBinder {
  let disposers: (() => void)[] = [];

  const dispose = (): void => {
    for (const off of disposers) off();
    disposers = [];
  };

  return {
    bind(elements, options = {}) {
      dispose();
      for (const element of elements) disposers.push(attachTilt(element, options));
    },
    dispose,
  };
}
