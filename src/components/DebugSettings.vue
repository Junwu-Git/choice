<template>
  <div class="choice-debug-settings">
    <div class="choice-debug-section">
      <h4>{{ t`版本信息` }}</h4>
      <p>Schema: {{ globalStore.settings.schema_version }}</p>
      <p>Prompt Schema: {{ globalStore.settings.prompt_rules.schema_version }}</p>
      <p>{{ t`模块数` }}: {{ globalStore.settings.prompt_rules.modules.length }}</p>
      <p>{{ t`条目池` }}: {{ globalStore.settings.master_pool.length }} {{ t`条` }}</p>
      <p>{{ t`配置数` }}: {{ globalStore.settings.configs.length }}</p>
      <p>{{ t`API 数` }}: {{ globalStore.settings.apis.length }}</p>
    </div>
    <div class="choice-debug-section">
      <h4>{{ t`上次生成的消息` }}</h4>
      <div v-if="!lastBuildMessages" class="choice-empty-hint">{{ t`尚未生成过` }}</div>
      <div v-else class="choice-debug-messages">
        <div v-for="(m, i) in lastBuildMessages" :key="i" class="choice-debug-msg">
          <span class="choice-debug-role" :class="'role-' + m.role">{{ m.role }}</span>
          <span class="choice-debug-content">{{ truncate(m.content) }}</span>
        </div>
      </div>
    </div>
    <div class="choice-debug-section">
      <h4>{{ t`上次去重报告` }}</h4>
      <div v-if="!lastDedupReport" class="choice-empty-hint">{{ t`去重未触发（未启用或无重复）` }}</div>
      <div v-else class="choice-debug-messages">
        <div class="choice-debug-msg">
          <span class="choice-debug-role">{{ t`剔除数` }}</span>
          <span class="choice-debug-content">{{ lastDedupReport.dropped }}</span>
        </div>
        <div class="choice-debug-msg">
          <span class="choice-debug-role">{{ t`补齐` }}</span>
          <span class="choice-debug-content">{{ lastDedupReport.refilled ? t`是` : t`否` }}</span>
        </div>
      </div>
    </div>
    <div class="choice-debug-section">
      <h4>{{ t`危险操作` }}</h4>
      <button class="menu_button" :title="t`删除所有设置并恢复为插件出厂默认值`" @click="factoryReset">
        <i class="fa-solid fa-rotate-left"></i>
        {{ t`恢复出厂设置` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { lastBuildMessages, lastDedupReport } from '@/core/generator';

const globalStore = useGlobalSettingsStore();

function factoryReset() {
  if (
    !confirm(
      t`确定要恢复插件所有设置为出厂默认值吗？\n\n这将删除所有条目池、提示词配置、API 设置、UI 偏好等。\n此操作不可撤销！`,
    )
  )
    return;
  globalStore.factoryReset();
  toastr.success(t`已恢复出厂设置`);
}

function truncate(s: string, n = 120): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}
</script>

<style scoped>
/* 调试页此前无任何样式，p 标签继承酒馆浅色文字，在亮色面板上几乎不可读 */
.choice-debug-settings {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-debug-section h4 {
  margin: 0 0 var(--choice-space-1);
  font-size: var(--choice-text-base);
  color: var(--choice-text);
}

.choice-debug-section p {
  margin: 2px 0;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-debug-messages {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  max-height: 400px;
  overflow: auto;
}

.choice-debug-msg {
  display: flex;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-xs);
  line-height: 1.4;
}

.choice-debug-role {
  flex-shrink: 0;
  font-weight: 600;
  text-transform: uppercase;
  width: 60px;
}

.role-system {
  color: var(--choice-color-info);
}
.role-user {
  color: var(--choice-color-warning);
}
.role-assistant {
  color: var(--choice-color-success);
}

.choice-debug-content {
  word-break: break-all;
  white-space: pre-wrap;
  color: var(--choice-text);
}
</style>
