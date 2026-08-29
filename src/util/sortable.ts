// Sortable.create 的通用过滤选项：输入类元素内禁止触发拖拽。
// 不加 filter 时，在输入框里按住拖动选中文本会被 Sortable 当成拖拽起步，文本几乎选不上；
// preventOnFilter:false 保留浏览器默认的文本选择行为。
// 用法：Sortable.create(el, { ...draggableFilterOptions, ...其余选项 })
export const draggableFilterOptions = {
  filter: 'input, textarea, select',
  preventOnFilter: false,
} as const;
