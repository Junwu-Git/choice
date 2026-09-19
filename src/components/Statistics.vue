<template>
  <div class="choice-stats-settings">
    <!-- 控制簇：统计/自动化/AI 归因/AI 理由四开关集中（原「统计与自动化」+「AI 增强」两段合并，
         减少顶部标题噪音）；运行状态读数随开关显隐 -->
    <div class="choice-stats-section">
      <div class="choice-stats-section-head">
        <h4 class="choice-stats-section-title"><i class="fa-solid fa-sliders"></i>{{ t`统计与自动化` }}</h4>
        <span class="choice-stats-info" :title="controlHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions"></div>
      </div>
      <div class="choice-stats-ai-row">
        <label class="choice-stats-toggle">
          <ChoiceSwitch
            v-model="statsEnabled"
            :title="t`统计采集：开启后记录生成/选择数据（驱动下方报表与建议引擎）；关闭期间零记录，既有历史保留`"
          />
          <span>{{ t`统计采集` }}</span>
        </label>
        <label class="choice-stats-toggle">
          <ChoiceSwitch
            v-model="automationEnabled"
            :disabled="!statsEnabled"
            :title="t`自动化：建议引擎/阵容计划/AI 增强（需先开启统计采集）；只想看统计报表可保持关闭`"
          />
          <span>{{ t`自动化建议` }}</span>
        </label>
        <template v-if="statsEnabled && automationEnabled">
          <label class="choice-stats-toggle">
            <ChoiceSwitch
              v-model="aiAttributionEnabled"
              :title="t`归因开关：每轮生成后后台 AI 修正选项→条目归因（成本提示见问号帮助）`"
            />
            <span>{{ t`AI 归因` }}</span>
          </label>
          <label class="choice-stats-toggle">
            <ChoiceSwitch
              v-model="aiAnalysisEnabled"
              :title="t`建议理由开关：为有统计建议的条目生成 AI 解释（仅展示）`"
            />
            <span>{{ t`AI 建议理由` }}</span>
          </label>
        </template>
      </div>
      <p v-if="statsEnabled && automationEnabled && aiAttributionEnabled" class="choice-stats-sub choice-stats-ai-l1">
        {{
          t`归因队列 ${aiAttributionState.queued} · 已修正 ${aiAttributionState.corrected} 条次 · 迁移命中 ${aiAttributionState.migrated} 条次`
        }}
      </p>
      <p v-if="statsEnabled && automationEnabled && aiCacheEntryCount > 0" class="choice-stats-sub">
        {{ t`已为 ${aiCacheEntryCount} 条建议生成理由（${aiCacheTimeText}）· 数据更新后自动重算` }}
      </p>
    </div>

    <!-- 统计关闭提示（仅提示；开关在上方控制簇，常驻可开可关） -->
    <div v-if="!statsEnabled" class="choice-stats-guide">
      <div>
        <b>{{ t`统计未开启` }}</b>
        <p>
          {{
            t`关闭期间不记录任何生成/选择数据，既有历史保留。开启「统计采集」后开始积累；仅需查看报表时保持「自动化建议」关闭即可。`
          }}
        </p>
      </div>
    </div>

    <!-- 粘性子头：维度切换 + 快捷跳转 pills（钉在设置面板可视区顶部，滚动时常驻可达） -->
    <div class="choice-stats-sticky-head">
      <!-- 维度切换：全局（聚合所有 config） / 未绑定档 / 各条目池配置 -->
      <div class="choice-stats-dim-bar">
        <select v-model="scopeId" class="text_pole choice-stats-scope-select" :title="t`统计维度`">
          <option v-for="o in scopeOptions" :key="o.id" :value="o.id">{{ o.name }}</option>
        </select>
        <button
          v-if="undoCount > 0"
          class="menu_button choice-stats-undo"
          :title="t`撤销最近一次应用到条目池配置的修改（可连续撤销）`"
          @click="onUndo"
        >
          <i class="fa-solid fa-rotate-left"></i>
          {{ t`撤销 (${undoCount})` }}
        </button>
        <span v-if="view.isGlobal" class="choice-stats-dim-note">{{ t`全局 = 全部配置的混合统计` }}</span>
        <span v-else-if="scopeId === NONE_SCOPE" class="choice-stats-dim-note">{{
          t`未绑定配置档（无 config 会话）`
        }}</span>
        <span v-else class="choice-stats-dim-note">{{ t`仅该条目池配置生效会话计入` }}</span>
      </div>
      <div v-if="jumpTargets.length > 1" class="choice-stats-jump-bar">
        <button v-for="j in jumpTargets" :key="j.anchor" class="choice-stats-jump-pill" @click="jumpTo(j.anchor)">
          {{ j.label }}
        </button>
      </div>
    </div>

    <!-- 无 config 引导：应用建议需要 config 作为写入目标（关闭态隐藏——建议应用不可达） -->
    <div
      v-if="statsEnabled && automationEnabled && scopeId === NONE_SCOPE && configs.length === 0"
      class="choice-stats-guide"
    >
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
    <div v-else-if="statsEnabled && automationEnabled && scopeId === NONE_SCOPE" class="choice-stats-guide">
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

    <!-- 概览（可折叠，默认展开）：汇总卡片 + 样本分布 + 趋势三合一，减少标题噪音 -->
    <div id="choice-stats-anchor-overview" class="choice-stats-section choice-stats-overview" data-anchor="overview">
      <div class="choice-stats-section-head">
        <button class="choice-stats-section-toggle" @click="showOverview = !showOverview">
          <i
            class="fa-solid fa-chevron-right choice-stats-chevron"
            :class="{ 'choice-stats-chevron--open': showOverview }"
          ></i>
          <h4 class="choice-stats-section-title"><i class="fa-solid fa-chart-pie"></i>{{ t`概览` }}</h4>
        </button>
        <span class="choice-stats-info" :title="overviewHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions"></div>
      </div>
      <div v-if="showOverview" class="choice-stats-section-body choice-stats-overview-body">
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
    <div id="choice-stats-anchor-leaderboard" class="choice-stats-section" data-anchor="leaderboard">
      <div class="choice-stats-section-head">
        <h4 class="choice-stats-section-title"><i class="fa-solid fa-ranking-star"></i>{{ t`条目榜` }}</h4>
        <span class="choice-stats-info" :title="leaderboardHelp"><i class="fa-solid fa-circle-info"></i></span>
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
            v-if="statsEnabled && automationEnabled && aiAnalysisEnabled"
            class="menu_button choice-stats-ai-btn"
            :class="{ 'choice-stats-ai-btn--running': aiAnalysisState.running }"
            :disabled="aiAnalysisState.running"
            :title="t`为当前维度有统计建议的条目生成/刷新 AI 理由（仅展示，不改动作）`"
            @click="onRunAiAnalysis()"
          >
            <i class="fa-solid fa-brain"></i>
            {{ aiAnalyzeLabel }}
          </button>
          <button
            v-if="statsEnabled && automationEnabled && aiAnalysisEnabled && aiAnalysisState.running"
            class="menu_button"
            :title="t`取消当前 AI 理由分析（已完成的批次不写入）`"
            @click="onCancelAiAnalysis()"
          >
            <i class="fa-solid fa-xmark"></i>
            {{ t`取消` }}
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
      <p class="choice-stats-sub">{{ t`分组 ${filteredGroups.length} 个 · 条目 ${leaderboardRowCount} 条` }}</p>
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
      <div v-if="groups.length === 0" class="choice-empty-hint">
        {{ t`条目库为空——先在条目池页添加条目并生成一组选项` }}
      </div>
      <div v-else-if="filteredGroups.length === 0" class="choice-empty-hint">
        {{ t`没有匹配的条目，试试调整搜索或筛选条件` }}
      </div>
      <div v-else class="choice-stats-groups">
        <div v-for="g in filteredGroups" :key="g.key" class="choice-stats-group">
          <button :ref="groupHeadRef(g)" class="choice-stats-group-head" @click="toggleGroup(g)">
            <i class="fa-solid" :class="isExpanded(g) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            <span class="choice-stats-group-name">{{ g.category }}</span>
            <span v-if="canApply && groupSuggestCount(g) > 0" class="choice-stats-suggest-badge">{{
              t`${groupSuggestCount(g)} 条建议`
            }}</span>
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
                    v-if="canApplyRow(row)"
                    class="choice-icon-btn choice-stats-apply"
                    :title="t`应用这条建议到当前配置`"
                    @click="applySuggestion(row)"
                  >
                    <i class="fa-solid fa-check"></i>
                  </button>
                  <button
                    v-if="insightOf(row) === 'disabled' && canApply && !row.deleted"
                    class="choice-icon-btn choice-stats-reenable"
                    :title="t`重新启用该条目（恢复参与生成；不记应用历史）`"
                    @click="reEnable(row)"
                  >
                    <i class="fa-solid fa-power-off"></i>
                  </button>
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
              <!-- meta 行：洞察徽标 + 命中率/期望/窗口读数 + 参与/命中/未命中 -->
              <div class="choice-stats-rank-meta">
                <span
                  v-if="statsEnabled && automationEnabled && badgeOf(row)"
                  class="choice-stats-insight"
                  :class="badgeOf(row)?.cls"
                  :title="badgeOf(row)?.title"
                  >{{ badgeOf(row)?.text }}</span
                >
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
              <div
                v-if="statsEnabled && automationEnabled && aiReasonOf(row)"
                class="choice-stats-ai-reason"
                :class="{ 'choice-stats-ai-reason--low': (aiReasonOf(row)?.confidence ?? 0) < 0.4 }"
                :title="t`AI 生成的理由（置信度 ${aiReasonOf(row)?.confidence ?? 0}）；仅解释统计建议，不改变动作`"
              >
                <i class="fa-solid fa-brain"></i>
                <span>{{ aiReasonOf(row)?.reason ?? '' }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 骰子战绩（全局维度，不随 config 切换；默认折叠） -->
    <div id="choice-stats-anchor-dice" class="choice-stats-section" data-anchor="dice">
      <div class="choice-stats-section-head">
        <button class="choice-stats-section-toggle" @click="showDice = !showDice">
          <i
            class="fa-solid fa-chevron-right choice-stats-chevron"
            :class="{ 'choice-stats-chevron--open': showDice }"
          ></i>
          <h4 class="choice-stats-section-title"><i class="fa-solid fa-dice"></i>{{ t`骰子战绩` }}</h4>
        </button>
        <span class="choice-stats-info" :title="diceHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions"></div>
      </div>
      <div v-if="showDice" class="choice-stats-section-body">
        <p class="choice-stats-sub">
          {{ t`共 ${diceStats.total_rolls} 次判定 · 胜率 ${diceRateText}（大成功 + 成功 ÷ 总掷数）` }}
        </p>
        <div v-if="diceStats.total_rolls === 0" class="choice-empty-hint">{{ t`尚未进行过骰子判定` }}</div>
        <template v-else>
          <div class="choice-stats-cards">
            <div class="choice-stats-card">
              <span class="choice-stats-card-icon choice-stats-card-icon--neutral"
                ><i class="fa-solid fa-dice"></i
              ></span>
              <div class="choice-stats-card-body">
                <div class="choice-stats-card-label">{{ t`总掷数` }}</div>
                <div class="choice-stats-card-value">{{ diceStats.total_rolls }}</div>
              </div>
            </div>
            <div class="choice-stats-card">
              <span class="choice-stats-card-icon choice-stats-card-icon--crit"><i class="fa-solid fa-star"></i></span>
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
              <span class="choice-stats-card-icon choice-stats-card-icon--danger"
                ><i class="fa-solid fa-xmark"></i
              ></span>
              <div class="choice-stats-card-body">
                <div class="choice-stats-card-label">{{ t`失败` }}</div>
                <div class="choice-stats-card-value">{{ diceStats.by_outcome.fail }}</div>
              </div>
            </div>
            <div class="choice-stats-card">
              <span class="choice-stats-card-icon choice-stats-card-icon--crit"><i class="fa-solid fa-bolt"></i></span>
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
        </template>
      </div>
    </div>

    <!-- 阵容计划（半自动：默认折叠；仅具体 config 维度可写） -->
    <div v-if="canApply" id="choice-stats-anchor-roster" class="choice-stats-section" data-anchor="roster">
      <div class="choice-stats-section-head">
        <button class="choice-stats-section-toggle" @click="showRoster = !showRoster">
          <i
            class="fa-solid fa-chevron-right choice-stats-chevron"
            :class="{ 'choice-stats-chevron--open': showRoster }"
          ></i>
          <h4 class="choice-stats-section-title"><i class="fa-solid fa-users-gear"></i>{{ t`阵容计划` }}</h4>
        </button>
        <span class="choice-stats-info" :title="rosterHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions">
          <button
            v-if="showRoster && rosterPlan && (rosterPlan.drops.length > 0 || rosterPlan.promotes.length > 0)"
            class="menu_button choice-stats-apply-all"
            :title="t`把落出/补入清单应用到当前配置`"
            @click="applyRoster()"
          >
            <i class="fa-solid fa-users-gear"></i>
            {{ t`应用阵容计划` }}
            <b>{{ rosterPlan.drops.length + rosterPlan.promotes.length }}</b>
          </button>
        </div>
      </div>
      <div v-if="showRoster" class="choice-stats-section-body">
        <p class="choice-stats-sub">{{ t`按目标在役条数生成落出 / 补入清单` }}</p>
        <div class="choice-stats-roster-bar">
          <label class="choice-stats-toggle">
            <ChoiceSwitch v-model="rosterEnabled" :title="t`启用阵容计划`" />
            <span>{{ t`启用` }}</span>
          </label>
          <label class="choice-stats-roster-size" :class="{ 'choice-stats-roster-size--off': !rosterEnabled }">
            {{ t`目标在役条数` }}
            <input
              v-model="rosterSizeText"
              class="text_pole choice-stats-roster-input"
              type="number"
              min="1"
              step="1"
              :placeholder="t`如 12`"
              @blur="syncRosterDisplay"
            />
          </label>
        </div>
        <div v-if="rosterPlan" class="choice-stats-roster-readout">
          {{ t`在役 ${rosterPlan.activeCount} 条` }}
          <template v-if="rosterPlan.exempt > 0"> · {{ t`${rosterPlan.exempt} 条被豁免` }}</template>
          · {{ t`替补席 ${benchCount} 条` }} · {{ t`未入池 ${unreferencedCount} 条` }}
        </div>
        <div v-if="rosterEnabled && rosterPlan" class="choice-stats-roster">
          <div v-if="rosterPlan.drops.length > 0" class="choice-stats-roster-col">
            <div class="choice-stats-roster-col-head choice-stats-roster-col-head--drop">
              <i class="fa-solid fa-arrow-down"></i>
              {{ t`落出 (${rosterPlan.drops.length})` }}
            </div>
            <div v-for="a in rosterPlan.drops" :key="a.entryId" class="choice-stats-roster-item">
              <span class="choice-stats-type-badge">{{ rosterTypeLabel(a) }}</span>
              <span class="choice-stats-roster-text" :title="rosterReason(a)">{{ rosterText(a) }}</span>
            </div>
          </div>
          <div v-if="rosterPlan.promotes.length > 0" class="choice-stats-roster-col">
            <div class="choice-stats-roster-col-head choice-stats-roster-col-head--promote">
              <i class="fa-solid fa-arrow-up"></i>
              {{ t`补入 (${rosterPlan.promotes.length})` }}
            </div>
            <div v-for="a in rosterPlan.promotes" :key="a.entryId" class="choice-stats-roster-item">
              <span class="choice-stats-type-badge">{{ rosterTypeLabel(a) }}</span>
              <span class="choice-stats-roster-text" :title="rosterReason(a)">{{ rosterText(a) }}</span>
            </div>
          </div>
          <div v-if="rosterPlan.drops.length === 0 && rosterPlan.promotes.length === 0" class="choice-empty-hint">
            {{ rosterEmptyText }}
          </div>
        </div>
      </div>
    </div>

    <!-- 应用历史：最近自动化写入批次（持久撤销槽的可视化，刷新不丢；默认折叠；统计或自动化
         任一关闭时隐藏——撤销入口保留在顶部维度条，config 写入记录与统计关停解耦） -->
    <div
      v-if="statsEnabled && automationEnabled && historyEntries.length > 0"
      id="choice-stats-anchor-history"
      class="choice-stats-section"
      data-anchor="history"
    >
      <div class="choice-stats-section-head">
        <button class="choice-stats-section-toggle" @click="showHistory = !showHistory">
          <i
            class="fa-solid fa-chevron-right choice-stats-chevron"
            :class="{ 'choice-stats-chevron--open': showHistory }"
          ></i>
          <h4 class="choice-stats-section-title"><i class="fa-solid fa-clock-rotate-left"></i>{{ t`应用历史` }}</h4>
        </button>
        <span class="choice-stats-info" :title="historyHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions">
          <span v-if="undoCount > 1" class="choice-stats-dim-note">{{
            t`共 ${historyEntries.length} 批，可逐条撤销`
          }}</span>
        </div>
      </div>
      <div v-if="showHistory" class="choice-stats-section-body">
        <p class="choice-stats-sub">{{ t`最近应用批次，可逐条撤销` }}</p>
        <div class="choice-stats-history">
          <div v-for="h in historyEntries" :key="h.entry.id" class="choice-stats-history-item">
            <div class="choice-stats-history-head">
              <span
                class="choice-stats-kind"
                :class="h.entry.kind === 'roster' ? 'choice-stats-kind--roster' : 'choice-stats-kind--suggestions'"
                >{{ h.entry.kind === 'roster' ? t`阵容` : t`建议` }}</span
              >
              <span class="choice-stats-history-time" :title="h.entry.ts ? historyTimeTitle(h.entry.ts) : undefined">{{
                h.entry.ts ? timeAgo(h.entry.ts) : EMPTY_DISPLAY
              }}</span>
              <span class="choice-stats-history-count">{{ t`${h.changes.length} 条变更` }}</span>
              <button
                class="choice-icon-btn choice-stats-history-undo"
                :title="t`撤销这一批应用`"
                @click="undoHistoryEntry(h.entry.id)"
              >
                <i class="fa-solid fa-rotate-left"></i>
              </button>
            </div>
            <div v-if="h.changes.length > 0" class="choice-stats-history-changes">
              <div v-for="c in h.changes" :key="c.entryId" class="choice-stats-history-change">
                <span class="choice-stats-type-badge">{{ c.name }}</span>
                <span class="choice-stats-history-change-text">{{ c.change }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 命中榜（用户选择条目的排行；默认折叠） -->
    <div id="choice-stats-anchor-hitrank" class="choice-stats-section" data-anchor="hitrank">
      <div class="choice-stats-section-head">
        <button class="choice-stats-section-toggle" @click="showHitRank = !showHitRank">
          <i
            class="fa-solid fa-chevron-right choice-stats-chevron"
            :class="{ 'choice-stats-chevron--open': showHitRank }"
          ></i>
          <h4 class="choice-stats-section-title"><i class="fa-solid fa-crown"></i>{{ t`命中榜` }}</h4>
        </button>
        <span class="choice-stats-info" :title="hitRankHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions"></div>
      </div>
      <div v-if="showHitRank" class="choice-stats-section-body">
        <p class="choice-stats-sub">{{ t`被选择过的条目，按命中次数排序` }}</p>
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
    </div>

    <!-- 管理（默认折叠） -->
    <div id="choice-stats-anchor-manage" class="choice-stats-section" data-anchor="manage">
      <div class="choice-stats-section-head">
        <button class="choice-stats-section-toggle" @click="showManage = !showManage">
          <i
            class="fa-solid fa-chevron-right choice-stats-chevron"
            :class="{ 'choice-stats-chevron--open': showManage }"
          ></i>
          <h4 class="choice-stats-section-title"><i class="fa-solid fa-sliders"></i>{{ t`管理` }}</h4>
        </button>
        <span class="choice-stats-info" :title="manageHelp"><i class="fa-solid fa-circle-info"></i></span>
        <div class="choice-stats-head-actions"></div>
      </div>
      <div v-if="showManage" class="choice-stats-section-body">
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
      </div>
    </div>

    <ConfirmDialog :open="clearOpen" @confirm="confirmClear" @cancel="cancelClear" />
    <ConfirmDialog :open="applyOpen" @confirm="confirmApply" @cancel="cancelApply" />
    <ConfirmDialog :open="rosterOpen" @confirm="confirmRoster" @cancel="cancelRoster" />
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
  undoApply,
  applyHistorySummary,
  planRoster,
  applyRosterPlan,
  reEnableEntry,
  diceWinRate,
  GLOBAL_SCOPE,
  NONE_SCOPE,
  suggestionKey,
  type EntryGroup,
  type EntryInsight,
  type EntryRankRow,
  type EntrySortBy,
  type HitRankRow,
  type RosterAction,
  type RosterPlan,
  type Suggestion,
  type StatsView,
  type WindowMetrics,
} from '@/core/stats';
import { requestTab, focusPoolEntry } from '@/core/floating-state';
import { EMPTY_DISPLAY } from '@/core/constants';
import { formatDateTime, isoTimestamp, pad2 } from '@/util/time';
import { aiAnalysisState, runAiAnalysis } from '@/core/ai-analysis';
import { aiAttributionState } from '@/core/ai-attribution';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useConfirm } from '@/components/shared/useConfirm';
import ChoiceSwitch from '@/components/shared/ChoiceSwitch.vue';
import {
  SCHEMA_VERSION,
  SUGGEST_MIN_SAMPLES,
  GenerationSettings,
  AI_ANALYSIS_DEBOUNCE_MS,
  createEmptyDiceStats,
  type AiAnalysisEntry,
  type DiceStats,
  type PoolConfigEntry,
} from '@/type/settings';

const gs = useGlobalSettingsStore();
const stats = computed(() => gs.settings.stats);
const masterPool = computed(() => gs.settings.master_pool);
const configs = computed(() => gs.settings.configs);
const groupOrder = computed(() => gs.settings.group_order);
const sampleMin = SUGGEST_MIN_SAMPLES;

// ── 折叠分区状态（组件内，不持久化：切 tab 组件卸载即重置） ──
const showOverview = ref(true);
const showDice = ref(false);
const showHitRank = ref(false);
const showRoster = ref(false);
const showHistory = ref(false);
const showManage = ref(false);

// ── 区块标题 info tooltip：完整说明收进原生 title，页面只留一行副标题 ──
/** 概览（汇总卡片 / 样本分布 / 趋势 三合一）说明 */
const overviewHelp = computed(
  () =>
    t`汇总卡片：当前维度（全局 = 所有配置聚合）的累计生成/选择/选择率/活跃天数/池内参与率/最近活动。样本分布：当前维度有效池 ${effectivePoolSize.value} 条目的样本覆盖——参与 ≥${sampleMin} 轮命中率才可信（可出建议），不足的只标「样本不足」，充足占比越高优化建议越可信；「参与」指条目进入过生成轮候选菜单（轮次共现），不代表选项一定出现在输出中。趋势：按天统计的生成/选择活动（仅行动选项视图计入，随选中维度），自 v51 起累积，历史不回填。`,
);
const leaderboardHelp = computed(() =>
  [
    t`命中轮次 = 选项被选中且文本匹配到该条目的轮次（精确归因：输出选项与候选 type+内容 做相似度匹配，被 AI 舍弃的候选不产生命中）；命中率与「期望」对比：期望 = 该条目方向被 AI 采纳输出时的随机点选基准（仅在输出匹配到该条目的轮次按「该条目被匹配到的输出数 ÷ 该轮输出条数」累计；AI 完全自由发挥的轮次不累计期望也不产生命中），高于期望越多越值得提权，低于越多越值得降权。单个 config 维度额外显示近 ${sampleMin} 轮窗口命中率。参与轮次 = 该条目被抽入候选菜单的轮次（共现归因）：AI 输出为自由文本，被 AI 舍弃的候选也计参与；生成条数按 AI 输出条数计，池子小于请求条数或 AI 自由发挥时，参与条目数可能少于或多于生成条数。`,
    view.value.isGlobal ? t` 全局 = 所有配置混合累计，不代表任何单一场景；建议功能需切换到具体配置维度。` : '',
  ].join(''),
);
const hitRankHelp = t`仅列出被选择过的条目（精确归因：输出选项文本匹配到该条目才算命中，被 AI 舍弃的候选不产生命中），按命中次数排序。`;
const diceHelp = t`骰子判定战绩（全局维度，不随条目池配置切换）：记录点击选项时的 D100 判定结局计数与每日判定次数。随「统计采集」开关积累；不参与条目建议/权重。清空统计时一并清除。`;
const rosterHelp = t`为目标在役条数 N 生成落出/补入清单：超过 N 的条目按表现（超额命中率，窗口优先/全量兜底）从末尾落出（软停用、保留统计），空位由替补席（曾停用条目）优先补入，再按探索预算从未入池条目补入。pinned 与样本不足（参与 <${sampleMin} 轮）豁免；点「应用」确认后写入，可撤销。`;
const historyHelp = t`最近应用到当前配置的自动化批次（建议/阵容），刷新不丢。撤销恢复应用前的权重/启闭状态并重置对应条目的冷却观察期。`;
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

/** 统计采集开关（默认关）：关 = 零采集零写入，统计页横幅提示；开 = 自开启时刻积累，
 *  既有历史保留。只想看统计的用户开启此项即可 */
const statsEnabled = computed({
  get: () => gs.settings.stats_enabled,
  set: (v: boolean) => {
    gs.settings.stats_enabled = v;
  },
});
/** 自动化开关（默认关，依赖统计采集）：关 = 纯报表（无建议引擎/阵容/AI）；
 *  开 = 在统计数据基础上启用自动化。仅统计开启时才有意义，UI 上置灰引导 */
const automationEnabled = computed({
  get: () => gs.settings.automation_enabled,
  set: (v: boolean) => {
    gs.settings.automation_enabled = v;
  },
});
/** 控制簇四开关说明（统计采集 / 自动化建议 / AI 归因 / AI 建议理由；常驻可见） */
const controlHelp = t`统计采集：开启后记录行动选项的生成/选择数据（仅行动选项视图），驱动下方报表与建议引擎；关闭期间零记录，既有历史保留。自动化建议：在统计数据基础上启用建议引擎（提权/降权/停用）、阵容计划与 AI 增强；只想看统计报表的用户保持关闭即可。自动化依赖统计采集，统计关闭时自动化不可用。AI 归因：每轮行动选项生成后，后台异步调 AI 把选项语义匹配到候选条目，结果与本地 Dice 归因 diff 后对称修正统计（默认关：每次生成会多一次 API 请求，且将条目内容送往模型）。AI 建议理由：为当前维度有统计建议的条目生成自然语言解释（打开统计页/切维度按需触发，默认开；仅展示，不改变建议动作与写入链路）。两个 AI 功能均需已配置 API，未配置时静默降级为纯统计。`;
const canApply = computed(() => {
  if (!statsEnabled.value || !automationEnabled.value) return false;
  const scoped = scopeId.value;
  if (scoped === GLOBAL_SCOPE || scoped === NONE_SCOPE) return false;
  return configs.value.some(c => c.id === scoped);
});

// ── AI 增强开关（独立，默认：归因关 / 分析开；见 settings.ts 字段注释） ──
const aiAttributionEnabled = computed({
  get: () => gs.settings.ai_attribution_enabled,
  set: (v: boolean) => {
    gs.settings.ai_attribution_enabled = v;
  },
});
const aiAnalysisEnabled = computed({
  get: () => gs.settings.ai_analysis_enabled,
  set: (v: boolean) => {
    gs.settings.ai_analysis_enabled = v;
  },
});

/** 当前维度 AI 理由缓存状态（供行内理由 + 按钮/状态文案） */
const aiCache = computed(() => gs.settings.stats.ai_analysis[scopeId.value]);
/** 行内 AI 理由（R2 指纹绑定）：仅当「当前建议」与缓存理由对应的建议指纹一致才展示——
 *  建议消失/变化（配置写入、数据波动）后旧理由立即隐藏，拒用过期解释误导用户。
 *  rowMeta 已有每行 suggestion（一次性计算），此处零额外建议计算。
 *  受 ai_analysis_enabled 开关统一控制：开关关时返回 null，行内理由与「已为 N 条建议生成
 *  理由」读数（aiCacheEntryCount 经此函数）一并隐藏，与「AI 分析/取消」按钮的开关门一致，
 *  杜绝「关掉开关后按钮消失、旧理由仍挂」的 gate 漂移 */
const aiReasonOf = (row: EntryRankRow): AiAnalysisEntry | null => {
  if (!gs.settings.ai_analysis_enabled) return null;
  const cached = aiCache.value?.entries[row.entryId];
  if (!cached || !cached.reason) return null;
  const s = rowMeta.value.get(row.entryId)?.suggestion ?? null;
  if (!s || cached.suggestion_key !== suggestionKey(s)) return null;
  return cached;
};
/** AI 增强区块状态读数：当前维度实际可展示（指纹校验通过）的 AI 理由条数 */
const aiCacheEntryCount = computed(() => {
  let n = 0;
  for (const g of groups.value) {
    for (const r of g.rows) {
      if (aiReasonOf(r)) n += 1;
    }
  }
  return n;
});
/** 上次分析时间文案（timeAgo 定义在下文，函数内引用无 TDZ 问题） */
const aiCacheTimeText = computed(() => timeAgo(aiCache.value?.updated_at ?? 0));

/** AI 分析按钮文案：运行中显示分批进度；空闲显示缓存条数/时间 */
const aiAnalyzeLabel = computed(() => {
  if (aiAnalysisState.running) {
    return aiAnalysisState.total > 0 ? t`AI 分析中 (${aiAnalysisState.done}/${aiAnalysisState.total})` : t`AI 分析中…`;
  }
  const n = aiCacheEntryCount.value;
  if (n > 0) return t`刷新 AI 理由 (${n})`;
  return t`AI 分析`;
});

/** 自动分析:打开/切维度/本维度统计有新数据时防抖触发一次；单飞与失效判定由
 *  runAiAnalysis/aiAnalysisNeeded 内部保证（打开页、切维度经 watch 也走同一调度）。
 *  只监听当前维度的活动时间戳——其他维度活动不再触发本维度的防抖（R1）。 */
let aiAutoTimer: ReturnType<typeof setTimeout> | null = null;
const scopeActivityTs = computed(() =>
  scopeId.value === GLOBAL_SCOPE ? stats.value.updated_at : (stats.value.entries[scopeId.value]?.updated_at ?? 0),
);
const scheduleAiAnalysis = () => {
  if (aiAutoTimer) clearTimeout(aiAutoTimer);
  aiAutoTimer = setTimeout(() => {
    void runAiAnalysis(scopeId.value);
  }, AI_ANALYSIS_DEBOUNCE_MS);
};
watch(scopeId, scheduleAiAnalysis);
watch(scopeActivityTs, scheduleAiAnalysis);
onMounted(scheduleAiAnalysis);
// 卸载清理：防抖定时器与手动分析的中止句柄一并释放，避免切 tab 后残留触发后台请求
onUnmounted(() => {
  if (aiAutoTimer) {
    clearTimeout(aiAutoTimer);
    aiAutoTimer = null;
  }
  aiAbort?.abort();
  aiAbort = null;
});

/** 手动「AI 分析」按钮：强制跳过缓存失效判定重跑，并登记取消句柄（旁边「取消」按钮可中止） */
let aiAbort: AbortController | null = null;
const onRunAiAnalysis = () => {
  if (!gs.settings.ai_analysis_enabled) return;
  aiAbort?.abort();
  aiAbort = new AbortController();
  void runAiAnalysis(scopeId.value, true, aiAbort.signal).finally(() => {
    if (aiAbort) aiAbort = null;
  });
};
const onCancelAiAnalysis = () => {
  aiAbort?.abort();
  aiAbort = null;
};

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
  if (total <= 0) return EMPTY_DISPLAY;
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

/** 组头「N 条建议」徽标：该组当前可应用建议的条数（仅具体 config 维度 + 被引用的条目） */
const groupSuggestCount = (g: EntryGroup): number => (canApply.value ? g.rows.filter(r => canApplyRow(r)).length : 0);

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

/** 每行建议/洞察一次性计算（entrySuggestion 每行只调 1 次，模板多处复用）：
 *  insightOf/suggestionOf/badgeOf/applyableCount/applyAll 均改读该 Map，
 *  避免大池渲染时每行 4-6 次重复遍历 recent 窗口（entryMetrics 内部遍历至 50 条）。
 *  连带缓存窗口/全量期望指标与洞察徽标（windowMetrics/fullExpectedRate/buildInsightBadge
 *  各自只算 1 次）——行内命中率、tooltip 与徽标直接从缓存读，模板渲染不再逐行重复计算。
 *  基于过滤前全量 groups 构建，切换搜索/筛选时建议结果不受影响。 */
type RowMeta = {
  insight: EntryInsight;
  suggestion: Suggestion | null;
  window: WindowMetrics | null;
  expectedRate: number | null;
  badge: InsightBadge | null;
};

type InsightBadge = { text: string; cls: string; title: string };

/** 洞察徽标（展示层派生，经 rowMeta 每行只算一次）：标签文案/样式类/tooltip 单一
 *  真相源——6 种标签（候选降权/建议停用/表现良好/样本不足/已停用/冷却中）的文案与
 *  语义色映射集中在此，模板只渲染不重复 if/else，防止两处漂移。建议类标签 tooltip
 *  复用 suggestionTitle 附依据。 */
const buildInsightBadge = (insight: EntryInsight, suggestion: Suggestion | null): InsightBadge | null => {
  if (!insight) return null;
  switch (insight) {
    case 'downgrade':
      return { text: t`候选降权`, cls: 'choice-stats-insight--bad', title: suggestionTitle(suggestion) };
    case 'disable':
      return { text: t`建议停用`, cls: 'choice-stats-insight--disable', title: suggestionTitle(suggestion) };
    case 'good':
      return { text: t`表现良好`, cls: 'choice-stats-insight--good', title: suggestionTitle(suggestion) };
    case 'insufficient':
      return {
        text: t`样本不足`,
        cls: 'choice-stats-insight--insufficient',
        title: t`参与轮次不足 ${sampleMin} 轮，命中率噪声大，暂不判断质量`,
      };
    case 'disabled':
      return {
        text: t`已停用`,
        cls: 'choice-stats-insight--disabled',
        title: t`该条目已停用（建议停用或阵容落出），不再参与生成；可在条目池页手动重新启用`,
      };
    case 'cooldown':
      return {
        text: t`冷却中`,
        cls: 'choice-stats-insight--cooldown',
        title: t`最近一次自动化调整后不足 ${sampleMin} 轮新数据，暂不重新评级`,
      };
    default:
      return null;
  }
};

/** 洞察标签 tooltip：附建议依据（依据口径 / 命中率 / 期望 / 超额） */
const suggestionTitle = (s: Suggestion | null): string => {
  if (!s) return t`基于近 ${sampleMin} 轮或全量样本的统计建议`;
  const newWeightText = s.newWeight !== undefined ? ` → ${s.newWeight}` : '';
  const act = s.action === 'down' ? t`降权` : s.action === 'disable' ? t`停用` : t`提权`;
  return t`${s.basis === '窗口' ? `近 ${s.samples} 轮` : `全量 ${s.samples} 轮`}命中率 ${rateText(s.rate)}，期望 ${rateText(s.expected)}：建议${act}${newWeightText}`;
};

const rowMeta = computed<Map<string, RowMeta>>(() => {
  const map = new Map<string, RowMeta>();
  for (const g of groups.value) {
    for (const r of g.rows) {
      const suggestion = entrySuggestion(r);
      const insight = entryInsight(r, suggestion);
      map.set(r.entryId, {
        suggestion,
        insight,
        window: windowMetrics(r),
        expectedRate: fullExpectedRate(r),
        badge: buildInsightBadge(insight, suggestion),
      });
    }
  }
  return map;
});

/** 读取行级元数据（rowMeta 基于全量 groups 必然收录，兜底防未来新增行路径） */
const metaOf = (row: EntryRankRow): RowMeta => {
  const m = rowMeta.value.get(row.entryId);
  return m ?? { insight: null, suggestion: null, window: null, expectedRate: null, badge: null };
};

const insightOf = (row: EntryRankRow): EntryInsight => metaOf(row).insight;
const suggestionOf = (row: EntryRankRow): Suggestion | null => metaOf(row).suggestion;

/** 洞察徽标读取（模板多个属性共用同一缓存项） */
const badgeOf = (row: EntryRankRow): InsightBadge | null => metaOf(row).badge;

/** 该行建议可应用：仅具体 config 维度 + 条目被 config 引用。未引用条目的历史数据
 *  残留只展示洞察标签、不提供写入（applySuggestions 在 config 中找不到引用会 skipped，
 *  出「永远无法应用」的建议会让批量应用计数虚高） */
const canApplyRow = (row: EntryRankRow): boolean => canApply.value && row.referenced && suggestionOf(row) !== null;

// ── 建议应用与撤销 ──
const applyableCount = computed(() =>
  canApply.value ? filteredGroups.value.flatMap(g => g.rows.filter(r => canApplyRow(r))).length : 0,
);

const pending = ref<Suggestion[] | null>(null);
const { open: applyOpen, show: showApplyConfirm, confirm: confirmApply, cancel: cancelApply } = useConfirm();

/** 当前维度可撤销的批次计数（持久历史派生，切维度/刷新后仍正确）。
 *  只数「目标 config 仍存活」的历史槽——config 已删除的槽点击撤销会静默失败
 *  （undoLastApply 对死槽直接移除），显示计数会误导用户以为可撤销。 */
const undoCount = computed(() => {
  if (scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return 0;
  const alive = new Set(configs.value.map(c => c.id));
  return gs.settings.apply_history.reduce(
    (n, e) => (e.scope_id === scopeId.value && alive.has(e.scope_id) ? n + 1 : n),
    0,
  );
});

/** 应用历史面板数据：当前 config 维度的批次（新→旧），join 变更摘要。
 *  poolMap 预建一次复用，避免每个历史批次在 applyHistorySummary 内重建 O(history×pool) */
const historyEntries = computed(() => {
  if (scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return [];
  const poolMap = new Map(masterPool.value.map(e => [e.id, e]));
  return gs.settings.apply_history
    .filter(e => e.scope_id === scopeId.value)
    .slice()
    .reverse()
    .map(entry => ({ entry, changes: applyHistorySummary(entry, poolMap) }));
});

/** 粘性子头快捷跳转目标：仅列出当前可见的分区（阵容/历史按维度与开关条件显隐）。
 *  pills 点击 scrollIntoView 到对应 anchor section；anchor id 见各 section 的 id 属性。
 *  scroll-margin-top（见样式）抵消粘性头高度，避免钉顶头遮挡 section 标题。 */
const jumpTargets = computed(() => {
  const list: Array<{ anchor: string; label: string }> = [
    { anchor: 'overview', label: t`概览` },
    { anchor: 'leaderboard', label: t`条目榜` },
  ];
  list.push({ anchor: 'dice', label: t`骰子` });
  if (canApply.value) list.push({ anchor: 'roster', label: t`阵容` });
  if (statsEnabled.value && automationEnabled.value && historyEntries.value.length > 0) {
    list.push({ anchor: 'history', label: t`历史` });
  }
  list.push({ anchor: 'hitrank', label: t`命中榜` });
  list.push({ anchor: 'manage', label: t`管理` });
  return list;
});
const jumpTo = (anchor: string): void => {
  const el = document.getElementById(`choice-stats-anchor-${anchor}`);
  el?.scrollIntoView({ block: 'start' });
};

const historyTimeTitle = (ts: number): string => formatDateTime(ts);

const undoHistoryEntry = (entryId: string) => {
  if (undoApply(entryId)) {
    toastr.success(t`已撤销该批应用`);
  }
};

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

/** 应用一批建议：设 pending → 弹确认 → 确认后写入。取消/外层守卫失败则只复位 pending。
 *  showApplyConfirm 弹窗的确认/取消分别走 confirmApply/cancelApply（关闭弹窗 + resolve），
 *  applyConfirmMessage 在 pending 已设后 show() 时同步求值，与原 computed 行为等价 */
const runApply = async (list: Suggestion[]) => {
  pending.value = list;
  const ok = await showApplyConfirm({
    title: t`应用统计建议`,
    message: applyConfirmMessage.value,
    confirmText: t`应用`,
    cancelText: t`取消`,
  });
  pending.value = null;
  if (!ok || list.length === 0 || scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return;
  const res = applySuggestions(scopeId.value, list);
  toastr.success(
    res.skipped > 0
      ? t`已应用 ${res.applied} 条建议（跳过 ${res.skipped} 条，可在统计页撤销）`
      : t`已应用 ${res.applied} 条建议（可在统计页撤销）`,
  );
};

const applyOne = (s: Suggestion) => runApply([s]);

/** 行内应用按钮（模板无法用非空断言，包装一层判空） */
const applySuggestion = (row: EntryRankRow) => {
  if (!canApplyRow(row)) return;
  const s = suggestionOf(row);
  if (s) applyOne(s);
};

/** 行内「重新启用」：建议停用/阵容落出的条目就地恢复（写入 config，不记历史、不刷冷却） */
const reEnable = (row: EntryRankRow) => {
  if (scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return;
  if (reEnableEntry(scopeId.value, row.entryId)) {
    toastr.success(t`已重新启用该条目`);
  }
};

const applyAll = () => {
  const list = filteredGroups.value
    .flatMap(g => g.rows)
    .filter(r => canApplyRow(r))
    .map(r => suggestionOf(r))
    .filter((s): s is Suggestion => s !== null);
  void runApply(list);
};

const onUndo = () => {
  if (scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return;
  if (undoLastApply(scopeId.value)) {
    toastr.success(t`已撤销最近一次应用`);
  }
};

// ── 阵容计划（固定名额：落出/补入，半自动） ──
// 与建议引擎并存：建议引擎管权重，阵容计划管成员资格；二者写同一 config 层、共用单槽撤销。

const rosterEnabled = computed({
  get: () => gs.settings.roster_enabled,
  set: (v: boolean) => {
    gs.settings.roster_enabled = v;
  },
});

/** 用文本态承载目标条数，避免 type=number 的空串被 v-model.number 钳成 0；
 *  解析失败/空串 → null（关闭计划），落盘时写入实际有限数或 null。
 *  不 clamp 用户输入（项目约束）：任意 ≥1 的有限数均接受 */
const rosterSizeText = ref(
  gs.settings.roster_size !== null && gs.settings.roster_size !== undefined ? String(gs.settings.roster_size) : '',
);
const rosterTarget = computed<number | null>(() => {
  const n = Number(rosterSizeText.value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
});
watch(rosterTarget, v => {
  gs.settings.roster_size = v;
});
/** 失焦时把输入框回填为已落盘的规范化值（空 → ''，有限数 → 取整字符串），消除
 *  「输入 12.5 显示 12.5、落盘 12」「输入 0 显示 0、落盘 null」的显示与落盘不一致。 */
const syncRosterDisplay = (): void => {
  const t = rosterTarget.value;
  rosterSizeText.value = t === null ? '' : String(t);
};

/** 当前选中维度的配置（具体 config 才有写入目标） */
const activeConfig = computed(() => configs.value.find(c => c.id === scopeId.value));

/** 阵容计划（纯函数派生，随维度/池/统计/目标条数响应刷新） */
const rosterPlan = computed<RosterPlan | null>(() => {
  if (!rosterEnabled.value || rosterTarget.value === null || !activeConfig.value) return null;
  return planRoster(view.value, masterPool.value, activeConfig.value, rosterTarget.value);
});

/** 替补席 = config 中 disabled 且仍存在于 master_pool 的条目数 */
const benchCount = computed(() => {
  const cfg = activeConfig.value;
  if (!cfg) return 0;
  const ids = new Set(masterPool.value.map(e => e.id));
  return cfg.entries.filter(e => e.enabled === false && ids.has(e.entry_id)).length;
});

/** 未入池 = master_pool 中未被 config 引用的条目数 */
const unreferencedCount = computed(() => {
  const cfg = activeConfig.value;
  if (!cfg) return 0;
  const ref = new Set(cfg.entries.map(e => e.entry_id));
  return masterPool.value.filter(e => !ref.has(e.id)).length;
});

/** 超额命中率展示（带符号、百分比） */
const excessText = (v: number): string => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';

const rosterTypeLabel = (a: RosterAction): string => typeLabel({ deleted: false, type: a.type });

const rosterText = (a: RosterAction): string => a.content || a.type || t`（空内容）`;

/** 落出/补入行 tooltip：附依据（口径/命中率/期望/超额） */
const rosterReason = (a: RosterAction): string => {
  const basis =
    a.samples !== undefined && a.score !== undefined
      ? t`近 ${a.samples} 轮超额 ${excessText(a.score)}`
      : a.reason === 'explore'
        ? t`未入池条目，探索补入`
        : t`样本不足，替补补入`;
  if (a.kind === 'drop') return t`落出：${basis}`;
  return a.reason === 'bench' ? t`替补补入：${basis}` : t`探索补入：${basis}`;
};

/** 计划无可执行动作时的说明 */
const rosterEmptyText = computed(() => {
  const p = rosterPlan.value;
  if (!p) return '';
  if (p.activeCount > p.target) {
    return t`在役 ${p.activeCount} 条超出目标 ${p.target}，但可落出的非 pinned 且样本充足的条目不足（其余被豁免），暂无可执行动作。`;
  }
  if (p.activeCount < p.target) {
    return t`在役 ${p.activeCount} 条低于目标 ${p.target}，但替补席与未入池条目已无可补入（未入池按探索预算进一步降低填充）。`;
  }
  return t`当前在役 ${p.activeCount} 条，正符合目标，无需调整。`;
});

const pendingRoster = ref<RosterPlan | null>(null);
const { open: rosterOpen, show: showRosterConfirm, confirm: confirmRoster, cancel: cancelRoster } = useConfirm();

const rosterConfirmMessage = computed(() => {
  const p = pendingRoster.value;
  if (!p) return '';
  const lines = [
    ...p.drops.map(a => `· ${t`落出`} ${rosterText(a)}（${rosterReason(a)}）`),
    ...p.promotes.map(a => `· ${t`补入`} ${rosterText(a)}（${rosterReason(a)}）`),
  ];
  return t`将应用到当前配置：\n${lines.join('\n')}\n\n落出为软停用（条目保留、统计不丢），可在条目池页手动重新启用。`;
});

/** 应用阵容计划：设 pendingRoster → 弹确认 → 确认后写入。取消/守卫失败只复位 pending。
 *  rosterConfirmMessage 在 pendingRoster 已设后 show() 时同步求值，与原 computed 行为等价 */
const applyRoster = async () => {
  const p = rosterPlan.value;
  if (!p || (p.drops.length === 0 && p.promotes.length === 0)) return;
  pendingRoster.value = p;
  const ok = await showRosterConfirm({
    title: t`应用阵容计划`,
    message: rosterConfirmMessage.value,
    confirmText: t`应用`,
    cancelText: t`取消`,
  });
  pendingRoster.value = null;
  if (!ok || scopeId.value === GLOBAL_SCOPE || scopeId.value === NONE_SCOPE) return;
  const res = applyRosterPlan(scopeId.value, p);
  toastr.success(
    res.skipped > 0
      ? t`已应用 ${res.applied} 条阵容变更（跳过 ${res.skipped} 条，可在统计页撤销）`
      : t`已应用 ${res.applied} 条阵容变更（可在统计页撤销）`,
  );
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
    // 自动化应用历史（建议/阵容批次快照，随 apply_history 持久化）
    apply_history: gs.settings.apply_history,
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

const { open: clearOpen, show: showClearConfirm, confirm: confirmClear, cancel: cancelClear } = useConfirm();
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

.choice-stats-undo {
  flex-shrink: 0;
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
  /* 不透明背景：暗/亮主题下均不透出下方滚动内容 */
  background: var(--choice-bg);
  border-bottom: 1px solid var(--choice-border);
}

/* 跳转 pills 行：横向排列、窄屏换行 */
.choice-stats-jump-bar {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-1);
}

.choice-stats-jump-pill {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-element);
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-3);
  cursor: pointer;
  white-space: nowrap;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-stats-jump-pill:hover {
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
}

/* 锚点分区滚动留白：抵消粘性头高度（维度条+跳转pills+内边距），避免跳转后标题被钉顶头遮挡 */
.choice-stats-section[data-anchor] {
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

/* 骰子战绩彩蛋结局（大成功/大失败）：星标/闪电用强调色强调 */
.choice-stats-card-icon--crit {
  background: var(--choice-color-warning-bg);
  color: var(--choice-color-warning);
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

/* ── 区块标题行（概览区可读标题 + 折叠区可点击切换，共用同一视觉语言） ── */
.choice-stats-section-title {
  margin: 0;
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  white-space: nowrap;
  transition: color var(--choice-transition);
}

.choice-stats-section-title i {
  color: var(--choice-color-info);
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
}

.choice-stats-section-head {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--choice-space-1) var(--choice-space-2);
  margin-bottom: var(--choice-space-1);
}

/* 折叠分区标题行整行为可点击区域（button 复位）；展开/收起看 chevron 旋转 */
.choice-stats-section-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex: 1 1 auto;
  min-width: 0;
  padding: var(--choice-space-1) 0;
  background: none;
  border: none;
  cursor: pointer;
  color: inherit;
  text-align: left;
}

.choice-stats-section-toggle:hover .choice-stats-section-title {
  color: var(--choice-color-info);
}

.choice-stats-chevron {
  flex-shrink: 0;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  transition: transform var(--choice-transition);
}

.choice-stats-chevron--open {
  transform: rotate(90deg);
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

.choice-stats-apply-all {
  white-space: nowrap;
}

/* 一行副标题：只保留读数式要点，完整说明进标题旁 info tooltip */
.choice-stats-sub {
  margin: 0 0 var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

/* 控制簇（首个分区）的状态读数在区块末尾：去掉自带下边距，间距交由其下粘性子头管理 */
.choice-stats-section:first-child > .choice-stats-sub {
  margin-bottom: 0;
}

/* 折叠分区展开后的内容容器：透明底 + 顶部微缩进，视觉上从属于标题行 */
.choice-stats-section-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: var(--choice-space-1) 0 0 var(--choice-space-4);
}

/* 折叠体内的副标题由 flex gap 管间距，去掉自带下边距避免双倍空隙 */
.choice-stats-section-body > .choice-stats-sub {
  margin-bottom: 0;
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

/* 键盘焦点可见态：分段按钮/跳转 pill/组头/撤销与图标按钮统一描边（对照 border-active），
   鼠标操作的 hover 反馈保留原样 */
.choice-stats-seg-btn:focus-visible,
.choice-stats-jump-pill:focus-visible,
.choice-stats-group-head:focus-visible,
.choice-stats-undo:focus-visible,
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

/* 已停用（真实启用态）：中性但比「样本不足」更沉，暗示该条目已不在生成中 */
.choice-stats-insight--disabled {
  background: var(--choice-bg-hover);
  color: var(--choice-text-secondary);
  text-decoration: line-through;
}

/* 冷却中（自动化调整后观察期）：信息色提示"系统正在等新数据"，区别于样本不足 */
.choice-stats-insight--cooldown {
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
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

/* 定位/应用/重新启用按钮：行内靠右 */
.choice-stats-locate,
.choice-stats-apply,
.choice-stats-reenable {
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

/* 重新启用：暖色提示「恢复」，区别于应用（成功绿）与定位（信息蓝） */
.choice-stats-reenable:hover {
  color: var(--choice-color-warning);
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

/* ── AI 增强 ── */
/* 开关行：两开关并排、紧凑，窄屏自动换行 */
.choice-stats-ai-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--choice-space-3);
  margin-bottom: var(--choice-space-2);
}

/* 条目榜头部的 AI 分析按钮：运行中禁用态 + 主色提示 */
.choice-stats-ai-btn {
  white-space: nowrap;
}

.choice-stats-ai-btn--running {
  color: var(--choice-color-info);
}

/* 行内 AI 理由：一行 muted 小字（2 行截断），brain 图标起视觉锚点；
   不与统计读数混排，独立一行避免窄屏挤压 */
.choice-stats-ai-reason {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-top: 2px;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.choice-stats-ai-reason i {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--choice-color-info);
}

/* 低置信理由（confidence<0.4）：淡化 + 提示图标变色，避免过度采信 */
.choice-stats-ai-reason--low {
  opacity: 0.65;
}

.choice-stats-ai-reason--low i {
  color: var(--choice-text-muted);
}

/* L1 归因状态读数：队列/修正量，与缓存理由读数同级 */
.choice-stats-ai-l1 {
  font-variant-numeric: tabular-nums;
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

/* 组头「N 条建议」徽标：提示该组存在可应用建议（面向决策的驾驶舱视角） */
.choice-stats-suggest-badge {
  flex-shrink: 0;
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
  font-size: var(--choice-text-xs);
  font-weight: 600;
  white-space: nowrap;
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

/* ── 阵容计划 ── */
.choice-stats-roster-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--choice-space-3);
  margin-bottom: var(--choice-space-2);
}

.choice-stats-roster-size {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: nowrap;
}

.choice-stats-roster-size--off {
  opacity: 0.5;
}

.choice-stats-roster-input {
  width: 80px;
  min-width: 0;
}

.choice-stats-roster-readout {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  margin-bottom: var(--choice-space-2);
}

.choice-stats-roster {
  /* 落出/补入两列：宽屏并排、窄屏自然堆叠（auto-fit 保证不横向溢出） */
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--choice-space-3);
  margin-bottom: var(--choice-space-2);
}

/* 无可执行动作的空提示横跨两列，避免只占第一格 */
.choice-stats-roster > .choice-empty-hint {
  grid-column: 1 / -1;
}

.choice-stats-roster-col {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-roster-col-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  font-weight: 600;
}

.choice-stats-roster-col-head--drop {
  color: var(--choice-color-error);
}

.choice-stats-roster-col-head--promote {
  color: var(--choice-color-success);
}

.choice-stats-roster-item {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: 2px 0;
  min-width: 0;
}

.choice-stats-roster-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

/* ── 应用历史 ── */
.choice-stats-history {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-stats-history-item {
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-stats-history-head {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-stats-kind {
  flex-shrink: 0;
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  font-size: var(--choice-text-xs);
  font-weight: 600;
}

.choice-stats-kind--suggestions {
  background: var(--choice-color-info-bg);
  color: var(--choice-color-info);
}

.choice-stats-kind--roster {
  background: var(--choice-color-warning-bg);
  color: var(--choice-color-warning);
}

.choice-stats-history-time {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-stats-history-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-stats-history-undo {
  margin-left: auto;
}

.choice-stats-history-changes {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.choice-stats-history-change {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  min-width: 0;
}

.choice-stats-history-change .choice-stats-type-badge {
  flex-shrink: 0;
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-stats-history-change-text {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  min-width: 0;
}
</style>
