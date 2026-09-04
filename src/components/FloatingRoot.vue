<template>
  <FloatingSettings />
  <FloatingBubble v-if="ui.floating_enabled" />
  <!-- 新手引导全局单实例：行内面板常驻挂载，若在面板内各挂一份会让共享 ref
       驱动两份 Teleport 弹窗/遮罩同时渲染 -->
  <OnboardingWizard />
  <!-- 首启欢迎卡：同样是全局单例（锚定悬浮球坐标，一次只该有一张） -->
  <WelcomeCard />
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import FloatingSettings from '@/components/FloatingSettings.vue';
import FloatingBubble from '@/components/FloatingBubble.vue';
import OnboardingWizard from '@/components/OnboardingWizard.vue';
import WelcomeCard from '@/components/WelcomeCard.vue';

const store = useGlobalSettingsStore();
const ui = computed(() => store.settings.ui);

// 贴边吸附的悬浮球会故意伸出屏幕边缘 20px（SNAP_OFFSET），fixed 元素的这块外伸
// 会把 <html> 撑出 20px 可滚区域——手机上聊天页能被横向拽动 20px，非常难受。
// overflow-x: clip 直接裁掉视口外内容（视觉无变化：视口外本来不可见），并禁止横向滚动；
// 老内核不认识 clip 时该行被忽略（优雅降级回既有的可滚状态），hidden 作为中间兜底。
// 必须同时显式补 overflow-y: hidden：CSS 视口传播规则只认根元素 overflow 为 visible 时
// body 的 overflow:hidden（ST style.css 的 body 规则）才传播到视口；只改 x 轴会让根元素
// 脱离 visible，视口 y 按规范回落为 auto → 整个文档变成可竖向滚动，安卓上滑会把
// ST 主界面整体拖走、底部露大片空白。禁止"简化"回单轴 overflow-x。
onMounted(() => {
  const html = document.documentElement;
  html.style.overflowY = 'hidden';
  html.style.overflowX = 'hidden';
  html.style.overflowX = 'clip';
});
onUnmounted(() => {
  const html = document.documentElement;
  html.style.overflowX = '';
  html.style.overflowY = '';
});
</script>
