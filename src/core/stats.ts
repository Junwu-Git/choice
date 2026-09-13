import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { ChoiceOption } from '@/core/options-store';
import {
  createEmptyStats,
  STATS_WINDOW_SIZE,
  SUGGEST_MIN_SAMPLES,
  SUGGEST_DOWNGRADE_EXCESS,
  SUGGEST_UPGRADE_EXCESS,
  SUGGEST_DISABLE_EXCESS,
  SUGGEST_WEIGHT_MIN,
  SUGGEST_WEIGHT_MAX,
  type DailyCount,
  type PoolConfigEntry,
  type PoolEntry,
  type ScopeStats,
  type StatsEntryEntry,
  type StatsRoundRecord,
  type StatsSettings,
} from '@/type/settings';

/** 无 config 会话的统计维度键（effectiveConfig 为 null 时使用） */
export const NONE_SCOPE = '__none__';

/** 全局聚合视图的虚拟 scopeId（区别于任何真实 config.id） */
export const GLOBAL_SCOPE = '__global__';

// ── 记录链路（scope 化 + 期望 + 滑动窗口） ──────────────────────────────────

/** 取维度统计记录：不存在则惰性创建。entries 键数受"实际使用过的 config 数 + 1"约束 */
const getScopeStats = (stats: StatsSettings, scopeId: string): ScopeStats => {
  let s = stats.entries[scopeId];
  if (!s) {
    s = { total_generated: 0, total_selected: 0, by_entry: {}, daily: {} };
    stats.entries[scopeId] = s;
  }
  return s;
};

/** 取条目统计记录：不存在则创建。by_entry 只增，键数受用户实际使用过的条目数约束 */
const getEntryStats = (scope: ScopeStats, entryId: string): StatsEntryEntry => {
  const e = scope.by_entry[entryId];
  if (e) return e;
  const fresh: StatsEntryEntry = {
    rounds_included: 0,
    rounds_with_selection: 0,
    expected_sum: 0,
    recent: [],
    last_selected_at: 0,
    last_selected_text: '',
    last_included_at: 0,
  };
  scope.by_entry[entryId] = fresh;
  return fresh;
};

/** 本地时区 YYYY-MM-DD（趋势 daily 的键）。daily 是"哪一天发生了活动"，用户心智按本地日 */
const dailyKey = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 取当天计数记录：不存在则创建。daily 只增——键数受实际使用天数约束 */
const getDaily = (scope: ScopeStats, key: string): DailyCount => {
  const d = scope.daily[key];
  if (d) return d;
  const fresh = { generated: 0, selected: 0 };
  scope.daily[key] = fresh;
  return fresh;
};

/** 当前生效统计维度 id：绑定/默认 config.id，无 config 会话为 NONE_SCOPE */
export const currentScopeId = (): string => usePoolSelectorStore().effectiveConfig?.id ?? NONE_SCOPE;

/** 记录一轮行动选项生成成功（去重/补齐后实际保留条数）。仅行动选项视图计入。
 *  gid 为 generation id：写入窗口记录的定位锚，选择时按 gid 回写 hit。
 *  count = options.length（该轮实际输出条数）——期望命中率 = 1/count，
 *  与 total_generated 口径一致（不是请求条数）。轮次共现归因：每个参与条目
 *  rounds_included+1、expected_sum += 1/count。 */
export function recordOptionsGenerated(options: ChoiceOption[], poolEntryIds: string[], gid: string): void {
  const stats = useGlobalSettingsStore().settings.stats;
  stats.total_generated += options.length;
  stats.updated_at = Date.now();
  const scopeId = currentScopeId();
  const scope = getScopeStats(stats, scopeId);
  scope.total_generated += options.length;
  getDaily(scope, dailyKey()).generated += options.length;
  const now = Date.now();
  const count = options.length;
  for (const id of poolEntryIds) {
    const e = getEntryStats(scope, id);
    e.rounds_included += 1;
    // count=0 理论上不会发生（成功路径必有输出），防御除零静默退化
    e.expected_sum += count > 0 ? 1 / count : 0;
    e.last_included_at = now;
    e.recent.push({ gid, ts: now, hit: false, count });
    if (e.recent.length > STATS_WINDOW_SIZE) e.recent.shift();
  }
}

/** 在统计全维度中定位"含该 generation 窗口记录"的 scope：命中应归到生成时所在的维度，
 *  而不是点击时当前生效的维度（用户可能切了 config 后回看旧楼层点击）。找不到返回 null。 */
const findHitScope = (stats: StatsSettings, entryId: string, gid: string): string | null => {
  const cur = currentScopeId();
  const curEntry = stats.entries[cur]?.by_entry[entryId];
  if (curEntry?.recent.some(r => r.gid === gid)) return cur;
  for (const [sid, scope] of Object.entries(stats.entries)) {
    if (sid === cur) continue;
    const e = scope.by_entry[entryId];
    if (e?.recent.some(r => r.gid === gid)) return sid;
  }
  return null;
};

/** 记录用户点击应用一次行动选项（仅行动选项视图；调用方已按 view 过滤）。
 *  poolEntryIds 为被点选项所在轮的条目集合——整轮共现：每个参与条目命中轮次 +1。
 *  generationId 用于同代去重（last_hit_generation_id 全局单槽）与窗口 hit 回写定位；
 *  命中归属 scope 优先 = 生成时所在维度（recent 含 gid），否则当前生效维度兜底。
 *  optionText 为被点选项的正文（已 parse 去标头），写入 last_selected_text 供展示；
 *  仅在真正计命中（非同代去重命中）时写入，保证与 rounds_with_selection 同步。 */
export function recordOptionSelected(poolEntryIds: string[], generationId?: string, optionText?: string): void {
  const stats = useGlobalSettingsStore().settings.stats;
  stats.total_selected += 1;
  stats.updated_at = Date.now();
  // scope.selected 跟随点击（不做同代去重）——反映"点击活跃度"，与条目级命中去重口径分离
  const scopeId = currentScopeId();
  const scope = getScopeStats(stats, scopeId);
  scope.total_selected += 1;
  getDaily(scope, dailyKey()).selected += 1;
  if (poolEntryIds.length === 0) return;
  if (generationId && generationId === stats.last_hit_generation_id) return;
  const now = Date.now();
  for (const entryId of poolEntryIds) {
    const hitScopeId = generationId ? (findHitScope(stats, entryId, generationId) ?? scopeId) : scopeId;
    const e = getEntryStats(getScopeStats(stats, hitScopeId), entryId);
    e.rounds_with_selection += 1;
    e.last_selected_at = now;
    if (optionText) e.last_selected_text = optionText;
    const rec = generationId ? e.recent.find(r => r.gid === generationId) : undefined;
    // 窗口滚动挤掉的旧代再被点击：全量计数照记，窗口回写跳过（窗口是滚动样本，可接受）
    if (rec) rec.hit = true;
  }
  stats.last_hit_generation_id = generationId ?? null;
}

/** 清空全部统计（各维度总量、逐日计数、条目聚合、代去重记录、时间戳一并重置）。 */
export function clearStats(): void {
  const gs = useGlobalSettingsStore();
  gs.settings.stats = createEmptyStats();
}

// ── 维度视图（组件唯一数据入口：全局聚合 or 单 scope） ──────────────────────

export type StatsView = {
  /** GLOBAL_SCOPE | config.id | NONE_SCOPE */
  scopeId: string;
  isGlobal: boolean;
  total_generated: number;
  total_selected: number;
  updated_at: number;
  daily: Record<string, DailyCount>;
  by_entry: Record<string, StatsEntryEntry>;
};

/** 构造维度视图：scopeId = GLOBAL_SCOPE 时聚合所有 scope（recent 不聚合——窗口指标仅
 *  单一 scope 维度有效，全局维度命中率显示全量口径），否则取该 scope 原样（缺省空）。 */
export function buildStatsView(stats: StatsSettings, scopeId: string): StatsView {
  if (scopeId === GLOBAL_SCOPE) {
    let total_generated = 0;
    let total_selected = 0;
    const daily: Record<string, DailyCount> = {};
    const by_entry: Record<string, StatsEntryEntry> = {};
    for (const scope of Object.values(stats.entries)) {
      total_generated += scope.total_generated;
      total_selected += scope.total_selected;
      for (const [key, d] of Object.entries(scope.daily)) {
        const agg = (daily[key] ??= { generated: 0, selected: 0 });
        agg.generated += d.generated;
        agg.selected += d.selected;
      }
      for (const [id, e] of Object.entries(scope.by_entry)) {
        const agg = by_entry[id];
        if (!agg) {
          by_entry[id] = {
            rounds_included: e.rounds_included,
            rounds_with_selection: e.rounds_with_selection,
            expected_sum: e.expected_sum,
            recent: [],
            last_selected_at: e.last_selected_at,
            last_selected_text: e.last_selected_text,
            last_included_at: e.last_included_at,
          };
        } else {
          agg.rounds_included += e.rounds_included;
          agg.rounds_with_selection += e.rounds_with_selection;
          agg.expected_sum += e.expected_sum;
          // 单槽近似字段取"最近"（时间戳大者）
          if (e.last_selected_at > agg.last_selected_at) {
            agg.last_selected_at = e.last_selected_at;
            agg.last_selected_text = e.last_selected_text;
          }
          if (e.last_included_at > agg.last_included_at) agg.last_included_at = e.last_included_at;
        }
      }
    }
    return {
      scopeId: GLOBAL_SCOPE,
      isGlobal: true,
      total_generated,
      total_selected,
      updated_at: stats.updated_at,
      daily,
      by_entry,
    };
  }
  const scope = stats.entries[scopeId];
  return {
    scopeId,
    isGlobal: false,
    total_generated: scope?.total_generated ?? 0,
    total_selected: scope?.total_selected ?? 0,
    updated_at: stats.updated_at,
    daily: scope?.daily ?? {},
    by_entry: scope?.by_entry ?? {},
  };
}

// ── 排行榜纯函数（接收维度视图，组件只渲染） ────────────────────────────────

export type EntryRankRow = {
  entryId: string;
  deleted: boolean;
  type: string;
  category: string;
  content: string;
  rounds_included: number;
  rounds_with_selection: number;
  /** 全量命中率（rounds_with_selection / rounds_included，未参与为 null） */
  rate: number | null;
  /** 全量期望命中率之和 Σ(1/count)（建议引擎与「期望」展示用） */
  expected_sum: number;
  /** 滑动窗口记录（单一 scope 维度才有；全局聚合视图为空数组） */
  recent: StatsRoundRecord[];
  /** 最近参与生成的时间戳（0 = 从未参与） */
  last_included_at: number;
  /** 最近一次命中时被选的选项正文（'' = 无） */
  last_selected_text: string;
  /** 有效权重：config 覆盖 ?? master_pool（建议引擎展示当前值与计算目标值） */
  effectiveWeight: number;
  /** 是否固定（pinned）：固定必发不参与抽签，weight 无意义，建议引擎跳过 */
  effectivePinned: boolean;
};

export type EntryGroup = {
  /** 组名（空 category 归「未分组」；已删除条目组为「已删除」） */
  category: string;
  deletedGroup: boolean;
  /** 组内条目（全量含 0 参与，按参与轮次降序、未参与排后） */
  rows: EntryRankRow[];
  /** 组汇总（参与轮次合计） */
  rounds_included: number;
  rounds_with_selection: number;
  rate: number | null;
};

/** 条目榜分组纯函数：按 category 分组的折叠列表数据源。
 *  组顺序：groupOrder（条目库分组顺序）优先 → 未列入的自定义/未分组按名称 → 已删除组末尾。
 *  组内排序：参与轮次降序 → 命中轮次降序 → entryId。排序/分组逻辑单一真相源，组件只渲染。
 *  cfgEntryMap：config 层覆盖（entry_id → PoolConfigEntry），用于 effectiveWeight/pinned；
 *  空 map = 无覆盖（'__none__' 维度直接读 master_pool 的 weight/pinned）。 */
export function entryGroups(
  view: StatsView,
  masterPool: PoolEntry[],
  groupOrder: string[],
  cfgEntryMap: Map<string, PoolConfigEntry> = new Map(),
): EntryGroup[] {
  const poolMap = new Map(masterPool.map(e => [e.id, e]));
  const byCat = new Map<string, EntryRankRow[]>();
  const deletedRows: EntryRankRow[] = [];
  const rowFor = (entryId: string, entry: PoolEntry | undefined): EntryRankRow => {
    const e = view.by_entry[entryId];
    const cfg = entry ? cfgEntryMap.get(entry.id) : undefined;
    return {
      entryId,
      deleted: !entry,
      type: entry?.type ?? '',
      category: entry?.category ?? '',
      content: entry?.content ?? '',
      rounds_included: e?.rounds_included ?? 0,
      rounds_with_selection: e?.rounds_with_selection ?? 0,
      rate: e && e.rounds_included > 0 ? e.rounds_with_selection / e.rounds_included : null,
      expected_sum: e?.expected_sum ?? 0,
      recent: e?.recent ?? [],
      last_included_at: e?.last_included_at ?? 0,
      last_selected_text: e?.last_selected_text ?? '',
      effectiveWeight: cfg?.weight ?? entry?.weight ?? 1,
      effectivePinned: cfg?.pinned ?? entry?.pinned ?? false,
    };
  };
  for (const entry of masterPool) {
    const cat = entry.category.trim() || '未分组';
    const list = byCat.get(cat) ?? [];
    list.push(rowFor(entry.id, entry));
    byCat.set(cat, list);
  }
  for (const [entryId] of Object.entries(view.by_entry)) {
    if (!poolMap.has(entryId)) deletedRows.push(rowFor(entryId, undefined));
  }
  const makeGroup = (category: string, deletedGroup: boolean, rows: EntryRankRow[]): EntryGroup => {
    const rounds_included = rows.reduce((s, r) => s + r.rounds_included, 0);
    const rounds_with_selection = rows.reduce((s, r) => s + r.rounds_with_selection, 0);
    return {
      category,
      deletedGroup,
      rows: rows.sort(
        (a, b) =>
          b.rounds_included - a.rounds_included ||
          b.rounds_with_selection - a.rounds_with_selection ||
          a.entryId.localeCompare(b.entryId),
      ),
      rounds_included,
      rounds_with_selection,
      rate: rounds_included > 0 ? rounds_with_selection / rounds_included : null,
    };
  };
  const groups: EntryGroup[] = [];
  const used = new Set<string>();
  for (const cat of groupOrder) {
    const rows = byCat.get(cat);
    if (rows) {
      groups.push(makeGroup(cat, false, rows));
      used.add(cat);
    }
  }
  const rest = [...byCat.keys()].filter(cat => !used.has(cat)).sort((a, b) => a.localeCompare(b));
  for (const cat of rest) {
    groups.push(makeGroup(cat, false, byCat.get(cat)!));
  }
  if (deletedRows.length) {
    groups.push(makeGroup('已删除', true, deletedRows));
  }
  return groups;
}

export type TypeRankRow = {
  type: string;
  rounds_included: number;
  rounds_with_selection: number;
  rate: number | null;
};

/** 类型榜纯函数：由维度视图内参与了至少一轮的条目统计按条目 type 聚合推导（不落盘）；
 *  已删除条目（无类型可查）归入「（已删除）」桶 */
export function typeLeaderboard(view: StatsView, masterPool: PoolEntry[]): TypeRankRow[] {
  const poolMap = new Map(masterPool.map(e => [e.id, e]));
  const agg = new Map<string, TypeRankRow>();
  for (const [entryId, e] of Object.entries(view.by_entry)) {
    if (e.rounds_included <= 0) continue;
    const entry = poolMap.get(entryId);
    const type = entry ? entry.type : '（已删除）';
    const row = agg.get(type) ?? {
      type,
      rounds_included: 0,
      rounds_with_selection: 0,
      rate: null,
    };
    row.rounds_included += e.rounds_included;
    row.rounds_with_selection += e.rounds_with_selection;
    row.rate = row.rounds_included > 0 ? row.rounds_with_selection / row.rounds_included : null;
    agg.set(type, row);
  }
  return [...agg.values()].sort(
    (a, b) =>
      b.rounds_included - a.rounds_included ||
      b.rounds_with_selection - a.rounds_with_selection ||
      a.type.localeCompare(b.type),
  );
}

// ── 命中率指标（全量/窗口 + 相对基线） ───────────────────────────────────────

/** 窗口命中率指标（recent 非空时可用）：rate/expectedRate/excess 均基于窗口内
 *  每轮的 count 推导（期望 = Σ 1/count / 样本数），非固定阈值口径 */
export type WindowMetrics = {
  samples: number;
  hits: number;
  expected: number;
  rate: number | null;
  expectedRate: number | null;
  excess: number | null;
};

export function windowMetrics(row: Pick<EntryRankRow, 'recent'>): WindowMetrics | null {
  const recent = row.recent;
  if (!recent || recent.length === 0) return null;
  let hits = 0;
  let expected = 0;
  for (const r of recent) {
    if (r.hit) hits += 1;
    if (r.count > 0) expected += 1 / r.count;
  }
  const samples = recent.length;
  const rate = hits / samples;
  const expectedRate = expected / samples;
  return { samples, hits, expected, rate, expectedRate, excess: rate - expectedRate };
}

/** 全量期望命中率：expected_sum / rounds_included（未参与为 null） */
export function fullExpectedRate(row: Pick<EntryRankRow, 'rounds_included' | 'expected_sum'>): number | null {
  if (row.rounds_included <= 0) return null;
  return row.expected_sum / row.rounds_included;
}

// ── 建议引擎（只建议不改权重之外的东西；写入由 applySuggestions 显式触发） ───

export type SuggestionAction = 'down' | 'up' | 'disable';

export type Suggestion = {
  entryId: string;
  action: SuggestionAction;
  /** 依据样本数（窗口长度或全量参与轮次） */
  samples: number;
  /** 实际命中率（依据数据源口径） */
  rate: number;
  /** 期望命中率（随机基线） */
  expected: number;
  /** rate - expected */
  excess: number;
  /** 当前有效权重（config 覆盖 ?? master_pool） */
  currentWeight: number;
  /** down/up 的目标权重；disable 无 */
  newWeight?: number;
  /** 依据口径：'窗口' | '全量' */
  basis: '窗口' | '全量';
};

/** 单条目建议（纯函数）：数据源优先窗口（recent ≥ SUGGEST_MIN_SAMPLES），否则全量
 *  （rounds_included ≥ SUGGEST_MIN_SAMPLES），样本不足返回 null。
 *  阈值：超额命中率（rate - expected）≤ -0.3 且 0 命中 → 停用；≤ -0.2 → 降权
 *  （减半、下限 SUGGEST_WEIGHT_MIN）；≥ +0.15 → 提权（翻倍、上限 SUGGEST_WEIGHT_MAX）。
 *  pinned 条目跳过（固定必发，权重不影响出现频率，改它无意义）。
 *  阈值是启发式常量（settings.ts），注释不重复解释，随数据积累调参。 */
export function entrySuggestion(
  row: Pick<
    EntryRankRow,
    | 'entryId'
    | 'rounds_included'
    | 'rounds_with_selection'
    | 'expected_sum'
    | 'recent'
    | 'effectiveWeight'
    | 'effectivePinned'
  >,
): Suggestion | null {
  if (row.effectivePinned) return null;
  const w = windowMetrics(row);
  let samples: number;
  let hits: number;
  let expected: number;
  let basis: Suggestion['basis'];
  if (w && w.samples >= SUGGEST_MIN_SAMPLES) {
    samples = w.samples;
    hits = w.hits;
    expected = w.expected;
    basis = '窗口';
  } else if (row.rounds_included >= SUGGEST_MIN_SAMPLES) {
    samples = row.rounds_included;
    hits = row.rounds_with_selection;
    expected = row.expected_sum;
    basis = '全量';
  } else {
    return null;
  }
  if (samples <= 0) return null;
  const rate = hits / samples;
  const expectedRate = expected / samples;
  const excess = rate - expectedRate;
  const base: Omit<Suggestion, 'action' | 'newWeight'> = {
    entryId: row.entryId,
    samples,
    rate,
    expected: expectedRate,
    excess,
    currentWeight: row.effectiveWeight,
    basis,
  };
  // 停用优先：更极端（超额极低且一次未命中）给更强动作；停用后不再进 effectivePool，
  // 无新数据，不会自动恢复——UI 须提示用户可撤销
  if (excess <= SUGGEST_DISABLE_EXCESS && hits === 0) {
    return { ...base, action: 'disable' };
  }
  if (excess <= SUGGEST_DOWNGRADE_EXCESS) {
    return {
      ...base,
      action: 'down',
      newWeight: Math.max(SUGGEST_WEIGHT_MIN, row.effectiveWeight * 0.5),
    };
  }
  if (excess >= SUGGEST_UPGRADE_EXCESS) {
    return {
      ...base,
      action: 'up',
      newWeight: Math.min(SUGGEST_WEIGHT_MAX, row.effectiveWeight * 2),
    };
  }
  return null;
}

export type EntryInsight = 'downgrade' | 'disable' | 'good' | 'insufficient' | null;

/** 洞察标签（展示层派生）：有建议 → 按其动作标「候选降权/建议停用/表现良好」；
 *  参与 >0 但样本不足 → 「样本不足」；无参与/无建议 → 无标签。只提示不改权重。 */
export function entryInsight(
  row: Pick<
    EntryRankRow,
    | 'entryId'
    | 'rounds_included'
    | 'rounds_with_selection'
    | 'expected_sum'
    | 'recent'
    | 'effectiveWeight'
    | 'effectivePinned'
  >,
): EntryInsight {
  const s = entrySuggestion(row);
  if (s) return s.action === 'down' ? 'downgrade' : s.action === 'disable' ? 'disable' : 'good';
  if (row.rounds_included > 0 && row.rounds_included < SUGGEST_MIN_SAMPLES) return 'insufficient';
  return null;
}

// ── 建议应用与撤销（写 config 覆盖层；经 global store 直写，deep watch 持久化） ──

export type SuggestionApplyResult = {
  applied: number;
  skipped: number;
};

/** 上次应用前的 config.entries 快照（模块级内存态，用于单步撤销） */
let lastUndo: { scopeId: string; entries: PoolConfigEntry[] } | null = null;

/** 应用一批建议到指定 config（scopeId = config.id）。快照应用前 entries 供撤销；
 *  找不到目标 config 或条目（理论上被建议条目必在 config 引用中）→ skipped。
 *  不显式调 saveSettingsDebounced——settings deep watch 统一落盘（见 global-settings.ts） */
export function applySuggestions(scopeId: string, suggestions: Suggestion[]): SuggestionApplyResult {
  const gs = useGlobalSettingsStore();
  const config = gs.settings.configs.find(c => c.id === scopeId);
  if (!config) return { applied: 0, skipped: suggestions.length };
  lastUndo = { scopeId, entries: klona(config.entries) };
  let applied = 0;
  for (const s of suggestions) {
    const entry = config.entries.find(e => e.entry_id === s.entryId);
    if (!entry) continue;
    if (s.action === 'disable') {
      entry.enabled = false;
    } else if (s.newWeight !== undefined) {
      entry.weight = s.newWeight;
    }
    applied += 1;
  }
  return { applied, skipped: suggestions.length - applied };
}

/** 撤销上次应用（单步）：把 config.entries 恢复为应用前快照，成功返回 true */
export function undoLastApply(): boolean {
  if (!lastUndo) return false;
  const { scopeId, entries } = lastUndo;
  const gs = useGlobalSettingsStore();
  const config = gs.settings.configs.find(c => c.id === scopeId);
  lastUndo = null;
  if (!config) return false;
  config.entries = klona(entries);
  return true;
}

/** 当前是否可撤销（组件据此显示撤销入口） */
export const hasUndo = (): boolean => lastUndo !== null;

// ── 列表交互纯函数 ────────────────────────────────────────────────────────────

export type EntrySortBy = 'rounds' | 'selection' | 'rate' | 'content';

export type EntryFilterOptions = {
  /** 搜索词：匹配内容/类型/分类（大小写不敏感）；空串不过滤 */
  query: string;
  /** 只看有数据的条目（rounds_included > 0） */
  onlyWithData: boolean;
  /** 组内排序维度：rounds=参与轮次、selection=命中轮次、rate=命中率、content=内容字典序 */
  sortBy: EntrySortBy;
};

/** 组内排序 comparator 工厂。默认维度（rounds）与 entryGroups 的原始排序一致，
 *  便于"未选排序时"行为稳定。rate 为 null（未参与）永远排最后。 */
const entryComparator = (sortBy: EntrySortBy) => {
  switch (sortBy) {
    case 'selection':
      return (a: EntryRankRow, b: EntryRankRow) =>
        b.rounds_with_selection - a.rounds_with_selection ||
        b.rounds_included - a.rounds_included ||
        a.entryId.localeCompare(b.entryId);
    case 'rate':
      return (a: EntryRankRow, b: EntryRankRow) =>
        (b.rate ?? -1) - (a.rate ?? -1) || b.rounds_included - a.rounds_included || a.entryId.localeCompare(b.entryId);
    case 'content':
      return (a: EntryRankRow, b: EntryRankRow) =>
        a.content.localeCompare(b.content) || a.entryId.localeCompare(b.entryId);
    case 'rounds':
    default:
      return (a: EntryRankRow, b: EntryRankRow) =>
        b.rounds_included - a.rounds_included ||
        b.rounds_with_selection - a.rounds_with_selection ||
        a.entryId.localeCompare(b.entryId);
  }
};

/** 条目榜搜索/筛选/排序纯函数：对 entryGroups 的组内 rows 过滤并重排，过滤后重算组汇总
 *  （参与轮次/命中轮次/命中率）；整组无匹配行时丢弃该组。组件只渲染，不重复实现该逻辑。 */
export function applyEntryFilters(groups: EntryGroup[], opts: EntryFilterOptions): EntryGroup[] {
  const q = opts.query.trim().toLowerCase();
  const cmp = entryComparator(opts.sortBy);
  const out: EntryGroup[] = [];
  for (const g of groups) {
    const rows = g.rows.filter(r => {
      if (opts.onlyWithData && r.rounds_included <= 0) return false;
      if (q) {
        const hay = `${r.content}\u0000${r.type}\u0000${r.category}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    if (rows.length === 0) continue;
    const rounds_included = rows.reduce((s, r) => s + r.rounds_included, 0);
    const rounds_with_selection = rows.reduce((s, r) => s + r.rounds_with_selection, 0);
    out.push({
      ...g,
      rows: rows.sort(cmp),
      rounds_included,
      rounds_with_selection,
      rate: rounds_included > 0 ? rounds_with_selection / rounds_included : null,
    });
  }
  return out;
}

export type DailySeriesPoint = {
  /** 本地 YYYY-MM-DD（daily 的键） */
  key: string;
  /** 展示标签 M/D */
  label: string;
  generated: number;
  selected: number;
};

/** 生成最近 days 天的连续每日计数序列（无数据天补 0），供趋势柱状图使用。
 *  label 用 M/D 短格式，移动端 380px 下不会挤爆格子。 */
export function dailySeries(view: StatsView, days: number): DailySeriesPoint[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: DailySeriesPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = dailyKey(d);
    const c = view.daily[key];
    out.push({
      key,
      label: `${d.getMonth() + 1}/${d.getDate()}`,
      generated: c?.generated ?? 0,
      selected: c?.selected ?? 0,
    });
  }
  return out;
}

export type SampleDistribution = {
  /** 样本充足（建议可用）：窗口 ≥ SUGGEST_MIN_SAMPLES 或全量参与 ≥ SUGGEST_MIN_SAMPLES */
  sufficient: number;
  /** 参与 >0 但 < SUGGEST_MIN_SAMPLES（命中率噪声大，只标「样本不足」） */
  insufficient: number;
  /** 有效池中从未出现在本维度 by_entry 的条目数（v51 修复：此前恒 0） */
  never: number;
};

/** 样本量分布诊断：基于维度视图 by_entry 与有效池大小。
 *  poolSize = 当前维度有效池大小（config 引用的 enabled 条目数；无 config = master_pool 全量）。
 *  已删除条目（by_entry 有但池中无）不计入三档，只在 never 计算时排除——分母语义
 *  是"池内条目样本覆盖度"，供统计页展示「优选置信度」。纯展示，不写回。 */
export function entrySampleDistribution(view: StatsView, poolSize: number, poolIds: Set<string>): SampleDistribution {
  let sufficient = 0;
  let insufficient = 0;
  let inPool = 0;
  for (const [id, e] of Object.entries(view.by_entry)) {
    if (!poolIds.has(id)) continue;
    inPool += 1;
    const w = windowMetrics({ recent: e.recent });
    const samples = w && w.samples >= SUGGEST_MIN_SAMPLES ? w.samples : e.rounds_included;
    if (samples >= SUGGEST_MIN_SAMPLES) sufficient += 1;
    else if (e.rounds_included > 0) insufficient += 1;
  }
  return { sufficient, insufficient, never: Math.max(0, poolSize - inPool) };
}
