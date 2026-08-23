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
              v-for="tab in tabs"
              :key="tab.id"
              class="choice-tab"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <i :class="tab.icon"></i>
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
  { id: 'pool', label: t`条目池`, icon: 'fa-solid fa-layer-group' },
  { id: 'prompt', label: t`提示词`, icon: 'fa-solid fa-align-left' },
  { id: 'api', label: t`API`, icon: 'fa-solid fa-plug' },
  { id: 'behavior', label: t`行为`, icon: 'fa-solid fa-sliders' },
  { id: 'worldinfo', label: t`世界书`, icon: 'fa-solid fa-book' },
] as const;

const posX = useStorage('choice_floating_settings_x', (window.innerWidth - 680) / 2);
const posY = useStorage('choice_floating_settings_y', (window.innerHeight - 500) / 2);

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
  left: 0;
  top: 0;
  z-index: 10001;
  width: 680px;
  max-width: 92vw;
  max-height: 85vh;
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
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(74, 144, 217, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
  cursor: move;
  user-select: none;
}

.choice-grip-icon {
  color: var(--choice-text-muted);
  font-size: 12px;
  margin-right: 2px;
}

.choice-floating-title {
  font-size: 14px;
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice-floating-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--choice-transition), color var(--choice-transition);
}

.choice-floating-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
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
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-full);
  padding: 6px 14px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: background var(--choice-transition), color var(--choice-transition), box-shadow var(--choice-transition);
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
</style>