<template>
  <Teleport to="body">
    <div v-if="isSettingsOpen" class="choice-floating-overlay" @click.self="closeSettings">
      <div
        ref="dialogEl"
        class="choice-floating-dialog"
        :class="{ 'choice-floating-dialog--dragging': isDragging }"
        :style="{
          '--choice-x': x + 'px',
          '--choice-y': y + 'px',
          width: dialogWidth + 'px',
          height: dialogHeight + 'px',
          transition: isDragging ? 'none' : 'transform 0.3s ease-out',
        }"
      >
        <div class="choice-floating-header" ref="headerEl">
          <span class="choice-floating-title">
            <i class="fa-solid fa-grip-vertical choice-grip-icon"></i>
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            {{ t`行动选项` }}
          </span>
          <button class="choice-floating-close" @click="closeSettings">&times;</button>
        </div>

        <div class="choice-floating-body choice-scrollbar">
          <div class="choice-tabs">
            <button
              v-for="tab in FLOATING_TABS"
              :key="tab.id"
              class="choice-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <i :class="tab.icon"></i>
              {{ tab.label }}
            </button>
            <button
              ref="guideBtn"
              class="choice-tab choice-guide-btn"
              :title="t`页面指引`"
              @click="showGuide = !showGuide"
            >
              <i class="fa-solid fa-circle-question"></i>
            </button>
          </div>

          <GuidePopover
            :visible="showGuide"
            :anchor-el="guideBtn"
            :icon="currentGuide.icon"
            :title="currentGuide.title"
            @close="showGuide = false"
          >
            <div v-html="currentGuide.html"></div>
          </GuidePopover>

          <PoolEditor v-if="activeTab === 'pool'" />
          <GenerationSettings v-else-if="activeTab === 'generation'" />
          <PromptEditor v-else-if="activeTab === 'prompt'" />
          <ApiEditor v-else-if="activeTab === 'api'" />
          <WorldInfoEditor v-else-if="activeTab === 'worldinfo'" />
          <FilterEditor v-else-if="activeTab === 'filter'" />
          <AppearanceSettings v-else-if="activeTab === 'appearance'" />
          <DebugSettings v-else-if="activeTab === 'debug'" />
        </div>

        <div class="choice-floating-resize" @mousedown="onResizeStart">
          <div class="choice-floating-resize-grip"></div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import ApiEditor from '@/components/ApiEditor.vue';
import AppearanceSettings from '@/components/AppearanceSettings.vue';
import GenerationSettings from '@/components/GenerationSettings.vue';
import PoolEditor from '@/components/PoolEditor.vue';
import PromptEditor from '@/components/PromptEditor.vue';
import FilterEditor from '@/components/FilterEditor.vue';
import WorldInfoEditor from '@/components/WorldInfoEditor.vue';
import GuidePopover from '@/components/GuidePopover.vue';
import DebugSettings from '@/components/DebugSettings.vue';
import { FLOATING_TABS, GUIDE_CONTENTS, type TabId } from '@/components/shared/tab-definitions';
import { isSettingsOpen, closeSettings } from '@/core/floating-state';

const activeTab = ref<TabId>('pool');
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const currentGuide = computed(() => GUIDE_CONTENTS[activeTab.value]);

const posX = useStorage('choice_floating_settings_x', (window.innerWidth - 680) / 2);
const posY = useStorage('choice_floating_settings_y', (window.innerHeight - 500) / 2);
const dialogWidth = useStorage('choice_floating_settings_w', 680);
const dialogHeight = useStorage('choice_floating_settings_h', 500);

const dialogEl = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);

const { x, y, isDragging } = useDraggable(dialogEl, {
  handle: headerEl,
  initialValue: { x: posX.value, y: posY.value },
  onEnd: ({ x, y }) => {
    posX.value = clampPanelX(x);
    posY.value = Math.max(0, Math.min(y, window.innerHeight - 100));
  },
});

// 夹取边界按面板实际宽度计算：留 40px 保证面板主体可见，
// 否则窄窗口下 innerWidth-200 的旧公式会让 680px 宽的面板大半出界
function clampPanelX(x: number): number {
  const maxX = Math.max(0, window.innerWidth - dialogWidth.value + 40);
  return Math.max(0, Math.min(x, maxX));
}

// 面板坐标持久化在 localStorage，窗口缩小/换分辨率后可能整体落在视口外，
// 表现为"点击气泡后主界面不出现"。每次打开时先夹回可视区，并同步给 useDraggable
// （storage → posX 变化不会自动联动内部 x/y，必须手动写回）。
watch(isSettingsOpen, open => {
  if (!open) return;
  const nx = clampPanelX(posX.value);
  const ny = Math.max(0, Math.min(posY.value, window.innerHeight - 100));
  if (nx !== x.value) x.value = nx;
  if (ny !== y.value) y.value = ny;
  posX.value = nx;
  posY.value = ny;
});

let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartW = 0;
let resizeStartH = 0;

const onResizeStart = (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  resizeStartX = e.clientX;
  resizeStartY = e.clientY;
  resizeStartW = dialogWidth.value;
  resizeStartH = dialogHeight.value;
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
};

const onResizeMove = (e: MouseEvent) => {
  const dx = e.clientX - resizeStartX;
  const dy = e.clientY - resizeStartY;
  dialogWidth.value = Math.max(400, Math.min(window.innerWidth - 20, resizeStartW + dx));
  dialogHeight.value = Math.max(300, Math.min(window.innerHeight - 20, resizeStartH + dy));
};

const onResizeEnd = () => {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
};

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isSettingsOpen.value) {
    closeSettings();
  }
});
</script>

<style scoped>
.choice-floating-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--choice-z-floating);
  background: var(--choice-overlay);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  transition: opacity 0.25s ease-out;
}

.choice-floating-dialog {
  position: fixed;
  left: 0;
  top: 0;
  z-index: calc(var(--choice-z-floating) + 1);
  min-width: 400px;
  min-height: 300px;
  max-width: calc(100vw - 20px);
  max-height: calc(100vh - 20px);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translate3d(var(--choice-x), var(--choice-y), 0);
}

.choice-floating-dialog--dragging {
  will-change: transform;
}

@media (max-width: 720px) {
  .choice-floating-dialog {
    width: 96vw;
    /* 行内 width（localStorage 持久化的 dialogWidth）优先级高于上面的 width 规则；
       且 min-width(400px) 与 max-width(100vw-20px) 在 <420px 视口冲突时 CSS 规定 min-width 胜出，
       两者叠加会导致窄屏（手机 WebView ~380px）下面板横向出界——必须放开 min-width，
       让 max-width 成为唯一收窄依据 */
    min-width: 0;
  }
}

.choice-floating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
  cursor: move;
  user-select: none;
}

.choice-grip-icon {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  margin-right: 2px;
}

.choice-floating-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-floating-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-floating-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-floating-body {
  overflow-y: auto;
  padding: var(--choice-space-4);
  flex: 1;
}

.choice-tabs {
  display: inline-flex;
  gap: var(--choice-space-1);
  margin-bottom: var(--choice-space-3);
}

.choice-tab {
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-2) var(--choice-space-4);
  font-size: var(--choice-text-xs);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  transition:
    background var(--choice-transition),
    color var(--choice-transition),
    box-shadow var(--choice-transition);
}

.choice-tab:hover {
  color: var(--choice-text);
  background: var(--choice-bg-hover);
}

.choice-tab.active {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
  color: var(--choice-text-on-primary);
  box-shadow: 0 0 10px var(--choice-primary-glow);
}

.choice-guide-btn {
  width: 32px;
  justify-content: center;
  padding: var(--choice-space-2) 0;
  font-size: var(--choice-text-base);
}

.choice-floating-resize {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 22px;
  height: 22px;
  cursor: nwse-resize;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding: 0 5px 5px 0;
  user-select: none;
  z-index: 1;
}

.choice-floating-resize:hover .choice-floating-resize-grip {
  border-bottom-color: var(--choice-primary);
}

.choice-floating-resize-grip {
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-bottom: 8px solid var(--choice-border-strong);
  transition: border-bottom-color var(--choice-transition);
}
</style>
