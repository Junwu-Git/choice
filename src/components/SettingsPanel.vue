<template>
  <div class="choice-extension-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ t`行动选项` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <div class="choice-tabs">
          <button
            v-for="tab in INLINE_TABS"
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

        <div class="choice-panel-body" :style="{ height: panelHeight + 'px' }">
          <PoolEditor v-if="activeTab === 'pool'" />
          <GenerationSettings v-else-if="activeTab === 'generation'" />
          <PromptEditor v-else-if="activeTab === 'prompt'" />
          <ApiEditor v-else-if="activeTab === 'api'" />
          <WorldInfoEditor v-else-if="activeTab === 'worldinfo'" />
          <FilterEditor v-else-if="activeTab === 'filter'" />
          <AppearanceSettings v-else-if="activeTab === 'appearance'" />
          <DebugSettings v-else-if="activeTab === 'debug'" />
        </div>

        <div class="choice-panel-resize" title="拖拽调整高度" @mousedown="onResizeStart">
          <div class="choice-panel-resize-grip"></div>
        </div>

        <hr class="sysHR" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import ApiEditor from '@/components/ApiEditor.vue';
import AppearanceSettings from '@/components/AppearanceSettings.vue';
import GenerationSettings from '@/components/GenerationSettings.vue';
import PoolEditor from '@/components/PoolEditor.vue';
import PromptEditor from '@/components/PromptEditor.vue';
import FilterEditor from '@/components/FilterEditor.vue';
import WorldInfoEditor from '@/components/WorldInfoEditor.vue';
import DebugSettings from '@/components/DebugSettings.vue';
import GuidePopover from '@/components/GuidePopover.vue';
import { INLINE_TABS, GUIDE_CONTENTS, type TabId } from '@/components/shared/tab-definitions';

const gs = useGlobalSettingsStore();
const activeTab = ref<TabId>('pool');
const showGuide = ref(false);
const guideBtn = ref<HTMLElement | null>(null);

const currentGuide = computed(() => GUIDE_CONTENTS[activeTab.value]);

const panelHeight = computed({
  get: () => gs.settings.ui.panel_height,
  set: (v: number) => {
    gs.settings.ui.panel_height = v;
  },
});

let resizeStartY = 0;
let resizeStartH = 0;

const onResizeStart = (e: MouseEvent) => {
  e.preventDefault();
  resizeStartY = e.clientY;
  resizeStartH = panelHeight.value;
  document.addEventListener('mousemove', onResizeMove);
  document.addEventListener('mouseup', onResizeEnd);
};

const onResizeMove = (e: MouseEvent) => {
  const dy = e.clientY - resizeStartY;
  const h = Math.max(300, Math.min(800, resizeStartH + dy));
  panelHeight.value = h;
};

const onResizeEnd = () => {
  document.removeEventListener('mousemove', onResizeMove);
  document.removeEventListener('mouseup', onResizeEnd);
};
</script>

<style scoped>
.choice-tabs {
  display: inline-flex;
  gap: var(--choice-space-1);
  margin-bottom: 10px;
  overflow-x: auto;
  scrollbar-width: none;
}

.choice-tabs::-webkit-scrollbar {
  display: none;
}

.choice-tab {
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-2) var(--choice-space-4);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
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

.choice-panel-body {
  overflow-y: auto;
}

.choice-panel-resize {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 8px;
  cursor: ns-resize;
  margin: 4px 0;
  user-select: none;
}

.choice-panel-resize:hover .choice-panel-resize-grip {
  background: var(--choice-primary);
}

.choice-panel-resize-grip {
  width: 40px;
  height: 3px;
  border-radius: 2px;
  background: var(--choice-border-strong);
  transition: background var(--choice-transition);
}
</style>
