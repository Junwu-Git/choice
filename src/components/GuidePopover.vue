<template>
  <Teleport to="body">
    <div v-if="visible" class="choice-guide-popover-backdrop" @click.self="emit('close')"></div>
    <div v-if="visible" ref="popoverEl" class="choice-guide-popover" :style="popoverStyle">
      <div class="choice-guide-popover-header">
        <i :class="hint.icon"></i>
        <span class="choice-guide-popover-title">{{ hint.title }}</span>
        <button class="choice-guide-popover-close" @click="emit('close')">&times;</button>
      </div>
      <div class="choice-guide-popover-body choice-scrollbar">
        <p class="choice-guide-popover-brief">{{ hint.brief }}</p>
        <ul class="choice-guide-popover-points">
          <li v-for="(point, i) in hint.points" :key="i">{{ point }}</li>
        </ul>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import type { PageHint } from '@/core/guide-content';

const props = defineProps<{
  visible: boolean;
  anchorEl: HTMLElement | null;
  hint: PageHint;
}>();

const emit = defineEmits<{
  close: [];
}>();

const popoverEl = ref<HTMLElement | null>(null);
const popoverStyle = ref<Record<string, string>>({});

const calcPosition = () => {
  if (!props.anchorEl || !popoverEl.value) return;
  const anchorRect = props.anchorEl.getBoundingClientRect();
  const vh = window.innerHeight;
  // 窄屏（手机 WebView ~380px）下固定 360px 几乎贴满视口边缘，收进视口内
  const popoverWidth = Math.min(360, window.innerWidth - 16);
  const gap = 6;

  let left = anchorRect.left + anchorRect.width / 2 - popoverWidth / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - popoverWidth - 8));

  // 锚点在屏幕下部（❓按钮在面板底部/tab 栏溢出行）时，若下方空间放不下弹层的
  // 最低可用高度（180px），翻到锚点上方弹出——否则弹层会被 maxHeight 压成矮条内滚
  const height = popoverEl.value.offsetHeight;
  const spaceBelow = vh - anchorRect.bottom - gap - 16;
  const placeAbove = spaceBelow < Math.min(height, 180) && anchorRect.top > vh / 2;

  let top: number;
  let maxHeight: number;
  if (placeAbove) {
    maxHeight = anchorRect.top - gap - 16;
    top = Math.max(16, anchorRect.top - gap - Math.min(height, maxHeight));
  } else {
    top = anchorRect.bottom + gap;
    maxHeight = spaceBelow;
  }

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
  /* 同 dvh 回退：手机上 100vh 按布局视口取值，大于可视高度 */
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-popover);
}

.choice-guide-popover {
  position: fixed;
  z-index: var(--choice-z-popover);
  width: min(360px, calc(100vw - 16px));
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

.choice-guide-popover-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
  user-select: none;
}

.choice-guide-popover-header i {
  color: var(--choice-primary);
}

.choice-guide-popover-title {
  flex: 1;
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-text);
}

.choice-guide-popover-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-lg);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
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
  /* 触屏上内容拖到滚动边缘时禁止滚动链传导，避免把背后的酒馆页面一起拖走 */
  overscroll-behavior: contain;
  padding: var(--choice-space-3) var(--choice-space-4);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  line-height: 1.7;
}

.choice-guide-popover-brief {
  margin: 0 0 var(--choice-space-2);
  color: var(--choice-text);
}

.choice-guide-popover-points {
  margin: 0;
  padding-left: var(--choice-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-guide-popover-points li::marker {
  color: var(--choice-primary);
}
</style>
