<template>
  <div class="choice-stats-settings">
    <!-- 维度切换：全局（聚合所有 config） / 未绑定档 / 各条目池配置 -->
    <div class="choice-stats-dim-bar">
      <select v-model="scopeId" class="text_pole choice-stats-scope-select" :title="t`统计维度`">
        <option v-for="o in scopeOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
      </select>
      <button
        v-if="undoAvailable"
        class="menu_button choice-stats-undo"
        :title="t`撤销上一次应用到条目池配置的权重修改`"
        @click="onUndo"
      >
        <i class="fa-solid fa-rotate-left"></i>
        {{ t`撤销上次应用` }}
      </button>
      <span v-if="view.isGlobal" class="choice-stats-dim-note">{{ t`全局 = 全部配置的混合统计` }}</span>
      <span v-else-if="scopeId === NONE_SCOPE" class="choice-stats-dim-note">{{
        t`未绑定配置档（无 config 会话）`
      }}</span>
      <span v-else class="choice-stats-dim-note">{{ t`仅该条目池配置生效会话计入` }}</span>
    </div>

    <!-- 无 config 引导：应用建议需要 config 作为写入目标 -->
    <div v-if="scopeId === NONE_SCOPE && configs.length === 0" class="choice-stats-guide">
      <div>
        <b>{{ t`尚未创建任何条目池配置` }}</b>
        <p>
          {{
            t`统计优选建议会写入条目池配置的权重覆盖。创建默认配置后，未绑定档的历史统计会自动并入新配置，即可在统计页应用建议。`
          }}
        </p>
      </div>
      <button class="menu_button" @click="onCreateDefaultConfig">
        <i class="fa-solid fa-folder-plus"></i>
        {{ t`创建默认配置` }}
      </button>
    </div>
    <div v-else-if="scopeId === NONE_SCOPE" class="choice-stats-guide">
      <div>
        <b>{{ t`当前会话未绑定条目池配置` }}</b>
        <p>
          {{
            t`本会话的统计记入「未绑定配置」档，可查看但无法应用建议。到条目池页绑定角色/聊天，或将某配置设为默认后回来。`
          }}
        </p>
      </div>
      <button class="menu_button" @click="requestTab('pool')">
        <i class="fa-solid fa-arrow-right-to-bracket"></i>
        {{ t`前往条目池页` }}
      </button>
    </div>

    <!-- 汇总卡片 -->
    <div class="choice-stats-cards">
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-wand-magic-sparkles"></i>
          {{ t`累计生成` }}
        </div>
        <div class="choice-stats-card-value">{{ view.total_generated }}</div>
      </div>
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-hand-pointer"></i>
          {{ t`累计选择` }}
        </div>
        <div class="choice-stats-card-value">{{ view.total_selected }}</div>
      </div>
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-arrow-trend-up"></i>
          {{ t`选择率` }}
        </div>
        <div class="choice-stats-card-value">{{ selectRateText }}</div>
      </div>
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-calendar"></i>
          {{ t`活跃天数` }}
        </div>
        <div class="choice-stats-card-value">{{ activeDays }}</div>
      </div>
      <div
        class="choice-stats-card"
        :title="
          t`池内参与率 = 有效池中至少进入过一轮生成候选的条目数 ÷ 有效池条目数。候选被抽中即计参与（轮次共现归因）；AI 输出为自由文本、选项与条目无法精确一一对应，被 AI 舍弃的候选也会计入`
        "
      >
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-layer-group"></i>
          {{ t`池内参与率` }}
        </div>
        <div class="choice-stats-card-value">{{ poolParticipationText }}</div>
      </div>
      <div class="choice-stats-card">
        <div class="choice-stats-card-label">
          <i class="fa-solid fa-clock"></i>
          {{ t`最近统计` }}
        </div>
        <div class="choice-stats-card-value choice-stats-card-value--sm">{{ updatedAtText }}</div>
      </div>
    </div>

    <!-- 样本量分布诊断 -->
    <div class="choice-stats-section">
      <h4>{{ t`样本分布` }}</h4>
      <p class="choice-stats-brief">
        {{
          t`当前维度有效池 ${effectivePoolSize} 条目的样本覆盖：参与 ≥${sampleMin} 轮命中率才可信（可出建议），不足的只标「样本不足」。充足占比越高，优化建议越可信。「参与」指条目进入过生成轮的候选菜单（轮次共现），不代表选项一定出现在输出中。`
        }}
      </p>
      <div class="choice-stats-sample">
        <div class="choice-stats-sample-row">
          <span class="choice-stats-sample-label">{{ t`样本充足` }}</span>
          <div class="choice-stats-sample-track">
            <div
              class="choice-stats-sample-fill choice-stats-sample-fill--good"
              :style="{ width: sampleGoodPct }"
            ></div>
          </div>
          <b>{{ distribution.sufficient }}</b>
        </div>
        <div class="choice-stats-sample-row">
          <span class="choice-stats-sample-label">{{ t`样本不足` }}</span>
          <div class="choice-stats-sample-track">
            <div class="choice-stats-sample-fill choice-stats-sample-fill--mid" :style="{ width: sampleMidPct }"></div>
          </div>
          <b>{{ distribution.insufficient }}</b>
        </div>
        <div class="choice-stats-sample-row">
          <span class="choice-stats-sample-label">{{ t`从未参与` }}</span>
          <div class="choice-stats-sample-track">
            <div
              class="choice-stats-sample-fill choice-stats-sample-fill--none"
              :style="{ width: sampleNeverPct }"
            ></div>
          </div>
          <b>{{ distribution.never }}</b>
        </div>
      </div>
    </div>

    <!-- 趋势 -->
    <div class="choice-stats-section">
      <div class="choice-stats-section-head">
        <h4>{{ t`趋势` }}</h4>
        <div class="choice-stats-seg">
          <button
            v-for="d in trendRangeOptions"
            :key="d"
            class="choice-stats-seg-btn"
            :class="{ 'choice-stats-seg-btn--active': trendDays === d }"
            @click="trendDays = d"
          >
            {{ d }} {{ t`天` }}
          </button>
        </div>
      </div>
      <p class="choice-stats-brief">
        {{ t`按天统计的生成/选择活动（仅行动选项视图计入，随选中维度），自 v51 起累积，历史不回填。` }}
      </p>
      <div class="choice-chart">
        <div v-for="(p, i) in trend" :key="p.key" class="choice-chart-day">
          <div class="choice-chart-bars">
            <div
              class="choice-chart-col choice-chart-col--generated"
              :style="{ height: barHeight(p.generated) }"
              :title="`${p.label} ${t`生成`} ${p.generated}`"
            ></div>
            <div
              class="choice-chart-col choice-chart-col--selected"
              :style="{ height: barHeight(p.selected) }"
              :title="`${p.label} ${t`选择`} ${p.selected}`"
            ></div>
          </div>
          <span v-if="showChartLabel(i)" class="choice-chart-label">{{ p.label }}</span>
        </div>
      </div>
      <div class="choice-chart-legend">
        <span><i class="choice-chart-legend-dot choice-chart-legend-dot--generated"></i>{{ t`生成` }}</span>
        <span><i class="choice-chart-legend-dot choice-chart-legend-dot--selected"></i>{{ t`选择` }}</span>
      </div>
    </div>

    <!-- 条目榜 -->
    <div class="choice-stats-section">
      <div class="choice-stats-section-head">
        <h4>{{ t`条目榜` }}</h4>
        <div class="choice-stats-head-actions">
          <button
            v-if="applyableCount > 0"
            class="menu_button choice-stats-apply-all"
            :title="t`批量应用当前筛选结果中的全部建议`"
            @click="applyAll()"
          >
            <i class="fa-solid fa-wand-magic-sparkles"></i>
            {{ t`应用全部建议 (${applyableCount})` }}
          </button>
          <button
            v-if="filteredGroups.length > 0"
            class="choice-icon-btn"
            :title="allExpanded ? t`全部收起` : t`全部展开`"
            @click="allExpanded ? collapseAll() : expandAll()"
          >
            <i :class="allExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
          </button>
        </div>
      </div>
      <div class="choice-stats-toolbar">
        <input
          v-model="query"
          class="text_pole choice-stats-search"
          type="search"
          :placeholder="t`搜索内容 / 类型 / 分类`"
        />
        <div class="choice-stats-seg">
          <button
            v-for="o in sortOptions"
            :key="o.key"
            class="choice-stats-seg-btn"
            :class="{ 'choice-stats-seg-btn--active': sortBy === o.key }"
            @click="sortBy = o.key"
          >
            {{ o.label }}
          </button>
        </div>
        <label class="choice-stats-toggle">
          <ChoiceSwitch v-model="onlyWithData" :title="t`只看有数据的条目`" />
          <span>{{ t`只看有数据` }}</span>
        </label>
      </div>
      <p class="choice-stats-brief">
        {{
          t`命中轮次 = 选项被选中且文本匹配到该条目的轮次（精确归因：输出选项与候选 type+内容 做相似度匹配，被 AI 舍弃的候选不产生命中）；命中率与「期望」对比：期望 = 该条目方向被 AI 采纳输出时的随机点选基准（仅在输出匹配到该条目的轮次按 1/选项数累计；AI 完全自由发挥的轮次不累计期望也不产生命中），高于期望越多越值得提权，低于越多越值得降权。单个 config 维度额外显示近 ${sampleMin} 轮窗口命中率。参与轮次 = 该条目被抽入候选菜单的轮次（共现归因）：AI 输出为自由文本，被 AI 舍弃的候选也计参与；生成条数按 AI 输出条数计，池子小于请求条数或 AI 自由发挥时，参与条目数可能少于或多于生成条数。`
        }}
      </p>
      <p v-if="view.isGlobal" class="choice-stats-brief choice-stats-brief--scope">
        {{ t`全局 = 所有配置混合累计，不代表任何单一场景；建议功能需切换到具体配置维度。` }}
      </p>
      <div v-if="groups.length === 0" class="choice-empty-hint">
        {{ t`条目库为空——先在条目池页添加条目并生成一组选项` }}
      </div>
      <div v-else-if="filteredGroups.length === 0" class="choice-empty-hint">
        {{ t`没有匹配的条目，试试调整搜索或筛选条件` }}
      </div>
      <div v-else class="choice-stats-groups">
        <div v-for="g in filteredGroups" :key="g.category" class="choice-stats-group">
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
                <span
                  v-if="insightOf(row) === 'downgrade'"
                  class="choice-stats-insight choice-stats-insight--bad"
                  :title="suggestionTitle(row)"
                  >{{ t`候选降权` }}</span
                >
                <span
                  v-else-if="insightOf(row) === 'disable'"
                  class="choice-stats-insight choice-stats-insight--disable"
                  :title="suggestionTitle(row)"
                  >{{ t`建议停用` }}</span
                >
                <span
                  v-else-if="insightOf(row) === 'good'"
                  class="choice-stats-insight choice-stats-insight--good"
                  :title="suggestionTitle(row)"
                  >{{ t`表现良好` }}</span
                >
                <span
                  v-else-if="insightOf(row) === 'insufficient'"
                  class="choice-stats-insight choice-stats-insight--insufficient"
                  :title="t`参与轮次不足 ${sampleMin} 轮，命中率噪声大，暂不判断质量`"
                  >{{ t`样本不足` }}</span
                >
                <span class="choice-stats-rank-text" :title="selectedTextTitle(row)">{{ entryText(row) }}</span>
                <button
                  v-if="suggestionOf(row) && canApply"
                  class="choice-icon-btn choice-stats-apply"
                  :title="t`应用这条建议到当前配置`"
                  @click="applySuggestion(row)"
                >
                  <i class="fa-solid fa-check"></i>
                </button>
                <button
                  v-if="!row.deleted"
                  class="choice-icon-btn choice-stats-locate"
                  :title="t`在条目库中定位`"
                  @click="locateEntry(row.entryId)"
                >
                  <i class="fa-solid fa-location-crosshairs"></i>
                </button>
              </div>
              <div
                v-if="row.rate !== null"
                class="choice-stats-rate-track"
                :title="`${t`命中率`} ${rateText(row.rate)} / ${t`期望`} ${expectedRateText(row)}`"
              >
                <div class="choice-stats-rate-fill" :style="{ width: rateWidth(row.rate) }"></div>
              </div>
              <div class="choice-stats-rank-meta">
                <span :title="participationTitle(row)"
                  >{{ t`参与轮次` }} <b>{{ row.rounds_included }}</b></span
                >
                <span
                  >{{ t`命中轮次` }} <b>{{ row.rounds_with_selection }}</b></span
                >
                <span
                  >{{ t`未命中轮次` }}
                  <b class="choice-stats-meta-miss">{{ row.rounds_included - row.rounds_with_selection }}</b></span
                >
                <span class="choice-stats-meta-rate"
                  >{{ t`命中率` }} <b>{{ rateText(row.rate) }}</b></span
                >
                <span class="choice-stats-meta-expected"
                  >{{ t`期望` }} <b>{{ expectedRateText(row) }}</b></span
                >
                <span v-if="windowMeta(row)" class="choice-stats-meta-window" :title="windowTitle(row)">{{
                  windowMeta(row)
                }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 命中榜（用户选择条目的排行） -->
    <div class="choice-stats-section">
      <h4>{{ t`命中榜` }}</h4>
      <p class="choice-stats-brief">
        {{
          t`仅列出被选择过的条目（精确归因：输出选项文本匹配到该条目才算命中，被 AI 舍弃的候选不产生命中），按命中次数排序。`
        }}
      </p>
      <div v-if="hitRank.length === 0" class="choice-empty-hint">{{ t`尚未选择过任何条目` }}</div>
      <div v-else class="choice-stats-rank">
        <div v-for="(row, i) in hitRank" :key="row.entryId" class="choice-stats-rank-row">
          <div class="choice-stats-rank-main">
            <span class="choice-stats-rank-no" :class="'choice-rank-' + Math.min(i + 1, 4)">{{ i + 1 }}</span>
            <span
              class="choice-stats-type-badge"
              :class="{
                'choice-stats-type-badge--none': !row.type && !row.deleted,
                'choice-stats-type-badge--deleted': row.deleted,
              }"
              >{{ typeLabel(row) }}</span
            >
            <span class="choice-stats-rank-text" :title="selectedTextTitle(row)">{{ hitText(row) }}</span>
            <button
              v-if="!row.deleted"
              class="choice-icon-btn choice-stats-locate"
              :title="t`在条目库中定位`"
              @click="locateEntry(row.entryId)"
            >
              <i class="fa-solid fa-location-crosshairs"></i>
            </button>
          </div>
          <div class="choice-stats-rank-meta">
            <span
              >{{ t`命中次数` }} <b>{{ row.count }}</b></span
            >
            <span v-if="row.last_selected_text" class="choice-stats-meta-expected"
              >{{ t`最近选中` }} <b class="choice-stats-meta-hit-text">{{ row.last_selected_text }}</b></span
            >
            <span
              >{{ t`最近选中时间` }} <b>{{ timeAgo(row.last_selected_at) }}</b></span
            >
          </div>
        </div>
      </div>
    </div>

    <!-- 管理 -->
    <div class="choice-stats-section">
      <h4>{{ t`管理` }}</h4>
      <p class="choice-stats-brief">
        {{
          t`导出统计为 JSON 便于备份与分析（含全部维度）；清空后所有维度与计数归零，用于重新统计。统计不与角色/聊天绑定，按条目池配置分维度累计。`
        }}
      </p>
      <div class="choice-stats-actions">
        <button class="menu_button" :title="t`导出统计为 JSON`" @click="exportStats()">
          <i class="fa-solid fa-download"></i>
          {{ t`导出 JSON` }}
        </button>
        <button class="menu_button" :title="t`清空全部统计计数与排行榜`" @click="showClearConfirm = true">
          <i class="fa-solid fa-broom"></i>
          {{ t`清空统计` }}
        </button>
      </div>
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
    <ConfirmDialog
      :open="showApplyConfirm"
      :title="t`应用统计建议`"
      :message="applyConfirmMessage"
      :confirm-text="t`应用`"
      :cancel-text="t`取消`"
      @confirm="onApplyConfirmed"
      @cancel="showApplyConfirm = false"
    />
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import {
  buildStatsView,
  entryGroups,
  hitLeaderboard,
  clearStats,
  applyEntryFilters,
  entryInsight,
  entrySuggestion,
  dailySeries,
  entrySampleDistribution,
  fullExpectedRate,
  windowMetrics,
  applySuggestions,
  undoLastApply,
  GLOBAL_SCOPE,
  NONE_SCOPE,
  type EntryGroup,
  type EntryRankRow,
  type EntrySortBy,
  type HitRankRow,
  type Suggestion,
  type StatsView,
} from '@/core/stats';
import { requestTab, focusPoolEntry } from '@/core/floating-state';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import ChoiceSwitch from '@/components/shared/ChoiceSwitch.vue';
import { SCHEMA_VERSION, SUGGEST_MIN_SAMPLES, GenerationSettings, type PoolConfigEntry } from '@/type/settings';

const gs = useGlobalSettingsStore();
const stats = computed(() => gs.settings.stats);
const masterPool = computed(() => gs.settings.master_pool);
const configs = computed(() => gs.settings.configs);
const groupOrder = computed(() => gs.settings.group_order);
const sampleMin = SUGGEST_MIN_SAMPLES;

const pad2 = (n: number) => String(n).padStart(2, '0');

// ── 维度 ──
// 默认选中当前生效维度（有 config → 该 config；无 → NONE_SCOPE 并显示引导），
// 便于直接操作；「全局」作为聚合总览保留在选项里可随时切换。
const scopeId = ref<string>(usePoolSelectorStore().effectiveConfig?.id ?? NONE_SCOPE);

const hasNoneScopeData = computed(() => {
  const s = stats.value.entries[NONE_SCOPE];
  return !!s && (s.total_generated > 0 || Object.keys(s.by_entry).length > 0);
});

const scopeOptions = computed(() => {
  const opts: Array<{ id: string; name: string }> = [{ id: GLOBAL_SCOPE, name: t`全局` }];
  if (hasNoneScopeData.value || configs.value.length === 0) {
    opts.push({ id: NONE_SCOPE, name: t`未绑定配置` });
  }
  for (const c of configs.value) {
    opts.push({ id: c.id, name: c.name });
  }
  return opts;
});

// 选中维度指向的配置被删除时回退全局，避免下拉失配
watch(
  [configs, scopeId],
  () => {
    if (scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return;
    if (!configs.value.some(c => c.id === scopeId.value)) scopeId.value = GLOBAL_SCOPE;
  },
  { immediate: true },
);

const view = computed<StatsView>(() => buildStatsView(stats.value, scopeId.value));

/** 当前维度的有效池（config 引用的 enabled 条目；全局/未绑定档 = master_pool 全量） */
const poolCapsule = computed(() => {
  const scoped = scopeId.value;
  if (scoped === GLOBAL_SCOPE || scoped === NONE_SCOPE) {
    return {
      ids: new Set(masterPool.value.map(e => e.id)),
      size: masterPool.value.length,
      cfgMap: new Map<string, PoolConfigEntry>(),
    };
  }
  const cfg = configs.value.find(c => c.id === scoped);
  if (!cfg) return { ids: new Set<string>(), size: 0, cfgMap: new Map<string, PoolConfigEntry>() };
  const entryMap = new Map(cfg.entries.map(e => [e.entry_id, e] as const));
  const enabledPool = masterPool.value.filter(m => {
    const ce = entryMap.get(m.id);
    return ce !== undefined && ce.enabled !== false;
  });
  return { ids: new Set(enabledPool.map(e => e.id)), size: enabledPool.length, cfgMap: entryMap };
});

const effectivePoolSize = computed(() => poolCapsule.value.size);

/** 仅具体 config 维度可应用建议；全局 = 无写入目标，未绑定档 = 无 config 目标 */
const canApply = computed(() => {
  const scoped = scopeId.value;
  if (scoped === GLOBAL_SCOPE || scoped === NONE_SCOPE) return false;
  return configs.value.some(c => c.id === scoped);
});

// ── 无 config 引导 ──
const onCreateDefaultConfig = () => {
  // 清空既有 is_default：当前仅"无任何配置"场景可达，防御未来放开入口导致双 default
  //（effectiveConfig 取 find(is_default) 首个，双 default 会造成绑定解析歧义）
  for (const c of gs.settings.configs) c.is_default = false;
  const entries: PoolConfigEntry[] = masterPool.value.map(e => ({
    entry_id: e.id,
    pinned: e.pinned,
    weight: e.weight,
    enabled: true,
  }));
  const cfg = {
    id: uuidv4(),
    name: t`默认配置`,
    entries,
    is_default: true,
    // generation 为 v35 起废弃的死字段（schema 必填），不承载任何运行时数据
    generation: GenerationSettings.parse({}),
  };
  gs.settings.configs.push(cfg);
  // 迁移「未绑定档」历史统计到新配置维度：新配置成为 is_default 即生效，
  // 后续会话不再记 NONE_SCOPE。若不迁移，历史数据留在未绑定档、新维度从零
  // 开始，引导文案"创建后即可应用建议"因新维度样本不足而落空（数据断层）。
  // 整块迁移保证建议引擎基于同一份历史样本、入榜数据不丢失
  const stats = gs.settings.stats;
  const noneScope = stats.entries[NONE_SCOPE];
  if (noneScope && (noneScope.total_generated > 0 || Object.keys(noneScope.by_entry).length > 0)) {
    stats.entries[cfg.id] = noneScope;
    delete stats.entries[NONE_SCOPE];
  }
  scopeId.value = cfg.id;
  toastr.success(t`已创建默认配置（未绑定档历史统计已并入），可在统计页应用优化建议`);
};

// ── 汇总卡片 ──
const selectRateText = computed(() => {
  const total = view.value.total_generated;
  if (total <= 0) return '–';
  return Math.round((view.value.total_selected / total) * 100) + '%';
});

/** 有 daily 记录的天数（按天活动计数存在即算活跃日） */
const activeDays = computed(() => Object.keys(view.value.daily).length);

// ── 样本量分布诊断（为优化建议提供置信度参考；第三档「从未参与」基于有效池对照） ──
const distribution = computed(() => entrySampleDistribution(view.value, poolCapsule.value.size, poolCapsule.value.ids));
const sampleTotal = computed(
  () => distribution.value.sufficient + distribution.value.insufficient + distribution.value.never,
);
const sampleGoodPct = computed(() =>
  sampleTotal.value > 0 ? Math.round((distribution.value.sufficient / sampleTotal.value) * 100) + '%' : '–',
);
const sampleMidPct = computed(() =>
  sampleTotal.value > 0 ? Math.round((distribution.value.insufficient / sampleTotal.value) * 100) + '%' : '–',
);
const sampleNeverPct = computed(() =>
  sampleTotal.value > 0 ? Math.round((distribution.value.never / sampleTotal.value) * 100) + '%' : '–',
);

/** 池内参与率 = 当前维度 by_entry 中仍存在于有效池的条目数 ÷ 有效池大小 */
const poolParticipationText = computed(() => {
  const total = poolCapsule.value.size;
  if (total === 0) return '–';
  const poolIds = poolCapsule.value.ids;
  const participated = [...Object.entries(view.value.by_entry)].filter(
    ([id, e]) => e.rounds_included > 0 && poolIds.has(id),
  ).length;
  return `${participated} / ${total}`;
});

const updatedAtText = computed(() => {
  const ts = view.value.updated_at;
  if (!ts) return '–';
  const d = new Date(ts);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
});

// ── 趋势图 ──
const trendRangeOptions = [7, 30];
const trendDays = ref(7);
const trend = computed(() => dailySeries(view.value, trendDays.value));
const trendMax = computed(() => Math.max(1, ...trend.value.flatMap(p => [p.generated, p.selected])));

/** 柱高百分比：0 值零高，非 0 至少 4% 保证可见（视觉提示当天有活动） */
const barHeight = (v: number) => (v > 0 ? Math.max(4, Math.round((v / trendMax.value) * 100)) : 0) + '%';

/** 日期 label 稀疏规则：7 天全显示；30 天每 5 天显示一个，末尾（今天）始终显示 */
const showChartLabel = (i: number) => trendDays.value <= 7 || i % 5 === 0 || i === trend.value.length - 1;

// ── 条目榜 ──
const groups = computed(() => entryGroups(view.value, masterPool.value, groupOrder.value, poolCapsule.value.cfgMap));

const query = ref('');
const sortBy = ref<EntrySortBy>('rounds');
// 「只看有数据」持久化到全局 UI 偏好：切 tab/关面板/刷新均不丢（随 extension_settings 落盘）
const onlyWithData = computed({
  get: () => gs.settings.ui.stats_only_with_data,
  set: (v: boolean) => {
    gs.settings.ui.stats_only_with_data = v;
  },
});
const filteredGroups = computed(() =>
  applyEntryFilters(groups.value, {
    query: query.value,
    sortBy: sortBy.value,
    onlyWithData: onlyWithData.value,
  }),
);

const sortOptions: Array<{ key: EntrySortBy; label: string }> = [
  { key: 'rounds', label: t`参与` },
  { key: 'selection', label: t`命中` },
  { key: 'rate', label: t`命中率` },
  { key: 'content', label: t`内容` },
];

// 分组折叠状态（组件内存活，不持久化）
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

const allExpanded = computed(() => filteredGroups.value.length > 0 && filteredGroups.value.every(g => isExpanded(g)));

const groupSummary = (g: EntryGroup): string => {
  if (g.deletedGroup) return t`${g.rows.length} 条已删除`;
  if (g.rounds_included > 0) {
    const participated = g.rows.filter(r => r.rounds_included > 0).length;
    return t`参与 ${participated} 条 · ${g.rounds_included} 轮 · 命中率 ${rateText(g.rate)}`;
  }
  return t`未参与（${g.rows.length} 条）`;
};

const rateText = (rate: number | null): string => (rate === null ? '–' : Math.round(rate * 100) + '%');
const rateWidth = (rate: number) => Math.max(4, Math.round(rate * 100)) + '%';
const expectedRateText = (row: EntryRankRow): string => rateText(fullExpectedRate(row));

/** 窗口命中率展示文本（仅单一 config 维度有窗口数据；全局聚合 recent 为空） */
const windowMeta = (row: EntryRankRow): string | null => {
  const w = windowMetrics(row);
  if (!w) return null;
  return t`近 ${w.samples} 轮 ${rateText(w.rate)}`;
};

const windowTitle = (row: EntryRankRow): string | undefined => {
  const w = windowMetrics(row);
  if (!w) return undefined;
  return t`近 ${w.samples} 轮命中 ${w.hits} 次，期望 ${rateText(w.expectedRate)}`;
};

/** 类型徽标：已删除条目标「已删除」，否则 type（可空标「未标注」）。
 *  参数取最小结构：条目榜与命中榜共用，避免两处内联复刻后函数更新不同步 */
const typeLabel = (row: { deleted: boolean; type: string }): string => {
  if (row.deleted) return t`已删除`;
  return row.type || t`未标注`;
};

const entryText = (row: EntryRankRow): string => {
  if (row.deleted) return t`已删除条目 ${row.entryId.slice(0, 8)}…（${row.rounds_included} 轮）`;
  return row.content || row.type || t`（空内容）`;
};

/** 相对时间（最近参与/命中），用于 tooltip */
const timeAgo = (ts: number): string => {
  if (ts <= 0) return t`从未`;
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return t`刚刚`;
  if (min < 60) return t`${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return t`${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return t`${day} 天前`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return t`${mo} 个月前`;
  return t`${Math.floor(mo / 12)} 年前`;
};

const includedTimeTitle = (row: EntryRankRow): string => t`最近参与：${timeAgo(row.last_included_at)}`;

/** 参与轮次的语义说明 + 最近参与时间（共现归因：被 AI 舍弃的候选也算参与） */
const participationTitle = (row: EntryRankRow): string =>
  t`参与轮次 = 该条目被抽入候选菜单的轮次（轮次共现归因）；AI 输出为自由文本，被 AI 舍弃的候选也计参与。${includedTimeTitle(row)}`;

/** 最近选中文本 tooltip（条目榜与命中榜共用；参数取最小结构，两榜行为同源） */
const selectedTextTitle = (row: { last_selected_text: string | undefined }): string | undefined =>
  row.last_selected_text ? t`最近选中：${row.last_selected_text.slice(0, 40)}` : undefined;

const locateEntry = (entryId: string) => {
  requestTab('pool');
  focusPoolEntry(entryId);
};

const insightOf = (row: EntryRankRow) => entryInsight(row);
const suggestionOf = (row: EntryRankRow): Suggestion | null => entrySuggestion(row);

/** 洞察标签 tooltip：附建议依据（依据口径 / 命中率 / 期望 / 超额） */
const suggestionTitle = (row: EntryRankRow): string => {
  const s = suggestionOf(row);
  if (!s) return t`基于近 ${sampleMin} 轮或全量样本的统计建议`;
  const newWeightText = s.newWeight !== undefined ? ` → ${s.newWeight}` : '';
  const act = s.action === 'down' ? t`降权` : s.action === 'disable' ? t`停用` : t`提权`;
  return t`${s.basis === '窗口' ? `近 ${s.samples} 轮` : `全量 ${s.samples} 轮`}命中率 ${rateText(s.rate)}，期望 ${rateText(s.expected)}：建议${act}${newWeightText}`;
};

// ── 建议应用与撤销 ──
const applyableCount = computed(() =>
  canApply.value ? filteredGroups.value.flatMap(g => g.rows.filter(r => entrySuggestion(r) !== null)).length : 0,
);

const pending = ref<Suggestion[] | null>(null);
const showApplyConfirm = ref(false);
const undoAvailable = ref(false);

const actionLabel = (s: Suggestion): string =>
  s.action === 'down' ? t`降权` : s.action === 'disable' ? t`停用` : t`提权`;

const applyConfirmMessage = computed(() => {
  const list = pending.value ?? [];
  if (list.length === 0) return '';
  const lines = list
    .map(s => {
      const row = groups.value.flatMap(g => g.rows).find(r => r.entryId === s.entryId);
      const name = (row?.content || s.entryId).slice(0, 24);
      const change = s.action === 'disable' ? t`启用 → 停用` : `${t`权重`} ${s.currentWeight} → ${s.newWeight}`;
      const basis = s.basis === '窗口' ? t`近 ${s.samples} 轮` : t`全量 ${s.samples} 轮`;
      return `· ${name}：${actionLabel(s)}（${change}；${basis}命中 ${rateText(s.rate)}，期望 ${rateText(s.expected)}）`;
    })
    .join('\n');
  return t`将应用到当前配置：\n${lines}\n\n停用后该条目不再参与生成，不会自动恢复（可在条目池页手动重新启用）。`;
});

const applyOne = (s: Suggestion) => {
  pending.value = [s];
  showApplyConfirm.value = true;
};

/** 行内应用按钮（模板无法用非空断言，包装一层判空） */
const applySuggestion = (row: EntryRankRow) => {
  const s = entrySuggestion(row);
  if (s) applyOne(s);
};

const applyAll = () => {
  pending.value = filteredGroups.value
    .flatMap(g => g.rows)
    .map(r => entrySuggestion(r))
    .filter((s): s is Suggestion => s !== null);
  showApplyConfirm.value = true;
};

const onApplyConfirmed = () => {
  const list = pending.value ?? [];
  showApplyConfirm.value = false;
  pending.value = null;
  if (list.length === 0 || scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return;
  const res = applySuggestions(scopeId.value, list);
  undoAvailable.value = res.applied > 0;
  toastr.success(
    res.skipped > 0
      ? t`已应用 ${res.applied} 条建议（跳过 ${res.skipped} 条，可在统计页撤销）`
      : t`已应用 ${res.applied} 条建议（可在统计页撤销）`,
  );
};

const onUndo = () => {
  if (undoLastApply()) {
    undoAvailable.value = false;
    toastr.success(t`已撤销上次应用`);
  }
};

// ── 命中榜（用户选择条目的排行） ──
const hitRank = computed(() => hitLeaderboard(view.value, masterPool.value));

/** 命中榜行文本：已删除条目显示占位，否则内容优先于 type */
const hitText = (row: HitRankRow): string => {
  if (row.deleted) return t`已删除条目 ${row.entryId.slice(0, 8)}…（命中 ${row.count} 次）`;
  return row.content || row.type || t`（空内容）`;
};

// ── 导出与管理 ──
const exportStats = () => {
  const payload = {
    exported_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    stats: {
      total_generated: stats.value.total_generated,
      total_selected: stats.value.total_selected,
      updated_at: stats.value.updated_at,
      // v51 按 config 维度（scopeId = config.id；无 config 会话 = '__none__'）
      entries: stats.value.entries,
    },
    leaderboard_scope: view.value.scopeId,
    leaderboard: groups.value
      .flatMap(g => g.rows)
      .map(r => ({
        id: r.entryId,
        deleted: r.deleted,
        content: r.content,
        type: r.type,
        category: r.category,
        rounds_included: r.rounds_included,
        rounds_with_selection: r.rounds_with_selection,
        expected_sum: r.expected_sum,
        rate: r.rate,
        recent: r.recent,
        effective_weight: r.effectiveWeight,
        effective_pinned: r.effectivePinned,
        last_included_at: r.last_included_at,
        last_selected_text: r.last_selected_text,
        insight: insightOf(r),
      })),
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}`;
  const json = JSON.stringify(payload, null, 2);
  // 下载交互沿用项目既有先例（EntryPoolDialog/PromptEditor 同款 Blob + 临时 a 元素），
  // 临时元素不参与 UI 渲染，不属于"手写 DOM 结构"约束范畴。
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `choice-stats-${stamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toastr.success(t`已导出统计 JSON`);
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

/* ── 维度切换条 ── */
.choice-stats-dim-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-stats-scope-select {
  flex: 0 1 220px;
  min-width: 120px;
}

.choice-stats-undo {
  flex-shrink: 0;
}

.choice-stats-dim-note {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

/* ── 引导卡（无 config） ── */
.choice-stats-guide {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  padding: var(--choice-space-3);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-color-info);
  border-radius: var(--choice-radius-md);
}

.choice-stats-guide b {
  color: var(--choice-color-info);
  font-size: var(--choice-text-sm);
}

.choice-stats-guide p {
  margin: var(--choice-space-1) 0 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
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

/* 长文本卡片（最近统计）用小号，避免 380px 下溢出卡片 */
.choice-stats-card-value--sm {
  font-size: var(--choice-text-sm);
  word-break: normal;
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

.choice-stats-head-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-stats-apply-all {
  white-space: nowrap;
}

.choice-stats-brief {
  margin: 0 0 var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

/* ── 分段按钮组（趋势天数 / 排序维度共用） ── */
.choice-stats-seg {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  flex-wrap: wrap;
}

.choice-stats-seg-btn {
  border: none;
  background: none;
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-xs);
  padding: 2px 8px;
  border-radius: var(--choice-radius-sm);
  cursor: pointer;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
  white-space: nowrap;
}

.choice-stats-seg-btn:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-stats-seg-btn--active {
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
  font-weight: 600;
}

/* ── 趋势柱状图 ── */
.choice-chart {
  display: flex;
  gap: 3px;
  height: 130px;
  padding: var(--choice-space-2);
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  overflow-x: auto;
  overflow-y: hidden;
}

.choice-chart-day {
  flex: 1 1 0;
  min-width: 12px;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}

.choice-chart-bars {
  display: flex;
  gap: 2px;
  align-items: flex-end;
  justify-content: center;
  height: calc(100% - 14px);
}

.choice-chart-col {
  width: 40%;
  max-width: 10px;
  min-height: 0;
  border-radius: 2px 2px 0 0;
  transition: height var(--choice-transition);
}

.choice-chart-col--generated {
  background: var(--choice-color-info);
}

.choice-chart-col--selected {
  background: var(--choice-color-success);
}

.choice-chart-label {
  flex-shrink: 0;
  text-align: center;
  font-size: 9px;
  line-height: 1;
  color: var(--choice-text-muted);
  padding-top: 3px;
  white-space: nowrap;
}

.choice-chart-legend {
  display: flex;
  align-items: center;
  gap: var(--choice-space-3);
  margin-top: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-chart-legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.choice-chart-legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.choice-chart-legend-dot--generated {
  background: var(--choice-color-info);
}

.choice-chart-legend-dot--selected {
  background: var(--choice-color-success);
}

/* ── 条目榜工具条 ── */
.choice-stats-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--choice-space-2);
  margin-bottom: var(--choice-space-2);
}

.choice-stats-search {
  flex: 1 1 160px;
  min-width: 0;
}

.choice-stats-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  cursor: pointer;
  white-space: nowrap;
  user-select: none;
}

/* ── 洞察徽标 ── */
.choice-stats-insight {
  flex-shrink: 0;
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  font-size: var(--choice-text-xs);
  font-weight: 600;
  white-space: nowrap;
}

.choice-stats-insight--bad {
  background: var(--choice-color-warning-bg);
  color: var(--choice-color-warning);
}

.choice-stats-insight--disable {
  background: var(--choice-color-error-bg);
  color: var(--choice-color-error);
}

.choice-stats-insight--good {
  background: var(--choice-color-success-bg);
  color: var(--choice-color-success);
}

.choice-stats-insight--insufficient {
  background: var(--choice-bg-hover);
  color: var(--choice-text-muted);
}

/* ── 样本量分布诊断 ── */
.choice-stats-sample {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-sample-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-stats-sample-label {
  flex-shrink: 0;
  min-width: 64px;
}

.choice-stats-sample-track {
  flex: 1 1 auto;
  min-width: 0;
  height: 6px;
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-hover);
  overflow: hidden;
}

.choice-stats-sample-fill {
  height: 100%;
  border-radius: var(--choice-radius-full);
  transition: width var(--choice-transition);
}

.choice-stats-sample-fill--good {
  background: var(--choice-color-success);
}

.choice-stats-sample-fill--mid {
  background: var(--choice-color-warning);
}

.choice-stats-sample-fill--none {
  background: var(--choice-text-muted);
  opacity: 0.5;
}

.choice-stats-sample-row > b {
  flex-shrink: 0;
  color: var(--choice-text);
  font-weight: 600;
}

/* 作用域说明（弱化样式，区别于主 brief） */
.choice-stats-brief--scope {
  margin-top: calc(-1 * var(--choice-space-1));
  color: var(--choice-text-muted);
  font-style: italic;
}

/* 定位/应用按钮：行内靠右 */
.choice-stats-locate,
.choice-stats-apply {
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-stats-locate:hover {
  color: var(--choice-color-info);
}

.choice-stats-apply:hover {
  color: var(--choice-color-success);
}

/* 未命中轮次用 muted 色，区别于命中的 secondary */
.choice-stats-meta-miss {
  color: var(--choice-text-muted) !important;
  font-weight: 500;
}

/* 期望命中率与窗口命中率使用 info/成功色区分语义 */
.choice-stats-meta-expected b {
  color: var(--choice-color-info);
}

.choice-stats-meta-window b {
  color: var(--choice-color-success);
}

/* 命中榜「最近选中」文本：单行截断，避免长选项挤爆行 */
.choice-stats-meta-hit-text {
  display: inline-block;
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: bottom;
}

/* ── 命中率 / 占比进度条 ── */
.choice-stats-rate-track {
  height: 4px;
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-hover);
  overflow: hidden;
}

.choice-stats-rate-fill {
  height: 100%;
  border-radius: var(--choice-radius-full);
  background: var(--choice-color-success);
  transition: width var(--choice-transition);
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

/* ── 管理 ── */
.choice-stats-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-2);
}
</style>
