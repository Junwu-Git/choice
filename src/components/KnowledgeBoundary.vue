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
          v-if="!knowledgeState.loading"
          class="choice-btn-sm"
          :title="t`手动新增一条知识边界条目`"
          @click="openAdd"
        >
          <i class="fa-solid fa-plus"></i>
          {{ t`新增条目` }}
        </button>
        <button
          v-if="!knowledgeState.loading && report.entries.length"
          class="choice-btn-sm"
          :title="t`扫描并合并重复条目（锁定条目不参与）`"
          @click="onTidy"
        >
          <i class="fa-solid fa-broom"></i>
          {{ t`整理条目` }}
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
        <button
          v-if="!knowledgeState.loading && report.entries.length"
          class="choice-btn-sm"
          :title="t`清空当前聊天的知识边界报告`"
          @click="onClear"
        >
          <i class="fa-solid fa-trash-can"></i>
          {{ t`清空报告` }}
        </button>
        <button
          v-if="!knowledgeState.loading && report.entries.length"
          class="choice-btn-sm"
          :title="t`导出当前报告为 JSON（不含退役条目）`"
          @click="onExport"
        >
          <i class="fa-solid fa-file-export"></i>
          {{ t`导出` }}
        </button>
        <button
          v-if="!knowledgeState.loading"
          class="choice-btn-sm"
          :title="t`从 JSON 导入条目，按 id/主题合并进当前报告`"
          @click="onImport"
        >
          <i class="fa-solid fa-file-import"></i>
          {{ t`导入` }}
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
          <small>{{ t`AI 回复后自动重跑；编辑、删除楼层与切换分支也会合并刷新` }}</small>
        </span>
      </label>
      <label class="choice-toggle">
        <input v-model="gs.settings.knowledge.inject_enabled" type="checkbox" :title="t`把报告注入选项生成请求`" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`注入选项生成` }}</strong>
          <small>{{ t`把与当前场景相关的条目发给生成选项的 AI（扩展模式与酒馆预设模式都生效）` }}</small>
        </span>
      </label>
      <label class="choice-toggle" :class="{ 'is-disabled': !gs.settings.knowledge.auto_analyze }">
        <input
          v-model="gs.settings.knowledge.merge_with_generation"
          type="checkbox"
          :disabled="!gs.settings.knowledge.auto_analyze"
          :title="t`把知识分析与选项生成合成一次请求`"
        />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`合并到选项生成请求` }}</strong>
          <small>{{
            t`省掉一次上下文发送：分析与候选在同一次回复里完成，先更新边界再写候选。需开启「自动刷新」；报告已是最新时不追加分析任务。`
          }}</small>
        </span>
      </label>
      <small v-if="!gs.settings.knowledge.auto_analyze" class="choice-field-hint">
        {{ t`「合并到选项生成请求」依赖「自动刷新」，当前未生效。` }}
      </small>

      <small v-if="stale" class="choice-field-hint choice-knowledge-stale">
        <i class="fa-solid fa-triangle-exclamation"></i>
        {{ staleText }}
      </small>
    </ChoiceSectionCard>

    <ChoiceSectionCard title="注入预算" icon="fa-solid fa-sliders">
      <small class="choice-field-hint">
        {{ t`每轮只注入与最近对话相关的条目：未知/存疑/锁定优先，已知项按场景命中与更新时间补齐。` }}
      </small>
      <div class="choice-knowledge-budget">
        <label class="choice-field">
          <span>{{ t`条数上限` }}</span>
          <input
            v-model.number="injectMaxEntries"
            class="choice-input choice-input-w-md"
            type="number"
            min="1"
            max="60"
            @blur="clampBudget"
          />
        </label>
        <label class="choice-field">
          <span>{{ t`字符预算` }}</span>
          <input
            v-model.number="injectCharBudget"
            class="choice-input choice-input-w-lg"
            type="number"
            min="300"
            max="8000"
            step="100"
            @blur="clampBudget"
          />
        </label>
      </div>
      <small class="choice-field-hint">{{ t`长聊可调高条数；上下文较小的模型可调低字符预算。` }}</small>
    </ChoiceSectionCard>

    <!-- 报告表：有数据才显示，空态单独给邀请 -->
    <template v-if="report.entries.length">
      <div class="choice-knowledge-summary">
        <span class="choice-knowledge-count choice-knowledge-count--known">{{ t`已知` }} {{ counts.known }}</span>
        <span class="choice-knowledge-count choice-knowledge-count--uncertain"
          >{{ t`存疑` }} {{ counts.uncertain }}</span
        >
        <span class="choice-knowledge-count choice-knowledge-count--unknown">{{ t`未知` }} {{ counts.unknown }}</span>
        <span v-if="counts.retired" class="choice-knowledge-count choice-knowledge-count--retired">
          {{ t`已退役` }} {{ counts.retired }}
        </span>
        <!-- 档位分布：模型把大半张表标成「高」时，这一行能一眼看出通胀 -->
        <span class="choice-knowledge-count choice-knowledge-count--importance" :title="t`档位只影响注入时的取舍顺序`">
          {{ t`高 ${counts.importance.high} / 中 ${counts.importance.normal} / 低 ${counts.importance.low}` }}
        </span>
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
        <input
          v-model="search"
          class="choice-input choice-knowledge-search"
          type="search"
          :placeholder="t`搜索主题/对象/别名/检索词`"
        />
      </div>

      <div class="choice-knowledge-table">
        <div class="choice-knowledge-row choice-knowledge-row--head">
          <span>{{ t`信息项` }}</span>
          <span>{{ t`关联对象` }}</span>
          <span>{{ t`状态` }}</span>
          <span>{{ t`依据` }}</span>
          <span>{{ t`对选项的约束` }}</span>
        </div>
        <div v-for="e in filtered" :key="e.id" class="choice-knowledge-row" :class="{ 'is-retired': e.retired }">
          <span class="choice-knowledge-topic">
            <span class="choice-knowledge-topic-line">
              <i v-if="e.locked" class="fa-solid fa-lock choice-knowledge-lock" :title="t`已锁定，AI 不会修改`"></i>
              <span :class="{ 'is-retired-text': e.retired }">{{ e.topic }}</span>
            </span>
            <span class="choice-knowledge-topic-meta">
              <!-- 「未获取」只在状态不是未知时显示：状态为未知时它必然成立，
                   摆一个恒定标签只是噪音（状态徽标已经说了「未知」） -->
              <span v-if="e.source !== 'none'" class="choice-knowledge-source">{{ sourceLabel(e.source) }}</span>
              <span v-if="e.aliases.length" :title="e.aliases.join('、')">
                {{ t`别名：${e.aliases.join('、')}` }}
              </span>
            </span>
            <span class="choice-knowledge-row-actions">
              <button class="choice-btn-sm" :title="t`编辑`" @click="openEdit(e)">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button
                class="choice-btn-sm"
                :title="e.locked ? t`解锁` : t`锁定后 AI 不会修改或删除`"
                @click="setEntryLocked(e.id, !e.locked)"
              >
                <i class="fa-solid" :class="e.locked ? 'fa-lock-open' : 'fa-lock'"></i>
              </button>
              <button
                v-if="!e.retired"
                class="choice-btn-sm"
                :title="t`退役（保留记录，可恢复）`"
                @click="retireEntry(e.id)"
              >
                <i class="fa-solid fa-box-archive"></i>
              </button>
              <button v-else class="choice-btn-sm" :title="t`恢复`" @click="restoreEntry(e.id)">
                <i class="fa-solid fa-rotate-left"></i>
              </button>
            </span>
          </span>
          <span class="choice-knowledge-cell choice-knowledge-subject">{{ e.subject || '—' }}</span>
          <span>
            <span class="choice-knowledge-badge" :class="`is-${e.status}`">{{ statusLabel(e.status) }}</span>
            <span
              v-if="e.previous_status && e.previous_status !== e.status"
              class="choice-knowledge-prev-status"
              :title="t`由「${statusLabel(e.previous_status as KnowledgeStatus)}」转为当前状态`"
            >
              {{ t`原${statusLabel(e.previous_status as KnowledgeStatus)}` }}
            </span>
            <span
              class="choice-knowledge-importance"
              :class="`is-${e.importance}`"
              :title="importanceHint(e.importance)"
            >
              {{ t`档位${IMPORTANCE_LABEL[e.importance]}` }}
            </span>
            <span v-if="e.retired" class="choice-knowledge-retired-note" :title="e.retired_reason">{{
              t`已退役`
            }}</span>
          </span>
          <span class="choice-knowledge-cell">
            {{ e.basis || '—' }}
            <small v-if="e.event_time" class="choice-knowledge-time">
              {{ t`时间：${e.event_time}` }}
            </small>
          </span>
          <span class="choice-knowledge-cell">{{ e.impact || '—' }}</span>
        </div>
        <div v-if="!filtered.length" class="choice-empty-hint">{{ t`当前筛选下没有条目` }}</div>
      </div>

      <ChoiceSectionCard v-if="report.last_changes.length" title="最近变更" icon="fa-solid fa-clock-rotate-left">
        <div class="choice-knowledge-changes">
          <div v-for="(c, i) in report.last_changes" :key="`${c.at}-${c.id}-${i}`" class="choice-knowledge-change">
            <span class="choice-knowledge-change-kind" :class="`is-${c.kind}`">{{ changeKindLabel(c.kind) }}</span>
            <span class="choice-knowledge-change-topic">{{ c.topic || c.id || '—' }}</span>
            <span class="choice-knowledge-change-detail">{{ c.detail }}</span>
            <span v-if="c.at" class="choice-knowledge-change-time">{{ changeTime(c.at) }}</span>
          </div>
        </div>
      </ChoiceSectionCard>
    </template>

    <div v-else-if="!knowledgeState.loading" class="choice-empty">
      <div class="choice-empty-icon"><i class="fa-solid fa-user-shield"></i></div>
      <p>{{ t`还没有分析结果。点「开始分析」让 AI 读一遍当前聊天与设定，列出玩家角色知道与不知道的事。` }}</p>
    </div>

    <KnowledgeEntryDialog
      :open="dialogOpen"
      :entry="editingEntry"
      :existing-topics="existingTopics"
      @close="dialogOpen = false"
      @save="onSaveEntry"
    />

    <ConfirmDialog
      :open="rebuildOpen"
      :title="rebuildTitle"
      :message="rebuildMessage"
      :confirm-text="rebuildConfirmText"
      :cancel-text="rebuildCancelText"
      @confirm="confirmRebuild"
      @cancel="cancelRebuild"
    />

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
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import KnowledgeEntryDialog from '@/components/KnowledgeEntryDialog.vue';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import { useConfirm } from '@/components/shared/useConfirm';
import toastr from 'toastr';
import {
  cancelKnowledgeAnalysis,
  analyzeKnowledgeBoundary,
  isKnowledgeReportStale,
  knowledgeDriftMessages,
  knowledgeState,
} from '@/core/knowledge-analysis';
import {
  addManualEntry,
  clearKnowledgeReport,
  importKnowledgeEntries,
  restoreEntry,
  retireEntry,
  scanDuplicateEntries,
  setEntryLocked,
  tidyKnowledgeReport,
  updateManualEntry,
} from '@/core/knowledge-actions';
import { buildKnowledgeExport, parseKnowledgeExport, IMPORTANCE_LABEL, SOURCE_LABEL } from '@/core/knowledge-report';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type {
  KnowledgeChangeKind,
  KnowledgeImportance,
  KnowledgeReportEntry,
  KnowledgeSource,
  KnowledgeStatus,
} from '@/type/settings';

type FilterId = 'all' | KnowledgeStatus | 'locked' | 'retired';

const gs = useGlobalSettingsStore();
const cs = useChatSettingsStore();

const report = computed(() => cs.settings.knowledge_report);

const {
  open: rebuildOpen,
  show: showRebuildConfirm,
  confirm: confirmRebuild,
  cancel: cancelRebuild,
  title: rebuildTitle,
  message: rebuildMessage,
  confirmText: rebuildConfirmText,
  cancelText: rebuildCancelText,
} = useConfirm();

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

const filter = ref<FilterId>('all');
const search = ref('');
const dialogOpen = ref(false);
const editingEntry = ref<KnowledgeReportEntry | null>(null);

const FILTERS = computed<Array<{ id: FilterId; label: string }>>(() => [
  { id: 'all', label: t`全部` },
  { id: 'known', label: t`已知` },
  { id: 'uncertain', label: t`存疑` },
  { id: 'unknown', label: t`未知` },
  { id: 'locked', label: t`锁定` },
  { id: 'retired', label: t`已退役` },
]);

const counts = computed(() => {
  const c = { known: 0, uncertain: 0, unknown: 0, retired: 0, importance: { high: 0, normal: 0, low: 0 } };
  for (const e of report.value.entries) {
    if (e.retired) {
      c.retired++;
      continue;
    }
    c[e.status]++;
    c.importance[e.importance]++;
  }
  return c;
});

const filtered = computed(() => {
  const entries = report.value.entries;
  let list: KnowledgeReportEntry[];
  if (filter.value === 'all') list = entries.filter(e => !e.retired);
  else if (filter.value === 'locked') list = entries.filter(e => e.locked && !e.retired);
  else if (filter.value === 'retired') list = entries.filter(e => e.retired);
  else list = entries.filter(e => !e.retired && e.status === filter.value);
  const query = search.value.trim().toLowerCase();
  if (!query) return list;
  // 搜索覆盖主题/对象/别名/检索词：长聊里用户通常记得人名或物件名，不一定记得主题措辞。
  return list.filter(e => [e.topic, e.subject, ...e.aliases, ...e.keywords].some(v => v.toLowerCase().includes(query)));
});

const statusLabel = (s: KnowledgeStatus): string => (s === 'known' ? t`已知` : s === 'uncertain' ? t`存疑` : t`未知`);

const sourceLabel = (s: KnowledgeSource): string => SOURCE_LABEL[s] ?? t`未标注`;

const importanceHint = (v: KnowledgeImportance): string =>
  v === 'high'
    ? t`漏了会写出越界或全知的候选`
    : v === 'low'
      ? t`背景常识、设定或场景已明写`
      : t`影响分寸与措辞，但不破底线`;

/** 变更记录的时间戳：只显示时分，长聊里靠它与「更新于」对齐判断先后。 */
const changeTime = (at: number): string => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const changeKindLabel = (kind: KnowledgeChangeKind): string => {
  switch (kind) {
    case 'added':
      return t`新增`;
    case 'updated':
      return t`更新`;
    case 'merged':
      return t`合并`;
    case 'retired':
      return t`退役`;
    case 'restored':
      return t`恢复`;
    case 'locked':
      return t`锁定`;
    case 'unlocked':
      return t`解锁`;
    case 'rejected_locked':
      return t`已拒绝`;
    case 'drop_missing':
      return t`未命中`;
    case 'ambiguous':
      return t`待确认`;
    case 'evicted':
      return t`淘汰`;
    case 'capacity_full':
      return t`已满`;
    default:
      return t`更新`;
  }
};

const statusText = computed(() => {
  const r = report.value;
  if (!r.updated_at) return '';
  const d = new Date(r.updated_at);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  // 只有手动条目（从未分析过）时 based_on_message=0，不显示「基于前 0 条」
  // based_on_message 是消息总数，不是楼层索引——措辞用「前 N 条」避免被读成第 N 楼
  return r.based_on_message > 0
    ? t`更新于 ${hh}:${mm} · 基于前 ${r.based_on_message} 条消息 · 修订 r${r.revision}`
    : t`更新于 ${hh}:${mm} · 修订 r${r.revision}`;
});

/** 过期判定：楼层数或内容指纹变了都算过期。knowledgeState.tick 用来在分析/调度后
 *  强制重算（聊天数组不是 Vue 响应式，computed 不会自己发现内容变了）。
 *  从未跑过分析的报告（based_on_message=0，只有手动条目）不提示过期——
 *  它本来就没有基准楼层，提示「有新消息」会误导。 */
const stale = computed(() => {
  void knowledgeState.tick;
  return report.value.based_on_message > 0 && isKnowledgeReportStale();
});

const staleText = computed(() => {
  void knowledgeState.tick;
  const diff = knowledgeDriftMessages();
  return diff > 0 ? t`聊天已有 ${diff} 条新消息，报告可能过期，建议重新分析` : t`聊天楼层内容有变动，报告可能过期`;
});

const injectMaxEntries = computed({
  get: () => gs.settings.knowledge.inject_max_entries,
  set: (v: number) => {
    if (Number.isFinite(v)) gs.settings.knowledge.inject_max_entries = Math.min(60, Math.max(1, Math.round(v)));
  },
});

const injectCharBudget = computed({
  get: () => gs.settings.knowledge.inject_char_budget,
  set: (v: number) => {
    if (Number.isFinite(v)) gs.settings.knowledge.inject_char_budget = Math.min(8000, Math.max(300, Math.round(v)));
  },
});

/** 输入框失焦再钳一次：v-model.number 在清空时会给空串，不能让设置落成 NaN */
const clampBudget = () => {
  const k = gs.settings.knowledge;
  if (!Number.isFinite(k.inject_max_entries)) k.inject_max_entries = 24;
  if (!Number.isFinite(k.inject_char_budget)) k.inject_char_budget = 2500;
  k.inject_max_entries = Math.min(60, Math.max(1, Math.round(k.inject_max_entries)));
  k.inject_char_budget = Math.min(8000, Math.max(300, Math.round(k.inject_char_budget)));
};

const existingTopics = computed(() =>
  report.value.entries.filter(e => e.id !== editingEntry.value?.id).map(e => e.topic),
);

const openAdd = () => {
  editingEntry.value = null;
  dialogOpen.value = true;
};

const openEdit = (entry: KnowledgeReportEntry) => {
  editingEntry.value = entry;
  dialogOpen.value = true;
};

const onSaveEntry = (payload: {
  topic: string;
  subject: string;
  status: KnowledgeStatus;
  source: KnowledgeSource;
  importance: KnowledgeImportance;
  aliases: string[];
  keywords: string[];
  basis: string;
  impact: string;
  event_time: string;
}) => {
  if (editingEntry.value) updateManualEntry(editingEntry.value.id, payload);
  else addManualEntry(payload);
  dialogOpen.value = false;
};

const onAnalyze = async () => {
  await analyzeKnowledgeBoundary(true);
};

/** 重建整表：丢弃已有表，让模型按当前上下文从零生成（表被污染时的逃生舱）。
 *  必须确认：它会丢弃用户手动编辑与锁定标记，不可撤销。 */
const onRebuild = async () => {
  const ok = await showRebuildConfirm({
    title: t`重建整表`,
    message: t`将丢弃当前报告的全部条目（含手动编辑与锁定标记），按当前聊天重新生成。确定继续？`,
    confirmText: t`重建`,
    cancelText: t`取消`,
  });
  if (!ok) return;
  await analyzeKnowledgeBoundary(true, true);
};

/** 整理条目：先扫描再确认，把「要合并几组/几条」讲清楚，避免用户不知道会发生什么。 */
const onTidy = async () => {
  const groups = scanDuplicateEntries();
  if (!groups.length) {
    toastr.info(t`没有发现需要合并的重复条目`);
    return;
  }
  const total = groups.reduce((n, g) => n + g.merge.length, 0);
  const ok = await showClearConfirm({
    title: t`整理条目`,
    message: t`发现 ${groups.length} 组重复，将并入 ${total} 条到保留条目（锁定条目不参与）。合并会保留更权威的状态与全部别名/检索词，被并入的条目将删除。确定继续？`,
    confirmText: t`合并`,
    cancelText: t`取消`,
  });
  if (!ok) return;
  const merged = tidyKnowledgeReport();
  if (merged > 0) toastr.success(t`已合并 ${merged} 条重复条目`);
  else toastr.info(t`没有可合并的条目`);
};

/** 清空报告：只删本地报告，不重新请求。开启「自动刷新」时下一轮回复后会从空表重建。 */
const onClear = async () => {
  const ok = await showClearConfirm({
    title: t`清空报告`,
    message: t`确定清空当前聊天的知识边界报告吗？条目与变更记录都会删除。开启「自动刷新」时，下一轮 AI 回复后会从空表重新分析；否则需手动点「开始分析」。`,
    confirmText: t`清空`,
    cancelText: t`取消`,
  });
  if (!ok) return;
  clearKnowledgeReport();
  toastr.success(t`已清空知识边界报告`);
};

/** 导出：走 Blob 下载，文件名带时间戳便于区分多次导出。 */
const onExport = () => {
  const payload = buildKnowledgeExport(report.value.entries);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = url;
  a.download = `choice-knowledge-${stamp}.json`;
  a.click();
  // 立刻 revoke 会让部分浏览器拿不到内容，延后一拍释放
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toastr.success(t`已导出 ${payload.entries.length} 条`);
};

/** 导入：合并进当前报告，不替换。格式不对时明确提示，不静默失败。 */
const onImport = () => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const entries = parseKnowledgeExport(await file.text());
    if (!entries) {
      toastr.error(t`文件格式不正确：需要本扩展导出的知识边界 JSON`);
      return;
    }
    const { added, updated, evicted } = importKnowledgeEntries(entries);
    if (!added && !updated) {
      toastr.info(t`没有可导入的新条目`);
      return;
    }
    if (evicted > 0) {
      toastr.warning(t`导入完成：新增 ${added} 条，更新 ${updated} 条；超出容量上限，已淘汰 ${evicted} 条`);
      return;
    }
    toastr.success(t`导入完成：新增 ${added} 条，更新 ${updated} 条`);
  };
  input.click();
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

.choice-knowledge-budget {
  display: flex;
  align-items: flex-end;
  gap: var(--choice-space-3);
  flex-wrap: wrap;
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

.choice-knowledge-count--retired {
  opacity: 0.7;
}

.choice-knowledge-count--importance {
  font-size: 10px;
  color: var(--choice-text-muted);
}

/* 档位标记：弱化处理——它是预算调度信息，不该和状态徽标抢注意力 */
.choice-knowledge-importance {
  display: inline-block;
  margin-left: 4px;
  padding: 0 var(--choice-space-1);
  border-radius: var(--choice-radius-full);
  font-size: 10px;
  color: var(--choice-text-muted);
  border: 1px solid var(--choice-border);
  white-space: nowrap;
}

.choice-knowledge-importance.is-high {
  color: var(--choice-color-warning);
  border-color: var(--choice-color-warning);
}

.choice-knowledge-filter {
  margin-left: auto;
}

/* 搜索独占一行：380px 窄屏下和筛选按钮挤在一行会把两边都压扁 */
.choice-knowledge-search {
  flex: 1 1 100%;
  min-width: 0;
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
  /* 五列：信息项 / 关联对象 / 状态 / 依据 / 约束。窄容器下折叠成卡片（见 @container） */
  grid-template-columns:
    minmax(64px, 1.1fr) minmax(52px, 0.7fr) 46px minmax(70px, 1.3fr)
    minmax(70px, 1.3fr);
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

.choice-knowledge-row.is-retired {
  opacity: 0.62;
}

.choice-knowledge-topic {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--choice-text);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.choice-knowledge-topic-line {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-knowledge-lock {
  color: var(--choice-color-warning);
  font-size: 10px;
}

.is-retired-text {
  text-decoration: line-through;
}

.choice-knowledge-topic-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-1);
  font-weight: 400;
  font-size: 10px;
  color: var(--choice-text-muted);
}

.choice-knowledge-source {
  padding: 0 4px;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-full);
  white-space: nowrap;
}

.choice-knowledge-row-actions {
  display: inline-flex;
  gap: 2px;
  opacity: 0.55;
  transition: opacity var(--choice-transition);
}

.choice-knowledge-row:hover .choice-knowledge-row-actions {
  opacity: 1;
}

.choice-knowledge-cell {
  color: var(--choice-text-secondary);
  overflow-wrap: anywhere;
}

/* 关联对象是分类标签，弱化处理，避免和主题抢注意力 */
.choice-knowledge-subject {
  color: var(--choice-text-muted);
}

.choice-knowledge-time {
  display: block;
  color: var(--choice-text-muted);
  margin-top: 2px;
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

.choice-knowledge-retired-note {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--choice-text-muted);
}

/* 状态来路：与当前状态徽标并排，弱化处理——它是补充信息，不该抢主状态的注意力 */
.choice-knowledge-prev-status {
  margin-left: 4px;
  font-size: 10px;
  color: var(--choice-text-muted);
}

.choice-knowledge-changes {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  max-height: 220px;
  overflow-y: auto;
}

.choice-knowledge-change {
  display: flex;
  align-items: baseline;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  overflow-wrap: anywhere;
}

.choice-knowledge-change-kind {
  flex-shrink: 0;
  padding: 0 var(--choice-space-1);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-full);
  font-size: 10px;
  color: var(--choice-text-muted);
}

.choice-knowledge-change-kind.is-added,
.choice-knowledge-change-kind.is-restored {
  color: var(--choice-color-success);
  border-color: var(--choice-color-success);
}

.choice-knowledge-change-kind.is-rejected_locked,
.choice-knowledge-change-kind.is-drop_missing,
.choice-knowledge-change-kind.is-ambiguous,
.choice-knowledge-change-kind.is-evicted,
.choice-knowledge-change-kind.is-capacity_full {
  color: var(--choice-color-warning);
  border-color: var(--choice-color-warning);
}

.choice-knowledge-change-topic {
  flex-shrink: 0;
  font-weight: 600;
  color: var(--choice-text);
}

.choice-knowledge-change-detail {
  color: var(--choice-text-muted);
}

/* 变更时间靠右：它是辅助信息，不该打断「类型 → 主题 → 说明」的阅读顺序 */
.choice-knowledge-change-time {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 10px;
  color: var(--choice-text-muted);
  opacity: 0.8;
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

  .choice-knowledge-row-actions {
    opacity: 1;
  }
}
</style>
