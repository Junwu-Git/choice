<template>
  <span class="choice-drag-handle" :title="title" :aria-label="title ?? '拖动排序'">
    <i class="fa-solid fa-grip-vertical"></i>
  </span>
</template>

<script setup lang="ts">
// 拖拽把手：所有可排序列表的唯一拖拽起点（配合 draggableFilterOptions 的 handle 选择器）。
// 为什么用把手而不用长按整行拖拽：手机上"按住 120ms 后移动"仍是隐形手势——用户不知道要按住、
// 手指停留超时的场景会误拖、还与系统级长按文本选择抢事件；把手图标把"这里能拖"变得可见，
// 且把手之外的任何区域滑动都绝不触发拖拽，滚动与拖拽零冲突。
defineProps<{
  /** 悬停提示，按场景传 t`拖动排序` / t`拖动排序/换组` 等 */
  title?: string;
}>();
</script>

<style scoped>
.choice-drag-handle {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  width: 32px;
  /* 不设 min-height：行高由行自身内容决定（否则把手会把每行强制撑到 40px+，
     条目多时一屏能看到的行数明显变少）。align-self:stretch 保证把手的
     纵向命中区铺满整行，常规行高 ≥32px 时触控已可用 */
  color: var(--choice-text-muted);
  cursor: grab;
  user-select: none;
  /* 不设 touch-action:none：触屏上碰把手立即滑动的手势交给浏览器原生滚动（pointercancel
     会取消 Sortable 的延迟拖拽）；若禁掉原生手势，"碰到把手又想滚动"会变成既不滚也不拖的死触摸。
     按住不动 120ms（draggableFilterOptions.delay）才真正进入拖拽 */
  transition: color var(--choice-transition);
}

.choice-drag-handle:hover {
  color: var(--choice-text);
}

.choice-drag-handle:active {
  color: var(--choice-primary);
  cursor: grabbing;
}

/* 手机上把手是主要拖拽途径，命中区加宽到完整触控目标；桌面维持紧凑不挤占行宽 */
@media (pointer: coarse) {
  .choice-drag-handle {
    width: var(--choice-tap-min);
  }
}
</style>
