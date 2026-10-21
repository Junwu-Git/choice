import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { CATEGORY_DELETED, CATEGORY_UNGROUPED, DELETED_GROUP_PREFIX } from '@/core/constants';
import type { ChoiceOption } from '@/core/options-store';
import type { DiceOutcome } from '@/core/dice';
import {
  AVG_PICKS_MIN_ROUNDS,
  STATS_MIN_SAMPLES,
  STATS_WINDOW_SIZE,
  createEmptyStats,
  createEmptyDiceStats,
  type DailyCount,
  type DiceStats,
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
    s = { total_generated: 0, total_selected: 0, updated_at: 0, by_entry: {}, daily: {} };
    stats.entries[scopeId] = s;
  }
  return s;
};

/** 取条目统计记录：不存在则创建。by_entry 只增，键数受用户实际使用过的条目数约束 */
const getEntryStats = (scope: ScopeStats, entryId: string): StatsEntryEntry => {
  // 原型键守卫：by_entry 是普通对象，方括号读在无自有键时会命中原型链（如 "__proto__"），
  // 篡改存档注入的 entryId 可借命中路径把计数写进 Object.prototype。hasOwn +
  // defineProperty 确保只在自有键上读写（defineProperty 创建键不走 __proto__ 赋值器）
  if (!Object.prototype.hasOwnProperty.call(scope.by_entry, entryId)) {
    const fresh: StatsEntryEntry = {
      rounds_included: 0,
      rounds_with_selection: 0,
      expected_sum: 0,
      recent: [],
      last_selected_at: 0,
      last_selected_text: '',
      last_included_at: 0,
    };
    Object.defineProperty(scope.by_entry, entryId, {
      value: fresh,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return fresh;
  }
  return scope.by_entry[entryId];
};

/** 本地时区 YYYY-MM-DD（趋势 daily 的键）。daily 是"哪一天发生了活动"，用户心智按本地日 */
const dailyKey = (date = new Date()): string => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

/** 取当天计数记录：不存在则创建。daily 只增——键数受实际使用天数约束 */
const getDaily = (scope: ScopeStats, key: string): DailyCount => {
  // 与 getEntryStats 相同的原型键守卫（date 键为本地日期串，此处防御存档被篡改）
  if (!Object.prototype.hasOwnProperty.call(scope.daily, key)) {
    const fresh = { generated: 0, selected: 0 };
    Object.defineProperty(scope.daily, key, {
      value: fresh,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    return fresh;
  }
  return scope.daily[key];
};

/** 当前生效统计维度 id：绑定/默认 config.id，无 config 会话为 NONE_SCOPE */
const currentScopeId = (): string => usePoolSelectorStore().effectiveConfig?.id ?? NONE_SCOPE;

/** 记录一轮行动选项生成成功（去重/补齐后实际保留条数）。仅行动选项视图计入。
 *  gid 为 generation id：写入窗口记录的定位锚，选择时按 gid 回写 hit。
 *  count = options.length（该轮实际输出条数）。
 *  scopeId 为生成时生效的统计维度（ChoiceGeneration.scopeId 同源传入，杜绝生成后
 *  再读 currentScopeId() 时用户已切配置的极小不一致窗口）；缺省回退 currentScopeId()。
 *  参与（rounds_included）= 轮次共现：每个进入候选的条目 +1（与选项是否被采纳无关）。
 *  期望 = 采纳感知随机基线：仅对「输出中被匹配到」的条目累计 matched/count——AI 完全
 *  自由发挥的轮次所有条目不累计期望（修正 v53 前期望恒按 1/count 累计、与精确命中
 *  不对称导致的系统性负超额）；匹配到 k 条输出时按 k/count 计——用户随机点选时命中
 *  该条目任一输出的概率是 k/count 而非 1/count（按 1/count 会让多输出条目基线偏低、
 *  超额系统性偏高被误读为表现好）。命中按轮单槽，期望与其对齐。 */
export function recordOptionsGenerated(
  options: ChoiceOption[],
  poolEntryIds: string[],
  gid: string,
  scopeId?: string,
): void {
  const gs = useGlobalSettingsStore();
  // 总开关默认关：关 = 完全不采集统计（含 updated_at/窗口/gid 记录），开启后才积累。
  // 与 recordOptionSelected 同口径，避免「关了还留时间戳/半条窗口记录」的数据断层
  if (!gs.settings.stats_enabled) return;
  const stats = gs.settings.stats;
  // 顶级 stats.total_generated 已废弃不再双写：全局总量由 buildStatsView 聚合推导
  //（单一真相源，见该函数注释）；仅导出 JSON 时临时聚合
  stats.updated_at = Date.now();
  const scope = getScopeStats(stats, scopeId ?? currentScopeId());
  scope.updated_at = Date.now();
  scope.total_generated += options.length;
  // 成功轮数计数（与输出条数无关）：平均点选数 m̄ 的分母（多点选期望基线校正，见
  // scopeAvgPicks / windowMetrics）
  scope.total_rounds = (scope.total_rounds ?? 0) + 1;
  getDaily(scope, dailyKey()).generated += options.length;
  const now = Date.now();
  const count = options.length;
  // 本轮各条目在输出中被匹配到的选项数（精确归因；matchedEntryId 随消息持久化）
  const matchedCounts = new Map<string, number>();
  for (const o of options) {
    const id = o.matchedEntryId;
    if (id) matchedCounts.set(id, (matchedCounts.get(id) ?? 0) + 1);
  }
  for (const id of poolEntryIds) {
    const e = getEntryStats(scope, id);
    e.rounds_included += 1;
    // count=0 理论上不会发生（成功路径必有输出），防御除零静默退化。
    // 期望按 matched/count（该条目被匹配到的输出数 ÷ 输出条数）：见函数头注释
    const matched = matchedCounts.get(id) ?? 0;
    e.expected_sum += count > 0 && matched > 0 ? matched / count : 0;
    e.last_included_at = now;
    e.recent.push({ gid, ts: now, hit: false, count, matched: matchedCounts.get(id) ?? 0 });
    if (e.recent.length > STATS_WINDOW_SIZE) e.recent.shift();
  }
}

/** 在统计全维度中定位"含该 generation 窗口记录"的 scope：命中应归到生成时所在的维度，
 *  而不是点击时当前生效的维度（用户可能切了 config 后回看旧楼层点击）。找不到返回 null。
 *  仅作旧代兜底——新代点击已由调用方传入生成时维度（generationScopeId），无需全表搜索。 */
const findHitScope = (stats: StatsSettings, entryId: string, gid: string): string | null => {
  // 原型键守卫（与 getEntryStats 同源）：by_entry 是持久化普通对象，方括号读无自有键时
  // 命中原型链（如 "__proto__" → Object.prototype，truthy），其 recent 为 undefined，
  // 直接 `?.recent.some` 会抛 TypeError——recordOptionSelected 的异常会中断选项发送链路。
  // hasOwn 守卫后取到的必为真实记录（recent 为数组），?. 仅作防御冗余
  const hasOwn = Object.prototype.hasOwnProperty;
  const hasGid = (e: StatsEntryEntry | undefined): boolean => !!e?.recent?.some(r => r.gid === gid);
  const cur = currentScopeId();
  const curScope = stats.entries[cur];
  if (curScope && hasOwn.call(curScope.by_entry, entryId) && hasGid(curScope.by_entry[entryId])) return cur;
  for (const [sid, scope] of Object.entries(stats.entries)) {
    if (sid === cur) continue;
    if (hasOwn.call(scope.by_entry, entryId) && hasGid(scope.by_entry[entryId])) return sid;
  }
  return null;
};

/** 记录用户点击应用一次行动选项（仅行动选项视图；调用方已按 view 过滤）。
 *  poolEntryIds 为被点选项所在轮的条目集合。命中口径按 matchedEntryId 三态：
 *  - string：精确归因命中该条目，仅它命中轮次 +1；
 *  - null（新代显式未匹配）：不命中任何条目（被 AI 舍弃的候选不产生命中）——避免 null
 *    回退整轮共现导致全轮条目误计命中、与跨维度命中去重组合后产生重复计数；
 *  - undefined（旧代消息无 matchedEntryId 字段）：回退整轮共现，每个参与条目命中轮次 +1
 *    （旧消息行为保持不变）。调用方须保留三态不归一化（勿 `?? null`），见 option-action.ts。
 *  generationId 用于同代去重（按「条目 × 代」粒度）与窗口 hit 回写定位；
 *  generationScopeId 为生成时所在的统计维度（ChoiceGeneration.scopeId，随消息持久化）——
 *  命中应归到生成时维度而不是点击时的当前维度（用户可能切了 config 后回看旧楼层点击）；
 *  缺省（旧代消息无 scopeId 字段）时回退 findHitScope 全局搜索，再回退当前生效维度。
 *  命中落入非当前维度时，同步刷新该维度 ScopeStats.updated_at——保持「维度最近活动」
 *  读数与命中数据变化一致（total_selected/daily 仍跟随点击时当前维度，符合「点击活跃度」
 *  口径，此处只刷新活动时间戳）。
 *  同代去重：条目在窗口中有该 gid 记录时以 rec.hit 为准——同代同条目重复点击只计 1 次，
 *  同代不同条目（整轮多选）互不吞；窗口无记录（旧代/被滚动挤掉）时回退全局单槽
 *  last_hit_generation_id 整轮去重（首击整轮计、重复点击全退），旧代行为保持不变。
 *  optionText 为被点选项的正文（已 parse 去标头），写入 last_selected_text 供展示；
 *  仅在真正计命中（非同代去重命中）时写入，保证与 rounds_with_selection 同步。 */
export function recordOptionSelected(
  poolEntryIds: string[],
  generationId?: string,
  optionText?: string,
  matchedEntryId?: string | null,
  generationScopeId?: string,
): void {
  const gs = useGlobalSettingsStore();
  // 总开关默认关：关 = 完全不采集统计（含点击活跃度计数），开启后才积累。
  // 与 recordOptionsGenerated 同口径，保证关闭期间 stats 各字段零写入
  if (!gs.settings.stats_enabled) return;
  const stats = gs.settings.stats;
  // 顶级 stats.total_selected 已废弃不再双写：全局总量由 buildStatsView 聚合推导
  stats.updated_at = Date.now();
  // scope.selected 跟随点击（不做同代去重）——反映"点击活跃度"，与条目级命中去重口径分离
  const scopeId = currentScopeId();
  const scope = getScopeStats(stats, scopeId);
  scope.updated_at = Date.now();
  scope.total_selected += 1;
  // 点选次数计数（与 total_selected 同口径、不做去重——重复点击也是点选习惯的一部分）：
  // 平均点选数 m̄ 的分子（多点选期望基线校正，见 scopeAvgPicks / windowMetrics）
  scope.picks_total = (scope.picks_total ?? 0) + 1;
  getDaily(scope, dailyKey()).selected += 1;
  if (poolEntryIds.length === 0) return;
  const now = Date.now();
  // 命中口径三态（见函数头注释）：string → 仅该条目；null → 不命中任何条目（新代
  // 自由发挥，被 AI 舍弃的候选不产生命中）；undefined → 回退整轮共现（旧代无字段兼容）
  const hitIds = matchedEntryId ? [matchedEntryId] : matchedEntryId === null ? [] : poolEntryIds;
  // 实际写入命中的维度集合（去重）：用于跨维度命中时刷新命中维度 updated_at
  const hitScopes = new Set<string>();
  for (const entryId of hitIds) {
    const hitScopeId = generationScopeId
      ? generationScopeId
      : generationId
        ? (findHitScope(stats, entryId, generationId) ?? scopeId)
        : scopeId;
    const e = getEntryStats(getScopeStats(stats, hitScopeId), entryId);
    const rec = generationId ? e.recent.find(r => r.gid === generationId) : undefined;
    // 同代去重按「条目 × 代」：窗口有记录时以 rec.hit 为准（同代同条目只计 1 次，不同
    // 条目互不吞）；窗口无记录（旧代/被滚动挤掉）回退全局单槽——首击允许计、重复全退
    if (rec) {
      if (rec.hit) continue;
      rec.hit = true;
    } else if (generationId && generationId === stats.last_hit_generation_id) {
      continue;
    }
    e.rounds_with_selection += 1;
    // 仅在实际写入命中时记录维度——去重跳过的点击不刷新 updated_at，避免无数据变化
    // 却白写一次时间戳
    hitScopes.add(hitScopeId);
    e.last_selected_at = now;
    if (optionText) e.last_selected_text = optionText;
  }
  // 跨维度命中：用户切 config 后回看旧楼层点击时，命中落入旧维度（≠ 当前 scope）。
  // 刷新该维度 ScopeStats.updated_at 让「最近活动」读数反映命中数据变化；当前 scope 的
  // updated_at 已在上方随 total_selected 一起刷新，此处跳过避免重复写
  for (const sid of hitScopes) {
    if (sid !== scopeId) getScopeStats(stats, sid).updated_at = now;
  }
  // 单槽只记录「实际记录了命中」的代：无 id 点击（旧消息）不写也不清空；null 命中
  // （新代自由发挥，hitIds 为空、零命中）同样不写——否则会占用该代单槽，等窗口记录
  // 滚动挤掉后，用户再点同代另一条带 matchedEntryId 的选项时走单槽去重被误吞（null
  // 点击不产生命中，不应消耗该代的「首击可计」资格）。若用 `?? null`，「点代 A → 点旧
  // 消息 → 回看代 A 再点」序列会把单槽清掉、代 A 被重复计命中，破坏"同代重复点击只计
  // 1 次"的口径（单槽按代记忆，与点击次数无关）。hitScopes 仅在真正计数命中后 add（见上），
  // 全去重/null/无 id 路径为空 → 不写单槽，行为与注释语义一致
  if (generationId && hitScopes.size > 0) stats.last_hit_generation_id = generationId;
}

/** 骰子判定历史条数上限（v61，FIFO，超出丢最旧）。 */
export const DICE_HISTORY_LIMIT = 50;

/** 记录一次骰子判定（全局战绩，不随 config 维度）。随 stats_enabled 采集：
 *  关 = 早退零写入（与 recordOptionsGenerated/recordOptionSelected 同口径）。
 *  判定结果只进独立战绩字段，不参与条目权重、不写 last_selected_text。
 *  outcome/roll/rate 由 option-action 判定后传入；daily 键与趋势图同口径（本地时区）。
 *  text 为 parse 后选项正文的短摘要，写入 history 供统计页最近判定回顾（v61）。 */
export function recordDiceRoll(outcome: DiceOutcome, roll: number, rate: number, text = ''): void {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.stats_enabled) return;
  const stats = gs.settings.stats;
  // 老档/未经过 zod parse 的运行时对象可能缺 dice 字段，惰性补一份空白战绩
  const dice = stats.dice ?? (stats.dice = createEmptyDiceStats());
  dice.total_rolls += 1;
  dice.by_outcome[outcome] = (dice.by_outcome[outcome] ?? 0) + 1;
  const key = dailyKey();
  // 原型键守卫（与 getDaily 同源）：daily 是持久化普通对象，防御篡改存档注入的键
  if (!Object.prototype.hasOwnProperty.call(dice.daily, key)) {
    Object.defineProperty(dice.daily, key, {
      value: { crit_success: 0, success: 0, fail: 0, crit_fail: 0 },
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  dice.daily[key][outcome] += 1;
  // 最近判定历史（FIFO，上限 DICE_HISTORY_LIMIT）。历史数组可能未初始化（老档），惰性补齐。
  const history = dice.history ?? (dice.history = []);
  history.push({ ts: Date.now(), text: text.slice(0, 60), rate, roll, outcome });
  if (history.length > DICE_HISTORY_LIMIT) history.splice(0, history.length - DICE_HISTORY_LIMIT);
  dice.updated_at = Date.now();
}

/** 骰子胜率（纯函数）：大成功+成功 ÷ 总掷数；未掷过返回 null（组件显示占位）。 */
export function diceWinRate(dice: DiceStats): number | null {
  if (!dice || dice.total_rolls <= 0) return null;
  return (dice.by_outcome.crit_success + dice.by_outcome.success) / dice.total_rolls;
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
  /** 平均每轮点选数 m̄（scope.picks_total / scope.total_rounds，总轮数达
   *  AVG_PICKS_MIN_ROUNDS 才启用）：窗口期望基线的多点选校正因子；null = 样本不足
   *  或全局聚合视图（回退单点模型 matched/count） */
  avgPicks: number | null;
};

/** 平均每轮点选数 m̄（module 内部，经 buildStatsView 预计算进 StatsView）：总轮数不足
 *  AVG_PICKS_MIN_ROUNDS 或字段缺失（老档）返回 null——不猜，回退单点模型 */
const scopeAvgPicks = (scope: ScopeStats | undefined): number | null => {
  if (!scope) return null;
  const rounds = scope.total_rounds ?? 0;
  if (rounds < AVG_PICKS_MIN_ROUNDS) return null;
  return (scope.picks_total ?? 0) / rounds;
};

/** 随机点选 m 个（不放回）命中「该条目 k 条输出之一」的精确概率（超几何）：
 *  P = 1 − Π_{i=0..m−1} (n−k−i)/(n−i)。m≥n 或 k≥n 时分子先取到 0 → P=1，无需特判。
 *  单点模型（m=1）退化为 k/n，与旧口径一致 */
const randomPickHitProb = (matched: number, picks: number, count: number): number => {
  if (matched <= 0 || picks <= 0 || count <= 0) return 0;
  const m = Math.min(picks, count);
  let miss = 1;
  for (let i = 0; i < m; i++) miss *= (count - matched - i) / (count - i);
  return Math.min(1, Math.max(0, 1 - miss));
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
      // 全局聚合视图 recent 恒为 []（窗口口径仅单一 scope 有效），m̄ 无消费方
      avgPicks: null,
    };
  }
  const scope = stats.entries[scopeId];
  return {
    scopeId,
    isGlobal: false,
    total_generated: scope?.total_generated ?? 0,
    total_selected: scope?.total_selected ?? 0,
    // 维度级最近活动时间：非全局视图读自身 scope.updated_at——全局 stats.updated_at
    // 会被其他维度活动带动，「最近统计」卡片切到具体配置时不应显示全局时间
    updated_at: scope?.updated_at ?? 0,
    daily: scope?.daily ?? {},
    by_entry: scope?.by_entry ?? {},
    avgPicks: scopeAvgPicks(scope),
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
  /** 全量期望命中率之和 Σ(matched/count)（「期望」展示用） */
  expected_sum: number;
  /** 滑动窗口记录（单一 scope 维度才有；全局聚合视图为空数组） */
  recent: StatsRoundRecord[];
  /** 最近参与生成的时间戳（0 = 从未参与） */
  last_included_at: number;
  /** 最近一次命中时被选的选项正文（'' = 无） */
  last_selected_text: string;
  /** 有效权重：config 覆盖 ?? master_pool（导出 JSON 附带，便于对照池配置） */
  effectiveWeight: number;
  /** 是否固定（pinned）：config 覆盖 ?? master_pool（导出 JSON 附带） */
  effectivePinned: boolean;
};

export type EntryGroup = {
  /** 组名（空 category 归「未分组」；已删除条目组为「已删除」） */
  category: string;
  /** 唯一渲染键：deletedGroup 用 'del:' 前缀区分——用户分类可能与「已删除」重名，
   *  组件 v-for key / 折叠状态键若按 category 会重复冲突（Vue duplicate key + 状态串扰） */
  key: string;
  deletedGroup: boolean;
  /** 组内条目（全量含 0 参与，按参与轮次降序、未参与排后） */
  rows: EntryRankRow[];
  /** 组汇总（参与轮次合计） */
  rounds_included: number;
  rounds_with_selection: number;
  rate: number | null;
};

/** 构建条目榜单行（join 统计 + master_pool + config 覆盖）。
 *  纯提取自 entryGroups 的内联 rowFor：可读性（装配逻辑不再埋在主流程里）。
 *  entry 为 undefined 表示已删除条目（池中已无此 id），行仍保留历史计数并标 deleted */
const rowFor = (
  view: StatsView,
  cfgEntryMap: Map<string, PoolConfigEntry>,
  entryId: string,
  entry: PoolEntry | undefined,
): EntryRankRow => {
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
  for (const entry of masterPool) {
    const cat = entry.category.trim() || CATEGORY_UNGROUPED;
    const list = byCat.get(cat) ?? [];
    list.push(rowFor(view, cfgEntryMap, entry.id, entry));
    byCat.set(cat, list);
  }
  for (const [entryId] of Object.entries(view.by_entry)) {
    if (!poolMap.has(entryId)) deletedRows.push(rowFor(view, cfgEntryMap, entryId, undefined));
  }
  const makeGroup = (category: string, deletedGroup: boolean, rows: EntryRankRow[]): EntryGroup => {
    const rounds_included = rows.reduce((s, r) => s + r.rounds_included, 0);
    const rounds_with_selection = rows.reduce((s, r) => s + r.rounds_with_selection, 0);
    return {
      category,
      // 唯一键（见类型注释）：已删除组可能与用户分类「已删除」撞名，需前缀区分
      key: deletedGroup ? `${DELETED_GROUP_PREFIX}${category}` : category,
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
    groups.push(makeGroup(CATEGORY_DELETED, true, deletedRows));
  }
  return groups;
}

export type HitRankRow = {
  entryId: string;
  deleted: boolean;
  type: string;
  content: string;
  /** 命中次数（精确归因：选项被选中且匹配到该条目的轮次） */
  count: number;
  /** 最近一次选中正文（parse 后，去标头；'' = 无） */
  last_selected_text: string;
  /** 最近一次选中时间戳（0 = 无） */
  last_selected_at: number;
};

/** 命中榜纯函数：只列用户选择过的条目（精确命中 > 0），按命中次数降序 →
 *  最近选中时间倒序 → entryId。已删除条目（池中无此 id）保留计数并标 deleted。
 *  展示字段 join master_pool（同条目榜），组件只渲染不重复实现逻辑。 */
export function hitLeaderboard(view: StatsView, masterPool: PoolEntry[]): HitRankRow[] {
  const poolMap = new Map(masterPool.map(e => [e.id, e]));
  const rows: HitRankRow[] = [];
  for (const [entryId, e] of Object.entries(view.by_entry)) {
    if (e.rounds_with_selection <= 0) continue;
    const entry = poolMap.get(entryId);
    rows.push({
      entryId,
      deleted: !entry,
      type: entry?.type ?? '',
      content: entry?.content ?? '',
      count: e.rounds_with_selection,
      last_selected_text: e.last_selected_text,
      last_selected_at: e.last_selected_at,
    });
  }
  return rows.sort(
    (a, b) => b.count - a.count || b.last_selected_at - a.last_selected_at || a.entryId.localeCompare(b.entryId),
  );
}

// ── 命中率指标（全量/窗口 + 相对基线） ───────────────────────────────────────

/** 窗口命中率指标（recent 非空时可用）：rate/expectedRate/excess 均基于窗口内
 *  每轮的 count 推导。期望 = 采纳感知随机基线：仅「该轮被匹配到」的记录计
 *  matched/count（老代记录无 matched 字段回退 1/count 保持旧口径，与新代
 *  matched=1 的记录数值一致） */
export type WindowMetrics = {
  samples: number;
  hits: number;
  expected: number;
  rate: number | null;
  expectedRate: number | null;
  excess: number | null;
};

export function windowMetrics(recent: StatsRoundRecord[] | undefined, avgPicks?: number | null): WindowMetrics | null {
  if (!recent || recent.length === 0) return null;
  let hits = 0;
  let expected = 0;
  for (const r of recent) {
    if (r.hit) hits += 1;
    // 期望基线：该条目被匹配到 k 条输出时，用户随机点选命中其任一输出的概率。
    // avgPicks 可用（scope 轮数达标）→ 按平均每轮点选数 m̄ 的超几何概率校正——单点模型
    // matched/count 在多点选用户下系统性低估基线；点数至少取 1（m̄<1 的轻度用户沿用
    // 单点模型，避免基线归零）。avgPicks 不可用回退单点模型 matched/count。
    // 老代记录无 matched 回退 1/count（与新代 matched=1 数值一致）
    const matched = r.matched ?? 1;
    if (r.count > 0 && matched > 0) {
      expected +=
        avgPicks != null ? randomPickHitProb(matched, Math.max(1, Math.round(avgPicks)), r.count) : matched / r.count;
    }
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

export type SampleDistribution = {
  /** 样本充足：参与轮次 ≥ STATS_MIN_SAMPLES，命中率读数基本可信 */
  sufficient: number;
  /** 参与 >0 但 < STATS_MIN_SAMPLES（命中率噪声大，只标「样本不足」） */
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
    if (e.rounds_included >= STATS_MIN_SAMPLES) sufficient += 1;
    else if (e.rounds_included > 0) insufficient += 1;
  }
  return { sufficient, insufficient, never: Math.max(0, poolSize - inPool) };
}

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
