<template>
  <Teleport to="body">
    <div v-if="open" class="choice-dialog-overlay" @click.self="onOverlayClick()">
      <div
        ref="dialogEl"
        class="choice-dialog"
        tabindex="-1"
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
import { isTopDialog, lockBodyScroll, popDialog, pushDialog, unlockBodyScroll } from '@/components/shared/dialog-stack';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    icon?: string;
    width?: string;
    maxHeight?: string;
    /** false：禁用 Esc/遮罩点击关闭（× 按钮仍可用）。默认 true。 */
    dismissible?: boolean;
  }>(),
  {
    icon: '',
    width: '560px',
    maxHeight: '85vh',
    dismissible: true,
  },
);

const emit = defineEmits<{
  close: [];
}>();

const dialogEl = ref<HTMLElement | null>(null);
const stackId = Symbol();

// Esc 关闭：document 级监听（焦点可能在弹窗内输入框，容器级 keydown 不可靠）；
// 多弹窗叠开只关最上层，防一键连环关闭
const onEscKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.dismissible && isTopDialog(stackId)) emit('close');
};

// 打开：进栈 + 锁背景滚动（计数制，见 dialog-stack.ts）+ 焦点移入；关闭：出栈 + 解锁
watch(
  () => props.open,
  open => {
    if (open) {
      pushDialog(stackId);
      document.addEventListener('keydown', onEscKey);
      lockBodyScroll();
      // 焦点移入弹窗：Esc 立即可用、Tab 从弹窗内开始循环
      nextTick(() => dialogEl.value?.focus());
    } else {
      popDialog(stackId);
      document.removeEventListener('keydown', onEscKey);
      unlockBodyScroll();
    }
  },
  // immediate：组件以 open=true 初始挂载（父级无 v-if 前置）时也走同一开启路径
  { immediate: true },
);

onUnmounted(() => {
  // 打开态被父级直接卸载（父 v-if）：还原锁与监听，防背景永久不可滚
  popDialog(stackId);
  document.removeEventListener('keydown', onEscKey);
  unlockBodyScroll();
});

const onOverlayClick = () => {
  if (props.dismissible) emit('close');
};
</script>

<style scoped>
.choice-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  /* 同 dvh 回退：手机上 100vh 按布局视口取值，大于可视高度 */
  height: 100vh;
  height: 100dvh;
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
  /* dvh 兜底：min() 取请求上限与可视高度中较小者，防止手机上底部出屏；
     老内核不认识 dvh 时本行非法，回落上一行 */
  max-height: min(var(--choice-dialog-max-height, 85vh), 100dvh);
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

/* 容器仅作 Esc/Tab 焦点落点（tabindex=-1 程序化聚焦），不显示焦点环 */
.choice-dialog:focus {
  outline: none;
}

/* 窄视口（手机）下弹窗近全屏：信息密集弹窗按 560px 设计，92vw 也放不下几行内容，
   直接给足宽高减少内部横向挤压。max-width 必须同步放宽，否则基础规则的 92vw
   会把 width: 96vw 钳回去（实测 390px 视口下弹窗只有 92vw） */
@media (max-width: 480px) {
  .choice-dialog {
    width: 96vw;
    max-width: 96vw;
    /* 同 dvh 回退 */
    max-height: 92vh;
    max-height: 92dvh;
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
