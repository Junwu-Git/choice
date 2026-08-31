<template>
  <FloatingSettings />
  <FloatingBubble v-if="ui.floating_enabled" />
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import FloatingSettings from '@/components/FloatingSettings.vue';
import FloatingBubble from '@/components/FloatingBubble.vue';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);

// 贴边吸附的悬浮球会故意伸出屏幕边缘 20px（SNAP_OFFSET），fixed 元素的这块外伸
// 会把 <html> 撑出 20px 可滚区域——手机上聊天页能被横向拽动 20px，非常难受。
// overflow-x: clip 直接裁掉视口外内容（视觉无变化：视口外本来不可见），并禁止横向滚动；
// 老内核不认识 clip 时该行被忽略（优雅降级回既有的可滚状态），hidden 作为中间兜底
onMounted(() => {
  const html = document.documentElement;
  html.style.overflowX = 'hidden';
  html.style.overflowX = 'clip';
});
onUnmounted(() => {
  document.documentElement.style.overflowX = '';
});
</script>
