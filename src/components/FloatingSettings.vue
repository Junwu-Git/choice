<template>
  <Teleport to="body">
    <div v-if="isSettingsOpen" class="choice-floating-overlay" @click.self="closeSettings">
      <div
        ref="dialogEl"
        class="choice-floating-dialog"
        :style="{ left: posX + 'px', top: posY + 'px' }"
      >
        <div class="choice-floating-header" ref="headerEl">
          <span class="choice-floating-title">
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            {{ t`行动选项` }}
          </span>
          <button class="choice-floating-close" @click="closeSettings">&times;</button>
        </div>

        <div class="choice-floating-body">
          <div class="choice-tabs">
            <button
              v-for="tab in tabs"
              :key="tab.id"
              class="choice-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              {{ tab.label }}
            </button>
          </div>

          <PoolEditor v-if="activeTab === 'pool'" />
          <PromptEditor v-else-if="activeTab === 'prompt'" />
          <ApiEditor v-else-if="activeTab === 'api'" />
          <BehaviorSettings v-else-if="activeTab === 'behavior'" />
          <WorldInfoEditor v-else-if="activeTab === 'worldinfo'" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import ApiEditor from '@/components/ApiEditor.vue';
import BehaviorSettings from '@/components/BehaviorSettings.vue';
import PoolEditor from '@/components/PoolEditor.vue';
import PromptEditor from '@/components/PromptEditor.vue';
import WorldInfoEditor from '@/components/WorldInfoEditor.vue';
import { isSettingsOpen, closeSettings } from '@/core/floating-state';

const activeTab = ref<'pool' | 'prompt' | 'api' | 'behavior' | 'worldinfo'>('pool');

const tabs = [
  { id: 'pool', label: t`条目池` },
  { id: 'prompt', label: t`提示词` },
  { id: 'api', label: t`API` },
  { id: 'behavior', label: t`行为` },
  { id: 'worldinfo', label: t`世界书` },
] as const;

const posX = useStorage('choice_floating_settings_x', (window.innerWidth - 680) / 2);
const posY = useStorage('choice_floating_settings_y', (window.innerHeight - 500) / 2);

const dialogEl = ref<HTMLElement | null>(null);
const headerEl = ref<HTMLElement | null>(null);

useDraggable(dialogEl, {
  handle: headerEl,
  initialValue: { x: posX.value, y: posY.value },
  onEnd: ({ x, y }) => {
    posX.value = Math.max(0, Math.min(x, window.innerWidth - 200));
    posY.value = Math.max(0, Math.min(y, window.innerHeight - 100));
  },
});

useEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape' && isSettingsOpen.value) {
    closeSettings();
  }
});
</script>

<style scoped>
.choice-floating-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
}

.choice-floating-dialog {
  position: fixed;
  z-index: 10001;
  width: 680px;
  max-width: 92vw;
  max-height: 85vh;
  background: #1e1e1e;
  border: 1px solid rgba(128, 128, 128, 0.45);
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
  padding: 10px 14px;
  background: rgba(50, 50, 50, 0.6);
  border-bottom: 1px solid rgba(128, 128, 128, 0.2);
  cursor: move;
  user-select: none;
}

.choice-floating-title {
  font-size: 14px;
  font-weight: bold;
  color: #e8e8e8;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice-floating-close {
  background: none;
  border: none;
  color: #a0a0a0;
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
}

.choice-floating-close:hover {
  color: #e8e8e8;
}

.choice-floating-body {
  overflow-y: auto;
  padding: 14px;
  flex: 1;
}

.choice-tabs {
  display: inline-flex;
  gap: 4px;
  margin-bottom: 10px;
}

.choice-tab {
  background: rgba(60, 60, 60, 0.4);
  color: #dcdcdc;
  border: 1px solid rgba(128, 128, 128, 0.35);
  border-radius: 6px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.choice-tab.active {
  background: #4a90d9;
  border-color: #4a90d9;
  color: #fff;
}
</style>