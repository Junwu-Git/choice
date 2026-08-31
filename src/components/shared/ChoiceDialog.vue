<template>
  <Teleport to="body">
    <div v-if="open" class="choice-dialog-overlay" @click.self="$emit('close')">
      <div
        class="choice-dialog"
        :style="{ '--choice-dialog-width': width, '--choice-dialog-max-height': maxHeight }"
      >
        <div class="choice-dialog-header">
          <span class="choice-dialog-title">
            <i v-if="icon" :class="icon"></i>
            {{ title }}
          </span>
          <div class="choice-dialog-header-actions">
            <slot name="header-actions"></slot>
            <button class="choice-dialog-close" title="关闭" @click="$emit('close')">&times;</button>
          </div>
        </div>

        <div class="choice-dialog-body">
          <slot></slot>
        </div>

        <div v-if="$slots.footer" class="choice-dialog-footer">
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    icon?: string;
    width?: string;
    maxHeight?: string;
  }>(),
  {
    width: '560px',
    maxHeight: '85vh',
  },
);

defineEmits<{
  close: [];
}>();
</script>

<style scoped>
.choice-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--choice-z-dialog);
  background: var(--choice-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-dialog {
  /* width/maxHeight prop 经内联 CSS 变量注入：不能用内联 width/max-height——
     内联样式优先级高于任何规则，下面的窄屏媒体查询将永远无法覆盖 */
  width: var(--choice-dialog-width, 560px);
  max-width: 92vw;
  max-height: var(--choice-dialog-max-height, 85vh);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 窄视口（手机）下弹窗近全屏：信息密集弹窗按 560px 设计，92vw 也放不下几行内容，
   直接给足宽高减少内部横向挤压。max-width 必须同步放宽，否则基础规则的 92vw
   会把 width: 96vw 钳回去（实测 390px 视口下弹窗只有 92vw） */
@media (max-width: 480px) {
  .choice-dialog {
    width: 96vw;
    max-width: 96vw;
    max-height: 92vh;
  }
}

.choice-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  border-bottom: 1px solid var(--choice-border);
  flex-shrink: 0;
}

.choice-dialog-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-dialog-header-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-dialog-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-dialog-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

@media (pointer: coarse) {
  .choice-dialog-close {
    width: var(--choice-tap-min);
    height: var(--choice-tap-min);
  }
}

.choice-dialog-body {
  padding: var(--choice-space-4);
  overflow-y: auto;
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把弹窗背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
  flex: 1;
}

.choice-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-3) var(--choice-space-4);
  flex-shrink: 0;
}
</style>
