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
import { setEntryVisible } from '@/core/entry-points';

const MENU_WIDTH = 140;
// 三项菜单估高（项高 ~40px + 上下 padding），仅用于底部视口钳制；与实际渲染高度略有
// 出入可接受——钳制目标是「打开设置/隐藏悬浮球」可达而非像素级贴边
const MENU_HEIGHT_EST = 132;

const menuEl = ref<HTMLElement | null>(null);

// 视口尺寸走 useWindowSize 响应式：computed 里裸读 window.innerWidth/innerHeight 不被
// 依赖追踪，旋转屏幕/缩放窗口后按旧视口钳制，弹层可部分出屏（FloatingOptions 同款修复）
const { width: winWidth, height: winHeight } = useWindowSize();

const menuX = computed(() => {
  const bx = bubbleX.value;
  // 菜单锚定实际球体边缘：移动端球 48px，桌面 60px，统一取 bubbleSize 单一来源
  const size = bubbleSize.value;
  const centerX = bx + size / 2;
  if (centerX + MENU_WIDTH > winWidth.value) {
    return bx - MENU_WIDTH - 8;
  }
  return bx + size + 8;
});

const menuY = computed(() => {
  // 底部视口钳制：气泡默认在屏幕下部，菜单可整体越出下缘致「打开设置/隐藏悬浮球」
  // 在移动端不可达；上缘 8px 下限防顶出
  const maxTop = Math.max(8, winHeight.value - MENU_HEIGHT_EST - 8);
  return Math.max(8, Math.min(bubbleY.value, maxTop));
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
  // 入口保底：悬浮球是最后一个开着入口时拒绝隐藏（toastr 提示在 setEntryVisible 内），
  // 菜单保持打开让用户理解原因；成功隐藏才收起菜单
  if (!setEntryVisible('floating', false)) {
    return;
  }
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
