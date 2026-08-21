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
  { id: 'pool', label: t`条目池` },
  { id: 'prompt', label: t`提示词` },
  { id: 'api', label: t`API` },
  { id: 'behavior', label: t`行为` },
  { id: 'worldinfo', label: t`世界书` },
] as const;
</script>

<style scoped>
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
}

.choice-tab.active {
  background: #4a90d9;
  border-color: #4a90d9;
  color: #fff;
}
</style>
