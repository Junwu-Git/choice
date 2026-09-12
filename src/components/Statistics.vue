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
      <h4>{{ t`生成榜（Top ${RANK_LIMIT}）` }}</h4>
      <p class="choice-stats-brief">{{ t`按选项文本被 AI 生成的次数排行，同一句话反复生成越多排名越高` }}</p>
      <div v-if="genRank.length === 0" class="choice-empty-hint">{{ t`暂无数据——生成一组选项后这里会出现排行` }}</div>
      <div v-else class="choice-stats-rank">
        <div v-for="(row, i) in genRank" :key="row.text" class="choice-stats-rank-row">
          <span class="choice-stats-rank-no" :class="'choice-rank-' + Math.min(i + 1, 4)">{{ i + 1 }}</span>
          <span class="choice-stats-type-badge" :class="{ 'choice-stats-type-badge--none': !row.type }">{{
            row.type || t`未标注`
          }}</span>
          <span class="choice-stats-rank-text">{{ row.text }}</span>
          <span class="choice-stats-rank-count">{{ row.generated }}</span>
        </div>
      </div>
    </div>

    <div class="choice-stats-section">
      <h4>{{ t`选择榜（Top ${RANK_LIMIT}）` }}</h4>
      <p class="choice-stats-brief">{{ t`按选项文本被用户点击应用的次数排行` }}</p>
      <div v-if="selRank.length === 0" class="choice-empty-hint">
        {{ t`暂无数据——点击应用一个选项后这里会出现排行` }}
      </div>
      <div v-else class="choice-stats-rank">
        <div v-for="(row, i) in selRank" :key="row.text" class="choice-stats-rank-row">
          <span class="choice-stats-rank-no" :class="'choice-rank-' + Math.min(i + 1, 4)">{{ i + 1 }}</span>
          <span class="choice-stats-type-badge" :class="{ 'choice-stats-type-badge--none': !row.type }">{{
            row.type || t`未标注`
          }}</span>
          <span class="choice-stats-rank-text">{{ row.text }}</span>
          <span class="choice-stats-rank-count">{{ row.selected }}</span>
        </div>
      </div>
    </div>

    <div class="choice-stats-section">
      <h4>{{ t`类型榜` }}</h4>
      <p class="choice-stats-brief">{{ t`按 [类型标签] 聚合的生成/选择情况，选择率 = 选择 / 生成` }}</p>
      <div v-if="typeRank.length === 0" class="choice-empty-hint">{{ t`暂无数据` }}</div>
      <div v-else class="choice-stats-type-table">
        <div class="choice-stats-type-head">
          <span>{{ t`类型` }}</span>
          <span>{{ t`生成` }}</span>
          <span>{{ t`选择` }}</span>
          <span>{{ t`选择率` }}</span>
        </div>
        <div v-for="row in typeRank" :key="row.type" class="choice-stats-type-row">
          <span class="choice-stats-type-name">{{ row.type }}</span>
          <span>{{ row.generated }}</span>
          <span>{{ row.selected }}</span>
          <span class="choice-stats-type-rate">{{ rateText(row.rate) }}</span>
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
import { topTextEntries, topTypeEntries, clearStats } from '@/core/stats';
import ConfirmDialog from '@/components/ConfirmDialog.vue';

const RANK_LIMIT = 50;

const gs = useGlobalSettingsStore();
const stats = computed(() => gs.settings.stats);

const selectRateText = computed(() => {
  const total = stats.value.total_generated;
  if (total <= 0) return '–';
  return Math.round((stats.value.total_selected / total) * 100) + '%';
});

const genRank = computed(() => topTextEntries(stats.value, 'generated', RANK_LIMIT));
const selRank = computed(() => topTextEntries(stats.value, 'selected', RANK_LIMIT));
const typeRank = computed(() => topTypeEntries(stats.value, RANK_LIMIT));

const rateText = (rate: number | null): string => (rate === null ? '–' : Math.round(rate * 100) + '%');

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
  margin: 0 0 var(--choice-space-1);
  font-size: var(--choice-text-base);
  color: var(--choice-text);
}

.choice-stats-brief {
  margin: 0 0 var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-stats-rank {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-rank-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2);
  background: var(--choice-bg-elevated);
  border-radius: var(--choice-radius-sm);
  border-left: 3px solid transparent;
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

.choice-stats-rank-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.choice-stats-rank-count {
  flex-shrink: 0;
  font-size: var(--choice-text-base);
  font-weight: 700;
  color: var(--choice-color-info);
  min-width: 24px;
  text-align: right;
}

.choice-stats-type-table {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-type-head,
.choice-stats-type-row {
  display: grid;
  grid-template-columns: 1fr 56px 56px 64px;
  gap: var(--choice-space-2);
  align-items: center;
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-xs);
}

.choice-stats-type-head {
  color: var(--choice-text-muted);
  font-weight: 600;
  border-bottom: 1px solid var(--choice-border);
}

.choice-stats-type-head span:nth-child(2),
.choice-stats-type-row > span:nth-child(2),
.choice-stats-type-head span:nth-child(3),
.choice-stats-type-row > span:nth-child(3) {
  text-align: right;
}

.choice-stats-type-head span:last-child,
.choice-stats-type-row > span:last-child {
  text-align: right;
}

.choice-stats-type-row {
  background: var(--choice-bg-elevated);
  border-radius: var(--choice-radius-sm);
  color: var(--choice-text-secondary);
}

.choice-stats-type-name {
  color: var(--choice-text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-stats-type-rate {
  color: var(--choice-color-success);
  font-weight: 600;
}
</style>
