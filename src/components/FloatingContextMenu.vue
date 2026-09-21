<template>
  <Teleport to="body">
    <div
      ref="menuEl"
      class="choice-floating-context"
      :style="{
        '--choice-menu-x': menuX + 'px',
        '--choice-menu-y': menuY + 'px',
      }"
    >
      <button class="choice-menu-item" @click.stop="onShowOptions">
        <i class="fa-solid fa-chess"></i>
        {{ t`查看行动选项` }}
      </button>
      <button class="choice-menu-item" @click.stop="onOpenSettings">
        <i class="fa-solid fa-gear"></i>
        {{ t`打开设置` }}
      </button>
      <button class="choice-menu-item" @click.stop="onHideBubble">
        <i class="fa-solid fa-eye-slash"></i>
        {{ t`隐藏悬浮球` }}
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import {
  openSettings,
  isBubbleContextMenuOpen,
  isBubbleOptionsOpen,
  bubbleX,
  bubbleY,
  bubbleSize,
} from '@/core/floating-state';
import { useGlobalSettingsStore } from '@/store/global-settings';

const MENU_WIDTH = 140;

const menuEl = ref<HTMLElement | null>(null);

const menuX = computed(() => {
  const bx = bubbleX.value;
  // 菜单锚定实际球体边缘：移动端球 48px，桌面 60px，统一取 bubbleSize 单一来源
  const size = bubbleSize.value;
  const centerX = bx + size / 2;
  if (centerX + MENU_WIDTH > window.innerWidth) {
    return bx - MENU_WIDTH - 8;
  }
  return bx + size + 8;
});

const menuY = computed(() => {
  return Math.max(8, bubbleY.value);
});

const onShowOptions = () => {
  isBubbleContextMenuOpen.value = false;
  isBubbleOptionsOpen.value = true;
};

const onOpenSettings = () => {
  isBubbleContextMenuOpen.value = false;
  openSettings();
};

const onHideBubble = () => {
  const gs = useGlobalSettingsStore();
  gs.settings.ui.floating_enabled = false;
  isBubbleContextMenuOpen.value = false;
};

const menuJustOpenedAt = ref(0);
let cleanupDoc: (() => void) | null = null;

onMounted(() => {
  menuJustOpenedAt.value = Date.now();
  const handler = (e: PointerEvent) => {
    if (Date.now() - menuJustOpenedAt.value < 300) return;
    const target = e.target as HTMLElement;
    if (menuEl.value?.contains(target)) return;
    if (target.closest('.choice-floating-bubble')) return;
    isBubbleContextMenuOpen.value = false;
  };
  document.addEventListener('pointerdown', handler);
  cleanupDoc = () => document.removeEventListener('pointerdown', handler);
});

onUnmounted(() => {
  cleanupDoc?.();
});
</script>

<style scoped>
.choice-floating-context {
  position: fixed;
  left: 0;
  top: 0;
  z-index: var(--choice-z-popover);
  transform: translate3d(var(--choice-menu-x), var(--choice-menu-y), 0);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-md);
  min-width: 140px;
  padding: var(--choice-space-1);
}

/* 菜单项本体样式走 global.css 的 .choice-menu-item 原子（图标+文字、hover 高亮、触屏抬升） */
</style>
