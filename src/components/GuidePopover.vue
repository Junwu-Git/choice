<template>
  <Teleport to="body">
    <div v-if="visible" class="choice-guide-popover-backdrop" @click.self="emit('close')"></div>
    <div
      v-if="visible"
      ref="popoverEl"
      class="choice-guide-popover"
      :style="popoverStyle"
    >
      <div class="choice-guide-popover-header">
        <i :class="icon"></i>
        <span class="choice-guide-popover-title">{{ title }}</span>
        <button class="choice-guide-popover-close" @click="emit('close')">&times;</button>
      </div>
      <div class="choice-guide-popover-body choice-scrollbar">
        <slot />
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const props = defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  icon?: string;
  title?: string;
}>();

const emit = defineEmits<{
  close: [];
}>();

const popoverEl = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const calcPosition = () => {
  if (!props.anchorEl || !popoverEl.value) return;
  const anchorRect = props.anchorEl.getBoundingClientRect();
  const popoverWidth = 360;
  const gap = 6;

  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

  const top = anchorRect.bottom + gap;
  const maxHeight = window.innerHeight - top - 16;

  popoverStyle.value = {
    left: `${left}px`,
    top: `${top}px`,
    maxHeight: `${Math.max(120, maxHeight)}px`,
  };
};

watch(
  () => props.visible,
  v => {
    if (v) {
      nextTick(calcPosition);
    }
  },
);

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.visible) {
    emit('close');
  }
});
</script>

<style scoped>
.choice-guide-popover-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 10009;
}

.choice-guide-popover {
  position: fixed;
  z-index: 10010;
  width: 360px;
  background: var(--choice-bg-panel);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-guide-popover-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(180deg, rgba(74, 144, 217, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
  user-select: none;
}

.choice-guide-popover-title {
  flex: 1;
  font-size: 13px;
  font-weight: bold;
  color: var(--choice-text);
}

.choice-guide-popover-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: 18px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-guide-popover-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-guide-popover-body {
  overflow-y: auto;
  padding: 10px 14px 12px;
  font-size: 12px;
  color: var(--choice-text-secondary);
  line-height: 1.7;
}

.choice-guide-popover-body :deep(p) {
  margin: 0 0 6px;
}

.choice-guide-popover-body :deep(ol) {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
}

.choice-guide-popover-body :deep(strong) {
  color: var(--choice-text);
}

.choice-guide-popover-body :deep(code) {
  background: var(--choice-bg-element);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 11px;
}
</style>