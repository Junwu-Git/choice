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
      <button class="choice-floating-context-item" @click.stop="onOpenSettings">
        <i class="fa-solid fa-gear"></i>
        {{ t`打开设置` }}
      </button>
      <button class="choice-floating-context-item" @click.stop="onHideBubble">
        <i class="fa-solid fa-eye-slash"></i>
        {{ t`隐藏悬浮球` }}
      </button>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { openSettings, isBubbleContextMenuOpen, bubbleX, bubbleY, bubbleSize } from '@/core/floating-state';
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

.choice-floating-context-item {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  width: 100%;
  padding: var(--choice-space-2) var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  background: none;
  border: none;
  border-radius: var(--choice-radius-sm);
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--choice-transition);
}

.choice-floating-context-item:hover {
  background: var(--choice-bg-hover);
}

.choice-floating-context-item i {
  width: 16px;
  color: var(--choice-text-muted);
  text-align: center;
}
</style>
