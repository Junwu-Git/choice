<template>
  <div class="choice-knowledge">
    <!-- 说明：功能定位 + 一句话讲清「为什么要分析」 -->
    <div class="choice-section">
      <h4 class="choice-section-title">{{ t`知识边界` }}</h4>
      <small class="choice-field-hint">
        {{
          t`让 AI 单独分析一次：当前聊天里玩家角色哪些信息已经知道、哪些只是怀疑、哪些完全不知道。分析结果会注入选项生成，压住「选项用了角色不该知道的信息」这类全知问题。`
        }}
      </small>
      <label class="choice-toggle">
        <input v-model="gs.settings.knowledge.enabled" type="checkbox" :title="t`关闭后不分析也不注入`" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`启用知识边界分析` }}</strong>
          <small>{{ t`关闭后既不自动分析，也不向选项生成注入报告` }}</small>
        </span>
      </label>
    </div>

    <ChoiceSectionCard title="分析与注入" icon="fa-solid fa-user-shield" :default-open="true">
      <div class="choice-knowledge-actions">
        <button
          v-if="!knowledgeState.loading"
          class="choice-knowledge-btn"
          :disabled="!gs.settings.knowledge.enabled"
          @click="onAnalyze"
        >
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          {{ report.entries.length ? t`增量分析` : t`开始分析` }}
        </button>
        <button v-else class="choice-knowledge-btn choice-knowledge-btn--stop" @click="cancelKnowledgeAnalysis">
          <i class="fa-solid fa-stop"></i>
          {{ t`取消分析` }}
        </button>
        <button
          v-if="!knowledgeState.loading && report.entries.length"
          class="choice-btn-sm"
          :title="t`丢弃现有表，按当前聊天重新生成完整报告`"
          @click="onRebuild"
        >
          <i class="fa-solid fa-rotate"></i>
          {{ t`重建整表` }}
        </button>
        <span v-if="knowledgeState.loading" class="choice-knowledge-status">
          <i class="fa-solid fa-spinner fa-spin"></i>
          {{ t`正在分析当前聊天…` }}
        </span>
        <span v-else-if="statusText" class="choice-knowledge-status">{{ statusText }}</span>
      </div>

      <label class="choice-toggle">
        <input v-model="gs.settings.knowledge.auto_analyze" type="checkbox" :title="t`每轮 AI 回复后自动刷新报告`" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`自动刷新` }}</strong>
          <small>{{ t`每轮 AI 回复后后台重跑一次（多一次请求，与选项生成并行）` }}</small>
        </span>
      </label>
      <label class="choice-toggle">
        <input v-model="gs.settings.knowledge.inject_enabled" type="checkbox" :title="t`把报告注入选项生成请求`" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`注入选项生成` }}</strong>
          <small>{{ t`把最新报告作为参考块发给生成选项的 AI（扩展模式与酒馆预设模式都生效）` }}</small>
        </span>
      </label>

      <small v-if="stale" class="choice-field-hint choice-knowledge-stale">
        <i class="fa-solid fa-triangle-exclamation"></i>
        {{ staleText }}
      </small>
    </ChoiceSectionCard>

    <!-- 报告表：有数据才显示，空态单独给邀请 -->
    <template v-if="report.entries.length">
      <div class="choice-knowledge-summary">
        <span class="choice-knowledge-count choice-knowledge-count--known">{{ t`已知` }} {{ counts.known }}</span>
        <span class="choice-knowledge-count choice-knowledge-count--uncertain"
          >{{ t`存疑` }} {{ counts.uncertain }}</span
        >
        <span class="choice-knowledge-count choice-knowledge-count--unknown">{{ t`未知` }} {{ counts.unknown }}</span>
        <div class="choice-seg choice-knowledge-filter">
          <button
            v-for="f in FILTERS"
            :key="f.id"
            class="choice-seg-btn"
            :class="{ active: filter === f.id }"
            @click="filter = f.id"
          >
            {{ f.label }}
          </button>
        </div>
      </div>

      <div class="choice-knowledge-table">
        <div class="choice-knowledge-row choice-knowledge-row--head">
          <span>{{ t`信息项` }}</span>
          <span>{{ t`状态` }}</span>
          <span>{{ t`依据` }}</span>
          <span>{{ t`对选项的约束` }}</span>
        </div>
        <div v-for="(e, i) in filtered" :key="`${e.topic}-${i}`" class="choice-knowledge-row">
          <span class="choice-knowledge-topic">{{ e.topic }}</span>
          <span>
            <span class="choice-knowledge-badge" :class="`is-${e.status}`">{{ statusLabel(e.status) }}</span>
          </span>
          <span class="choice-knowledge-cell">{{ e.basis || '—' }}</span>
          <span class="choice-knowledge-cell">{{ e.impact || '—' }}</span>
        </div>
        <div v-if="!filtered.length" class="choice-empty-hint">{{ t`当前筛选下没有条目` }}</div>
      </div>
    </template>

    <div v-else-if="!knowledgeState.loading" class="choice-empty">
      <div class="choice-empty-icon"><i class="fa-solid fa-user-shield"></i></div>
      <p>{{ t`还没有分析结果。点「开始分析」让 AI 读一遍当前聊天与设定，列出玩家角色知道与不知道的事。` }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import { cancelKnowledgeAnalysis, analyzeKnowledgeBoundary, knowledgeState } from '@/core/knowledge-analysis';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { KnowledgeStatus } from '@/type/settings';

type FilterId = 'all' | KnowledgeStatus;

const gs = useGlobalSettingsStore();
const cs = useChatSettingsStore();

const report = computed(() => cs.settings.knowledge_report);

const filter = ref<FilterId>('all');

const FILTERS = computed<Array<{ id: FilterId; label: string }>>(() => [
  { id: 'all', label: t`全部` },
  { id: 'known', label: t`已知` },
  { id: 'uncertain', label: t`存疑` },
  { id: 'unknown', label: t`未知` },
]);

const counts = computed(() => {
  const c = { known: 0, uncertain: 0, unknown: 0 };
  for (const e of report.value.entries) c[e.status]++;
  return c;
});

const filtered = computed(() =>
  filter.value === 'all' ? report.value.entries : report.value.entries.filter(e => e.status === filter.value),
);

const statusLabel = (s: KnowledgeStatus): string => (s === 'known' ? t`已知` : s === 'uncertain' ? t`存疑` : t`未知`);

const statusText = computed(() => {
  const r = report.value;
  if (!r.updated_at) return '';
  const d = new Date(r.updated_at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return t`更新于 ${hh}:${mm} · 基于第 ${r.based_on_message} 楼`;
});

/** 过期判定：分析后楼层数变了（新增或删除）都说明报告与当前聊天不再一致 */
const currentMessageCount = (): number => {
  try {
    return window.SillyTavern?.getContext?.()?.chat?.length ?? 0;
  } catch {
    return 0;
  }
};

const stale = computed(() => {
  const r = report.value;
  if (!r.updated_at) return false;
  return r.based_on_message !== currentMessageCount();
});

const staleText = computed(() => {
  const diff = currentMessageCount() - report.value.based_on_message;
  return diff > 0 ? t`聊天已有 ${diff} 条新消息，报告可能过期，建议重新分析` : t`聊天楼层有变动，报告可能过期`;
});

const onAnalyze = async () => {
  await analyzeKnowledgeBoundary(true);
};

/** 重建整表：丢弃已有表，让模型按当前上下文从零生成（表被污染时的逃生舱）。 */
const onRebuild = async () => {
  await analyzeKnowledgeBoundary(true, true);
};
</script>

<style scoped>
.choice-knowledge {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
  /* 表格折叠按本面板实际宽度判断（设置面板在桌面上也只有 ~345px 宽），
     不能用视口宽度——那会把「大屏 + 窄面板」漏掉 */
  container-type: inline-size;
}

.choice-knowledge-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-knowledge-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2) var(--choice-space-4);
  border: 1px solid var(--choice-primary);
  border-radius: var(--choice-radius-full);
  background: var(--choice-primary);
  color: var(--choice-primary-text, #fff);
  font-size: var(--choice-text-sm);
  font-weight: 600;
  cursor: pointer;
  transition: opacity var(--choice-transition);
}

.choice-knowledge-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.choice-knowledge-btn--stop {
  background: transparent;
  color: var(--choice-color-error);
  border-color: var(--choice-color-error);
}

.choice-knowledge-status {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-knowledge-stale {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  color: var(--choice-color-warning);
}

.choice-knowledge-summary {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-knowledge-count {
  font-size: var(--choice-text-xs);
  padding: var(--choice-space-1) var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  border: 1px solid var(--choice-border);
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  white-space: nowrap;
}

.choice-knowledge-count--known {
  border-color: var(--choice-color-success);
  color: var(--choice-color-success);
}

.choice-knowledge-count--uncertain {
  border-color: var(--choice-color-warning);
  color: var(--choice-color-warning);
}

.choice-knowledge-count--unknown {
  border-color: var(--choice-color-error);
  color: var(--choice-color-error);
}

.choice-knowledge-filter {
  margin-left: auto;
}

/* 表格：不用 <table>，用 grid 行——380px 窄屏下表格必然横滚 */
.choice-knowledge-table {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  overflow: hidden;
}

.choice-knowledge-row {
  display: grid;
  /* 四列的最小宽合计约 320px；容器查询在更窄时切成卡片式，避免出现横向滚动 */
  grid-template-columns: minmax(72px, 1.1fr) 48px minmax(80px, 1.4fr) minmax(80px, 1.4fr);
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  border-top: 1px solid var(--choice-border);
  font-size: var(--choice-text-xs);
  align-items: start;
}

.choice-knowledge-row:first-child {
  border-top: none;
}

.choice-knowledge-row--head {
  background: var(--choice-bg-element);
  color: var(--choice-text-muted);
  font-weight: 600;
  font-size: var(--choice-text-xs);
}

.choice-knowledge-row:not(.choice-knowledge-row--head):hover {
  background: var(--choice-bg-hover);
}

.choice-knowledge-topic {
  color: var(--choice-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.choice-knowledge-cell {
  color: var(--choice-text-secondary);
  overflow-wrap: anywhere;
}

.choice-knowledge-badge {
  display: inline-block;
  padding: 0 var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  border: 1px solid currentColor;
  font-size: var(--choice-text-xs);
  line-height: 1.6;
  white-space: nowrap;
}

.choice-knowledge-badge.is-known {
  color: var(--choice-color-success);
}

.choice-knowledge-badge.is-uncertain {
  color: var(--choice-color-warning);
}

.choice-knowledge-badge.is-unknown {
  color: var(--choice-color-error);
}

/* 窄容器折叠成卡片：四列并排会把每列压到 40px 以下不可读。
   用容器查询而非媒体查询——设置面板在桌面上也只有 ~345px 宽，按视口宽度判断会漏掉
   「大屏 + 窄面板」这个最常见的场景（实测四列在此布局下溢出 5px）。 */
@container (max-width: 400px) {
  .choice-knowledge-row {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .choice-knowledge-row--head {
    display: none;
  }

  .choice-knowledge-cell {
    grid-column: 1 / -1;
  }

  .choice-knowledge-filter {
    margin-left: 0;
  }
}
</style>
