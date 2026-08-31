// Sortable.create 的通用过滤选项：输入类元素内禁止触发拖拽。
// 不加 filter 时，在输入框里按住拖动选中文本会被 Sortable 当成拖拽起步，文本几乎选不上；
// preventOnFilter:false 保留浏览器默认的文本选择行为。
// 触屏防误拖：拖拽一律从行首 DragHandle 把手发起（DRAG_HANDLE_SELECTOR，见各调用点的 handle 选项），
// 把手之外的任何区域上下滑动都绝不拖起条目，滚动与拖拽零冲突；
// delay/touchStartThreshold 只兜底"误碰把手"——触屏需按住 120ms 且位移 ≤10px 才真正进入拖拽，
// delayOnTouchOnly 保证桌面鼠标零延迟（按下即拖），两端体验互不干扰。
// 用法：Sortable.create(el, { ...draggableFilterOptions, handle: DRAG_HANDLE_SELECTOR, ...其余选项 })
export const DRAG_HANDLE_SELECTOR = '.choice-drag-handle';

// 分组级把手（拖整张分组卡片换位/换区）：与条目级把手区分选择器。
// 嵌套 Sortable（分组列表 ⊃ 条目列表）若共用同一 handle 选择器，SortableJS 的 handle 匹配
// 是 closest 语义，条目把手同样命中分组层的 handle 判定；虽然内层先建 dragEl 会让外层 bail
// （_onTapStart 的 if (dragEl) return 守卫），但显式分层选择器不依赖该时序守卫，嵌套语义一目了然
export const DRAG_HANDLE_GROUP_SELECTOR = '.choice-drag-handle--group';

export const draggableFilterOptions = {
  filter: 'input, textarea, select',
  preventOnFilter: false,
  delay: 120,
  delayOnTouchOnly: true,
  touchStartThreshold: 10,
} as const;
