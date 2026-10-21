<template>
  <div class="choice-stats-settings">
    <!-- 控制簇：统计采集单开关（v78 起自动化系统已移除，统计页为纯报表） -->
    <div class="choice-section">
      <div class="choice-stats-card-head">
        <h4 class="choice-section-title"><i class="fa-solid fa-sliders"></i>{{ t`统计` }}</h4>
        <span class="choice-stats-info" :title="controlHelp"><i class="fa-solid fa-circle-info"></i></span>
      </div>
      <div class="choice-stats-switch-row">
        <label class="choice-stats-toggle">
          <ChoiceSwitch
            v-model="statsEnabled"
            :title="t`统计采集：开启后记录生成/选择数据（驱动下方报表）；关闭期间零记录，既有历史保留`"
          />
          <span>{{ t`统计采集` }}</span>
        </label>
      </div>
    </div>

    <!-- 统计关闭提示（仅提示；开关在上方控制簇，常驻可开可关） -->
    <div v-if="!statsEnabled" class="choice-stats-guide">
      <div>
        <b>{{ t`统计未开启` }}</b>
        <p>
          {{ t`关闭期间不记录任何生成/选择数据，既有历史保留。开启「统计采集」后开始积累。` }}
        </p>
      </div>
    </div>

    <!-- 粘性子头：维度切换（钉在设置面板可视区顶部，滚动时常驻可达） -->
    <div class="choice-stats-sticky-head">
      <!-- 维度切换：全局（聚合所有 config） / 未绑定档 / 各条目池配置 -->
      <div class="choice-stats-dim-bar">
        <select v-model="scopeId" class="text_pole choice-stats-scope-select" :title="t`统计维度`">
          <option v-for="o in scopeOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <span v-if="view.isGlobal" class="choice-stats-dim-note">{{ t`全局 = 全部配置的混合统计` }}</span>
        <span v-else-if="scopeId === NONE_SCOPE" class="choice-stats-dim-note">{{
          t`未绑定配置档（无 config 会话）`
        }}</span>
        <span v-else class="choice-stats-dim-note">{{ t`仅该条目池配置生效会话计入` }}</span>
      </div>
    </div>

    <!-- 概览（恒展开）：汇总卡片 + 样本分布 + 趋势三合一，减少标题噪音 -->
    <div id="choice-stats-anchor-overview" class="choice-section" data-anchor="overview">
      <div class="choice-stats-card-head">
        <h4 class="choice-section-title"><i class="fa-solid fa-chart-pie"></i>{{ t`概览` }}</h4>
        <span class="choice-stats-info" :title="overviewHelp"><i class="fa-solid fa-circle-info"></i></span>
      </div>
      <div class="choice-stats-overview-body">
        <!-- 汇总卡片 -->
        <div class="choice-stats-cards">
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--info"
              ><i class="fa-solid fa-wand-magic-sparkles"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`累计生成` }}</div>
              <div class="choice-stats-card-value">{{ view.total_generated }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--success"
              ><i class="fa-solid fa-hand-pointer"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`累计选择` }}</div>
              <div class="choice-stats-card-value">{{ view.total_selected }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--warning"
              ><i class="fa-solid fa-arrow-trend-up"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`选择率` }}</div>
              <div class="choice-stats-card-value">{{ selectRateText }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--neutral"
              ><i class="fa-solid fa-calendar"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`活跃天数` }}</div>
              <div class="choice-stats-card-value">{{ activeDays }}</div>
            </div>
          </div>
          <div
            class="choice-stats-card"
            :title="
              t`池内参与率 = 有效池中至少进入过一轮生成候选的条目数 ÷ 有效池条目数。候选被抽中即计参与（轮次共现归因）；AI 输出为自由文本、选项与条目无法精确一一对应，被 AI 舍弃的候选也会计入`
            "
          >
            <span class="choice-stats-card-icon choice-stats-card-icon--info"
              ><i class="fa-solid fa-layer-group"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`池内参与率` }}</div>
              <div class="choice-stats-card-value">{{ poolParticipationText }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--neutral"
              ><i class="fa-solid fa-clock"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`最近统计` }}</div>
              <div class="choice-stats-card-value choice-stats-card-value--sm">{{ updatedAtText }}</div>
            </div>
          </div>
        </div>

        <!-- 样本量分布诊断 -->
        <div class="choice-stats-sub-block">
          <div class="choice-stats-sub-block-head">
            <span class="choice-stats-mini-title"><i class="fa-solid fa-vial"></i>{{ t`样本分布` }}</span>
            <p class="choice-stats-sub">
              {{
                t`有效池 ${effectivePoolSize} 条 · 充足 ${distribution.sufficient} · 不足 ${distribution.insufficient} · 未参与 ${distribution.never}`
              }}
            </p>
          </div>
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
                <div
                  class="choice-stats-sample-fill choice-stats-sample-fill--mid"
                  :style="{ width: sampleMidPct }"
                ></div>
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
        <div class="choice-stats-sub-block">
          <div class="choice-stats-sub-block-head">
            <span class="choice-stats-mini-title"><i class="fa-solid fa-chart-column"></i>{{ t`趋势` }}</span>
            <div class="choice-seg">
              <button
                v-for="d in trendRangeOptions"
                :key="d"
                class="choice-seg-btn"
                :class="{ active: trendDays === d }"
                @click="trendDays = d"
              >
                {{ d }} {{ t`天` }}
              </button>
            </div>
          </div>
          <p class="choice-stats-sub">{{ t`近 ${trendDays} 天生成 / 选择活动` }}</p>
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
      </div>
    </div>

    <!-- 条目榜（主内容；分组默认折叠，展开后限高滚动，避免无限撑长页面） -->
    <ChoiceSectionCard
      id="choice-stats-anchor-leaderboard"
      title="条目榜"
      icon="fa-solid fa-ranking-star"
      data-anchor="leaderboard"
    >
      <template #extra>
        <span class="choice-stats-info" :title="leaderboardHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions">
          <button
            v-if="filteredGroups.length > 0"
            class="choice-icon-btn"
            :title="allExpanded ? t`全部收起` : t`全部展开`"
            @click="allExpanded ? collapseAll() : expandAll()"
          >
            <i :class="allExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand'"></i>
          </button>
        </div>
      </template>
      <p class="choice-stats-sub">{{ t`分组 ${filteredGroups.length} 个 · 条目 ${leaderboardRowCount} 条` }}</p>
      <div class="choice-stats-toolbar">
        <input
          v-model="query"
          class="text_pole choice-stats-search"
          type="search"
          :placeholder="t`搜索内容 / 类型 / 分类`"
        />
        <div class="choice-seg">
          <button
            v-for="o in sortOptions"
            :key="o.key"
            class="choice-seg-btn"
            :class="{ active: sortBy === o.key }"
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
      <div v-if="groups.length === 0" class="choice-empty">
        <div class="choice-empty-icon"><i class="fa-solid fa-ranking-star"></i></div>
        <p>{{ t`条目库为空——先在条目池页添加条目并生成一组选项` }}</p>
      </div>
      <div v-else-if="filteredGroups.length === 0" class="choice-empty">
        <div class="choice-empty-icon"><i class="fa-solid fa-ranking-star"></i></div>
        <p>{{ t`没有匹配的条目，试试调整搜索或筛选条件` }}</p>
      </div>
      <div v-else class="choice-stats-groups">
        <div v-for="g in filteredGroups" :key="g.key" class="choice-stats-group">
          <button :ref="groupHeadRef(g)" class="choice-stats-group-head" @click="toggleGroup(g)">
            <i class="fa-solid" :class="isExpanded(g) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            <span class="choice-stats-group-name">{{ g.category }}</span>
            <span class="choice-stats-group-summary">{{ groupSummary(g) }}</span>
          </button>
          <div v-if="isExpanded(g)" class="choice-stats-group-body choice-scrollbar">
            <div v-for="row in g.rows" :key="row.entryId" class="choice-stats-rank-row">
              <!-- 主行：类型徽标 + 内容 + 右侧操作按钮（精简，指标读数收进 meta 行） -->
              <div class="choice-stats-rank-main">
                <span
                  class="choice-stats-type-badge"
                  :class="{
                    'choice-stats-type-badge--none': !row.type && !row.deleted,
                    'choice-stats-type-badge--deleted': row.deleted,
                  }"
                  >{{ typeLabel(row) }}</span
                >
                <span class="choice-stats-rank-text" :title="selectedTextTitle(row)">{{ entryText(row) }}</span>
                <span class="choice-stats-rank-actions">
                  <button
                    v-if="!row.deleted"
                    class="choice-icon-btn choice-stats-locate"
                    :title="t`在条目库中定位`"
                    @click="locateEntry(row.entryId)"
                  >
                    <i class="fa-solid fa-location-crosshairs"></i>
                  </button>
                </span>
              </div>
              <div
                v-if="row.rate !== null"
                class="choice-stats-rate-track"
                :title="`${t`命中率`} ${rateText(row.rate)} / ${t`期望`} ${expectedRateText(row)}`"
              >
                <div class="choice-stats-rate-fill" :style="{ width: rateWidth(row.rate) }"></div>
              </div>
              <!-- meta 行：命中率/期望/窗口读数 + 参与/命中/未命中 -->
              <div class="choice-stats-rank-meta">
                <span v-if="row.rate !== null" class="choice-stats-rank-rate" :title="t`命中率 = 命中轮次 ÷ 参与轮次`"
                  >{{ t`命中率` }} <b>{{ rateText(row.rate) }}</b></span
                >
                <span class="choice-stats-rank-expected"
                  >{{ t`期望` }} <b>{{ expectedRateText(row) }}</b></span
                >
                <span v-if="windowMeta(row)" class="choice-stats-rank-window" :title="windowTitle(row)">{{
                  windowMeta(row)
                }}</span>
                <span :title="participationTitle(row)"
                  >{{ t`参与` }} <b>{{ row.rounds_included }}</b></span
                >
                <span
                  >{{ t`命中` }} <b>{{ row.rounds_with_selection }}</b></span
                >
                <span
                  >{{ t`未命中` }}
                  <b class="choice-stats-meta-miss">{{ row.rounds_included - row.rounds_with_selection }}</b></span
                >
              </div>
            </div>
          </div>
        </div>
      </div>
    </ChoiceSectionCard>

    <!-- 骰子战绩（全局维度，不随 config 切换；默认折叠） -->
    <ChoiceSectionCard id="choice-stats-anchor-dice" title="骰子战绩" icon="fa-solid fa-dice" data-anchor="dice">
      <template #extra>
        <span class="choice-stats-info" :title="diceHelp"><i class="fa-solid fa-circle-info"></i></span>
      </template>
      <p class="choice-stats-sub">
        {{ t`共 ${diceStats.total_rolls} 次判定 · 胜率 ${diceRateText}（大成功 + 成功 ÷ 总掷数）` }}
      </p>
      <div v-if="diceStats.total_rolls === 0" class="choice-empty-hint">{{ t`尚未进行过骰子判定` }}</div>
      <template v-else>
        <div class="choice-stats-cards">
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--neutral"><i class="fa-solid fa-dice"></i></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`总掷数` }}</div>
              <div class="choice-stats-card-value">{{ diceStats.total_rolls }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--crit-success"
              ><i class="fa-solid fa-star"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`大成功` }}</div>
              <div class="choice-stats-card-value">{{ diceStats.by_outcome.crit_success }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--success"
              ><i class="fa-solid fa-check"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`成功` }}</div>
              <div class="choice-stats-card-value">{{ diceStats.by_outcome.success }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--danger"><i class="fa-solid fa-xmark"></i></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`失败` }}</div>
              <div class="choice-stats-card-value">{{ diceStats.by_outcome.fail }}</div>
            </div>
          </div>
          <div class="choice-stats-card">
            <span class="choice-stats-card-icon choice-stats-card-icon--crit-fail"
              ><i class="fa-solid fa-bolt"></i
            ></span>
            <div class="choice-stats-card-body">
              <div class="choice-stats-card-label">{{ t`大失败` }}</div>
              <div class="choice-stats-card-value">{{ diceStats.by_outcome.crit_fail }}</div>
            </div>
          </div>
        </div>
        <div class="choice-stats-sub-block">
          <div class="choice-stats-sub-block-head">
            <span class="choice-stats-mini-title"><i class="fa-solid fa-chart-column"></i>{{ t`近 7 天判定` }}</span>
          </div>
          <p class="choice-stats-sub">{{ t`每日判定次数（含大成功/大失败）` }}</p>
          <div class="choice-chart">
            <div v-for="p in diceTrend" :key="p.key" class="choice-chart-day">
              <div class="choice-chart-bars">
                <div
                  class="choice-chart-col choice-chart-col--dice"
                  :style="{ height: diceBarHeight(p.total) }"
                  :title="`${p.label} ${t`判定`} ${p.total}`"
                ></div>
              </div>
              <!-- 骰子图固定 7 天，标签全显示（不复用受 trendDays 影响的 showChartLabel） -->
              <span class="choice-chart-label">{{ p.label }}</span>
            </div>
          </div>
        </div>
        <!-- 最近判定历史（v61）：FIFO 上限 DICE_HISTORY_LIMIT，随 stats_enabled 采集 -->
        <div class="choice-stats-sub-block">
          <div class="choice-stats-sub-block-head">
            <span class="choice-stats-mini-title"><i class="fa-solid fa-clock-rotate-left"></i>{{ t`最近判定` }}</span>
          </div>
          <p class="choice-stats-sub">{{ t`最近 ${diceHistoryLimit} 次判定（点数 / 需求 / 结局）` }}</p>
          <div v-if="diceHistory.length === 0" class="choice-empty-hint">{{ t`暂无判定历史` }}</div>
          <ol v-else class="choice-dice-history-list">
            <li v-for="(h, i) in diceHistory" :key="i" class="choice-dice-history-item">
              <span class="choice-dice-history-text" :title="h.text">{{ h.text }}</span>
              <span class="choice-dice-history-nums"
                ><b>{{ h.roll }}</b
                >/{{ h.rate }}
                <span class="choice-dice-history-outcome" :class="`choice-dice-history-outcome--${h.outcome}`">{{
                  rollLabelHist(h.outcome)
                }}</span></span
              >
            </li>
          </ol>
        </div>
      </template>
    </ChoiceSectionCard>

    <!-- 命中榜（用户选择条目的排行；默认折叠） -->
    <ChoiceSectionCard id="choice-stats-anchor-hitrank" title="命中榜" icon="fa-solid fa-crown" data-anchor="hitrank">
      <template #extra>
        <span class="choice-stats-info" :title="hitRankHelp"><i class="fa-solid fa-circle-info"></i></span>
      </template>
      <p class="choice-stats-sub">{{ t`被选择过的条目，按命中次数排序` }}</p>
      <div v-if="hitRank.length === 0" class="choice-empty">
        <div class="choice-empty-icon"><i class="fa-solid fa-crown"></i></div>
        <p>{{ t`尚未选择过任何条目` }}</p>
      </div>
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
    </ChoiceSectionCard>

    <!-- 管理（默认折叠） -->
    <ChoiceSectionCard id="choice-stats-anchor-manage" title="管理" icon="fa-solid fa-sliders" data-anchor="manage">
      <template #extra>
        <span class="choice-stats-info" :title="manageHelp"><i class="fa-solid fa-circle-info"></i></span>
      </template>
      <p class="choice-stats-sub">{{ t`导出 JSON 备份 / 清空后重新统计` }}</p>
      <div class="choice-stats-actions">
        <button class="menu_button" :title="t`导出统计为 JSON`" @click="exportStats()">
          <i class="fa-solid fa-download"></i>
          {{ t`导出 JSON` }}
        </button>
        <button class="menu_button" :title="t`清空全部统计计数与排行榜`" @click="onClearStats">
          <i class="fa-solid fa-broom"></i>
          {{ t`清空统计` }}
        </button>
      </div>
    </ChoiceSectionCard>

    <ConfirmDialog
      :open="clearOpen"
      :title="clearTitle"
      :message="clearMessage"
      :confirm-text="clearConfirmText"
      :cancel-text="clearCancelText"
      @confirm="confirmClear"
      @cancel="cancelClear"
    />
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { DiceOutcome } from '@/core/dice';
import {
  buildStatsView,
  entryGroups,
  hitLeaderboard,
  clearStats,
  applyEntryFilters,
  dailySeries,
  entrySampleDistribution,
  fullExpectedRate,
  windowMetrics,
  diceWinRate,
  DICE_HISTORY_LIMIT,
  GLOBAL_SCOPE,
  NONE_SCOPE,
  type EntryGroup,
  type EntryRankRow,
  type EntrySortBy,
  type HitRankRow,
  type StatsView,
  type WindowMetrics,
} from '@/core/stats';
import { requestTab, focusPoolEntry } from '@/core/floating-state';
import { EMPTY_DISPLAY } from '@/core/constants';
import { formatDateTime, isoTimestamp, pad2 } from '@/util/time';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useConfirm } from '@/components/shared/useConfirm';
import ChoiceSwitch from '@/components/shared/ChoiceSwitch.vue';
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import {
  SCHEMA_VERSION,
  STATS_MIN_SAMPLES,
  createEmptyDiceStats,
  type DiceStats,
  type PoolConfigEntry,
} from '@/type/settings';

const gs = useGlobalSettingsStore();
const stats = computed(() => gs.settings.stats);
const masterPool = computed(() => gs.settings.master_pool);
const configs = computed(() => gs.settings.configs);
const groupOrder = computed(() => gs.settings.group_order);
const sampleMin = STATS_MIN_SAMPLES;

// ── 区块标题 info tooltip：完整说明收进原生 title，页面只留一行副标题 ──
/** 概览（汇总卡片 / 样本分布 / 趋势 三合一）说明 */
const overviewHelp = computed(
  () =>
    t`汇总卡片：当前维度（全局 = 所有配置聚合）的累计生成/选择/选择率/活跃天数/池内参与率/最近活动。样本分布：当前维度有效池 ${effectivePoolSize.value} 条目的样本覆盖——参与 ≥${sampleMin} 轮命中率读数才基本可信，不足的标「样本不足」，充足占比越高报表读数越可信；「参与」指条目进入过生成轮候选菜单（轮次共现），不代表选项一定出现在输出中。趋势：按天统计的生成/选择活动（仅行动选项视图计入，随选中维度），自 v51 起累积，历史不回填。`,
);
const leaderboardHelp = computed(() =>
  [
    t`命中轮次 = 选项被选中且文本匹配到该条目的轮次（精确归因：输出选项与候选 type+内容 做相似度匹配，被 AI 舍弃的候选不产生命中）；命中率与「期望」对比：期望 = 该条目方向被 AI 采纳输出时的随机点选基准（仅在输出匹配到该条目的轮次按「该条目被匹配到的输出数 ÷ 该轮输出条数」累计；AI 完全自由发挥的轮次不累计期望也不产生命中；统计满 ${sampleMin} 轮后按平均每轮点选数校正，多选时基线随之抬高），实际命中率持续高于期望说明该条目方向更常被采纳、低于期望说明更常被绕开。单个 config 维度额外显示近 ${sampleMin} 轮窗口命中率。参与轮次 = 该条目被抽入候选菜单的轮次（共现归因）：AI 输出为自由文本，被 AI 舍弃的候选也计参与；生成条数按 AI 输出条数计，池子小于请求条数或 AI 自由发挥时，参与条目数可能少于或多于生成条数。`,
    view.value.isGlobal ? t` 全局 = 所有配置混合累计，不代表任何单一场景。` : '',
  ].join(''),
);
const hitRankHelp = t`仅列出被选择过的条目（精确归因：输出选项文本匹配到该条目才算命中，被 AI 舍弃的候选不产生命中），按命中次数排序。`;
const diceHelp = t`骰子判定战绩（全局维度，不随条目池配置切换）：记录点击选项时的判定结局计数（D100 或骰式）与每日判定次数。随「统计采集」开关积累。清空统计时一并清除。`;
const manageHelp = t`导出统计为 JSON 便于备份与分析（含全部维度）；清空后所有维度与计数归零，用于重新统计。统计不与角色/聊天绑定，按条目池配置分维度累计。`;

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
  [configs, scopeId, hasNoneScopeData],
  () => {
    if (scopeId.value === GLOBAL_SCOPE) return;
    // NONE 数据已清空且有可用 config：NONE 选项已从下拉移除，滞留会让视图与模型脱节——回退全局
    if (scopeId.value === NONE_SCOPE) {
      if (!hasNoneScopeData.value && configs.value.length > 0) scopeId.value = GLOBAL_SCOPE;
      return;
    }
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

/** 统计采集开关（默认关）：关 = 零采集零写入，统计页横幅提示；开 = 自开启时刻积累，
 *  既有历史保留 */
const statsEnabled = computed({
  get: () => gs.settings.stats_enabled,
  set: (v: boolean) => {
    gs.settings.stats_enabled = v;
  },
});
/** 控制簇开关说明（统计采集；常驻可见） */
const controlHelp = t`统计采集：开启后记录行动选项的生成/选择数据（仅行动选项视图），驱动下方报表；关闭期间零记录，既有历史保留。统计页为纯报表，不会改写任何条目池配置。`;

// ── 汇总卡片 ──
const selectRateText = computed(() => {
  const total = view.value.total_generated;
  if (total <= 0) return EMPTY_DISPLAY;
  return Math.round((view.value.total_selected / total) * 100) + '%';
});

/** 有 daily 记录的天数（按天活动计数存在即算活跃日） */
const activeDays = computed(() => Object.keys(view.value.daily).length);

// ── 样本量分布诊断（第三档「从未参与」基于有效池对照） ──
const distribution = computed(() => entrySampleDistribution(view.value, poolCapsule.value.size, poolCapsule.value.ids));
const sampleTotal = computed(
  () => distribution.value.sufficient + distribution.value.insufficient + distribution.value.never,
);
const sampleGoodPct = computed(() =>
  sampleTotal.value > 0 ? Math.round((distribution.value.sufficient / sampleTotal.value) * 100) + '%' : EMPTY_DISPLAY,
);
const sampleMidPct = computed(() =>
  sampleTotal.value > 0 ? Math.round((distribution.value.insufficient / sampleTotal.value) * 100) + '%' : EMPTY_DISPLAY,
);
const sampleNeverPct = computed(() =>
  sampleTotal.value > 0 ? Math.round((distribution.value.never / sampleTotal.value) * 100) + '%' : EMPTY_DISPLAY,
);

/** 池内参与率 = 当前维度 by_entry 中仍存在于有效池的条目数 ÷ 有效池大小 */
const poolParticipationText = computed(() => {
  const total = poolCapsule.value.size;
  if (total === 0) return EMPTY_DISPLAY;
  const poolIds = poolCapsule.value.ids;
  const participated = [...Object.entries(view.value.by_entry)].filter(
    ([id, e]) => e.rounds_included > 0 && poolIds.has(id),
  ).length;
  return `${participated} / ${total}`;
});

const updatedAtText = computed(() => {
  const ts = view.value.updated_at;
  if (!ts) return EMPTY_DISPLAY;
  return formatDateTime(ts);
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

// ── 骰子战绩（全局维度，不随 config 切换） ──
const diceStats = computed<DiceStats>(() => stats.value.dice ?? createEmptyDiceStats());
const diceRateText = computed(() => {
  const r = diceWinRate(diceStats.value);
  return r === null ? '—' : rateText(r);
});
/** 近 7 天每日判定次数（合并四档计数），与 stats.ts dailyKey 同格式（本地时区） */
const diceTrend = computed(() => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Array<{ key: string; label: string; total: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    const c = diceStats.value.daily[key];
    out.push({
      key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      total: c ? c.crit_success + c.success + c.fail + c.crit_fail : 0,
    });
  }
  return out;
});
const diceTrendMax = computed(() => Math.max(1, ...diceTrend.value.map(p => p.total)));
const diceBarHeight = (v: number) => (v > 0 ? Math.max(4, Math.round((v / diceTrendMax.value) * 100)) : 0) + '%';
/** 最近判定历史（v61）：最新在前，空数组兜底老档缺字段。 */
const diceHistory = computed(() => [...(diceStats.value.history ?? [])].reverse());
const diceHistoryLimit = DICE_HISTORY_LIMIT;
const rollLabelHist = (o: DiceOutcome): string =>
  o === 'crit_success' ? t`大成功` : o === 'crit_fail' ? t`大失败` : o === 'success' ? t`成功` : t`失败`;

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

/** 条目榜副标题读数：当前筛选后的条目总数 */
const leaderboardRowCount = computed(() => filteredGroups.value.reduce((n, g) => n + g.rows.length, 0));

const sortOptions: Array<{ key: EntrySortBy; label: string }> = [
  { key: 'rounds', label: t`参与` },
  { key: 'selection', label: t`命中` },
  { key: 'rate', label: t`命中率` },
  { key: 'content', label: t`内容` },
];

// 分组折叠状态（组件内存活，不持久化）：默认全部折叠——去掉旧的「有数据自动展开」，
// 展开/收起完全由用户操作决定；组头 DOM 引用用于展开后滚回面板可视区。
// 状态与 DOM 引用一律按 g.key（EntryGroup 唯一渲染键，见 stats.ts）记账：
// 用户分类可能与系统「已删除」组重名，按 category 会串扰
const collapsed = ref<Set<string>>(new Set());
const forced = ref<Set<string>>(new Set());
const groupEls = new Map<string, HTMLElement>();
const groupHeadRef = (g: EntryGroup) => (el: unknown) => {
  if (el instanceof HTMLElement) groupEls.set(g.key, el);
};

const isExpanded = (g: EntryGroup): boolean => forced.value.has(g.key) && !collapsed.value.has(g.key);

const toggleGroup = (g: EntryGroup) => {
  const expand = !isExpanded(g);
  if (expand) {
    collapsed.value.delete(g.key);
    forced.value.add(g.key);
    // 展开后把组头滚回面板可视区（block: nearest 仅在需要时滚动），避免被面板底部截断
    nextTick(() => {
      const el = groupEls.get(g.key);
      el?.scrollIntoView({ block: 'nearest' });
    });
  } else {
    collapsed.value.add(g.key);
    forced.value.delete(g.key);
  }
};

const expandAll = () => {
  collapsed.value = new Set();
  forced.value = new Set(groups.value.map(g => g.key));
};

const collapseAll = () => {
  collapsed.value = new Set(groups.value.map(g => g.key));
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

/** 组头汇总读数由 groupSummary 承担；分组头部不再挂建议徽标（v78 自动化移除） */

const rateText = (rate: number | null): string => (rate === null ? EMPTY_DISPLAY : Math.round(rate * 100) + '%');
const rateWidth = (rate: number) => Math.max(4, Math.round(rate * 100)) + '%';
const expectedRateText = (row: EntryRankRow): string => rateText(metaOf(row).expectedRate);

/** 窗口命中率展示文本（仅单一 config 维度有窗口数据；全局聚合 recent 为空） */
const windowMeta = (row: EntryRankRow): string | null => {
  const w = metaOf(row).window;
  if (!w) return null;
  return t`近 ${w.samples} 轮 ${rateText(w.rate)}`;
};

const windowTitle = (row: EntryRankRow): string | undefined => {
  const w = metaOf(row).window;
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

/** 每行窗口/期望指标一次性计算（模板多处复用，避免大池渲染时每行重复遍历 recent 窗口）：
 *  行内命中率 tooltip、窗口读数与期望读数直接从缓存读。
 *  基于过滤前全量 groups 构建，切换搜索/筛选时读数不受影响。 */
type RowMeta = {
  window: WindowMetrics | null;
  expectedRate: number | null;
};

const rowMeta = computed<Map<string, RowMeta>>(() => {
  const map = new Map<string, RowMeta>();
  const avgPicks = view.value.avgPicks;
  for (const g of groups.value) {
    for (const r of g.rows) {
      map.set(r.entryId, {
        window: windowMetrics(r.recent, avgPicks),
        expectedRate: fullExpectedRate(r),
      });
    }
  }
  return map;
});

/** 读取行级元数据（rowMeta 基于全量 groups 必然收录，兜底防未来新增行路径） */
const metaOf = (row: EntryRankRow): RowMeta => rowMeta.value.get(row.entryId) ?? { window: null, expectedRate: null };

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
    exported_at: isoTimestamp(),
    schema_version: SCHEMA_VERSION,
    stats: {
      // 顶级 total_* 已废弃不再持续写入（全局总量由各 scope 聚合推导）：
      // 导出时临时求和，保持导出格式与旧版兼容
      total_generated: Object.values(stats.value.entries).reduce((n, s) => n + s.total_generated, 0),
      total_selected: Object.values(stats.value.entries).reduce((n, s) => n + s.total_selected, 0),
      updated_at: stats.value.updated_at,
      // v51 按 config 维度（scopeId = config.id；无 config 会话 = '__none__'）
      entries: stats.value.entries,
      // 骰子判定战绩（全局维度原始结构）
      dice: stats.value.dice,
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

const {
  open: clearOpen,
  show: showClearConfirm,
  confirm: confirmClear,
  cancel: cancelClear,
  title: clearTitle,
  message: clearMessage,
  confirmText: clearConfirmText,
  cancelText: clearCancelText,
} = useConfirm();
/** 清空统计：弹确认 → 确认后清空。取消只关闭弹窗（无 pending 状态） */
const onClearStats = async () => {
  const ok = await showClearConfirm({
    title: t`清空统计`,
    message: t`确定要清空所有统计数据和排行榜吗？此操作不可撤销。`,
    confirmText: t`清空`,
    cancelText: t`取消`,
  });
  if (!ok) return;
  clearStats();
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

.choice-stats-dim-note {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

/* ── 粘性子头（维度条 + 快捷跳转） ── */
/* 钉在设置面板 .choice-floating-body 可视区顶部（overflow-y:auto 是其滚动上下文），
   滚动时常驻可达——切换维度/跳转分区无需滚回顶部。tab 条会向上滚走、子头钉顶 */
.choice-stats-sticky-head {
  position: sticky;
  top: 0;
  /* 复用面板层级 token（不硬编码）：钉顶头需盖住下方滚动的同级分区，又处在面板内容栈内 */
  z-index: var(--choice-z-panel);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) 0;
  /* 不透明背景：暗/亮主题下均不透出下方滚动内容；细阴影与 content 分层，
     现代面板感（传统做法只有一条 hard border）。blur 为渐进增强，老 WebView
     忽略 backdrop-filter 时回落纯色 + 阴影，仍可读 */
  background: var(--choice-bg);
  border-bottom: 1px solid var(--choice-border);
  box-shadow: 0 var(--choice-space-1) var(--choice-space-4) rgba(0, 0, 0, 0.12);
  backdrop-filter: blur(6px);
}

/* 锚点分区滚动留白：抵消粘性头高度（维度条+内边距），避免跳转后标题被钉顶头遮挡。
   统计页区块已迁移为卡片组件（可折叠 ChoiceSectionCard / 恒展开 .choice-section），
   锚点 id 经 $attrs 落到根 <section>（.choice-section-card / .choice-section），scroll-margin 需挂在这两者上 */
.choice-section-card[data-anchor],
.choice-section[data-anchor] {
  scroll-margin-top: calc(var(--choice-space-6) * 2 + var(--choice-space-5));
}

/* ── 概览分区：三块（卡片/样本/趋势）合并在一个折叠体内，减少标题噪音 ── */
.choice-stats-overview-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

/* 概览内的子块（样本/趋势）：无独立 section-head，用一行迷你标题 + 副控件 */
.choice-stats-sub-block {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-sub-block-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--choice-space-2);
}

.choice-stats-mini-title {
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-stats-mini-title i {
  color: var(--choice-color-info);
  font-size: var(--choice-text-sm);
}

.choice-stats-sub-block-head > .choice-stats-sub {
  margin: 0;
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
  /* 响应式列数：680px 面板约 4 列，400px 约 2 列，窄触屏约 2 列，不溢出 */
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--choice-space-2);
}

.choice-stats-card {
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  align-items: flex-start;
  gap: var(--choice-space-2);
  min-width: 0;
}

/* 图标 chip：色块底 + 语义色图标，承担视觉锚点（数值本身不染色，保持可读性） */
.choice-stats-card-icon {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: var(--choice-radius-md);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: var(--choice-text-sm);
}

.choice-stats-card-icon--info {
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
}

.choice-stats-card-icon--success {
  background: var(--choice-color-success-bg);
  color: var(--choice-color-success);
}

.choice-stats-card-icon--warning {
  background: var(--choice-color-warning-bg);
  color: var(--choice-color-warning);
}

.choice-stats-card-icon--neutral {
  background: var(--choice-bg-hover);
  color: var(--choice-text-secondary);
}

/* 骰子战绩彩蛋结局：大成功（星标）与 大失败（闪电）语义对立——
   大成功用成功绿、大失败用失败红，不再同色难辨 */
.choice-stats-card-icon--crit-success {
  background: var(--choice-color-success-bg);
  color: var(--choice-color-success);
}

.choice-stats-card-icon--crit-fail {
  background: var(--choice-color-error-bg);
  color: var(--choice-color-error);
}

/* 骰子战绩失败结局（普通失败） */
.choice-stats-card-icon--danger {
  background: var(--choice-color-error-bg);
  color: var(--choice-color-error);
}

.choice-stats-card-body {
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

.choice-stats-card-value {
  font-size: var(--choice-text-lg);
  font-weight: 700;
  color: var(--choice-text);
  line-height: 1.1;
  word-break: break-all;
  /* 数字列对齐：统计数字滚动/刷新时宽度不抖动 */
  font-variant-numeric: tabular-nums;
}

/* 长文本卡片（最近统计）用小号，避免窄卡片下溢出 */
.choice-stats-card-value--sm {
  font-size: var(--choice-text-sm);
  word-break: normal;
}

/* ── 恒展开固定卡（.choice-section）的标题行：标题左、帮助/操作右 ── */
.choice-stats-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--choice-space-2);
  margin-bottom: var(--choice-space-2);
}

/* 固定卡标题图标与卡片体系一致：主色点亮；可折叠卡（ChoiceSectionCard）标题已由组件自身着色 */
.choice-stats-card-head .choice-section-title i {
  color: var(--choice-color-info);
}

/* 说明入口：悬停显示完整口径/规则说明（原生 title，触屏长按可见） */
.choice-stats-info {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  cursor: help;
}

.choice-stats-info:hover {
  color: var(--choice-color-info);
}

.choice-stats-head-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  margin-left: auto;
}

/* 一行副标题：只保留读数式要点，完整说明进标题旁 info tooltip */
.choice-stats-sub {
  margin: 0 0 var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

/* 分段按钮组（趋势天数 / 排序维度）已统一为 global.css 的 .choice-seg/.choice-seg-btn 原子 */

/* ── 键盘焦点可见态：组头与图标按钮统一描边（对照 border-active），
    分段按钮已统一为 global.css 的 .choice-seg/.choice-seg-btn 原子，focus 由原子承担，
    hover 反馈保留原样 */
.choice-stats-group-head:focus-visible,
.choice-icon-btn:focus-visible {
  outline: 1px solid var(--choice-border-active);
  outline-offset: 1px;
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

.choice-chart-col--dice {
  background: var(--choice-color-info);
}

.choice-chart-label {
  flex-shrink: 0;
  text-align: center;
  font-size: var(--choice-text-2xs);
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
  flex: 1 1 140px;
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
  /* 工具条/开关行里不被压缩，放不下时换行而不是挤压文字 */
  flex-shrink: 0;
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

/* 定位按钮：行内靠右 */
.choice-stats-locate {
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-stats-locate:hover {
  color: var(--choice-color-info);
}

/* 未命中轮次用 muted 色，区别于命中的 secondary */
.choice-stats-meta-miss {
  color: var(--choice-text-muted) !important;
  font-weight: 500;
}

/* 命中榜「最近选中」label 用 info 色区分语义 */
.choice-stats-meta-expected b {
  color: var(--choice-color-info);
}

/* ── 开关行：紧凑排列，窄屏自动换行 ── */
.choice-stats-switch-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--choice-space-3);
  margin-bottom: var(--choice-space-2);
}

/* 命中率/期望/窗口紧凑读数（meta 行内）：用 success/info/success 区分 */
.choice-stats-rank-rate,
.choice-stats-rank-expected,
.choice-stats-rank-window {
  flex-shrink: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  white-space: nowrap;
}

.choice-stats-rank-rate b {
  color: var(--choice-color-success);
  font-weight: 700;
}

.choice-stats-rank-expected b {
  color: var(--choice-color-info);
  font-weight: 600;
}

.choice-stats-rank-window {
  color: var(--choice-color-success);
  font-weight: 600;
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
  height: 3px;
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

/* 展开后的组内容限高 + 内部滚动：条目再多也只占固定高度，不再无限撑长页面 */
.choice-stats-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) var(--choice-space-2) var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  background: var(--choice-bg-panel);
  max-height: 360px;
  overflow-y: auto;
  overscroll-behavior: contain;
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
  padding: var(--choice-space-1) var(--choice-space-2);
  background: var(--choice-bg-elevated);
  border-radius: var(--choice-radius-sm);
  border-left: 3px solid transparent;
  min-width: 0;
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
}

/* 行 hover 反馈：背景亮起 + 左缘 accent，提示该行可交互（应用/重新启用/定位） */
.choice-stats-rank-row:hover {
  background: var(--choice-bg-hover);
  border-left-color: var(--choice-border-active);
}

.choice-stats-rank-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--choice-space-1) var(--choice-space-2);
  min-width: 0;
}

/* 行内操作按钮组：主行右侧右对齐（rank-text flex:1 撑满后的自然位置） */
.choice-stats-rank-actions {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  flex-shrink: 0;
  margin-left: auto;
}

.choice-stats-rank-no {
  flex-shrink: 0;
  width: 20px;
  text-align: center;
  font-size: var(--choice-text-xs);
  font-weight: 700;
  color: var(--choice-text-muted);
  /* 数字对齐：刷新/翻页时排名位宽不抖动 */
  font-variant-numeric: tabular-nums;
}

.choice-rank-1 {
  color: var(--choice-color-warning);
}

.choice-rank-2 {
  color: var(--choice-text-secondary);
}

.choice-rank-3 {
  color: var(--choice-text-muted);
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
  align-items: center;
  flex-wrap: wrap;
  gap: var(--choice-space-1) var(--choice-space-3);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  padding: var(--choice-space-1) 0 0;
  border-top: 1px dashed var(--choice-border);
  /* 参与/命中/命中率等数字列对齐，避免刷新/翻页抖动 */
  font-variant-numeric: tabular-nums;
}

.choice-stats-rank-meta b {
  color: var(--choice-text-secondary);
  font-weight: 600;
}

/* ── 管理 ── */
.choice-stats-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-2);
}

/* ── 骰子最近判定历史（v61） ── */
.choice-dice-history-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 240px;
  overflow-y: auto;
}
.choice-dice-history-item {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: 3px var(--choice-space-2);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-element);
  font-size: var(--choice-text-xs);
}
.choice-dice-history-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--choice-text-secondary);
}
.choice-dice-history-nums {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
  color: var(--choice-text-secondary);
}
.choice-dice-history-nums b {
  color: var(--choice-text);
}
.choice-dice-history-outcome {
  font-weight: 600;
  margin-left: var(--choice-space-1);
}
.choice-dice-history-outcome--crit_success,
.choice-dice-history-outcome--success {
  color: var(--choice-color-success);
}
.choice-dice-history-outcome--fail,
.choice-dice-history-outcome--crit_fail {
  color: var(--choice-color-danger);
}
</style>
