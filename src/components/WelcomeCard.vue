<template>
  <Teleport to="body">
    <div v-if="visible" ref="cardEl" class="choice-welcome-card" :style="cardStyle">
      <button class="choice-welcome-close" :title="t`关闭`" @click="dismiss">&times;</button>
      <div class="choice-welcome-header">
        <i class="fa-solid fa-chess"></i>
        <span>{{ t`欢迎使用「行动选项」` }}</span>
      </div>
      <p class="choice-welcome-intro">
        {{
          t`在主线对话之外单独调用 API，按当前剧情生成一组行动选项；点选一条即可进入输入框，不占用楼层、不打断对话节奏。`
        }}
      </p>
      <ol class="choice-welcome-steps">
        <li>
          <i class="fa-solid fa-plug"></i>
          <span>{{ t`配置 API（唯一必做的一步）` }}</span>
        </li>
        <li>
          <i class="fa-solid fa-bolt"></i>
          <span>{{ t`AI 回复后自动生成选项` }}</span>
        </li>
        <li>
          <i class="fa-solid fa-paper-plane"></i>
          <span>{{ t`点选一条，直接使用` }}</span>
        </li>
      </ol>
      <div class="choice-welcome-actions">
        <button class="menu_button menu_button_default" @click="start">
          {{ t`配置 API，开始使用` }}
        </button>
        <button class="menu_button" @click="dismiss">{{ t`稍后再说` }}</button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import { bubbleX, bubbleY } from '@/core/floating-state';
import { onboardingVisible, onboardingMenuVisible, openApiOnboarding } from '@/core/onboarding';

const gs = useGlobalSettingsStore();

const visible = ref(false);
const cardEl = ref<HTMLElement | null>(null);
const cardStyle = ref<Record<string, string>>({});

/**
 * 首启欢迎卡的定位：锚定悬浮球（bubbleX/Y 是球的左上逻辑坐标），卡片右缘大致对齐
 * 球右缘、优先放球上方（球默认停在右下角，上方空间恒定充足）；悬浮球被隐藏时
 * 退化为屏幕右下角。球被拖到屏幕上部时下方空间更大则改放下方
 */
const computePosition = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(320, vw - 16);
  const h = cardEl.value?.offsetHeight ?? 240;
  // BUBBLE_SIZE 随触屏 48/60 两档，这里取大值：多留的间隙比卡片叠进球里好
  const bubbleSize = 60;
  const gap = 12;
  const anchored = gs.settings.ui.floating_enabled;
  const bx = anchored ? bubbleX.value : vw - bubbleSize - 16;
  const by = anchored ? bubbleY.value : vh - bubbleSize - 80;
  const left = Math.max(8, Math.min(bx + bubbleSize - w, vw - w - 8));
  const spaceAbove = by - gap;
  const spaceBelow = vh - (by + bubbleSize) - gap;
  const top =
    spaceAbove >= Math.min(h, 200) || spaceAbove >= spaceBelow ? Math.max(8, by - gap - h) : by + bubbleSize + gap;
  cardStyle.value = { left: `${left}px`, top: `${top}px`, width: `${w}px` };
};

const dismiss = () => {
  visible.value = false;
};

const start = () => {
  visible.value = false;
  // 直达 quick-start 的填 API 步（跳过欢迎页——欢迎卡本身已经把插件介绍完了）
  openApiOnboarding();
};

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && visible.value) dismiss();
});

useEventListener('resize', () => {
  if (visible.value) computePosition();
});

onMounted(() => {
  // 延迟 ~3s：等悬浮球/选项面板挂载稳定、酒馆首屏渲染完，避免加载瞬间弹卡被
  // 布局变化带着跳；打开设置面板会触发 maybeAutoOpenOnboarding（向导），那时
  // 欢迎卡不再叠加——onboarding_done 已被向导置位，下面的检查会拦住
  window.setTimeout(() => {
    if (gs.settings.ui.onboarding_done) return;
    if (onboardingVisible.value || onboardingMenuVisible.value) return;
    // 弹出瞬间即置 done（与 maybeAutoOpenOnboarding 同一哲学）：中途刷新/杀进程
    // 也视为看过，避免每次进酒馆都被欢迎卡拦一道；重看走 🎓 功能课堂
    gs.settings.ui.onboarding_done = true;
    visible.value = true;
    nextTick(computePosition);
  }, 3000);
});

watch(visible, v => {
  if (v) nextTick(computePosition);
});
</script>

<style scoped>
.choice-welcome-card {
  position: fixed;
  z-index: var(--choice-z-popover);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  padding: var(--choice-space-3) var(--choice-space-4);
  pointer-events: auto;
}

.choice-welcome-close {
  position: absolute;
  top: var(--choice-space-2);
  right: var(--choice-space-2);
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

.choice-welcome-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-welcome-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  margin-bottom: var(--choice-space-2);
}

.choice-welcome-header i {
  color: var(--choice-primary);
}

.choice-welcome-intro {
  margin: 0 0 var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  line-height: 1.7;
}

.choice-welcome-steps {
  margin: 0 0 var(--choice-space-3);
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  counter-reset: welcome-step;
}

.choice-welcome-steps li {
  counter-increment: welcome-step;
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.choice-welcome-steps li::before {
  content: counter(welcome-step);
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(var(--choice-primary-rgb), 0.12);
  color: var(--choice-primary);
  font-size: var(--choice-text-xs);
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-welcome-steps li i {
  color: var(--choice-primary);
  width: 14px;
  text-align: center;
}

.choice-welcome-actions {
  display: flex;
  gap: var(--choice-space-2);
  justify-content: flex-end;
}
</style>
