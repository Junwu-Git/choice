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
      <div v-if="!lastDedupReport || !lastDedupReport.details.length" class="choice-empty-hint">
        {{ t`去重未触发（未启用或无重复）` }}
      </div>
      <div v-else class="choice-debug-messages">
        <div class="choice-debug-msg">
          <span class="choice-debug-role">{{ t`剔除数` }}</span>
          <span class="choice-debug-content">{{ lastDedupReport.dropped }}</span>
        </div>
        <div class="choice-debug-msg">
          <span class="choice-debug-role">{{ t`补齐` }}</span>
          <span class="choice-debug-content">{{ lastDedupReport.refilled ? t`是` : t`否` }}</span>
        </div>
        <div class="choice-debug-msg">
          <span class="choice-debug-role">{{ t`阈值` }}</span>
          <span class="choice-debug-content">{{ lastDedupReport.threshold }}</span>
        </div>
      </div>
      <div v-if="lastDedupReport?.refs.length" class="choice-debug-dedup-refs">
        <div class="choice-debug-dedup-refs-title">{{ t`参照池（${lastDedupReport.refs.length} 条）` }}</div>
        <div class="choice-debug-dedup-refs-list">
          <div v-for="(ref, i) in lastDedupReport.refs" :key="i" class="choice-debug-dedup-ref-item">
            {{ truncate(ref, 100) }}
          </div>
        </div>
      </div>
      <div v-if="lastDedupReport?.details.length" class="choice-debug-dedup-details">
        <div v-for="(d, i) in lastDedupReport.details" :key="i" class="choice-debug-dedup-item">
          <div class="choice-debug-dedup-candidate">{{ truncate(d.candidate, 80) }}</div>
          <div class="choice-debug-dedup-meta">
            <span :class="['choice-debug-dedup-reason', 'reason-' + d.reason]">
              {{ d.reason === 'title' ? t`标题精确匹配` : t`Jaccard ${d.score?.toFixed(2)}` }}
            </span>
            <span class="choice-debug-dedup-matched">{{ t`⇐` }} {{ truncate(d.matchedRef, 60) }}</span>
          </div>
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

.choice-debug-dedup-details {
  margin-top: var(--choice-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-debug-dedup-item {
  padding: var(--choice-space-2);
  background: var(--choice-bg-elevated);
  border-radius: var(--choice-radius-sm);
  border-left: 3px solid var(--choice-color-warning);
}

.choice-debug-dedup-candidate {
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  word-break: break-all;
}

.choice-debug-dedup-meta {
  margin-top: var(--choice-space-1);
  display: flex;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-debug-dedup-reason {
  font-weight: 600;
}

.reason-title {
  color: var(--choice-color-info);
}

.reason-jaccard {
  color: var(--choice-color-warning);
}

.choice-debug-dedup-matched {
  opacity: 0.8;
}

.choice-debug-dedup-refs {
  margin-top: var(--choice-space-2);
}

.choice-debug-dedup-refs-title {
  font-size: var(--choice-text-xs);
  font-weight: 600;
  color: var(--choice-text-secondary);
  margin-bottom: var(--choice-space-1);
}

.choice-debug-dedup-refs-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-debug-dedup-ref-item {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  word-break: break-all;
  padding: var(--choice-space-1) var(--choice-space-2);
  background: var(--choice-bg-elevated);
  border-radius: var(--choice-radius-sm);
  border-left: 2px solid var(--choice-color-info);
}
</style>
