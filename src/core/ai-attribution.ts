import { reactive } from 'vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { callSecondaryApiWithRetry, type ChatMsg } from '@/core/api-client';
import { writeBackOptionAttribution, type ChoiceGeneration } from '@/core/options-store';
import { reconcileAttribution } from '@/core/stats';
import { AI_ATTRIBUTION_QUEUE_MAX } from '@/type/settings';
import type { PoolEntry, ScopeStats, SecondaryApi } from '@/type/settings';

/** 面板刷新钩子：writeBackAttribution 写回消息后调用，由面板层（panel-mount）注册。
 *  用注册而非直接 import 解耦 core 与 store 的循环依赖——ai-attribution 若 import
 *  panel-state 会成环（panel-state→enrich-input→generator→ai-attribution）。未注册时 no-op。 */
let panelRefreshHook: ((messageId: number, swipeId: number) => void) | null = null;
export function setAttributionPanelRefreshHook(fn: ((messageId: number, swipeId: number) => void) | null): void {
  panelRefreshHook = fn;
}

/**
 * L1 AI 归因增强（异步队列，不进生成关键路径）。
 *
 * generateOptions 成功后在生成链路之外 fire-and-forget 入队：后台调 AI 对「本轮输出选项 vs
 * 候选条目」做语义归因，结果与生成时已按本地 Dice 归因实时记账的统计 diff 后**对称修正**
 * （reconcileAttribution，保持 v53 采纳感知基线口径），再把 AI 归因写回消息 extra
 * （覆盖 options[].matchedEntryId——点击路径零改动，继续读该字段）。
 *
 * 设计红线（不能直接简化掉）：
 *  - 失败/未启用/解析失败一律静默保留 Dice 结果（主体功能对 AI 零依赖）；
 *  - 全局单飞串行队列：同一时刻至多一个 AI 请求在飞，避免短时间连发多轮请求成本叠加；
 *  - 统计修正与消息写回**同进同出**：先写回消息、写回成功才修统计（reconcile 读的是内存
 *    generation.options 的 Dice 旧值，与消息写回互不干扰，顺序反转安全）——写回失败
 *    （楼层被删/顶掉）时两者都不动，消除「统计已按 AI 修正、消息仍是 Dice 口径」的单侧分裂；
 *    scope 已清空/该 gid 已滚出窗口时同样两者都跳过（修正会复活已清数据）；
 *  - 前置快检：整轮选项均 type 前缀高置信命中（allPrefixMatched）时直接跳过——Dice 结果
 *    与 AI 几乎必然一致，省一次外部请求；
 *  - 队列有上限（AI_ATTRIBUTION_QUEUE_MAX）：超出丢最旧，宁可不纠偏不积压（坏 API 串行
 *    重试可能阻塞队列数分钟，刷新又丢，无上限只会无限膨胀）；
 *  - 进度/失败经 aiAttributionState 暴露（统计页/Debug 可查），重试不 toastr（后台任务不打扰）。
 */

type AttributionJob = {
  generation: ChoiceGeneration;
  messageId: number;
  swipeId: number;
};

type AttributionResult = Array<{ index: number; entryId: string | null }>;

/** L1 工作状态（可观测）：统计页 AI 增强块读取，回答「开着值不值」。
 *  只保留被消费的字段（queued/corrected/migrated）。单飞由模块级 attributionRunning 控制、
 *  无需对外暴露 running；错误不 toastr（后台任务不打扰），曾用 lastError/totalRuns 留痕但
 *  全仓库无读取，已删——如需排查改 console.error。 */
export type AiAttributionState = {
  /** 当前队列积压数（刷新即丢，仅运行时视图） */
  queued: number;
  /** 累计期望/窗口 matched 修正条次数（reconcile.adjusted 累加） */
  corrected: number;
  /** 累计命中迁移条次数（reconcile.migrated 累加） */
  migrated: number;
};

export const aiAttributionState = reactive<AiAttributionState>({
  queued: 0,
  corrected: 0,
  migrated: 0,
});

/** 待归因队列（FIFO，上限 AI_ATTRIBUTION_QUEUE_MAX）。页面刷新即丢：未归因代静默保留
 *  Dice 结果，二期再做恢复 */
const attributionQueue: AttributionJob[] = [];
/** 单飞标志：同一时刻只跑一个归因任务（串行，避免并发 API 请求） */
let attributionRunning = false;

/** 入队一次 AI 归因（生成成功路径调用，fire-and-forget）。开关关/无选项 → no-op。
 *  API 解析在队内执行而非此处：queue 中先入的请求可能失败，逐条解析保证状态一致。
 *  allPrefixMatched=true = 整轮选项均 type 前缀高置信命中，直接跳过（省一次请求）。 */
export function enqueueAttributionAnalysis(
  generation: ChoiceGeneration,
  messageId: number,
  swipeId: number,
  allPrefixMatched = false,
): void {
  const gs = useGlobalSettingsStore();
  // 总开关默认关：关 = 统计都不采集，归因无意义且会发起外部请求。generator 成功路径
  // 无条件调用本函数，recordOptionsGenerated 的早退拦不住这里，必须单独守卫。
  // 归因属自动化能力：需统计开启 + 自动化开启 + 归因子开关三者同时满足
  if (!gs.settings.stats_enabled || !gs.settings.automation_enabled) return;
  if (!gs.settings.ai_attribution_enabled) return;
  if (!generation?.options?.length) return;
  if (allPrefixMatched) return;
  // 上限保护：超出丢最旧（宁可丢失不积压——坏 API 串行重试会阻塞队列数分钟）
  if (attributionQueue.length >= AI_ATTRIBUTION_QUEUE_MAX) attributionQueue.shift();
  attributionQueue.push({ generation, messageId, swipeId });
  aiAttributionState.queued = attributionQueue.length;
  void pumpAttributionQueue();
}

/** 串行泵：单飞时直接返回（在飞任务完成后再续跑），保证队列严格串行 */
async function pumpAttributionQueue(): Promise<void> {
  if (attributionRunning) return;
  attributionRunning = true;
  try {
    while (attributionQueue.length > 0) {
      const job = attributionQueue.shift();
      aiAttributionState.queued = attributionQueue.length;
      if (!job) continue;
      try {
        await runAttributionJob(job);
      } catch {
        // 单条失败静默：保留 Dice 结果，不 toastr（后台任务不打扰用户）。
        // 曾用 lastError 留痕但全仓库无读取，已删；如需排查改 console.error
      }
    }
  } finally {
    attributionRunning = false;
  }
}

async function runAttributionJob(job: AttributionJob): Promise<void> {
  const gs = useGlobalSettingsStore();
  const api = resolveActiveApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) return;
  const { generation } = job;
  const candidates = buildCandidateList(generation.poolEntryIds, gs.settings.master_pool);
  if (candidates.length === 0) return;
  const messages = buildAttributionPrompt(generation.options, candidates);
  // quiet=true：后台任务的重试进度不 toastr 打扰；失败由 aiAttributionState 记录
  const raw = await callSecondaryApiWithRetry(
    messages,
    api,
    gs.settings.retry_count,
    gs.settings.retry_interval,
    undefined,
    true,
  );
  const result = parseAttributionResult(raw, generation.options.length, new Set(candidates.map(c => c.id)));
  if (!result) return;
  // AI 结果与 Dice 完全一致时跳过：reconcile 无 diff 可修，写回也只是原值覆盖，
  // 跳过可避免一次无意义的 setMessageChoiceData（saveChatDebounced 落盘）。
  // 注意归一化：Dice 未匹配写 undefined，AI 契约写 null，比较前统一 ?? null。
  // 只比对 result 实际覆盖的 index：解析层允许缺 index（缺省 = 保持 Dice），部分数组
  // 即使与 Dice 一致（含空数组）也视为无变化——整体一致才跳过，否则不触发多余落盘
  const unchanged = result.every(r => (r.entryId ?? null) === (generation.options[r.index]?.matchedEntryId ?? null));
  if (unchanged) return;
  // 统计修正与消息写回同进同出：scope 已删/清空，或该 gid 已滚出窗口 → 两者都跳过
  //（修正会复活已清数据；单独写回会让该轮期望保持 Dice、点击命中按 AI，口径永久分裂）。
  const scope = generation.scopeId ? gs.settings.stats.entries[generation.scopeId] : undefined;
  // 候选 id 集：gid 只可能出现在本轮 poolEntryIds 对应条目的 recent 里（recordOptionsGenerated
  // 仅对 poolEntryIds 推 recent）。限定候选集查 scopeHasGid，避免扫全 by_entry×window
  const candidateIds = new Set(generation.poolEntryIds);
  if (scope && scopeHasGid(scope, generation.id, candidateIds)) {
    // 先写回消息：写回失败（消息/代已不存在，用户删楼层或重新生成顶掉旧代）直接跳过——
    // 统计一并保持 Dice 口径，消除「统计已修、消息未写回」的单侧分裂（同进同出）。
    // 写回改的是消息 extra 里的克隆，reconcile 读的内存 generation.options 不受影响
    const written = writeBackOptionAttribution(
      job.messageId,
      job.swipeId,
      job.generation.id,
      result.map(r => ({ index: r.index, entryId: r.entryId })),
    );
    if (!written) return;
    // count 取 options.length（实际保留条数）与 recordOptionsGenerated 记账口径一致；
    // 勿用 generation.count（请求条数）——池下溢时两者不等，Δmatched/count 分母错配会让
    // 全量期望与窗口口径漂移、建议引擎误判（reconcileAttribution 默认 count=options.length）
    const r = reconcileAttribution(scope, generation.id, generation.options, result);
    aiAttributionState.corrected += r.adjusted;
    aiAttributionState.migrated += r.migrated;
    // 同步刷新面板持有的当前 generation 副本：写回只改了消息 extra，面板的 generations ref 是
    // 另一份克隆（非响应式源自 chat），不刷新则点击会读到旧 Dice matchedEntryId、而统计已按
    // AI 修正——期望/命中来源分裂（同进同出设计的第三源缺口）。面板未显示该消息时钩子 no-op
    panelRefreshHook?.(job.messageId, job.swipeId);
  }
}

/** 解析生效副 API（与 generateOptions 同源）。不 import resolveCustomApi（generator.ts 会
 *  import 本模块，再反向 import 会形成循环依赖；此处一行的查找逻辑直接内联）。 */
function resolveActiveApi(id: string, apis: SecondaryApi[]): SecondaryApi | undefined {
  return id ? apis.find(a => a.id === id) : undefined;
}

/** 候选列表：poolEntryIds join master_pool（id → type/content/rule），id 必须存在否则跳过 */
function buildCandidateList(
  ids: string[],
  masterPool: PoolEntry[],
): Array<{ id: string; type: string; content: string; rule: string }> {
  const map = new Map(masterPool.map(e => [e.id, e]));
  const out: Array<{ id: string; type: string; content: string; rule: string }> = [];
  for (const id of ids) {
    const e = map.get(id);
    if (e) out.push({ id, type: e.type, content: e.content, rule: e.rule });
  }
  return out;
}

/** 归因提示词：只发本轮候选与选项（条目正文会出站，由开关显式授权）。
 *  输出契约钉死为 JSON 数组（与条目池生成同理：结构化契约避免自由文本解析漂移）。 */
function buildAttributionPrompt(
  options: { text: string }[],
  candidates: Array<{ id: string; type: string; content: string; rule: string }>,
): ChatMsg[] {
  const candText = candidates
    .map((c, i) => `#${i + 1} id=${c.id} type=${c.type} content=${c.content}${c.rule ? ` rule=${c.rule}` : ''}`)
    .join('\n');
  const optText = options.map((o, i) => `[${i}] ${o.text}`).join('\n');
  return [
    {
      role: 'system',
      content:
        '你是「行动选项归因器」。角色扮演中 AI 会参考候选条目生成行动选项，输出可能被语义改写、合并或自由发挥。请判断每条输出选项源自哪个候选条目（内容或方向派生自它），与任何候选都无关时归 null。',
    },
    {
      role: 'user',
      content: `【候选条目】\n${candText}\n\n【输出选项】\n${optText}\n\n输出严格 JSON 数组，不要输出任何其他内容：\n[{"index": 0, "entryId": "候选 id 或 null"}, ...]\n每条选项都必须给出，entryId 只能取上述候选 id 之一或 null。`,
    },
  ];
}

/** 解析归因结果：剥代码围栏/截取首个 JSON 数组后 parse；非法元素（非对象/越界 index/
 *  entryId 不在候选集/类型错）逐条跳过、重复 index 取首个——弱模型容错，部分可用结果
 *  仍被采用（与下游「缺 index = 保持 Dice」契约一致），全部元素非法或整体非数组才返回
 *  null（宁可保留 Dice 结果，不采用空结果） */
function parseAttributionResult(raw: string, optionCount: number, candidateIds: Set<string>): AttributionResult | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/g, '')
    .trim();
  let arr: unknown;
  try {
    arr = JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('[');
    const end = cleaned.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    try {
      arr = JSON.parse(cleaned.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(arr)) return null;
  const out: AttributionResult = [];
  const seen = new Set<number>();
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const { index, entryId } = item as { index?: unknown; entryId?: unknown };
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= optionCount) continue;
    if (seen.has(index)) continue; // index 重复：取首个（首见即认），后续按非法跳过
    if (entryId !== null && typeof entryId !== 'string') continue;
    if (typeof entryId === 'string' && !candidateIds.has(entryId)) continue;
    seen.add(index);
    out.push({ index, entryId: (entryId as string | null) ?? null });
  }
  return out.length > 0 ? out : null;
}

/** 该 scope 的窗口记录里是否还有该 gid（reconcile 前置守卫：清空统计后旧代残留检查）。
 *  限定在候选 id 集（本轮 poolEntryIds）内查——gid 只可能出现在这些条目的 recent 里，
 *  避免扫全 by_entry×window。hasOwn 守卫同 getEntryStats：by_entry 是持久化普通对象，
 *  方括号读无自有键时命中原型链（如 "__proto__" → Object.prototype，truthy）。 */
function scopeHasGid(scope: ScopeStats, gid: string, candidateIds: Set<string>): boolean {
  const hasOwn = Object.prototype.hasOwnProperty;
  for (const id of candidateIds) {
    if (!hasOwn.call(scope.by_entry, id)) continue;
    const e = scope.by_entry[id];
    if (e?.recent.some(r => r.gid === gid)) return true;
  }
  return false;
}
