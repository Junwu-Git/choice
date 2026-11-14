/**
 * 知识边界分析：独立副 API 请求，判定 {{user}} 此刻「已知 / 存疑 / 未知」的信息，
 * 结果写入聊天级缓存（ChatSettings.knowledge_report），再由 generator 注入选项生成请求。
 *
 * 为什么默认单独发一次请求：选项 AI 每轮都要现推「谁该知道什么」，
 * 静态规则（knowledge_boundary 模块）只能约束「不许越界」却给不出具体边界，
 * 实测仍会写出全知候选。把判定提前固化成一个可查看、可复用的表，注入时只给结论。
 * 开启 knowledge.merge_with_generation 后，本轮分析改由 generateOptions 顺带完成
 * （省一次上下文发送），本模块只保留删除/滑动等不伴随生成的事件与手动入口。
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
import { buildChatHistory, buildWICached, generatorState, historyWindowStart } from '@/core/generator';
import { getExternalSummary } from '@/core/memory-summary-bridge';
import { renderMemorySummaryContent } from '@/core/preset-task';
import {
  parseKnowledgeResponse,
  renderExistingTable,
  resolveAnalysisHistoryStart,
  shouldSkipKnowledgeRefresh,
} from '@/core/knowledge-report';
import {
  commitKnowledgePatches,
  currentMessageCount,
  isKnowledgeReportStale,
  knowledgeDriftMessages,
  knowledgeState,
  takeSnapshot,
} from '@/core/knowledge-state';
import { KNOWLEDGE_SYSTEM_PROMPT } from '@/core/knowledge-task';
import { getStCharacter, readCharacterFields } from '@/core/st-character';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { ContextMode } from '@/type/settings';

// 面板与调度仍从本模块取这些入口（既有 import 零改动）；实现已迁到 knowledge-state，
// 因为 generator 也要用同一份快照/落库语义，留在本模块会形成 knowledge-analysis ⇄ generator 环。
export { isKnowledgeReportStale, knowledgeDriftMessages, knowledgeState };

let knowledgeController: AbortController | null = null;

/** 防抖调度状态：删除/滑动/载入在短时间连续发生时只发一次请求。
 *  与 loading 分开记——分析在途时再来事件，结束后补跑一次（pending 标志）。 */
const EDIT_DEBOUNCE_MS = 1200;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
/** 尚未触发的防抖任务参数：新事件到来时要把它们合并进来，不能直接丢掉。 */
let timerDelta = false;
/** 在途期间攒下的补跑参数：delta 表示「只发新消息」。 */
let pendingReason: RefreshReason | null = null;
let pendingDelta = false;
/** 合并请求在途时挂起的事件：合并请求结束后由生成链路调用 flush 补跑
 *  （knowledge-analysis 不能反向 import generator：generator 已依赖本模块的快照语义）。 */
let mergePending: { reason: RefreshReason; delta: boolean } | null = null;

type RefreshReason = 'received' | 'deleted' | 'swiped' | 'loaded';

const ANALYSIS_USER_FIRST = `请分析以上对话与设定，输出 {{user}} 当前的知识边界表（首次分析，输出完整表）。只输出 JSON 对象。`;

// 增量指令把「只输出变化」再强调一次：system 里已写，但 user 是模型读到的最后一条指令，
// 弱模型常忽略 system 直接按「重新判定整表」输出，导致补丁体积暴涨、还容易把旧条目改坏。
const ANALYSIS_USER_INCREMENTAL = `请对照「已有知识边界表」与最近剧情，只输出需要新增或修改的条目；没有变化就输出空 entries。未变化的条目不要重复输出，已有条目的 id 必须原样沿用。只输出 JSON 对象。`;

/** 构建分析请求的消息数组。世界书排他窗口只包住构建（与 generateOptions 一致）：
 *  applyWIExcl 改写的是酒馆全局状态，构建完立即还原，请求期间不持有。 */
async function buildAnalysisMessages(
  contextRounds: number,
  windowMode: ContextMode,
  existingTable: string,
  revision: number,
  historyStart: number,
  includeHidden: boolean,
): Promise<ChatMsg[]> {
  const gs = useGlobalSettingsStore();
  const cs = useChatSettingsStore();
  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;

  // 世界书分桶走缓存（buildWICached）：与选项生成共用同一份结果——
  // 同一轮回复不再跑两遍 getWorldInfoPrompt / EJS（<% setvar %> 副作用会双跑，
  // 既白花一次扫描，也可能把酒馆变量改出与主生成不一致的状态）
  const wi = await buildWICached(gwi, cwi);
  const msgs: ChatMsg[] = [{ role: 'system', content: substituteParams(KNOWLEDGE_SYSTEM_PROMPT) }];

  const persona = power_user?.persona_description;
  if (persona)
    msgs.push({
      role: 'system',
      content: substituteParams(
        `<user_persona>\n以下是用户本人（用户=主角=user）的人物设定：\n${persona}\n</user_persona>`,
      ),
    });

  if (wi) {
    const before = [wi.before, wi.anBefore, wi.em].filter(Boolean).join('\n\n');
    if (before) msgs.push({ role: 'system', content: before });
    // 与生成侧同源：anAfter 并入 after 桶（buildMessages 的 world_info_after 同款），
    // 深度条目按 depth 两桶分别落在历史前后，否则分析侧会漏掉「角色当前状态」这类
    // 最常写在 atDepth 条目里的信息。
    const after = [wi.after, wi.anAfter].filter(Boolean).join('\n\n');
    if (after) msgs.push({ role: 'system', content: after });
    if (wi.depthBefore) msgs.push({ role: 'system', content: wi.depthBefore });
  }

  // 角色设定三字段与 buildMessages 同源同法（V1/浅卡走 readCharacterFields 兜底）
  for (const field of Object.values(readCharacterFields(getStCharacter(this_chid)))) {
    if (field) msgs.push({ role: 'system', content: substituteParams(field) });
  }

  // 摘要层（若外部记忆系统可用）：补上「已离开窗口的旧剧情」。
  // 增量分析靠 existing_knowledge_table 保留旧结论，但模型看不到出处时无法判断
  // 新剧情是否推翻旧条目；摘要正是这部分的压缩记录，与正文窗口 [start, 末尾) 零重复。
  // 增量模式下 historyStart 前移到上次分析处，摘要边界随之同步，仍保持零重复。
  const summary = getExternalSummary(historyStart);
  if (summary) msgs.push({ role: 'system', content: renderMemorySummaryContent(summary) });

  // 分析读聊天用自己的独立窗口（knowledge.context_mode/context_rounds）：
  // 边界判定要的是「主角此刻知道什么」，与出选项的近景上下文深度本来就不同，
  // 跟着提示词页联动会把分析窗口设成「恰好够写选项」——历史一长早期事实全部出窗。
  // 轮数模式含隐藏楼（includeHidden）：隐藏在酒馆里只承诺「不发给生成侧」，
  // 不承诺「剧情没发生过」——被隐藏的「谁告诉了主角什么」同样是主角的经历。
  msgs.push(...buildChatHistory(contextRounds, true, historyStart, windowMode, includeHidden));

  // depthAfter（D0-D2）在生成侧紧跟历史之后，分析侧保持同一相对位置
  if (wi?.depthAfter) msgs.push({ role: 'system', content: wi.depthAfter });

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
}

/** 执行一次知识边界分析（增量）。返回是否写入了新报告。
 *  manual=true 时失败会 toastr 提示；自动触发（manual=false）静默失败，避免刷屏。
 *  rebuild=true 丢弃已有表从零重建（表被污染时的逃生舱）。 */
export async function analyzeKnowledgeBoundary(manual = true, rebuild = false, delta = false): Promise<boolean> {
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

  const previous = rebuild ? [] : snapshot.entries;
  // 传给模型的是表头修订号：重建时表是空的，从 0 开始；并发守卫始终对比当前报告的真实修订号
  const tableRevision = rebuild ? 0 : snapshot.revision;
  const existingTable = renderExistingTable(previous, tableRevision);

  // 分析读聊天用自己的独立窗口设置（knowledge.context_mode/context_rounds），
  // 不随提示词页联动；完整窗口起点与 buildChatHistory 的截尾用同一套参数，
  // 否则增量起点（基于 fullStart）与实际发送的正文窗口对不上。
  const contextRounds = gs.settings.knowledge.context_rounds;
  const windowMode = gs.settings.knowledge.context_mode;
  // 轮数模式含隐藏楼：「仅可见消息」名字即语义维持可见口径；轮数模式关心的是
  // 「主角经历过什么」，被隐藏的剧情楼照样是主角的经历。两个口径必须贯穿
  // 窗口起点、正文截尾与指纹（过期判定），否则改隐藏楼不触发重算。
  const includeHidden = windowMode === 'rounds';

  // 增量窗口：只有「收到新回复」时只发上次分析之后的消息（保留一条重叠）。
  // 旧事实已经在已有表与摘要里；删除/滑动/载入更多历史，以及编辑过楼层后的下一次分析，
  // 都可能改到旧楼层，必须走完整窗口，否则被改的早期信息永远进不了判定。
  const historyStart = resolveAnalysisHistoryStart(
    historyWindowStart(contextRounds, windowMode, includeHidden),
    cs.settings.knowledge_report.based_on_message,
    snapshot.messageCount,
    delta && !rebuild,
  );

  knowledgeState.loading = true;
  knowledgeController = new AbortController();
  try {
    const messages = await buildAnalysisMessages(
      contextRounds,
      windowMode,
      existingTable,
      tableRevision,
      historyStart,
      includeHidden,
    );
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
    // base_revision 明确不符：模型拿旧表做的增量（或自行编造），补丁丢弃。
    // null = 弱模型漏传修订号，不据此丢弃（本地 revision 守卫仍然有效）。
    if (parsed.baseRevision !== null && parsed.baseRevision !== tableRevision) {
      if (manual) toastr.info(t`模型回传的修订号与当前报告不一致，本次结果已丢弃，请重新分析`);
      return false;
    }

    // 重建整表时模型返回空 entries 通常意味着它没看懂任务，而不是「表真的应该为空」。
    // 直接落库会清空用户所有条目（含手动与锁定），故保留旧表并要求重试。
    if (rebuild && parsed.patches.length === 0) {
      if (manual) toastr.info(t`模型未返回任何条目，已保留现有报告；请重试或检查模型输出`);
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
    // 在途期间有新事件：结束后补跑一次（只补一次，避免连续操作时无限追请求）
    if (pendingReason) {
      const reason = pendingReason;
      const pendingDeltaValue = pendingDelta;
      pendingReason = null;
      pendingDelta = false;
      scheduleKnowledgeRefresh(reason, pendingDeltaValue);
    }
  }
}

export function cancelKnowledgeAnalysis(): void {
  knowledgeController?.abort();
  // loading 复位交给 analyzeKnowledgeBoundary 的 finally（与 cancelPoolGen 同款约定）
}

function shouldSkipRefresh(delta = true): boolean {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.knowledge.enabled || !gs.settings.knowledge.auto_analyze) return true;
  if (!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis)) return true;
  // 编辑记账（needFullWindow）不排请求，但下一次分析必须看到它：视为过期并改用完整窗口；
  // 间隔节流仍按传入的 delta 判定（只有 received 是「新消息自然增长」）。
  return shouldSkipKnowledgeRefresh({
    needFullWindow: knowledgeState.fullWindowNeeded,
    stale: isKnowledgeReportStale(),
    delta,
    basedOnMessage: driftBaseOfReport(),
    messageCount: currentMessageCount(),
    intervalRounds: gs.settings.knowledge.auto_refresh_interval,
  });
}

/** 间隔判定用的报告基线：based_on_message=0（从未分析/只有手动条目）视为「必须立即建基准」，
 *  与 shouldAutoAnalyzeNow 的 basedOnMessage<=0 放行语义一致。 */
function driftBaseOfReport(): number {
  return useChatSettingsStore().settings.knowledge_report.based_on_message;
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

/** 聊天楼层被编辑：只记账，不立即发分析请求。
 *  用户改字/润色不该额外烧一次后台 API；下一次自动分析（新回复到点或手动）改用完整
 *  窗口，把被改的旧楼层重新读进来。未抽样早期楼层不改变指纹，这个标记同时让调度层把它
 *  视为「过期」，否则报告会永远停在旧结论。 */
export function noteKnowledgeContentEdited(): void {
  knowledgeState.editSeq += 1;
  knowledgeState.fullWindowNeeded = true;
  // 聊天数组不是响应式：面板的过期提示不会自己发现内容变了
  knowledgeState.tick += 1;
}

/** 自动刷新调度：
 *  - received（新回复）立即执行，保持与选项生成并行——本轮用旧报告，下一轮用新报告；
 *    这是唯一走增量窗口的事件（只发上次分析之后的新消息）；
 *  - deleted / swiped / loaded 合并防抖，避免连续删除/滚动加载逐次发请求；
 *    这些事件可能改到旧楼层，必须用完整窗口；
 *  - 编辑不进本函数（见 noteKnowledgeContentEdited）：只标记 fullWindowNeeded，不排请求；
 *  - 尚未触发的防抖任务与在途 pending 都会合并「完整窗口」需求（delta 取 AND），
 *    避免后续的 received 把之前那次完整窗口需求冲掉；结束后按合并结果补跑一次。
 *  不 await 是因为 ST 的 eventSource.emit 串行 await 监听器。 */
export function scheduleKnowledgeRefresh(reason: RefreshReason, delta = reason === 'received'): void {
  try {
    // 合并请求在途：本次独立分析与合并请求争同一个修订号，后到者会被并发守卫丢弃、
    // 白耗一次上下文。事件先挂起，等合并请求结束后由生成链路 flush 补跑。
    if (generatorState.mergeActive) {
      mergePending = mergePending
        ? {
            reason,
            // 只要有一个待处理事件需要完整窗口，补跑就必须用完整窗口（AND）
            delta: mergePending.delta && delta,
          }
        : { reason, delta };
      return;
    }
    // 继承尚未触发的防抖任务：新事件不能把它的「完整窗口」需求丢掉。
    // 例如删除楼层（完整窗口）的防抖还没触发，随后又来了一条新回复——若直接按
    // received 的增量窗口跑，删楼影响到的旧结论就永远进不了判定。
    if (refreshTimer) {
      delta = delta && timerDelta;
    }
    if (shouldSkipRefresh(delta)) return;
    if (knowledgeState.loading) {
      // 只要有一个待处理事件需要完整窗口，补跑就必须用完整窗口（AND，不是 OR）。
      pendingDelta = pendingReason === null ? delta : pendingDelta && delta;
      pendingReason = reason;
      return;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
      timerDelta = false;
    }
    if (reason === 'received') {
      // 编辑过楼层时下一次分析必须用完整窗口：delta 只是「省上下文」的优化，
      // 不能拿它换掉被改旧楼层的重读。
      void analyzeKnowledgeBoundary(false, false, delta && !knowledgeState.fullWindowNeeded);
      return;
    }
    timerDelta = delta;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      const carriedDelta = timerDelta;
      timerDelta = false;
      if (shouldSkipRefresh(carriedDelta)) return;
      void analyzeKnowledgeBoundary(false, false, carriedDelta && !knowledgeState.fullWindowNeeded);
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
  timerDelta = false;
  pendingReason = null;
  pendingDelta = false;
  mergePending = null;
  // 「需要完整窗口」属于旧聊天；新聊天按自己的报告重新判定
  knowledgeState.fullWindowNeeded = false;
  cancelKnowledgeAnalysis();
  knowledgeState.tick += 1;
}

/** 合并请求结束后补跑挂起的事件。
 *
 *  由生成链路在 generateOptions 返回后调用（见 panel-mount / ActionOptionsPanel）：
 *  合并请求在途期间到达的事件（新一轮回复、删除、滑动）在此补跑一次独立分析。
 *  报告若已被合并请求更新到最新，调度层的过期判定会自然跳过（不重复请求）。 */
export function flushKnowledgeRefreshAfterGeneration(): void {
  if (!mergePending) return;
  const { reason, delta } = mergePending;
  mergePending = null;
  scheduleKnowledgeRefresh(reason, delta);
}

/** 兼容旧入口：MESSAGE_RECEIVED 的自动分析（内部走统一调度）。
 *  fullWindow=true 用于 type='swipe'：酒馆的 MESSAGE_SWIPED 在新分支生成前触发，
 *  真正的新分支内容是在流式结束后以 MESSAGE_RECEIVED(type='swipe') 补发的；swipe
 *  不增加楼层数，增量起点（based_on_message - 1）会落到末尾，只能看到最后一条，
 *  必须用完整窗口才能复核被替换分支留下的旧结论。 */
export function maybeAutoAnalyze(fullWindow = false): void {
  scheduleKnowledgeRefresh('received', !fullWindow);
}
