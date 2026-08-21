<template>
  <Teleport to="body">
    <div v-if="isMobile" ref="bubbleEl" class="choice-floating-bubble" :style="{ left: posX + 'px', top: posY + 'px' }">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { openSettings } from '@/core/floating-state';

const isMobile = useMediaQuery('(max-width: 768px)');

const BUBBLE_SIZE = 56;
const STORAGE_KEY_X = 'choice_floating_bubble_x';
const STORAGE_KEY_Y = 'choice_floating_bubble_y';

const posX = useStorage(STORAGE_KEY_X, window.innerWidth - BUBBLE_SIZE - 16);
const posY = useStorage(STORAGE_KEY_Y, window.innerHeight - BUBBLE_SIZE - 80);

const bubbleEl = ref<HTMLElement | null>(null);

let pointerStartX = 0;
let pointerStartY = 0;

const onPointerDown = (e: PointerEvent) => {
  pointerStartX = e.clientX;
  pointerStartY = e.clientY;
};

const onPointerUp = (e: PointerEvent) => {
  const dx = Math.abs(e.clientX - pointerStartX);
  const dy = Math.abs(e.clientY - pointerStartY);
  if (dx < 5 && dy < 5) {
    openSettings();
  }
};

useDraggable(bubbleEl, {
  initialValue: { x: posX.value, y: posY.value },
  onStart: (_pos, e) => {
    if (e instanceof PointerEvent) {
      onPointerDown(e);
    }
  },
  onEnd: ({ x, y }, e) => {
    posX.value = Math.max(0, Math.min(x, window.innerWidth - BUBBLE_SIZE));
    posY.value = Math.max(0, Math.min(y, window.innerHeight - BUBBLE_SIZE));
    if (e instanceof PointerEvent) {
      onPointerUp(e);
    }
  },
});
</script>

<style scoped>
.choice-floating-bubble {
  position: fixed;
  z-index: 9999;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(74, 144, 217, 0.8);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
  touch-action: none;
  user-select: none;
  transition: background 0.15s ease;
}

.choice-floating-bubble:hover {
  background: rgba(74, 144, 217, 0.95);
}
</style>
