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

        <hr class="sysHR" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import ApiEditor from '@/components/ApiEditor.vue';
import BehaviorSettings from '@/components/BehaviorSettings.vue';
import PoolEditor from '@/components/PoolEditor.vue';
import PromptEditor from '@/components/PromptEditor.vue';
import WorldInfoEditor from '@/components/WorldInfoEditor.vue';

const activeTab = ref<'pool' | 'prompt' | 'api' | 'behavior' | 'worldinfo'>('pool');

const tabs = [
  { id: 'pool', label: t`条目池`, icon: 'fa-solid fa-layer-group' },
  { id: 'prompt', label: t`提示词`, icon: 'fa-solid fa-align-left' },
  { id: 'api', label: t`API`, icon: 'fa-solid fa-plug' },
  { id: 'behavior', label: t`行为`, icon: 'fa-solid fa-sliders' },
  { id: 'worldinfo', label: t`世界书`, icon: 'fa-solid fa-book' },
] as const;
</script>

<style scoped>
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
</style>
