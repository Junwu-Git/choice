/**
 * 知识边界分析：独立副 API 请求，判定 {{user}} 此刻「已知 / 存疑 / 未知」的信息，
 * 结果写入聊天级缓存（ChatSettings.knowledge_report），再由 generator 注入选项生成请求。
 *
 * 为什么默认单独发一次请求：选项 AI 每轮都要现推「谁该知道什么」，
 * 静态规则（knowledge_boundary 模块）只能约束「不许越界」却给不出具体边界，
 * 实测仍会写出全知候选。把判定提前固化成一个可查看、可复用的表，注入时只给结论。
 * 开启 knowledge.merge_with_generation 后，本轮分析改由 generateOptions 顺带完成
 * （省一次上下文发送），本模块只保留编辑/删除/滑动等不伴随生成的事件与手动入口。
 *
 * 为什么是增量补丁而不是整表重写：报告随聊天长期存在，整表重写有两个硬伤——
 * ① 请求输出随表变大线性增长；② 早期事件滚出上下文窗口后，模型看不到出处就会把
 * 本该保留的条目丢掉。改为「已有表 + 最近窗口 → 只输出变化」，表是累积记忆，
 * 只有新剧情明确推翻某条时才改动它。
 *
 * 上下文来源与 generateOptions 完全同源（persona / 世界书 / 角色卡 / 同一份历史窗口），
 * 否则分析与生成的依据不一致，注入的边界会和 AI 看到的世界对不上。
 */

import { power_user } from '@sillytavern/scripts/power-user';
import { substituteParams, this_chid } from '@sillytavern/script';
import toastr from 'toastr';
import { callSecondaryApiWithRetry, resolveCustomApi, type ChatMsg } from '@/core/api-client';
import { applyWIExcl, buildChatHistory, buildWI, resolveWIParticipation, runWIExclWindow } from '@/core/generator';
import { parseKnowledgeResponse, renderExistingTable } from '@/core/knowledge-report';
import {
  commitKnowledgePatches,
  isKnowledgeReportStale,
  knowledgeDriftMessages,
  knowledgeState,
  takeSnapshot,
} from '@/core/knowledge-state';
import { KNOWLEDGE_SYSTEM_PROMPT } from '@/core/knowledge-task';
import { getStCharacter, readCharacterFields } from '@/core/st-character';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

// 面板与调度仍从本模块取这些入口（既有 import 零改动）；实现已迁到 knowledge-state，
// 因为 generator 也要用同一份快照/落库语义，留在本模块会形成 knowledge-analysis ⇄ generator 环。
export { isKnowledgeReportStale, knowledgeDriftMessages, knowledgeState };

let knowledgeController: AbortController | null = null;

/** 防抖调度状态：编辑/删除/滑动在短时间连续发生时只发一次请求。
 *  与 loading 分开记——分析在途时再来事件，结束后补跑一次（pending 标志）。 */
const EDIT_DEBOUNCE_MS = 1200;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReason: string | null = null;

type RefreshReason = 'received' | 'edited' | 'deleted' | 'swiped';

const ANALYSIS_USER_FIRST = `请分析以上对话与设定，输出 {{user}} 当前的知识边界表（首次分析，输出完整表）。只输出 JSON 对象。`;

const ANALYSIS_USER_INCREMENTAL = `请对照「已有知识边界表」与最近剧情，只输出需要新增或修改的条目；没有变化就输出空 entries。只输出 JSON 对象。`;

/** 构建分析请求的消息数组。世界书排他窗口只包住构建（与 generateOptions 一致）：
 *  applyWIExcl 改写的是酒馆全局状态，构建完立即还原，请求期间不持有。 */
async function buildAnalysisMessages(
  contextRounds: number,
  existingTable: string,
  revision: number,
): Promise<ChatMsg[]> {
  const gs = useGlobalSettingsStore();
  const cs = useChatSettingsStore();
  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;

  return runWIExclWindow(async () => {
    const { allExcl, enabled } = await resolveWIParticipation(gwi, cwi);
    const wiRestore = gwi.enabled
      ? await applyWIExcl(allExcl, enabled, cwi.book_entry_modes, cwi.book_entry_overrides)
      : null;
    try {
      const msgs: ChatMsg[] = [{ role: 'system', content: substituteParams(KNOWLEDGE_SYSTEM_PROMPT) }];

      const persona = power_user?.persona_description;
      if (persona)
        msgs.push({ role: 'system', content: substituteParams(`<user_persona>\n${persona}\n</user_persona>`) });

      if (gwi.enabled) {
        const wi = await buildWI();
        const before = [wi.before, wi.anBefore, wi.em].filter(Boolean).join('\n\n');
        if (before) msgs.push({ role: 'system', content: before });
        if (wi.after) msgs.push({ role: 'system', content: wi.after });
      }

      // 角色设定三字段与 buildMessages 同源同法（V1/浅卡走 readCharacterFields 兜底）
      for (const field of Object.values(readCharacterFields(getStCharacter(this_chid)))) {
        if (field) msgs.push({ role: 'system', content: substituteParams(field) });
      }

      msgs.push(...buildChatHistory(contextRounds, true));

      // 已有表放在历史之后、任务指令之前：模型读到时离输出最近，最不容易被历史冲淡
      if (existingTable) {
        msgs.push({
          role: 'system',
          content: `<existing_knowledge_table>\n${existingTable}\n</existing_knowledge_table>`,
        });
      }
      msgs.push({
        role: 'user',
        content: substituteParams(
          existingTable ? `${ANALYSIS_USER_INCREMENTAL}\n（当前修订号=${revision}）` : ANALYSIS_USER_FIRST,
        ),
      });
      return msgs;
    } finally {
      wiRestore?.restore();
    }
  });
}

/** 执行一次知识边界分析（增量）。返回是否写入了新报告。
 *  manual=true 时失败会 toastr 提示；自动触发（manual=false）静默失败，避免刷屏。
 *  rebuild=true 丢弃已有表从零重建（表被污染时的逃生舱）。 */
export async function analyzeKnowledgeBoundary(manual = true, rebuild = false): Promise<boolean> {
  const gs = useGlobalSettingsStore();
  const cs = useChatSettingsStore();

  if (!gs.settings.knowledge.enabled) {
    if (manual) toastr.info(t`知识边界分析已关闭，请先在上方开启`);
    return false;
  }
  if (knowledgeState.loading) {
    if (manual) toastr.info(t`正在分析知识边界，请稍候`);
    return false;
  }
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) {
    if (manual) toastr.error(t`请先在设置中配置 API（API 地址 + 模型），然后重新分析`);
    return false;
  }

  const snapshot = takeSnapshot();
  if (!snapshot.messageCount) {
    if (manual) toastr.info(t`当前聊天还没有消息，暂无可分析的内容`);
    return false;
  }

  const previous = rebuild ? [] : cs.settings.knowledge_report.entries;
  // 传给模型的是表头修订号：重建时表是空的，从 0 开始；并发守卫始终对比当前报告的真实修订号
  const tableRevision = rebuild ? 0 : snapshot.revision;
  const existingTable = renderExistingTable(previous, tableRevision);

  knowledgeState.loading = true;
  knowledgeController = new AbortController();
  try {
    const messages = await buildAnalysisMessages(gs.settings.prompt_rules.context_rounds, existingTable, tableRevision);
    const raw = await callSecondaryApiWithRetry(
      messages,
      api,
      gs.settings.retry_count,
      gs.settings.retry_interval,
      knowledgeController.signal,
      !manual,
    );

    const parsed = parseKnowledgeResponse(raw);
    // null = 模型输出不可解析；entries 为空 = 明确的「本轮无变化」，是合法结果
    if (parsed === null) {
      if (manual) toastr.error(t`未解析出知识边界条目，请检查模型输出后重试`);
      return false;
    }

    // 跨聊天/删楼/改楼守卫与落库统一走 commitKnowledgePatches（合并请求共用同一语义）
    const outcome = commitKnowledgePatches(parsed.patches, snapshot, previous, rebuild);
    if (outcome === 'chat-changed') return false;
    if (outcome === 'stale') {
      if (manual) toastr.info(t`聊天内容已变化，本次分析结果已丢弃，请重新分析`);
      return false;
    }
    // 分析期间用户手动改过报告：以用户为准，丢弃 AI 结果
    if (outcome === 'revision-changed') {
      if (manual) toastr.info(t`报告已被手动修改，本次分析结果已丢弃`);
      return false;
    }

    if (manual) {
      const merged = cs.settings.knowledge_report;
      const active = merged.entries.filter(e => !e.retired).length;
      toastr.success(
        merged.last_changes.length === 0
          ? t`知识边界分析完成：本轮无变化，共 ${active} 条`
          : t`知识边界分析完成：${merged.last_changes.length} 项变更，共 ${active} 条`,
      );
    }
    return true;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return false;
    console.error('[Choice] knowledge analysis failed', e);
    if (manual) toastr.error(t`知识边界分析失败：${e instanceof Error ? e.message : String(e)}`);
    return false;
  } finally {
    knowledgeController = null;
    knowledgeState.loading = false;
    knowledgeState.tick += 1;
    // 在途期间有新事件：结束后补跑一次（只补一次，避免连续编辑时无限追请求）
    if (pendingReason) {
      const reason = pendingReason;
      pendingReason = null;
      if (reason === 'received' || reason === 'edited' || reason === 'deleted' || reason === 'swiped') {
        scheduleKnowledgeRefresh(reason as RefreshReason);
      }
    }
  }
}

export function cancelKnowledgeAnalysis(): void {
  knowledgeController?.abort();
  // loading 复位交给 analyzeKnowledgeBoundary 的 finally（与 cancelPoolGen 同款约定）
}

function shouldSkipRefresh(): boolean {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.knowledge.enabled || !gs.settings.knowledge.auto_analyze) return true;
  if (!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis)) return true;
  return !isKnowledgeReportStale();
}

/** 合并模式是否接管了本轮分析：由选项生成请求顺带完成，独立分析必须让路，
 *  否则两次请求会同时跑同一份增量补丁，后到的结果被修订号守卫丢掉，白耗一次上下文。
 *  调用方必须先确认本次确实会发选项生成请求——不会生成时（auto_generate 关、
 *  生成在途、无 API）仍需走独立分析，否则报告永远停在旧状态。 */
export function isKnowledgeMergeActive(): boolean {
  const gs = useGlobalSettingsStore();
  return (
    gs.settings.knowledge.enabled && gs.settings.knowledge.auto_analyze && gs.settings.knowledge.merge_with_generation
  );
}

/** 自动刷新调度：
 *  - received（新回复）立即执行，保持与选项生成并行——本轮用旧报告，下一轮用新报告；
 *  - edited / deleted / swiped 合并防抖，避免连续编辑逐字发请求；这些事件不伴随生成，
 *    合并模式下仍走独立请求；
 *  - 分析在途时只记 pending，结束后补跑一次。
 *  不 await 是因为 ST 的 eventSource.emit 串行 await 监听器。 */
export function scheduleKnowledgeRefresh(reason: RefreshReason): void {
  try {
    if (shouldSkipRefresh()) return;
    if (knowledgeState.loading) {
      pendingReason = reason;
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    if (reason === 'received') {
      void analyzeKnowledgeBoundary(false);
      return;
    }
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (shouldSkipRefresh()) return;
      void analyzeKnowledgeBoundary(false);
    }, EDIT_DEBOUNCE_MS);
  } catch (error) {
    console.error('[Choice] scheduleKnowledgeRefresh failed', error);
  }
}

/** 切换聊天时清空调度状态：防抖定时器属于旧聊天，跨聊天触发会分析错内容。 */
export function resetKnowledgeScheduling(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  pendingReason = null;
  cancelKnowledgeAnalysis();
  knowledgeState.tick += 1;
}

/** 兼容旧入口：MESSAGE_RECEIVED 的自动分析（内部走统一调度）。 */
export function maybeAutoAnalyze(): void {
  scheduleKnowledgeRefresh('received');
}
