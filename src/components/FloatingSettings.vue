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
    posX.value = Math.max(0, Math.min(x, window.innerWidth - 200));
    posY.value = Math.max(0, Math.min(y, window.innerHeight - 100));
  },
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
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
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
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
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
  }
}

.choice-floating-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(74, 144, 217, 0.08), transparent);
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
  color: #fff;
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
