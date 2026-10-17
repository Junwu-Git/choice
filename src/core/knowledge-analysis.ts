/**
 * 知识边界分析：独立副 API 请求，判定 {{user}} 此刻「已知 / 存疑 / 未知」的信息，
 * 结果写入聊天级缓存（ChatSettings.knowledge_report），再由 generator 注入选项生成请求。
 *
 * 为什么单独发一次请求而不塞进选项生成：选项 AI 每轮都要现推「谁该知道什么」，
 * 静态规则（knowledge_boundary 模块）只能约束「不许越界」却给不出具体边界，
 * 实测仍会写出全知候选。把判定提前固化成一个可查看、可复用的表，注入时只给结论。
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
import { mergeKnowledgePatch, parseKnowledgePatch, renderExistingTable } from '@/core/knowledge-report';
import { getStCharacter, readCharacterFields } from '@/core/st-character';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

/** 分析请求状态：面板据此切「分析/取消」按钮，与 generatorState/poolGenState 分离。 */
export const knowledgeState = reactive({ loading: false });

let knowledgeController: AbortController | null = null;

/** 分析器系统提示：写死，不进 PromptEditor、不依赖预设。
 *  三态定义必须与内置 knowledge_boundary 模块的口径一致（获取过程从严认定、
 *  已知≠熟练、他人内心不可断言），否则注入的结论会和生成侧规则互相打架。 */
const KNOWLEDGE_SYSTEM_PROMPT = `你是「知识边界分析器」，负责判定角色扮演对话中玩家角色（{{user}}）此刻掌握哪些信息、哪些只是怀疑、哪些完全不知道。你只做判定，不续写剧情、不扮演角色、不评价文笔。

【判定对象】
只判定 {{user}} 一个人的知识状态。其他角色知道什么不在此列（他们各自的秘密属于 {{user}} 的「未知」）。

【三态口径（从严认定）】
- known（已知）：设定或剧情明确写过 {{user}} 通过看、听、读或被当面告知获取了该信息。必须能指出获取的具体来源。
- uncertain（存疑）：{{user}} 只接触到传闻、怀疑、可见迹象（神色、动作、语气、前后矛盾的言行），但没有得到确认。
- unknown（未知）：没有交代获取过程的一律算不知道——包括世界书/背景资料里只有读者能看到的内容（他人的秘密计划、远方发生的事、尚未公开的真相、角色未告知的身份）。他人的内心想法与打算对 {{user}} 永远是 unknown，除非已被当面说出。

【覆盖范围】
尽量覆盖这几类：人物身份与关系、秘密与未公开真相、事件进展与因果、地点与人物动向、关键物品与能力来历。只列对「下一步能做什么」有影响的信息，不列天气、环境这类无约束力的细节。

【增量维护规则（重要）】
消息里可能附有「已有知识边界表」。它记录的是你此前判定过、且可能来自当前上下文之外的早期剧情：
- 已有条目除非新剧情**明确推翻**，否则一律保持不变，不要因为看不到原始出处就删除或改成 unknown。
- 只在信息状态真的发生变化时输出该条目：新获知 → known；得到新迹象但仍未确认 → uncertain；被明确推翻/遗忘 → drop。
- 首次分析（没有已有表）时输出完整的表。

【输出格式（严格 JSON）】
只输出一个 JSON 数组，不要输出思考过程、解释或前后缀文字。数组里只放**本轮需要新增或修改的条目**，没有变化就输出空数组 []。每个元素：
- "topic"：信息项短标题，不超过 12 个字（如「主角的真实身份」「城北仓库的货」）。修改已有条目时必须沿用原 topic 原文。
- "status"：只能是 "known" / "uncertain" / "unknown" 三者之一。
- "basis"：判定依据，写清出自哪一楼、哪个场景或哪份设定；unknown 项写「未交代获取过程」或说明只有读者可见。
- "impact"：对候选行动的约束，一句话说明生成选项时该注意什么（如「不得直接叫出真名」「只能以试探口吻询问」）。unknown 项必须写，否则生成端无法执行。
- "drop"：true 表示该信息已失效（被推翻、已公开、不再相关），此时只需 topic，可省略其余字段。

条目总数控制在 30 条以内，优先保留对当前场景有影响的。`;

const ANALYSIS_USER_FIRST = `请分析以上对话与设定，输出 {{user}} 当前的知识边界表（首次分析，输出完整表）。只输出 JSON 数组。`;

const ANALYSIS_USER_INCREMENTAL = `请对照「已有知识边界表」与最近剧情，只输出需要新增或修改的条目；没有变化就输出 []。只输出 JSON 数组。`;

/** 当前聊天身份快照：分析请求可能跨秒级，期间切聊天会把结果写进错的聊天。
 *  用 getCurrentChatId（群聊下 chatId 是群 id 而非聊天文件）优先，回退 chatId。 */
function snapshotChatIdentity(): string {
  try {
    const ctx = window.SillyTavern?.getContext?.();
    return String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '');
  } catch {
    return '';
  }
}

function currentMessageCount(): number {
  try {
    return window.SillyTavern?.getContext?.()?.chat?.length ?? 0;
  } catch {
    return 0;
  }
}

/** 构建分析请求的消息数组。世界书排他窗口只包住构建（与 generateOptions 一致）：
 *  applyWIExcl 改写的是酒馆全局状态，构建完立即还原，请求期间不持有。 */
async function buildAnalysisMessages(contextRounds: number, existingTable: string): Promise<ChatMsg[]> {
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

      // 角色卡三字段与 buildMessages 同源同法（V1/浅卡走 readCharacterFields 兜底）
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
        content: substituteParams(existingTable ? ANALYSIS_USER_INCREMENTAL : ANALYSIS_USER_FIRST),
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

  const chatIdentity = snapshotChatIdentity();
  const messageCount = currentMessageCount();
  const previous = rebuild ? [] : cs.settings.knowledge_report.entries;
  const existingTable = renderExistingTable(previous);

  knowledgeState.loading = true;
  knowledgeController = new AbortController();
  try {
    const messages = await buildAnalysisMessages(gs.settings.prompt_rules.context_rounds, existingTable);
    const raw = await callSecondaryApiWithRetry(
      messages,
      api,
      gs.settings.retry_count,
      gs.settings.retry_interval,
      knowledgeController.signal,
      !manual,
    );

    const patch = parseKnowledgePatch(raw);
    // null = 模型输出不可解析；[] = 明确的「本轮无变化」，是合法结果
    if (patch === null) {
      if (manual) toastr.error(t`未解析出知识边界条目，请检查模型输出后重试`);
      return false;
    }

    // 跨聊天/删楼守卫：请求期间身份变了就丢弃，绝不写进另一份聊天
    if (snapshotChatIdentity() !== chatIdentity) return false;

    const entries = mergeKnowledgePatch(previous, patch, messageCount);
    cs.settings.knowledge_report = {
      updated_at: Date.now(),
      based_on_message: messageCount,
      entries,
    };

    if (manual) {
      const changed = patch.length;
      toastr.success(
        changed === 0
          ? t`知识边界分析完成：本轮无变化，共 ${entries.length} 条`
          : t`知识边界分析完成：更新 ${changed} 条，共 ${entries.length} 条`,
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
  }
}

export function cancelKnowledgeAnalysis(): void {
  knowledgeController?.abort();
  // loading 复位交给 analyzeKnowledgeBoundary 的 finally（与 cancelPoolGen 同款约定）
}

/** 自动分析入口：由 MESSAGE_RECEIVED 调用，fire-and-forget。
 *  报告基于的楼层数已追上当前楼层时跳过，避免重复请求。 */
export function maybeAutoAnalyze(): void {
  try {
    const gs = useGlobalSettingsStore();
    const cs = useChatSettingsStore();
    if (!gs.settings.knowledge.enabled || !gs.settings.knowledge.auto_analyze) return;
    if (knowledgeState.loading) return;
    if (!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis)) return;
    const report = cs.settings.knowledge_report;
    // based_on_message 记录的是分析时的消息总数；楼层未增长说明没有新信息可分析。
    // 删除楼层后 based_on_message 会大于当前数，此时同样应重跑（内容已变），故用 !==。
    if (report.updated_at > 0 && report.based_on_message === currentMessageCount()) return;
    void analyzeKnowledgeBoundary(false);
  } catch (error) {
    console.error('[Choice] maybeAutoAnalyze failed', error);
  }
}
