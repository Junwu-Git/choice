import type { TabId } from '@/components/shared/tab-definitions';
import { useGlobalSettingsStore } from '@/store/global-settings';

export const isSettingsOpen = ref(false);

// 气泡直径单一来源（手机窄触屏 / 其余分档，且随样式）：FloatingBubble 的渲染尺寸与
// 贴边 clamp、FloatingContextMenu 的菜单偏移全部引用本值——各自硬编码会在移动端
// 产生 ~12px 错位。MQL 监听挂在模块作用域（import 即生效、全局单例，无需随某组件
// 卸载而清理；floating-state 被多个组件共享，模块只加载一次，监听不会重复注册）
const MOBILE_BUBBLE_QUERY = '(pointer: coarse) and (max-width: 480px)';
const mobileBubbleMql = window.matchMedia(MOBILE_BUBBLE_QUERY);
export const isMobileBubble = ref(mobileBubbleMql.matches);
mobileBubbleMql.addEventListener('change', (e: MediaQueryListEvent) => {
  isMobileBubble.value = e.matches;
});

/** 悬浮球样式（与 settings.ui.bubble_style 同源，组件侧不必再引 store 判档） */
export type BubbleStyle = 'ring' | 'compact';

/** 直径随样式 + 移动端：ring = 现状（桌面 60 / 手机 48）；compact = 紧凑小点
 *  （桌面 48 / 手机 40，手机端更不遮挡）。单一事实源——新增样式只改这里 */
export function bubbleSizeFor(style: BubbleStyle, isMobile: boolean): number {
  if (style === 'compact') return isMobile ? 40 : 48;
  return isMobile ? 48 : 60;
}

/** 模块作用域初始直径：不读 store（pinia 未在模块加载时安装，bubbleX/Y 初始化
 *  只能在此时用纯函数取值），默认 ring 档 */
const defaultBubbleSize = (): number => bubbleSizeFor('ring', isMobileBubble.value);

// 运行时直径：样式随设置实时切换（组件惰性求值，store 已就绪），移动端随 MQL
export const bubbleSize = computed(() => {
  const ui = useGlobalSettingsStore().settings.ui;
  return bubbleSizeFor(ui.bubble_style === 'compact' ? 'compact' : 'ring', isMobileBubble.value);
});

// 右侧/底部留白（与悬浮球默认贴右下角呼应；非直径相关，独立常量）
const BUBBLE_MARGIN_X = 16;
const BUBBLE_MARGIN_Y = 80;

// 逻辑坐标（球左上角），由 FloatingBubble 拖拽/吸附后回写；默认值用当前直径，
// 保证移动端首载默认位置亦按 48 计算（与 FloatingBubble.posX/posY 默认一致）
export const bubbleX = ref(window.innerWidth - defaultBubbleSize() - BUBBLE_MARGIN_X);
export const bubbleY = ref(window.innerHeight - defaultBubbleSize() - BUBBLE_MARGIN_Y);

export const isBubbleContextMenuOpen = ref(false);

// 气泡左键点击弹出的选项菜单 popover（FloatingOptions.vue）：与快捷菜单互斥，
// 任一打开时另一方应关闭（见 FloatingBubble 的 handleClick / onContextMenu）
export const isBubbleOptionsOpen = ref(false);

export function closeBubbleOptions() {
  isBubbleOptionsOpen.value = false;
}

export function toggleSettings() {
  isSettingsOpen.value = !isSettingsOpen.value;
}

export function openSettings() {
  isSettingsOpen.value = true;
}

export function closeSettings() {
  isSettingsOpen.value = false;
}

// 统计页「定位条目」→ 请求设置面板切到指定 tab（仿 onboardingPendingTab 但信号独立，
// 避免与向导跳转耦合；由打开中的面板 watch 消费后置回 null）
export const requestedTab = ref<TabId | null>(null);

// 待定位的条目 id：PoolEditor 收到后打开条目库弹窗，EntryPoolDialog 消费后置回 null。
// 统计页是全局视角，目标条目可能不在当前 config，故定位到 master_pool 全量视图
// （EntryPoolDialog）而非 config 视图（PoolEditor 内联列表）
export const focusPoolEntryId = ref<string | null>(null);

export function requestTab(id: TabId) {
  requestedTab.value = id;
}

export function focusPoolEntry(id: string) {
  focusPoolEntryId.value = id;
}

/** 贴边吸附时球体外露量 = 球径/3（四舍五入）。snapBubblePosition 与 FloatingBubble 的
 *  初始吸附态推断/resize 保持吸附钳制共用——改吸附外观只改这一处，勿在两处各自硬编码 */
export const getSnapOffset = (size: number): number => Math.round(size / 3);

/** 贴边吸附纯计算：给定逻辑坐标与球径，返回吸附后的位置与吸附侧。
 *  纯提取自 FloatingBubble 的 onEnd 内联逻辑（吸附规则单一真相，勿改语义）：
 *  - 球心距左缘 < SNAP_THRESHOLD → 贴左（外露 getSnapOffset(size)）；
 *  - 距右缘 < SNAP_THRESHOLD → 贴右（同上，右侧对称）；
 *  - 否则自由位置，钳制在视口内。
 *  y 始终钳制在视口内。viewport 由调用方传入（window 尺寸，便于测试） */
export function snapBubblePosition(
  x: number,
  y: number,
  size: number,
  viewport: { width: number; height: number },
): { x: number; y: number; snappedLeft: boolean; snappedRight: boolean } {
  const SNAP_THRESHOLD = 100;
  const SNAP_OFFSET = getSnapOffset(size);
  const centerX = x + size / 2;
  const distToLeft = centerX;
  const distToRight = viewport.width - centerX;
  let snappedX: number;
  let snappedLeft: boolean;
  let snappedRight: boolean;
  if (distToLeft < SNAP_THRESHOLD) {
    snappedX = -SNAP_OFFSET;
    snappedLeft = true;
    snappedRight = false;
  } else if (distToRight < SNAP_THRESHOLD) {
    snappedX = viewport.width - size + SNAP_OFFSET;
    snappedLeft = false;
    snappedRight = true;
  } else {
    snappedX = Math.max(0, Math.min(x, viewport.width - size));
    snappedLeft = false;
    snappedRight = false;
  }
  return {
    x: snappedX,
    y: Math.max(0, Math.min(y, viewport.height - size)),
    snappedLeft,
    snappedRight,
  };
}
