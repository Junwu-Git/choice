import { reactive } from 'vue';
import { callSecondaryApiWithRetry, type ChatMsg } from '@/core/api-client';
import {
  buildStatsView,
  entryGroups,
  entrySuggestion,
  suggestionKey,
  GLOBAL_SCOPE,
  NONE_SCOPE,
  type EntryRankRow,
  type StatsView,
  type Suggestion,
} from '@/core/stats';
import { useGlobalSettingsStore } from '@/store/global-settings';
import toastr from 'toastr';
import {
  AI_ANALYSIS_BATCH_SIZE,
  AI_ANALYSIS_MAX_ENTRIES,
  AI_REASON_MAX_CHARS,
  SUGGEST_MIN_SAMPLES,
  type AiAnalysisEntry,
  type GlobalSettings,
  type PoolConfigEntry,
  type PoolEntry,
  type SecondaryApi,
} from '@/type/settings';

export type AiAnalysisProgress = {
  running: boolean;
  done: number;
  total: number;
};

export const aiAnalysisState = reactive<AiAnalysisProgress>({
  running: false,
  done: 0,
  total: 0,
});

type AnalysisPayload = {
  entryId: string;
  type: string;
  content: string;
  rule: string;
  category: string;
  samples: number;
  rate: number;
  expected: number;
  excess: number;
  basis: '窗口' | '全量';
  effectiveWeight: number;
};

/** 维度级最近活动时间戳：具体 config/NONE 维度读各自 scope 记录（全局 stats.updated_at 会被
 *  其他维度活动带动，导致无关维度缓存误失效、全量重跑）；全局视图是聚合，用全局值兜底 */
const scopeUpdatedAt = (scopeId: string, view: StatsView): number => {
  if (scopeId === GLOBAL_SCOPE) return view.updated_at;
  return useGlobalSettingsStore().settings.stats.entries[scopeId]?.updated_at ?? 0;
};

/** 判断当前维度是否需要重新分析。只有本维度统计数据产生新活动才失效，配置写入不触发重跑。
 *  rows 可传已收集的建议行（runAiAnalysis 内部复用，避免同轮两次 collectSuggestionRows 重复计算）。 */
function aiAnalysisNeeded(
  scopeId: string,
  view: StatsView,
  rows?: Array<EntryRankRow & { suggestion: Suggestion }>,
): boolean {
  const gs = useGlobalSettingsStore();
  // 分析属自动化能力：需统计开启 + 自动化开启（见 settings.ts stats_enabled / automation_enabled）
  if (!gs.settings.stats_enabled || !gs.settings.automation_enabled) return false;
  if (!gs.settings.ai_analysis_enabled) return false;
  const cached = gs.settings.stats.ai_analysis[scopeId];
  // 廉价前置：维度级无新活动（updated_at 未增长）→ 不需要重算，避免 collectSuggestionRows
  // 全量扫描（runAiAnalysis 也做了同源前置检查；此处供外部调用方复用同一短路）
  if (cached && scopeUpdatedAt(scopeId, view) <= cached.data_updated_at) return false;
  const suggestions = rows ?? collectSuggestionRows(scopeId, view);
  if (suggestions.length === 0) return false;
  return true;
}

/**
 * 按当前 scope 执行一次 AI 建议理由分析。
 * force=true 跳过缓存失效判定，用于用户显式点击「AI 分析」强刷。
 * signal 提供取消：手动「取消」中止后续批次，不写缓存（用户可重跑）。
 * 返回 false 表示未执行（开关关闭、无 API、已有任务在飞、已取消或请求全部失败）。
 */
export async function runAiAnalysis(scopeId: string, force = false, signal?: AbortSignal): Promise<boolean> {
  const gs = useGlobalSettingsStore();
  // 分析属自动化能力：需统计开启 + 自动化开启，缺一不触发（见 settings.ts stats_enabled）
  if (!gs.settings.stats_enabled || !gs.settings.automation_enabled) return false;
  if (!gs.settings.ai_analysis_enabled || aiAnalysisState.running) return false;
  const view = buildStatsView(gs.settings.stats, scopeId);
  // 廉价前置检查：维度级无新活动（updated_at 未增长）且非强制 → 直接返回，避免
  // collectSuggestionRows 全量扫描（O(pool×window)）。此前每轮统计变动都重扫一遍——
  // 空建议分支在 aiAnalysisNeeded 之后才可达、且 aiAnalysisNeeded 对空建议直接返回 false
  // 不写「已看过」缓存，导致无建议维度永远重扫。此处前置时间戳判定堵住该路径
  const cachedScope0 = gs.settings.stats.ai_analysis[scopeId];
  if (!force && cachedScope0 && scopeUpdatedAt(scopeId, view) <= cachedScope0.data_updated_at) {
    return false;
  }
  const rows = collectSuggestionRows(scopeId, view);
  // 无建议可分析：写空缓存标记「已看过」（自动路径也写，下次无新活动即被上方前置检查拦住、
  // 不再重扫）；手动点击（force）给可见反馈
  if (rows.length === 0) {
    gs.settings.stats.ai_analysis[scopeId] = {
      updated_at: Date.now(),
      data_updated_at: scopeUpdatedAt(scopeId, view),
      entries: {},
    };
    if (force)
      toastr.info(t`当前维度没有可生成理由的统计建议（参与 ≥${SUGGEST_MIN_SAMPLES} 轮且建议引擎出建议的条目）`);
    return true;
  }
  if (!force && !aiAnalysisNeeded(scopeId, view, rows)) return false;
  const api = gs.settings.active_api_id ? gs.settings.apis.find(a => a.id === gs.settings.active_api_id) : undefined;
  if (!api) {
    if (force) toastr.warning(t`未配置 API，无法生成 AI 建议理由（请在 API 设置中配置后重试）`);
    return false;
  }

  // 增量复用（仅自动路径）：已分析且当前建议指纹一致（理由仍准确）的条目不重发请求。
  // 手动「AI 分析/刷新理由」是显式动作（force=true），必须全量重跑——增量静默跳过时
  // 按钮无任何可见反馈，用户会误以为功能失灵（点击无反应）。
  const cachedScope = gs.settings.stats.ai_analysis[scopeId];
  // master_pool 索引一次：toPayload 按 entryId 取 rule，避免每条目 O(pool) 线性扫描
  const poolMap = new Map(gs.settings.master_pool.map(e => [e.id, e] as const));
  const maxRows = rows.slice(0, AI_ANALYSIS_MAX_ENTRIES);
  const needsAnalysis = force
    ? maxRows
    : maxRows.filter(r => {
        const cached = cachedScope?.entries[r.entryId];
        if (!cached || !cached.reason) return true;
        return cached.suggestion_key !== suggestionKey(r.suggestion);
      });
  if (needsAnalysis.length === 0) {
    // 仅自动路径可达（force 下 needsAnalysis 必然非空）：全部未变化只刷新失效时间戳，
    // 并按当前建议集裁剪缓存（丢弃已无建议的条目键，避免长尾滞留）
    const currentKeys = new Set(maxRows.map(r => r.entryId));
    gs.settings.stats.ai_analysis[scopeId] = {
      updated_at: Date.now(),
      data_updated_at: scopeUpdatedAt(scopeId, view),
      entries: pruneAiReasonCache(cachedScope?.entries, currentKeys, {}),
    };
    return true;
  }
  const payloads = needsAnalysis.map(r => toPayload(r, poolMap));
  const keyById = new Map(needsAnalysis.map(r => [r.entryId, suggestionKey(r.suggestion)]));
  const batches: AnalysisPayload[][] = [];
  for (let i = 0; i < payloads.length; i += AI_ANALYSIS_BATCH_SIZE) {
    batches.push(payloads.slice(i, i + AI_ANALYSIS_BATCH_SIZE));
  }

  aiAnalysisState.running = true;
  aiAnalysisState.done = 0;
  aiAnalysisState.total = batches.length;
  try {
    const { results, succeeded } = await executeAnalysisBatches(batches, api, gs.settings, signal, keyById);
    if (signal?.aborted) return false;
    // 全部批次失败：不写缓存（保留旧结果），下次数据更新/手动按钮仍可重试；
    // 手动点击（force）给失败反馈，自动路径静默（下次数据活动会再试）
    if (!succeeded) {
      if (force) toastr.error(t`AI 建议理由生成失败，请检查 API 配置与网络后重试`);
      return false;
    }
    // 增量合并：未重跑的既有结果保留（仅在当前建议集中）、新结果覆盖对应条目；
    // 已无建议的条目缓存键一并裁剪（pruneAiReasonCache），控制缓存规模不随时间膨胀
    const currentKeys = new Set(maxRows.map(r => r.entryId));
    gs.settings.stats.ai_analysis[scopeId] = {
      updated_at: Date.now(),
      data_updated_at: scopeUpdatedAt(scopeId, view),
      entries: pruneAiReasonCache(cachedScope?.entries, currentKeys, results),
    };
    return true;
  } finally {
    aiAnalysisState.running = false;
  }
}

/** 串行执行分析批次，返回各条目理由结果与是否有任一成功标志。
 *  纯提取自 runAiAnalysis 的批次循环：每批构建 prompt → 调次级 API（重试静默）→
 *  解析 → 按当前建议指纹落 suggestion_key。单批 try/catch 不阻塞其余批次；
 *  aiAnalysisState.done 在每批 finally 推进，供进度 UI 呈现；取消时 break 不写结果 */
async function executeAnalysisBatches(
  batches: AnalysisPayload[][],
  api: SecondaryApi,
  settings: GlobalSettings,
  signal: AbortSignal | undefined,
  keyById: Map<string, string>,
): Promise<{ results: Record<string, AiAnalysisEntry>; succeeded: boolean }> {
  const results: Record<string, AiAnalysisEntry> = {};
  let succeeded = false;
  for (const batch of batches) {
    if (signal?.aborted) break; // 取消：停止后续批次，不写缓存（用户可重跑）
    try {
      const raw = await callSecondaryApiWithRetry(
        buildAnalysisPrompt(batch),
        api,
        settings.retry_count,
        settings.retry_interval,
        signal,
        true, // quiet：重试进度不 toastr，进展由 aiAnalysisState 呈现
      );
      const parsed = parseAnalysisResult(raw, new Set(batch.map(item => item.entryId)));
      if (parsed) {
        for (const [id, entry] of Object.entries(parsed)) {
          // 指纹随条目落缓存：展示侧校验当前建议指纹一致才显示理由（R2）
          results[id] = { ...entry, suggestion_key: keyById.get(id) ?? '' };
        }
        succeeded = true;
      }
    } catch {
      // 单批失败不阻塞其余批次；成功批次仍可展示，整体结果写入后可手动重跑失败批次
    } finally {
      aiAnalysisState.done += 1;
    }
  }
  return { results, succeeded };
}

function collectSuggestionRows(scopeId: string, view: StatsView): Array<EntryRankRow & { suggestion: Suggestion }> {
  const gs = useGlobalSettingsStore();
  const config =
    scopeId === GLOBAL_SCOPE || scopeId === NONE_SCOPE ? undefined : gs.settings.configs.find(c => c.id === scopeId);
  const cfgMap = new Map<string, PoolConfigEntry>(config?.entries.map(e => [e.entry_id, e]) ?? []);
  return entryGroups(view, gs.settings.master_pool, gs.settings.group_order, cfgMap)
    .flatMap(group => group.rows)
    .map(row => ({ row, suggestion: entrySuggestion(row) }))
    .filter((item): item is { row: EntryRankRow; suggestion: Suggestion } => item.suggestion !== null)
    .sort((a, b) => b.row.rounds_included - a.row.rounds_included || a.row.entryId.localeCompare(b.row.entryId))
    .map(item => ({ ...item.row, suggestion: item.suggestion }));
}

function toPayload(row: EntryRankRow & { suggestion: Suggestion }, poolMap: Map<string, PoolEntry>): AnalysisPayload {
  const s = row.suggestion;
  // rule 不在 EntryRankRow（排行视图只带展示字段），join master_pool 补全——写作约束对
  // 「为什么表现差」是重要信号（规则含混/约束过强会让 AI 倾向舍弃），不能省。
  // poolMap 由调用方预建一次，避免每条目 O(pool) 线性扫描
  const poolEntry = poolMap.get(row.entryId);
  return {
    entryId: row.entryId,
    type: row.type,
    content: row.content,
    rule: poolEntry?.rule ?? '',
    category: row.category,
    samples: s.samples,
    rate: s.rate,
    expected: s.expected,
    excess: s.excess,
    basis: s.basis,
    effectiveWeight: s.currentWeight,
  };
}

function buildAnalysisPrompt(batch: AnalysisPayload[]): ChatMsg[] {
  return [
    {
      role: 'system',
      content: `你是行动选项条目统计分析器。请根据条目内容与统计指标，为每条已有统计建议生成简洁、具体、可核验的中文理由。理由最多 ${AI_REASON_MAX_CHARS} 个字符，只解释为什么统计引擎会建议提权、降权或停用，不得改变动作，不得编造未提供的剧情信息。confidence 为 0 到 1 的数字。`,
    },
    {
      role: 'user',
      content:
        `请分析以下条目，严格只输出 JSON 数组，不要输出 Markdown 或其他文字：\n${JSON.stringify(batch)}` +
        '\n格式：[{"entryId":"原 id","reason":"理由","confidence":0.8}]，必须覆盖输入中的每个 entryId。',
    },
  ];
}

/** 按当前建议集裁剪理由缓存：只保留仍在当前建议条目集（currentKeys）中、且未被本轮
 *  重跑覆盖（不在 results 中）的既有理由，再并入本轮新结果。不再有建议的条目缓存键
 *  被丢弃——避免随时间长尾滞留（展示侧另有 suggestionKey 指纹守卫双保险，此处只管数据卫生）。
 *  results 为空时（自动路径全部指纹未变）退化为「仅按 currentKeys 保留」，等价裁剪。 */
function pruneAiReasonCache(
  cached: Record<string, AiAnalysisEntry> | undefined,
  currentKeys: Set<string>,
  results: Record<string, AiAnalysisEntry>,
): Record<string, AiAnalysisEntry> {
  const kept: Record<string, AiAnalysisEntry> = {};
  for (const [id, e] of Object.entries(cached ?? {})) {
    if (currentKeys.has(id) && !results[id]) kept[id] = e;
  }
  return { ...kept, ...results };
}

function parseAnalysisResult(raw: string, entryIds: Set<string>): Record<string, AiAnalysisEntry> | null {
  const text = raw.trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    try {
      value = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value)) return null;
  const out: Record<string, AiAnalysisEntry> = {};
  for (const item of value) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    const id = record.entryId;
    if (typeof id !== 'string' || !entryIds.has(id)) return null;
    const reason = typeof record.reason === 'string' ? record.reason.trim().slice(0, AI_REASON_MAX_CHARS) : '';
    const rawConfidence = typeof record.confidence === 'number' ? record.confidence : 0;
    const confidence = Math.min(1, Math.max(0, Number.isFinite(rawConfidence) ? rawConfidence : 0));
    if (!reason) continue;
    // suggestion_key 由调用方按当前建议指纹覆写；此处占位保持类型完整
    out[id] = { reason, confidence, suggestion_key: '' };
  }
  return out;
}
