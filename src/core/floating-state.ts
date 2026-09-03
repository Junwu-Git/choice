export const isSettingsOpen = ref(false);

// 气泡直径单一来源（手机窄触屏 48 / 其余 60）：FloatingBubble 的渲染尺寸与贴边 clamp、
// FloatingContextMenu 的菜单偏移全部引用本值——各自硬编码 60 会在移动端（实际 48）
// 产生 ~12px 错位。MQL 监听挂在模块作用域（import 即生效、全局单例，无需随某组件
// 卸载而清理；floating-state 被多个组件共享，模块只加载一次，监听不会重复注册）
const MOBILE_BUBBLE_QUERY = '(pointer: coarse) and (max-width: 480px)';
const mobileBubbleMql = window.matchMedia(MOBILE_BUBBLE_QUERY);
export const isMobileBubble = ref(mobileBubbleMql.matches);
mobileBubbleMql.addEventListener('change', (e: MediaQueryListEvent) => {
  isMobileBubble.value = e.matches;
});
export const bubbleSize = computed(() => (isMobileBubble.value ? 48 : 60));

// 右侧/底部留白（与悬浮球默认贴右下角呼应；非直径相关，独立常量）
const BUBBLE_MARGIN_X = 16;
const BUBBLE_MARGIN_Y = 80;

// 逻辑坐标（球左上角），由 FloatingBubble 拖拽/吸附后回写；默认值用当前直径，
// 保证移动端首载默认位置亦按 48 计算（与 FloatingBubble.posX/posY 默认一致）
export const bubbleX = ref(window.innerWidth - bubbleSize.value - BUBBLE_MARGIN_X);
export const bubbleY = ref(window.innerHeight - bubbleSize.value - BUBBLE_MARGIN_Y);

export const isBubbleContextMenuOpen = ref(false);

export function toggleSettings() {
  isSettingsOpen.value = !isSettingsOpen.value;
}

export function openSettings() {
  isSettingsOpen.value = true;
}

export function closeSettings() {
  isSettingsOpen.value = false;
}
