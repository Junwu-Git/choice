import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { CATEGORY_DELETED, CATEGORY_UNGROUPED, DELETED_GROUP_PREFIX } from '@/core/constants';
import type { ChoiceOption } from '@/core/options-store';
import {
  APPLY_HISTORY_LIMIT,
  createEmptyStats,
  STATS_WINDOW_SIZE,
  SUGGEST_MIN_SAMPLES,
  SUGGEST_DOWNGRADE_EXCESS,
  SUGGEST_UPGRADE_EXCESS,
  SUGGEST_DISABLE_EXCESS,
  SUGGEST_WEIGHT_MIN,
  SUGGEST_WEIGHT_MAX,
  SUGGEST_UPGRADE_MULTIPLIER,
  ROSTER_EXPLORE_RATIO,
  type ApplyHistoryEntry,
  type DailyCount,
  type PoolConfig,
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
      last_weight_changed_at: 0,
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
 *  超额系统性偏高被误提权）。命中按轮单槽，期望与其对齐。 */
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
 *  - null（新代显式未匹配 / L1 AI 归因写回的「自由发挥」）：不命中任何条目（被 AI 舍弃的
 *    候选不产生命中）——避免 null 回退整轮共现导致全轮条目误计命中、与 reconcileAttribution
 *    的命中迁移组合后产生重复计数（迁移清掉 rec.hit=false 后重链又全轮计一次）；
 *  - undefined（旧代消息无 matchedEntryId 字段）：回退整轮共现，每个参与条目命中轮次 +1
 *    （旧消息行为保持不变）。调用方须保留三态不归一化（勿 `?? null`），见 option-action.ts。
 *  generationId 用于同代去重（按「条目 × 代」粒度）与窗口 hit 回写定位；
 *  generationScopeId 为生成时所在的统计维度（ChoiceGeneration.scopeId，随消息持久化）——
 *  命中应归到生成时维度而不是点击时的当前维度（用户可能切了 config 后回看旧楼层点击）；
 *  缺省（旧代消息无 scopeId 字段）时回退 findHitScope 全局搜索，再回退当前生效维度。
 *  命中落入非当前维度时，同步刷新该维度 ScopeStats.updated_at——否则切回该维度时
 *  L2 失效判定（按维度级 updated_at）不触发、理由缓存陈旧（total_selected/daily 仍
 *  跟随点击时当前维度，符合「点击活跃度」口径，此处只刷新活动时间戳）。
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
  getDaily(scope, dailyKey()).selected += 1;
  if (poolEntryIds.length === 0) return;
  const now = Date.now();
  // 命中口径三态（见函数头注释）：string → 仅该条目；null → 不命中任何条目（新代/AI 写回
  // 自由发挥，被 AI 舍弃的候选不产生命中）；undefined → 回退整轮共现（旧代无字段兼容）
  const hitIds = matchedEntryId ? [matchedEntryId] : matchedEntryId === null ? [] : poolEntryIds;
  // 实际写入命中的维度集合（去重）：用于跨维度命中时刷新命中维度 updated_at（P3）
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
    // 却触发 L2 重算（指纹守卫虽会兜底空转，但白白发起一次判断）
    hitScopes.add(hitScopeId);
    e.last_selected_at = now;
    if (optionText) e.last_selected_text = optionText;
  }
  // 跨维度命中：用户切 config 后回看旧楼层点击时，命中落入旧维度（≠ 当前 scope）。
  // 刷新该维度 ScopeStats.updated_at 让 L2 失效判定能感知到命中数据变化、触发重算；
  // 当前 scope 的 updated_at 已在上方随 total_selected 一起刷新，此处跳过避免重复写
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

/** AI 归因结果与本地 Dice 归因的对称修正（纯函数，L1 归因队列成功后调用）。
 *  生成时统计已按 Dice 结果实时记账（expected_sum / recent[gid].matched / 可能已有点击
 *  命中），AI 语义归因是后补的，必须按「采纳感知随机基线」对称修正，否则命中/期望来源
 *  不一致会让超额系统性偏移、建议引擎误判（v53 口径根基，不能直接简化掉）。
 *  - 期望修正：逐条目 Δmatched/count（count = 该轮实际输出条数，0 防御跳过）。
 *  - 窗口修正：recent[gid].matched 改写为新值（匹配基数随归因升级同步）。
 *  - 命中迁移（保守规则）：仅当「旧归属条目在该 gid 上被匹配的选项数恰好为 1」
 *    且该条选项被移走、且该 gid 已有点击命中时，才把命中从旧条目迁到新条目
 *    （matched==1 时命中必来自这条唯一被匹配的选项，迁移无歧义）；matched>1 属歧义
 *    不迁移（宁缺勿错）。迁移连带 rounds_with_selection 与最近选中单槽。
 *  aiAttribution 缺 index 的选项视为保持 Dice 结果（解析层已校验，此处防御）。
 *  不修改消息层（写回由调用方 setMessageChoiceData 完成）。 */
export function reconcileAttribution(
  scope: ScopeStats,
  gid: string,
  options: ChoiceOption[],
  aiAttribution: Array<{ index: number; entryId: string | null }>,
  count = options.length,
): { adjusted: number; migrated: number } {
  if (!scope || options.length === 0) return { adjusted: 0, migrated: 0 };
  // 有效新归因：逐 index 取 AI 判定（越界防御忽略），缺省保持 Dice 结果
  const aiByIndex = new Map<number, string | null>();
  for (const a of aiAttribution) {
    if (a.index >= 0 && a.index < options.length) aiByIndex.set(a.index, a.entryId);
  }
  const effectiveNew = options.map((o, i) =>
    aiByIndex.has(i) ? (aiByIndex.get(i) ?? null) : (o.matchedEntryId ?? null),
  );

  const oldMatched = new Map<string, number>();
  const newMatched = new Map<string, number>();
  for (const id of options.map(o => o.matchedEntryId)) {
    if (id) oldMatched.set(id, (oldMatched.get(id) ?? 0) + 1);
  }
  for (const id of effectiveNew) {
    if (id) newMatched.set(id, (newMatched.get(id) ?? 0) + 1);
  }

  // 期望与窗口 matched 修正
  let adjusted = 0;
  const unionIds = new Set([...oldMatched.keys(), ...newMatched.keys()]);
  for (const id of unionIds) {
    const oldC = oldMatched.get(id) ?? 0;
    const newC = newMatched.get(id) ?? 0;
    if (oldC === newC) continue;
    const e = getEntryStats(scope, id);
    if (count > 0) e.expected_sum += (newC - oldC) / count;
    const rec = e.recent.find(r => r.gid === gid);
    if (rec) rec.matched = newC;
    adjusted += 1;
  }

  // 命中迁移：遍历归属发生变化的选项，按保守规则迁移已计命中
  let migrated = 0;
  for (let i = 0; i < options.length; i++) {
    const oldId = options[i].matchedEntryId;
    const newId = effectiveNew[i];
    if (oldId === newId || !oldId) continue;
    const oldE = scope.by_entry[oldId];
    const oldRec = oldE?.recent.find(r => r.gid === gid);
    // 仅当该代该条目只匹配了这一条选项且已命中：命中必来自该选项，迁移无歧义
    if (oldRec?.hit && oldMatched.get(oldId) === 1) {
      oldRec.hit = false;
      oldE.rounds_with_selection = Math.max(0, oldE.rounds_with_selection - 1);
      migrated += 1;
      if (newId) {
        const newE = getEntryStats(scope, newId);
        const newRec = newE.recent.find(r => r.gid === gid);
        // 目标条目该代已有命中（用户同时点了另一条仍归它的选项）→ 吸收迁移不重复计
        if (newRec && !newRec.hit) {
          newRec.hit = true;
          newE.rounds_with_selection += 1;
          newE.last_selected_text = oldE.last_selected_text;
          newE.last_selected_at = oldE.last_selected_at;
        }
      }
      // 旧条目的最近选中单槽随命中迁走清空（该命中已不属于它；见函数头注释的口径说明）
      oldE.last_selected_text = '';
      oldE.last_selected_at = 0;
    }
  }
  return { adjusted, migrated };
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
            last_weight_changed_at: e.last_weight_changed_at,
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
          if (e.last_weight_changed_at > agg.last_weight_changed_at) {
            agg.last_weight_changed_at = e.last_weight_changed_at;
          }
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
    // 维度级最近活动时间：非全局视图读自身 scope.updated_at——全局 stats.updated_at
    // 会被其他维度活动带动，「最近统计」卡片切到具体配置时不应显示全局时间
    updated_at: scope?.updated_at ?? 0,
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
  /** 全量期望命中率之和 Σ(matched/count)（建议引擎与「期望」展示用） */
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
  /** 是否在生成中有效（config 覆盖 enabled；master_pool 无 enabled 概念 → 无覆盖即 true）。
   *  停用（建议停用/阵容落出）的条目不再被建议引擎重复建议，行内显示「已停用」 */
  effectiveEnabled: boolean;
  /** 是否被当前维度 config 引用（rowFor 依 cfgEntryMap 判定）。建议可应用的前提：
   *  写入目标是 config 覆盖层，未引用条目（历史数据残留）出建议也永远无法落盘，
   *  应用侧据此过滤（展示侧洞察标签不受影响） */
  referenced: boolean;
  /** 最近一次自动化调整时间戳（透传 by_entry.last_weight_changed_at，0 = 从未调整）：
   *  建议引擎冷却依据，展示层据此标「冷却中」 */
  last_weight_changed_at: number;
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
 *  纯提取自 entryGroups 的内联 rowFor：可读性（23 行装配逻辑不再埋在主流程里）。
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
    effectiveEnabled: cfg?.enabled ?? true,
    referenced: entry ? cfgEntryMap.has(entry.id) : false,
    last_weight_changed_at: e?.last_weight_changed_at ?? 0,
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
 *  matched=1 的记录数值一致），非固定阈值口径 */
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
    // 期望按 matched/count：该条目被匹配到的输出数 ÷ 输出条数（用户随机点选命中其
    // 任一输出的概率）。老代记录无 matched（旧口径每轮按 1/count 计期望，与
    // matched=1 数值一致）；v53+ 按实际 matched 计，多输出条目基线不再被低估
    if (r.count > 0 && (r.matched ?? 1) > 0) expected += (r.matched ?? 1) / r.count;
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

/** 条目评级解析（纯函数，建议引擎与阵容计划共用，防止两处解析逻辑漂移）：
 *  数据源优先窗口（recent 长度 ≥ SUGGEST_MIN_SAMPLES），否则全量
 *  （rounds_included ≥ SUGGEST_MIN_SAMPLES）；样本不足或无记录返回 null。
 *  返回窗口/全量统一后的命中率、期望命中率与超额（rate - expected）。
 *  冷却语义（不能直接简化掉）：条目被自动化调整过（last_weight_changed_at > 0）时，
 *  只用该时间戳之后的窗口记录评级，且不足 SUGGEST_MIN_SAMPLES 轮新数据直接返回 null——
 *  ① 避免建议基于旧权重下的表现（新权重还没积累足够样本）；② 缩短窗口期限天然形成
 *  「调整后需观察 N 轮」的冷却，防止 1↔2↔4 权重颠簸。全量兜底此时不可用（全量含
 *  变更前数据，正是要排除的）。从未调整（=0）的条目走原有窗口→全量路径，行为不变。 */
function entryMetrics(
  row: Pick<
    EntryRankRow,
    'rounds_included' | 'rounds_with_selection' | 'expected_sum' | 'recent' | 'last_weight_changed_at'
  >,
): { samples: number; rate: number; expected: number; excess: number; basis: '窗口' | '全量' } | null {
  if (!row || row.rounds_included <= 0 || !row.recent) return null;
  const changedAt = row.last_weight_changed_at ?? 0;
  // 自动化调整后的条目：只统计调整之后的窗口数据
  if (changedAt > 0) {
    const post = row.recent.filter(r => r.ts >= changedAt);
    if (post.length < SUGGEST_MIN_SAMPLES) return null; // 冷却中：新数据不足，暂不评级
    const w = windowMetrics({ recent: post });
    if (!w) return null;
    // post 非空保证 samples > 0，rate/expectedRate 不会为 null（windowMetrics 的类型
    // 是 number|null，这里用 hits/expected 除 samples 得到确定值，避免 null 运算）
    const rate = w.hits / w.samples;
    const expectedRate = w.expected / w.samples;
    return { samples: w.samples, rate, expected: expectedRate, excess: rate - expectedRate, basis: '窗口' };
  }
  const w = windowMetrics(row);
  let samples: number;
  let hits: number;
  let expected: number;
  let basis: '窗口' | '全量';
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
  return { samples, rate, expected: expectedRate, excess: rate - expectedRate, basis };
}

// ── 建议引擎（只建议不改权重之外的东西；写入由 applySuggestions 显式触发） ───

type SuggestionAction = 'down' | 'up' | 'disable';

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

/** 建议稳定指纹（纯函数）：AI 建议理由缓存与当前建议绑定用的展示校验键。
 *  任意决定「理由解释的是哪个建议」的输入变化（动作/目标权重/口径/超额/当前权重）
 *  都会让指纹变化 → 旧理由不再展示（隐藏而非误导），直到下次分析按新指纹重写。
 *  excess 只取 2 位小数：理由不随微小数据波动频繁失效，小幅变化仍算同一建议 */
export function suggestionKey(s: Suggestion): string {
  return `${s.action}:${s.newWeight !== undefined ? s.newWeight : 'disable'}:${s.basis}:${s.excess.toFixed(2)}:${s.currentWeight}`;
}

/** 单条目建议（纯函数）：数据源优先窗口（recent ≥ SUGGEST_MIN_SAMPLES），否则全量
 *  （rounds_included ≥ SUGGEST_MIN_SAMPLES），样本不足返回 null。
 *  阈值：超额命中率（rate - expected）≤ -0.3 且 0 命中 → 停用；≤ -0.2 → 降权
 *  （减半、下限 SUGGEST_WEIGHT_MIN）；≥ +0.15 → 提权（×SUGGEST_UPGRADE_MULTIPLIER
 *  =1.5 保守倍率、上限 SUGGEST_WEIGHT_MAX）。
 *  额外停用：期望=0 且样本充足且 0 命中 →「从未被采纳」直接建议停用（精确归因下
 *  期望只在输出被匹配的轮次累计，AI 从不采用其方向时恒 0；历史共现数据期望恒 >0，
 *  不会误触发）。
 *  pinned 条目跳过（固定必发，权重不影响出现频率，改它无意义）。
 *  已停用条目（effectiveEnabled=false，建议停用或阵容落出已生效）直接跳过——
 *  不重复建议，避免「停用后标签永远挂着」的口径不自洽。
 *  已删除条目（deleted=true，master_pool 已无此 id）直接跳过——config 引用即使仍指向
 *  该 id，条目也已不在 effectivePool，建议与写入均无实际意义（纯噪音，含「样本不足」
 *  这类展示标签一并屏蔽）。
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
    | 'effectiveEnabled'
    | 'last_weight_changed_at'
    | 'deleted'
  >,
): Suggestion | null {
  if (row.deleted) return null;
  if (row.effectivePinned || !row.effectiveEnabled) return null;
  const m = entryMetrics(row);
  if (!m) return null;
  const { samples, rate, expected: expectedRate, excess, basis } = m;
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
  // 无新数据，不会自动恢复——UI 须提示用户可撤销。
  // 精确归因下另加「从未被采纳」停用：期望=0 说明其在输出中从未被匹配到（AI 从不采用），
  // 样本充足时直接给停用建议（被 AI 舍弃的条目）；历史共现数据 expected>0 不误触发
  // （rate/expected 均为按 samples 平均后的比率，与原始 hits/expected_sum 同零性）
  const neverAdopted = expectedRate === 0 && rate === 0 && samples >= SUGGEST_MIN_SAMPLES;
  if ((excess <= SUGGEST_DISABLE_EXCESS && rate === 0) || neverAdopted) {
    return { ...base, action: 'disable' };
  }
  if (excess <= SUGGEST_DOWNGRADE_EXCESS) {
    const newWeight = Math.max(SUGGEST_WEIGHT_MIN, row.effectiveWeight * 0.5);
    // 权重已在下限边界时降权无实际变化：返回 null 而非零差异建议，
    // 否则应用会产生「0 条变更」历史批次并误刷冷却（建议→应用→冷却→再建议空转）
    if (newWeight === row.effectiveWeight) return null;
    return { ...base, action: 'down', newWeight };
  }
  if (excess >= SUGGEST_UPGRADE_EXCESS) {
    // 提权按 SUGGEST_UPGRADE_MULTIPLIER 保守倍率（1.5，非翻倍）：期望基线不随权重变化，
    // 翻倍会让高权重条目更快向 SUGGEST_WEIGHT_MAX 收敛，权重分散度劣化（见 settings.ts 常量注释）
    const newWeight = Math.min(SUGGEST_WEIGHT_MAX, row.effectiveWeight * SUGGEST_UPGRADE_MULTIPLIER);
    if (newWeight === row.effectiveWeight) return null;
    return { ...base, action: 'up', newWeight };
  }
  return null;
}

export type EntryInsight = 'downgrade' | 'disable' | 'good' | 'insufficient' | 'disabled' | 'cooldown' | null;

/** 洞察标签（展示层派生）：有建议 → 按其动作标「候选降权/建议停用/表现良好」；
 *  已停用条目 → 「已停用」（真实启用态，不再给建议）；自动化调整后新数据不足 →
 *  「冷却中」（等新样本再评级）；参与 >0 但样本不足 → 「样本不足」；
 *  无参与/无建议 → 无标签。只提示不改权重。
 *  suggestion 为可选预计算值（组件一次 entrySuggestion、多标签复用，避免每处重算）：
 *  缺省时内部自行计算，行为不变。已删除条目返回 null（不挂任何质量标签）。 */
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
    | 'effectiveEnabled'
    | 'last_weight_changed_at'
    | 'deleted'
  >,
  suggestion?: Suggestion | null,
): EntryInsight {
  if (row.deleted) return null;
  if (!row.effectiveEnabled) return 'disabled';
  const s = suggestion !== undefined ? suggestion : entrySuggestion(row);
  if (s) return s.action === 'down' ? 'downgrade' : s.action === 'disable' ? 'disable' : 'good';
  // 冷却中：仅当调整后的窗口数据确实不足门槛（entryMetrics 因冷却返回 null）才标——
  // 若冷却早已过期（新数据 ≥10 轮）但未达任何建议阈值，应回落到「无标签」而非永远「冷却中」
  // 全局聚合视图 recent 恒为 []（窗口口径仅单一 scope 有效）：无窗口数据无法判冷却，
  // 跳过本分支回落到 insufficient/无标签，避免全局视图把调整过的条目永久标「冷却中」
  const changedAt = row.last_weight_changed_at ?? 0;
  if (changedAt > 0 && row.rounds_included > 0 && row.recent.length > 0) {
    const post = row.recent.filter(r => r.ts >= changedAt);
    if (post.length < SUGGEST_MIN_SAMPLES) return 'cooldown';
  }
  if (row.rounds_included > 0 && row.rounds_included < SUGGEST_MIN_SAMPLES) return 'insufficient';
  return null;
}

// ── 建议应用与撤销（写 config 覆盖层；经 global store 直写，deep watch 持久化） ──

export type SuggestionApplyResult = {
  applied: number;
  skipped: number;
};

/** 应用一批建议到指定 config（scopeId = config.id）。只保存受影响条目的应用前后局部快照供撤销；
 *  找不到目标 config 或条目（理论上被建议条目必在 config 引用中）→ skipped。
 *  应用成功写入的条目会打 last_weight_changed_at 冷却标记（entryMetrics 据此只统计
 *  变更后新数据，见冷却语义注释）；批次连同局部快照入持久撤销槽 apply_history。
 *  不显式调 saveSettingsDebounced——settings deep watch 统一落盘（见 global-settings.ts） */
export function applySuggestions(scopeId: string, suggestions: Suggestion[]): SuggestionApplyResult {
  const gs = useGlobalSettingsStore();
  const config = gs.settings.configs.find(c => c.id === scopeId);
  if (!config) return { applied: 0, skipped: suggestions.length };
  const targetIds = suggestions.map(s => s.entryId);
  const entriesBefore = snapshotEntryRefs(config.entries, targetIds);
  const markersBefore = collectMarkersBefore(gs, scopeId, targetIds);
  let applied = 0;
  const appliedIds: string[] = [];
  for (const s of suggestions) {
    const entry = config.entries.find(e => e.entry_id === s.entryId);
    if (!entry) continue;
    if (s.action === 'disable') {
      entry.enabled = false;
    } else if (s.newWeight !== undefined) {
      entry.weight = s.newWeight;
    }
    applied += 1;
    appliedIds.push(s.entryId);
  }
  if (applied > 0) {
    touchChangedMarker(gs, scopeId, appliedIds);
    invalidateAiReasons(gs, scopeId, appliedIds);
    pushApplyHistory(gs, {
      id: uuidv4(),
      scope_id: scopeId,
      kind: 'suggestions',
      ts: Date.now(),
      entries_before: entriesBefore,
      entries_after: snapshotEntryRefs(config.entries, appliedIds),
      markers_before: markersBefore,
    });
  }
  return { applied, skipped: suggestions.length - applied };
}

/** 受影响条目引用的局部快照：从 config.entries 中过滤出指定 id 并深拷贝。
 *  撤销/摘要只关心本批实际改写的条目，未受影响条目不入快照——大幅减小 apply_history
 *  持久化体积与撤销遍历范围；快照外条目本批无变更，缺失不影响字段级条件逆操作正确性。 */
const snapshotEntryRefs = (entries: PoolConfigEntry[], ids: string[]): PoolConfigEntry[] => {
  const idSet = new Set(ids);
  return entries.filter(e => idSet.has(e.entry_id)).map(e => klona(e));
};

/** 收集受影响条目应用前的 last_weight_changed_at 快照（undo 时连带回滚冷却标记）。
 *  条目统计记录不存在（从未参与）则不入快照——undo 时也无需回滚。 */
function collectMarkersBefore(
  gs: ReturnType<typeof useGlobalSettingsStore>,
  scopeId: string,
  entryIds: string[],
): Record<string, number> {
  const scope = gs.settings.stats.entries[scopeId];
  const out: Record<string, number> = {};
  if (!scope) return out;
  const hasOwn = Object.prototype.hasOwnProperty;
  for (const id of entryIds) {
    // 原型键守卫（与 getEntryStats 同源）：by_entry 是持久化普通对象，方括号读在无自有键时
    // 命中原型链（如 "__proto__" → Object.prototype，truthy），?. 不会短路，会读到原型上的
    // last_weight_changed_at（可能已被先前污染写入）。只在自有键上读，篡改存档注入的 entryId 无处落脚
    // 即使旧值为 0 也必须入快照：否则 undo 无法把本次新写入的冷却标记清回 0
    out[id] = hasOwn.call(scope.by_entry, id) ? (scope.by_entry[id]?.last_weight_changed_at ?? 0) : 0;
  }
  return out;
}

/** 把受影响条目的冷却标记刷到当前时间：建议/阵容应用后新权重需要观察期，
 *  期间 entryMetrics 只统计此时间戳之后的窗口数据（不足门槛视为冷却中）。 */
function touchChangedMarker(gs: ReturnType<typeof useGlobalSettingsStore>, scopeId: string, entryIds: string[]): void {
  const stats = gs.settings.stats;
  const scope = getScopeStats(stats, scopeId);
  const now = Date.now();
  for (const id of entryIds) {
    const e = getEntryStats(scope, id);
    e.last_weight_changed_at = now;
  }
}

/** 清理受影响条目的 AI 理由缓存：配置写入路径（建议应用/阵容落出补入/重新启用）
 *  刻意不触发整维重跑（成本），但改写的条目其建议与理由必然过期——直接删缓存条目，
 *  展示侧在下次分析前不再显示旧理由（配合 suggestionKey 指纹双保险）。 */
function invalidateAiReasons(gs: ReturnType<typeof useGlobalSettingsStore>, scopeId: string, entryIds: string[]): void {
  const cached = gs.settings.stats.ai_analysis[scopeId];
  if (!cached) return;
  for (const id of entryIds) {
    delete cached.entries[id];
  }
}

/** 入持久撤销槽（上限 APPLY_HISTORY_LIMIT，超出 FIFO 丢最旧）。历史随
 *  extension_settings 落盘（deep watch），刷新后仍可撤销。 */
function pushApplyHistory(gs: ReturnType<typeof useGlobalSettingsStore>, entry: ApplyHistoryEntry): void {
  gs.settings.apply_history.push(entry);
  if (gs.settings.apply_history.length > APPLY_HISTORY_LIMIT) {
    gs.settings.apply_history.splice(0, gs.settings.apply_history.length - APPLY_HISTORY_LIMIT);
  }
}

/** 撤销一条应用历史（按条目条件逆操作）：对该批受影响条目做字段级逆操作，
 *  而不是整表恢复 entries_before（那会吞掉其后批次的修改）。
 *  每字段（weight/enabled）仅在「当前值仍等于该批应用后的值」（未被后续批次或
 *  手动编辑改动）时才回滚为应用前值；被后续改动干扰的字段跳过、保留现状。
 *  本批新增的引用（roster promote）仅当当前引用整体仍等于 after 时删除；
 *  被实际回滚的条目连带恢复冷却标记（markers_before，可能为 0）。
 *  config 已删除则返回 false（失效）。 */
function restoreApplyEntry(gs: ReturnType<typeof useGlobalSettingsStore>, entry: ApplyHistoryEntry): boolean {
  const config = gs.settings.configs.find(c => c.id === entry.scope_id);
  if (!config) return false;
  const before = new Map(entry.entries_before.map(e => [e.entry_id, e]));
  const after = new Map(entry.entries_after.map(e => [e.entry_id, e]));
  const scope = gs.settings.stats.entries[entry.scope_id];
  const rolledBackIds = new Set<string>();
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(id);
    const a = after.get(id);
    const idx = config.entries.findIndex(e => e.entry_id === id);
    const cur = idx >= 0 ? config.entries[idx] : undefined;
    let rolled = false;
    if (b && a) {
      // 同一引用：字段级独立回滚，互不阻塞（后批只改了 enabled 时 weight 仍可回滚）
      if (b.weight !== a.weight && cur?.weight === a.weight) {
        cur!.weight = b.weight;
        rolled = true;
      }
      if (b.enabled !== a.enabled && cur?.enabled === a.enabled) {
        cur!.enabled = b.enabled;
        rolled = true;
      }
    } else if (a && !b) {
      // 本批新增引用（roster promote）：当前引用整体仍等于 after 才删除。
      // pinned 须一并比对——用户在 promote 后又改了 pinned 覆盖时，整体已不等于 after，
      // 删除会吞掉 pin 改动，违反「整体仍等于 after 才删除」契约（只回滚未受干扰的字段）
      if (cur && cur.enabled === a.enabled && cur.weight === a.weight && cur.pinned === a.pinned) {
        config.entries.splice(idx, 1);
        rolled = true;
      }
    } else if (b && !a) {
      // 防御分支（自动化不删引用）：当前无此引用时按 before 重建
      if (!cur) {
        config.entries.push(klona(b));
        rolled = true;
      }
    }
    if (rolled) rolledBackIds.add(id);
  }
  if (scope) {
    // 原型键守卫（与 getEntryStats/collectMarkersBefore 同源）：by_entry / markers_before 均
    // 为持久化普通对象，方括号读在无自有键时命中原型链（如 "__proto__" → Object.prototype，
    // truthy），随后 `e.last_weight_changed_at = markers_before[id] ?? 0` 会把值写进
    // Object.prototype（markers_before[id] 同样命中原型、非 null 不触发 ?? 0）——
    // 即 getEntryStats 用 hasOwnProperty+defineProperty 防御的原型污染，此撤销路径不得绕过。
    const hasOwn = Object.prototype.hasOwnProperty;
    for (const id of rolledBackIds) {
      if (!hasOwn.call(scope.by_entry, id)) continue;
      const e = scope.by_entry[id];
      const marker = hasOwn.call(entry.markers_before, id) ? entry.markers_before[id] : 0;
      if (e) e.last_weight_changed_at = marker;
    }
  }
  return true;
}

/** 撤销最近一次应用（多槽）：从持久历史末尾向前找最后一条匹配 scopeId（省略则任意）
 *  且目标 config 仍存在的条目并恢复；config 已删除的历史条目跳过（视为失效移除）。
 *  成功返回 true。 */
export function undoLastApply(scopeId?: string): boolean {
  const gs = useGlobalSettingsStore();
  const history = gs.settings.apply_history;
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (scopeId !== undefined && entry.scope_id !== scopeId) continue;
    const config = gs.settings.configs.find(c => c.id === entry.scope_id);
    if (!config) {
      // 目标 config 已被删除：本条历史失效，移除后继续向前找
      history.splice(i, 1);
      continue;
    }
    if (restoreApplyEntry(gs, entry)) history.splice(i, 1);
    return true;
  }
  return false;
}

/** 撤销指定的历史批次（应用历史面板逐条撤销）：按 id 定位并恢复，成功返回 true。
 *  目标 config 已删除（restore 返回 false）时该槽永久失效，一并移除（与
 *  undoLastApply 的死槽清理对齐），避免失效批次长期残留在历史里。 */
export function undoApply(entryId: string): boolean {
  const gs = useGlobalSettingsStore();
  const idx = gs.settings.apply_history.findIndex(e => e.id === entryId);
  if (idx < 0) return false;
  const entry = gs.settings.apply_history[idx];
  const ok = restoreApplyEntry(gs, entry);
  gs.settings.apply_history.splice(idx, 1);
  return ok;
}

/** 手动重新启用 config 中已停用的条目（统计页「重新启用」就地入口）。
 *  用户显式动作，语义同条目池页编辑：不写 apply_history、不刷冷却标记——
 *  重新启用后的条目按既有数据直接评级（可能再次被建议停用，属用户选择）。
 *  config/引用不存在或条目已在启用态时忽略，返回是否实际改写了 enabled。 */
export function reEnableEntry(scopeId: string, entryId: string): boolean {
  const gs = useGlobalSettingsStore();
  const config = gs.settings.configs.find(c => c.id === scopeId);
  if (!config) return false;
  const entry = config.entries.find(e => e.entry_id === entryId);
  if (!entry || entry.enabled === true) return false;
  entry.enabled = true;
  // 重新启用后建议形态会变（已停用不再出建议 → 可能重新评级）：旧的「停用建议」理由作废
  invalidateAiReasons(gs, scopeId, [entryId]);
  return true;
}

/** 应用历史变更摘要（纯函数，应用历史面板展示用）：diff 一条历史批次的 entries_before
 *  与 entries_after，逐条目给出「加入/停用/启用/权重 x→y」的变化描述。
 *  entryId join master_pool（由调用方预建成 poolMap 传入）拿 type/content 做展示名
 *  （已删除条目退化显示 id 截断）。poolMap 由调用方建一次复用，避免每个历史批次重建。 */
export function applyHistorySummary(
  entry: ApplyHistoryEntry,
  poolMap: Map<string, PoolEntry>,
): Array<{ entryId: string; name: string; change: string }> {
  const before = new Map(entry.entries_before.map(e => [e.entry_id, e]));
  const after = new Map(entry.entries_after.map(e => [e.entry_id, e]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const out: Array<{ entryId: string; name: string; change: string }> = [];
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    const pool = poolMap.get(id);
    const name = pool ? pool.type || pool.content || id : `${id.slice(0, 8)}…`;
    if (!b && a) {
      out.push({ entryId: id, name, change: '加入' });
    } else if (b && a && b.enabled !== a.enabled) {
      out.push({ entryId: id, name, change: b.enabled ? '启用 → 停用' : '停用 → 启用' });
    } else if (b && a && b.weight !== a.weight) {
      out.push({ entryId: id, name, change: `权重 ${b.weight} → ${a.weight}` });
    }
  }
  return out;
}

// ── 阵容计划（固定名额：表现末尾落出、替补/未引用补入） ───────────────────────
// 与建议引擎并存：建议引擎管权重（池内出现概率），阵容计划管成员资格（谁在池里）。
// 落出 = config 层软停用（enabled=false，条目保留、统计不丢）；补入 = 引用进 config。
// 一期半自动：planRoster 只算清单，applyRosterPlan 由用户显式触发、可撤销。

export type RosterAction = {
  entryId: string;
  kind: 'drop' | 'promote';
  reason: 'roster_overflow' | 'bench' | 'explore';
  /** 超额命中率（仅可评级条目有；explore 无样本缺省） */
  score?: number;
  /** 依据样本轮数（仅可评级条目有） */
  samples?: number;
  /** 展示用（join master_pool） */
  type: string;
  content: string;
};

export type RosterPlan = {
  /** 目标 config.id */
  scopeId: string;
  /** 目标在役条数 N */
  target: number;
  /** 当前在役（enabled 且存在于 master_pool）条数 */
  activeCount: number;
  /** 落出清单 */
  drops: RosterAction[];
  /** 补入清单 */
  promotes: RosterAction[];
  /** 因 pinned/样本不足豁免无法裁掉的溢出条数（仅说明用） */
  exempt: number;
  /** 无可执行动作（无需变动或条件不满足） */
  noop: boolean;
};

/** 替补席排序比较器：可评级按超额降序（表现好先归队）；无样本排后，按最近参与倒序。
 *  纯提取自 planRoster 的内联比较器（排序规则单一真相，勿改语义） */
const benchComparator = (
  a: { m: NonNullable<ReturnType<typeof entryMetrics>> | null; last: number },
  b: { m: NonNullable<ReturnType<typeof entryMetrics>> | null; last: number },
): number => {
  if (a.m && b.m) return b.m.excess - a.m.excess || b.last - a.last;
  if (a.m) return -1;
  if (b.m) return 1;
  return b.last - a.last;
};

/** 生成阵容计划（纯函数，组件只渲染）。
 *  在役 = config 中 enabled 且 id ∈ master_pool（与 Statistics.vue poolCapsule 口径一致）；
 *  落出：在役 > N 时从「可评级且非 pinned」中按超额升序（表现最差在前）裁末尾到 ≤N，
 *  pinned/样本不足豁免导致的溢出接受（exempt 说明）；
 *  补入：空位 = N − (在役 − 落出)，替补席（config 中 disabled 且 ∈ master_pool）优先，
 *  按超额降序、样本不足排后（同级按最近参与倒序）；剩余空位按 ROSTER_EXPLORE_RATIO 上限
 *  从未被引用的 master_pool 条目补入（探索，确定性顺序避免 computed 重算抖动）。
 *  target 非法（<1 / NaN/Infinity）或条目库为空 → noop 空计划（不落出不补入、不崩溃）。 */
export function planRoster(view: StatsView, masterPool: PoolEntry[], config: PoolConfig, target: number): RosterPlan {
  const scopeId = config.id;
  if (!Number.isFinite(target) || target < 1 || masterPool.length === 0) {
    return { scopeId, target, activeCount: 0, drops: [], promotes: [], exempt: 0, noop: true };
  }
  const poolMap = new Map(masterPool.map(e => [e.id, e]));
  const cfgMap = new Map(config.entries.map(e => [e.entry_id, e]));
  const effectivePinned = (id: string): boolean => cfgMap.get(id)?.pinned ?? poolMap.get(id)?.pinned ?? false;

  const active: string[] = [];
  const bench: string[] = [];
  for (const ce of config.entries) {
    if (!poolMap.has(ce.entry_id)) continue; // 已从 master_pool 删除的引用跳过
    if (ce.enabled === false) bench.push(ce.entry_id);
    else active.push(ce.entry_id);
  }
  const activeCount = active.length;

  // 落出：只裁「可评级且非 pinned」的末尾；pinned 与样本不足豁免
  const drops: RosterAction[] = [];
  const over = activeCount - target;
  if (over > 0) {
    const rated = active
      .filter(id => !effectivePinned(id))
      .map(id => ({ id, m: entryMetrics(view.by_entry[id]) }))
      .filter((x): x is { id: string; m: NonNullable<ReturnType<typeof entryMetrics>> } => x.m !== null)
      .sort((a, b) => a.m.excess - b.m.excess); // 超额升序：表现最差在前
    const dropCount = Math.min(over, rated.length);
    for (const { id, m } of rated.slice(0, dropCount)) {
      const e = poolMap.get(id)!;
      drops.push({
        entryId: id,
        kind: 'drop',
        reason: 'roster_overflow',
        score: m.excess,
        samples: m.samples,
        type: e.type,
        content: e.content,
      });
    }
  }
  const exempt = Math.max(0, over - drops.length);

  // 补入：替补席优先，空位未尽走探索（上限 ROSTER_EXPLORE_RATIO，未填满保持空缺）
  const promotes: RosterAction[] = [];
  const slots = Math.max(0, target - (activeCount - drops.length));
  if (slots > 0) {
    const benchRated = bench
      .filter(id => !effectivePinned(id))
      .map(id => ({ id, m: entryMetrics(view.by_entry[id]), last: view.by_entry[id]?.last_included_at ?? 0 }))
      .sort(benchComparator);
    for (const { id, m } of benchRated.slice(0, slots)) {
      const e = poolMap.get(id)!;
      promotes.push({
        entryId: id,
        kind: 'promote',
        reason: 'bench',
        score: m?.excess,
        samples: m?.samples,
        type: e.type,
        content: e.content,
      });
    }
    const remaining = slots - promotes.length;
    if (remaining > 0) {
      // 探索：从未引用条目补入，上限 = ceil(剩余 × ROSTER_EXPLORE_RATIO)。
      // 确定性：曾参与按最近时间倒序、其余按 id 序，避免 computed 反复求值时随机抖动
      const exploreCap = Math.min(remaining, Math.ceil(remaining * ROSTER_EXPLORE_RATIO));
      const referenced = new Set(config.entries.map(ce => ce.entry_id));
      const unreferenced = masterPool
        .filter(e => !referenced.has(e.id))
        .sort(
          (a, b) =>
            (view.by_entry[b.id]?.last_included_at ?? 0) - (view.by_entry[a.id]?.last_included_at ?? 0) ||
            a.id.localeCompare(b.id),
        );
      for (const e of unreferenced.slice(0, exploreCap)) {
        promotes.push({ entryId: e.id, kind: 'promote', reason: 'explore', type: e.type, content: e.content });
      }
    }
  }

  return {
    scopeId,
    target,
    activeCount,
    drops,
    promotes,
    exempt,
    noop: drops.length === 0 && promotes.length === 0,
  };
}

/** 应用阵容计划到指定 config（scopeId = config.id）。只保存受影响条目的应用前后局部快照供撤销；
 *  落出置 enabled=false（已停用/已删除跳过），补入若已引用置 enabled=true，
 *  否则以 master_pool 的 pinned/weight 新建引用（与 onCreateDefaultConfig 形态对齐）；
 *  目标条目已从 master_pool 删除的跳过。应用成功写入的条目打 last_weight_changed_at
 *  冷却标记（entryMetrics 据此只统计变更后新数据，观察期内不评级不落出）；
 *  批次连同局部快照入持久撤销槽 apply_history。
 *  不显式 saveSettingsDebounced（deep watch 统一落盘）。 */
export function applyRosterPlan(scopeId: string, plan: RosterPlan): SuggestionApplyResult {
  const gs = useGlobalSettingsStore();
  const config = gs.settings.configs.find(c => c.id === scopeId);
  const total = plan.drops.length + plan.promotes.length;
  if (!config) return { applied: 0, skipped: total };
  // 受影响集取计划全量（落出/补入），快照只保存这些条目（含重置 enabled 的既有引用）
  const affectedIds = [...plan.drops, ...plan.promotes].map(a => a.entryId);
  const entriesBefore = snapshotEntryRefs(config.entries, affectedIds);
  const markersBefore = collectMarkersBefore(gs, scopeId, affectedIds);
  const masterMap = new Map(gs.settings.master_pool.map(e => [e.id, e]));
  let applied = 0;
  const appliedIds: string[] = [];
  for (const a of plan.drops) {
    const entry = config.entries.find(e => e.entry_id === a.entryId);
    if (!entry || entry.enabled === false) continue;
    entry.enabled = false;
    applied += 1;
    appliedIds.push(a.entryId);
  }
  for (const a of plan.promotes) {
    const master = masterMap.get(a.entryId);
    if (!master) continue; // 已删除
    const existing = config.entries.find(e => e.entry_id === a.entryId);
    if (existing) {
      if (existing.enabled === true) continue;
      existing.enabled = true;
    } else {
      config.entries.push({ entry_id: a.entryId, pinned: master.pinned, weight: master.weight, enabled: true });
    }
    applied += 1;
    appliedIds.push(a.entryId);
  }
  if (applied > 0) {
    touchChangedMarker(gs, scopeId, appliedIds);
    invalidateAiReasons(gs, scopeId, appliedIds);
    pushApplyHistory(gs, {
      id: uuidv4(),
      scope_id: scopeId,
      kind: 'roster',
      ts: Date.now(),
      entries_before: entriesBefore,
      entries_after: snapshotEntryRefs(config.entries, appliedIds),
      markers_before: markersBefore,
    });
  }
  return { applied, skipped: total - applied };
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
 *  是"池内条目样本覆盖度"，供统计页展示「优选置信度」。纯展示，不写回。
 *  可评级判定复用建议引擎的评级解析（entryMetrics，含冷却过滤）：冷却中、窗口/全量
 *  样本不足、从未参与均返回 null——保证诊断与「实际能否出建议」口径一致。 */
export function entrySampleDistribution(view: StatsView, poolSize: number, poolIds: Set<string>): SampleDistribution {
  let sufficient = 0;
  let insufficient = 0;
  let inPool = 0;
  for (const [id, e] of Object.entries(view.by_entry)) {
    if (!poolIds.has(id)) continue;
    inPool += 1;
    if (entryMetrics(e)) sufficient += 1;
    else if (e.rounds_included > 0) insufficient += 1;
  }
  return { sufficient, insufficient, never: Math.max(0, poolSize - inPool) };
}
