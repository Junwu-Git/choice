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
      <h4>{{ t`占位符速查` }}</h4>
      <p class="choice-debug-hint">
        {{ t`模块内容里可写的变量，生成时自动替换成实际值（供复制到提示词模块中使用）` }}
      </p>
      <div class="choice-debug-ph-list">
        <div v-for="ph in PLACEHOLDER_DOCS" :key="ph.syntax" class="choice-debug-ph">
          <code class="choice-debug-ph-syntax">{{ ph.syntax }}</code>
          <span class="choice-debug-ph-desc">{{ ph.desc }}</span>
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

/** 占位符速查表：名称 + 中文说明。说明必须与 generator.ts 的 sub() 替换语义一致，
 *  新增占位符时两处同步（此处只是文档，替换逻辑以 sub() 为准）。 */
const PLACEHOLDER_DOCS = [
  { syntax: '{{count}}', desc: t`本轮要生成的选项/版本数量（数量设为区间时，是实际抽中的值）` },
  { syntax: '{{count_minus_1}}', desc: t`数量减一（count - 1）` },
  { syntax: '{{pinned_count}}', desc: t`固定条目的数量` },
  { syntax: '{{pinned}}', desc: t`固定条目列表——本轮必须全部用上的素材（选项生成）` },
  { syntax: '{{pool_selected}}', desc: t`候选条目列表——AI 从中挑选方向的素材（选项生成）` },
  { syntax: '{{input}}', desc: t`待润色的用户原文（仅润色任务有值）` },
  { syntax: '{{min_chars}}', desc: t`每条字数下限——选项/润色各自取各自的设置` },
  { syntax: '{{max_chars}}', desc: t`每条字数上限——选项/润色各自取各自的设置` },
  { syntax: '{{option_person}}', desc: t`选项叙述人称（如「第三人称」）` },
  { syntax: '{{enrich_person}}', desc: t`润色人称` },
  { syntax: '{{enrich_person_style}}', desc: t`润色人称风格整句（含人称与人设要求）` },
  { syntax: '{{prev_options}}', desc: t`上一楼已生成选项的文本（默认提示词已不使用；自定义模块可引用作参照）` },
  {
    syntax: '{{user}} 等酒馆宏',
    desc: t`由酒馆宏引擎替换（assistant 预填模块内同样执行）`,
  },
];

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

.choice-debug-hint {
  color: var(--choice-text-muted);
}

.choice-debug-ph-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-debug-ph {
  display: flex;
  align-items: baseline;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-xs);
  line-height: 1.4;
}

.choice-debug-ph-syntax {
  flex-shrink: 0;
  min-width: 150px;
  font-family: monospace;
  color: var(--choice-color-info);
  word-break: break-all;
}

.choice-debug-ph-desc {
  color: var(--choice-text-secondary);
  word-break: break-all;
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
