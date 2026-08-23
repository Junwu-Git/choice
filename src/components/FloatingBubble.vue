<template>
  <Teleport to="body">
    <div
      ref="bubbleEl"
      class="choice-floating-bubble"
      :class="{ 'choice-floating-bubble--dragging': isDragging }"
      :style="{
        '--choice-x': x + 'px',
        '--choice-y': y + 'px',
        transition: isDragging ? 'none' : 'transform 0.3s ease-out',
      }"
      title="行动选项设置"
    >
      <i class="fa-solid fa-list-check"></i>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { openSettings } from '@/core/floating-state';

const BUBBLE_SIZE = 60;
const STORAGE_KEY_X = 'choice_floating_bubble_x';
const STORAGE_KEY_Y = 'choice_floating_bubble_y';

const posX = useStorage(STORAGE_KEY_X, window.innerWidth - BUBBLE_SIZE - 16);
const posY = useStorage(STORAGE_KEY_Y, window.innerHeight - BUBBLE_SIZE - 80);

const bubbleEl = ref<HTMLElement | null>(null);

const { x, y, isDragging } = useDraggable(bubbleEl, {
  initialValue: { x: posX.value, y: posY.value },
  onEnd: ({ x, y }, e) => {
    // 用总位移判断点击/拖拽，而非 movementX/movementY（后者仅表示最后一段增量）
    const dx = Math.abs(x - posX.value);
    const dy = Math.abs(y - posY.value);
    posX.value = Math.max(0, Math.min(x, window.innerWidth - BUBBLE_SIZE));
    posY.value = Math.max(0, Math.min(y, window.innerHeight - BUBBLE_SIZE));
    if (dx < 3 && dy < 3) {
      openSettings();
    }
  },
});
</script>

<style scoped>
.choice-floating-bubble {
  position: fixed;
  left: 0;
  top: 0;
  z-index: 9999;
  width: 60px;
  height: 60px;
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-panel);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid var(--choice-border);
  color: var(--choice-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  cursor: pointer;
  box-shadow: var(--choice-shadow-glow);
  touch-action: none;
  user-select: none;
  transform: translate3d(var(--choice-x), var(--choice-y), 0);
  animation: choice-bubble-pulse 3s ease-in-out infinite;
}

.choice-floating-bubble--dragging {
  will-change: transform;
}

.choice-floating-bubble:hover {
  transform: translate3d(var(--choice-x), var(--choice-y), 0) scale(1.08);
  box-shadow: 0 0 28px rgba(74, 144, 217, 0.45);
}
</style>