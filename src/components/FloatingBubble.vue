<template>
  <Teleport to="body">
    <div
      ref="bubbleEl"
      class="choice-floating-bubble"
      :class="{
        'choice-floating-bubble--dragging': isDragging,
        'choice-floating-bubble--generating': bubbleState === 'generating',
        'choice-floating-bubble--idle': bubbleState === 'idle' && !isDragging,
        'choice-floating-bubble--disabled': bubbleState === 'disabled',
        'choice-floating-bubble--snapped-left': isSnappedLeft && !isDragging,
        'choice-floating-bubble--snapped-right': isSnappedRight && !isDragging,
      }"
      :style="{
        '--choice-x': x + 'px',
        '--choice-y': y + 'px',
        transition: isDragging || isResizing ? 'none' : 'transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }"
      title="行动选项设置"
    >
      <div class="choice-bubble-inner-ring"></div>
      <i
        :class="
          isGenerating ? 'fa-solid fa-spinner fa-spin choice-bubble-icon' : 'fa-solid fa-code-branch choice-bubble-icon'
        "
      ></i>
      <i v-if="bubbleState === 'disabled'" class="fa-solid fa-exclamation choice-bubble-disabled-badge"></i>
    </div>
    <FloatingContextMenu v-if="isBubbleContextMenuOpen" />
  </Teleport>
</template>

<script setup lang="ts">
import { resolveCustomApi } from '@/core/generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { generatorState } from '@/core/generator';
import {
  openSettings,
  isBubbleContextMenuOpen,
  bubbleX,
  bubbleY,
} from '@/core/floating-state';
import FloatingContextMenu from '@/components/FloatingContextMenu.vue';

const BUBBLE_SIZE = 60;
const SNAP_EXPOSED = 40;
const SNAP_OFFSET = BUBBLE_SIZE - SNAP_EXPOSED;
const STORAGE_KEY_X = 'choice_floating_bubble_x';
const STORAGE_KEY_Y = 'choice_floating_bubble_y';

const isGenerating = computed(() => generatorState.loading);

const posX = useStorage(STORAGE_KEY_X, window.innerWidth - BUBBLE_SIZE - 16);
const posY = useStorage(STORAGE_KEY_Y, window.innerHeight - BUBBLE_SIZE - 80);

const isSnappedLeft = ref(false);
const isSnappedRight = ref(false);

const isDisabled = computed(() => {
  const gs = useGlobalSettingsStore();
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  const pool = usePoolSelectorStore().effectivePool;
  return !api || pool.length === 0;
});

const bubbleState = computed(() => {
  if (isDisabled.value) return 'disabled';
  if (isGenerating.value) return 'generating';
  if (isDragging.value) return 'dragging';
  return 'idle';
});

const bubbleEl = ref<HTMLElement | null>(null);

const handleClick = () => {
  isBubbleContextMenuOpen.value = false;
  bubbleX.value = posX.value;
  bubbleY.value = posY.value;
  openSettings();
};

const { x, y, isDragging } = useDraggable(bubbleEl, {
  initialValue: { x: posX.value, y: posY.value },
  onEnd: (finalPos, _e) => {
    const dx = Math.abs(finalPos.x - posX.value);
    const dy = Math.abs(finalPos.y - posY.value);

    const SNAP_THRESHOLD = 100;
    const centerX = finalPos.x + BUBBLE_SIZE / 2;
    const distToLeft = centerX;
    const distToRight = window.innerWidth - centerX;

    let snappedX: number;
    if (distToLeft < SNAP_THRESHOLD) {
      snappedX = -SNAP_OFFSET;
      isSnappedLeft.value = true;
      isSnappedRight.value = false;
    } else if (distToRight < SNAP_THRESHOLD) {
      snappedX = window.innerWidth - BUBBLE_SIZE + SNAP_OFFSET;
      isSnappedLeft.value = false;
      isSnappedRight.value = true;
    } else {
      snappedX = Math.max(0, Math.min(finalPos.x, window.innerWidth - BUBBLE_SIZE));
      isSnappedLeft.value = false;
      isSnappedRight.value = false;
    }

    posX.value = snappedX;
    posY.value = Math.max(0, Math.min(finalPos.y, window.innerHeight - BUBBLE_SIZE));
    x.value = snappedX;
    y.value = posY.value;

    bubbleX.value = snappedX;
    bubbleY.value = posY.value;

    if (dx < 3 && dy < 3) {
      if (!longPressTriggered) {
        handleClick();
      }
      longPressTriggered = false;
    }
  },
});

let longPressTimer: ReturnType<typeof setTimeout> | null = null;
let longPressTriggered = false;
let pointerDownPos = { x: 0, y: 0 };

const onPointerDown = (e: PointerEvent) => {
  longPressTriggered = false;
  pointerDownPos = { x: e.clientX, y: e.clientY };
  longPressTimer = setTimeout(() => {
    longPressTriggered = true;
    bubbleX.value = posX.value;
    bubbleY.value = posY.value;
    isBubbleContextMenuOpen.value = true;
  }, 500);
};

const onPointerMove = (e: PointerEvent) => {
  if (longPressTimer !== null) {
    const dx = Math.abs(e.clientX - pointerDownPos.x);
    const dy = Math.abs(e.clientY - pointerDownPos.y);
    if (dx > 5 || dy > 5) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }
};

const onPointerUp = () => {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
};

// 初始位置判断：如果存储的 x 靠左或靠右，初始化吸附状态
watch(
  posX,
  val => {
    const centerX = val + BUBBLE_SIZE / 2;
    isSnappedLeft.value = centerX < window.innerWidth / 2 && (val === -SNAP_OFFSET || val <= 0);
    isSnappedRight.value =
      centerX >= window.innerWidth / 2 && (val === window.innerWidth - BUBBLE_SIZE + SNAP_OFFSET || val >= window.innerWidth - BUBBLE_SIZE);
    bubbleX.value = val;
    bubbleY.value = posY.value;
  },
  { immediate: true },
);

const isResizing = ref(false);
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
const handleResize = () => {
  isResizing.value = true;
  let clampedX: number;
  if (isSnappedLeft.value) {
    clampedX = -SNAP_OFFSET;
  } else if (isSnappedRight.value) {
    clampedX = window.innerWidth - BUBBLE_SIZE + SNAP_OFFSET;
  } else {
    clampedX = Math.max(0, Math.min(posX.value, window.innerWidth - BUBBLE_SIZE));
  }
  const clampedY = Math.max(0, Math.min(posY.value, window.innerHeight - BUBBLE_SIZE));
  posX.value = clampedX;
  posY.value = clampedY;
  x.value = clampedX;
  y.value = clampedY;
  bubbleX.value = clampedX;
  bubbleY.value = clampedY;

  if (resizeTimer !== null) clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    resizeTimer = null;
    isResizing.value = false;
  }, 200);
};

onMounted(() => {
  bubbleEl.value?.addEventListener('pointerdown', onPointerDown);
  bubbleEl.value?.addEventListener('pointermove', onPointerMove);
  bubbleEl.value?.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', handleResize);
});
onUnmounted(() => {
  bubbleEl.value?.removeEventListener('pointerdown', onPointerDown);
  bubbleEl.value?.removeEventListener('pointermove', onPointerMove);
  bubbleEl.value?.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('resize', handleResize);
  if (resizeTimer !== null) clearTimeout(resizeTimer);
  if (longPressTimer !== null) clearTimeout(longPressTimer);
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
  font-size: var(--choice-text-xl);
  cursor: pointer;
  box-shadow: var(--choice-shadow-glow);
  touch-action: none;
  user-select: none;
  transform: translate3d(var(--choice-x), var(--choice-y), 0);
  overflow: hidden;
}

.choice-floating-bubble--idle {
  opacity: 0.75;
  animation: choice-bubble-breathe 8s ease-in-out infinite;
}

.choice-floating-bubble--generating {
  animation: choice-bubble-pulse 3s ease-in-out infinite;
}

.choice-floating-bubble--disabled {
  opacity: 0.5;
  filter: grayscale(30%);
}

.choice-floating-bubble--dragging {
  will-change: transform;
}

.choice-floating-bubble:hover {
  opacity: 1;
  box-shadow: 0 0 28px rgba(74, 144, 217, 0.45);
}

.choice-floating-bubble--snapped-left:hover {
  transform: translate3d(var(--choice-x), var(--choice-y), 0) translateX(20px) scale(1.08);
}

.choice-floating-bubble--snapped-right:hover {
  transform: translate3d(var(--choice-x), var(--choice-y), 0) translateX(-20px) scale(1.08);
}

.choice-floating-bubble:not(.choice-floating-bubble--snapped-left):not(.choice-floating-bubble--snapped-right):hover {
  transform: translate3d(var(--choice-x), var(--choice-y), 0) scale(1.08);
}

.choice-bubble-inner-ring {
  position: absolute;
  inset: 3px;
  border-radius: 50%;
  background: conic-gradient(from 0deg, var(--choice-primary), transparent 60%, var(--choice-primary));
  opacity: 0.3;
  pointer-events: none;
}

.choice-floating-bubble--idle .choice-bubble-inner-ring {
  animation: choice-bubble-ring-spin 20s linear infinite;
}

.choice-floating-bubble--generating .choice-bubble-inner-ring {
  animation: choice-bubble-ring-spin 1.5s linear infinite;
  opacity: 0.5;
}

.choice-floating-bubble--disabled .choice-bubble-inner-ring {
  animation: none;
  opacity: 0.15;
}

.choice-bubble-icon {
  position: relative;
  z-index: 1;
  transition: transform 0.3s ease;
}

.choice-floating-bubble--snapped-left .choice-bubble-icon {
  transform: translateX(10px);
}

.choice-floating-bubble--snapped-right .choice-bubble-icon {
  transform: translateX(-10px);
}

.choice-bubble-disabled-badge {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--choice-bg-element);
  border: 2px solid var(--choice-bg-panel);
  color: var(--choice-text-muted);
  font-size: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
}
</style>