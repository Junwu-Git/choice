<template>
  <div class="choice-stats-settings">
    <div class="choice-stats-cards">
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          {{ t`累计生成` }}
        </div>
        <div class="choice-stats-card-value">{{ stats.total_generated }}</div>
      </div>
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-hand-pointer"></i>
          {{ t`累计选择` }}
        </div>
        <div class="choice-stats-card-value">{{ stats.total_selected }}</div>
      </div>
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-arrow-trend-up"></i>
          {{ t`选择率` }}
        </div>
        <div class="choice-stats-card-value">{{ selectRateText }}</div>
      </div>
    </div>

    <div class="choice-stats-section">
      <div class="choice-stats-section-head">
        <h4>{{ t`条目榜` }}</h4>
        <button
          class="choice-icon-btn"
          :title="allExpanded ? t`全部收起` : t`全部展开`"
          @click="allExpanded ? collapseAll() : expandAll()"
        >
          <i :class="allExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
        </button>
      </div>
      <p class="choice-stats-brief">
        {{
          t`按分组统计条目本身：命中轮次 = 该条目参与的轮次中、有选项被选中的轮次数（当轮有选择即计 1，整轮共现），命中率 = 命中轮次 ÷ 参与轮次。有数据的分组默认展开。`
        }}
      </p>
      <div v-if="groups.length === 0" class="choice-empty-hint">
        {{ t`条目库为空——先在条目池页添加条目并生成一组选项` }}
      </div>
      <div v-else class="choice-stats-groups">
        <div v-for="g in groups" :key="g.category" class="choice-stats-group">
          <button class="choice-stats-group-head" @click="toggleGroup(g)">
            <i class="fa-solid" :class="isExpanded(g) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            <span class="choice-stats-group-name">{{ g.category }}</span>
            <span class="choice-stats-group-summary">{{ groupSummary(g) }}</span>
          </button>
          <div v-if="isExpanded(g)" class="choice-stats-group-body">
            <div v-for="row in g.rows" :key="row.entryId" class="choice-stats-rank-row">
              <div class="choice-stats-rank-main">
                <span
                  class="choice-stats-type-badge"
                  :class="{
                    'choice-stats-type-badge--none': !row.type && !row.deleted,
                    'choice-stats-type-badge--deleted': row.deleted,
                  }"
                  >{{ typeLabel(row) }}</span
                >
                <span class="choice-stats-rank-text">{{ entryText(row) }}</span>
              </div>
              <div class="choice-stats-rank-meta">
                <span
                  >{{ t`参与轮次` }} <b>{{ row.rounds_included }}</b></span
                >
                <span
                  >{{ t`命中轮次` }} <b>{{ row.rounds_with_selection }}</b></span
                >
                <span class="choice-stats-meta-rate"
                  >{{ t`命中率` }} <b>{{ rateText(row.rate) }}</b></span
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="choice-stats-section">
      <h4>{{ t`类型榜` }}</h4>
      <p class="choice-stats-brief">{{ t`按条目的类型标签聚合（整轮共现口径，未参与的类型不列出）` }}</p>
      <div v-if="typeRank.length === 0" class="choice-empty-hint">{{ t`暂无数据` }}</div>
      <div v-else class="choice-stats-rank">
        <div v-for="(row, i) in typeRank" :key="row.type" class="choice-stats-rank-row">
          <div class="choice-stats-rank-main">
            <span class="choice-stats-rank-no" :class="'choice-rank-' + Math.min(i + 1, 4)">{{ i + 1 }}</span>
            <span
              class="choice-stats-type-badge"
              :class="{
                'choice-stats-type-badge--none': row.type === '（未标注）',
                'choice-stats-type-badge--deleted': row.type === '（已删除）',
              }"
              >{{ row.type }}</span
            >
            <span class="choice-stats-rank-text">{{ t`类型` }}</span>
          </div>
          <div class="choice-stats-rank-meta">
            <span
              >{{ t`参与轮次` }} <b>{{ row.rounds_included }}</b></span
            >
            <span
              >{{ t`命中轮次` }} <b>{{ row.rounds_with_selection }}</b></span
            >
            <span class="choice-stats-meta-rate"
              >{{ t`命中率` }} <b>{{ rateText(row.rate) }}</b></span
            >
          </div>
        </div>
      </div>
    </div>

    <div class="choice-stats-section">
      <h4>{{ t`管理` }}</h4>
      <p class="choice-stats-brief">
        {{ t`清空后所有计数与排行榜归零，用于重新统计；统计数据不与角色/聊天绑定，全局共享一份` }}
      </p>
      <button class="menu_button" :title="t`清空全部统计计数与排行榜`" @click="showClearConfirm = true">
        <i class="fa-solid fa-broom"></i>
        {{ t`清空统计` }}
      </button>
    </div>

    <ConfirmDialog
      :open="showClearConfirm"
      :title="t`清空统计`"
      :message="t`确定要清空所有统计数据和排行榜吗？此操作不可撤销。`"
      :confirm-text="t`清空`"
      :cancel-text="t`取消`"
      @confirm="onClearConfirmed"
      @cancel="showClearConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { entryGroups, typeLeaderboard, clearStats, type EntryGroup, type EntryRankRow } from '@/core/stats';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

const gs = useGlobalSettingsStore();
const stats = computed(() => gs.settings.stats);
const masterPool = computed(() => gs.settings.master_pool);
const groupOrder = computed(() => gs.settings.group_order);

const selectRateText = computed(() => {
  const total = stats.value.total_generated;
  if (total <= 0) return '–';
  return Math.round((stats.value.total_selected / total) * 100) + '%';
});

const groups = computed(() => entryGroups(stats.value, masterPool.value, groupOrder.value));
const typeRank = computed(() => typeLeaderboard(stats.value, masterPool.value));

// 分组折叠状态（组件内存活，不持久化）：
// - collapsed = 用户手动收起的组（默认展开的有数据组被收起后不再自动展开）；
// - forced = 用户手动展开的组（未参与组也能点开展开）。
// 生效规则：有数据的组默认展开，除非在 collapsed 里；其余组默认折叠，除非在 forced 里。
const collapsed = ref<Set<string>>(new Set());
const forced = ref<Set<string>>(new Set());

const isExpanded = (g: EntryGroup): boolean =>
  forced.value.has(g.category) || (g.rounds_included > 0 && !collapsed.value.has(g.category));

const toggleGroup = (g: EntryGroup) => {
  if (isExpanded(g)) {
    collapsed.value.add(g.category);
    forced.value.delete(g.category);
  } else {
    collapsed.value.delete(g.category);
    forced.value.add(g.category);
  }
};

const expandAll = () => {
  collapsed.value = new Set();
  forced.value = new Set(groups.value.map(g => g.category));
};

const collapseAll = () => {
  collapsed.value = new Set(groups.value.map(g => g.category));
  forced.value = new Set();
};

const allExpanded = computed(() => groups.value.length > 0 && groups.value.every(g => isExpanded(g)));

const groupSummary = (g: EntryGroup): string => {
  if (g.deletedGroup) return t`${g.rows.length} 条已删除`;
  if (g.rounds_included > 0) {
    const participated = g.rows.filter(r => r.rounds_included > 0).length;
    return t`参与 ${participated} 条 · ${g.rounds_included} 轮 · 命中率 ${rateText(g.rate)}`;
  }
  return t`未参与（${g.rows.length} 条）`;
};

const rateText = (rate: number | null): string => (rate === null ? '–' : Math.round(rate * 100) + '%');

const typeLabel = (row: EntryRankRow): string => {
  if (row.deleted) return t`已删除`;
  return row.type || t`未标注`;
};

const entryText = (row: EntryRankRow): string => {
  if (row.deleted) return t`已删除条目 ${row.entryId.slice(0, 8)}…（${row.rounds_included} 轮）`;
  return row.content || row.type || t`（空内容）`;
};

const showClearConfirm = ref(false);
const onClearConfirmed = () => {
  clearStats();
  showClearConfirm.value = false;
  toastr.success(t`已清空统计`);
};
</script>

<style scoped>
.choice-stats-settings {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-stats-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--choice-space-2);
}

.choice-stats-card {
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-3) var(--choice-space-2);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  min-width: 0;
}

.choice-stats-card-label {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: nowrap;
}

.choice-stats-card-label i {
  color: var(--choice-color-info);
  flex-shrink: 0;
}

.choice-stats-card-value {
  font-size: var(--choice-text-xl);
  font-weight: 700;
  color: var(--choice-text);
  line-height: 1.1;
  word-break: break-all;
}

.choice-stats-section h4 {
  margin: 0;
  font-size: var(--choice-text-base);
  color: var(--choice-text);
}

.choice-stats-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  margin-bottom: var(--choice-space-1);
}

.choice-stats-brief {
  margin: 0 0 var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-stats-groups {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-group {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  overflow: hidden;
  background: var(--choice-bg-element);
}

.choice-stats-group-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  width: 100%;
  padding: var(--choice-space-2) var(--choice-space-3);
  background: none;
  border: none;
  cursor: pointer;
  text-align: left;
  color: var(--choice-text);
  transition: background var(--choice-transition);
}

.choice-stats-group-head:hover {
  background: var(--choice-bg-hover);
}

.choice-stats-group-head > i {
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-stats-group-name {
  flex-shrink: 0;
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text);
}

.choice-stats-group-summary {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  text-align: right;
}

.choice-stats-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) var(--choice-space-2) var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  background: var(--choice-bg-panel);
}

.choice-stats-rank {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-rank-row {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2);
  background: var(--choice-bg-elevated);
  border-radius: var(--choice-radius-sm);
  border-left: 3px solid transparent;
  min-width: 0;
}

.choice-stats-rank-main {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  min-width: 0;
}

.choice-stats-rank-no {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: var(--choice-text-xs);
  font-weight: 700;
  color: var(--choice-text-muted);
}

.choice-rank-1 {
  color: var(--choice-color-warning);
}

.choice-rank-2 {
  color: var(--choice-text-secondary);
}

.choice-rank-3 {
  color: var(--choice-color-warning);
  opacity: 0.75;
}

.choice-stats-type-badge {
  flex-shrink: 0;
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
  font-size: var(--choice-text-xs);
  font-weight: 600;
}

.choice-stats-type-badge--none {
  background: var(--choice-bg-hover);
  color: var(--choice-text-muted);
}

.choice-stats-type-badge--deleted {
  background: var(--choice-color-error-bg);
  color: var(--choice-color-error);
}

.choice-stats-rank-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.choice-stats-rank-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-2) var(--choice-space-3);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  padding-left: 0;
}

.choice-stats-rank-meta b {
  color: var(--choice-text-secondary);
  font-weight: 600;
}

.choice-stats-meta-rate b {
  color: var(--choice-color-success);
}
</style>
