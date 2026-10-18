/**
 * 知识边界的运行时装配层：聊天身份快照、最近楼层摘要、过期判定、补丁落库。
 *
 * 为什么与 knowledge-analysis.ts 分开：analysis 要 import generator 的 buildChatHistory，
 * 而 generator 又要在生成链路里调用本模块的落库/快照——放同一文件会形成模块环。
 * 本模块只依赖 store 与纯函数层，两个方向都能安全 import。
 *
 * 为什么独立分析与合并请求必须共用 commitKnowledgePatches：并发守卫（跨聊天、内容
 * 指纹、报告修订号三重比对）只要有一处漏判，旧结论就会写进新内容。落库语义只留一份。
 */

import { chat } from '@sillytavern/script';
import { computeChatFingerprint, mergeKnowledgePatch, type KnowledgePatch } from '@/core/knowledge-report';
import { useChatSettingsStore } from '@/store/chat-settings';

/** 分析请求状态：面板据此切「分析/取消」按钮，与 generatorState/poolGenState 分离。
 *  tick 在每次调度/分析完成后自增，供面板的过期提示重新计算（聊天数组不是响应式）。
 *  放在本模块而不是 knowledge-analysis：合并请求在 generator 里落库后同样要 bump tick，
 *  而 generator 不能 import knowledge-analysis（后者依赖 generator 的 buildChatHistory）。 */
export const knowledgeState = reactive({ loading: false, tick: 0 });

export type AnalysisSnapshot = {
  chatIdentity: string;
  messageCount: number;
  fingerprint: string;
  revision: number;
};

/** 当前聊天身份快照：请求可能跨秒级，期间切聊天会把结果写进错的聊天。
 *  用 getCurrentChatId（群聊下 chatId 是群 id 而非聊天文件）优先，回退 chatId。 */
export function snapshotChatIdentity(): string {
  try {
    const ctx = window.SillyTavern?.getContext?.();
    return String(ctx?.getCurrentChatId?.() ?? ctx?.chatId ?? '');
  } catch {
    return '';
  }
}

export function currentChat(): StChatMessage[] {
  try {
    // chat 的导出类型是 TavernHelper 子集，运行时是 ST 原生楼层结构
    return chat as unknown as StChatMessage[];
  } catch {
    return [];
  }
}

export function currentMessageCount(): number {
  return currentChat().length;
}

export function takeSnapshot(): AnalysisSnapshot {
  const messages = currentChat();
  return {
    chatIdentity: snapshotChatIdentity(),
    messageCount: messages.length,
    fingerprint: computeChatFingerprint(messages),
    revision: useChatSettingsStore().settings.knowledge_report.revision,
  };
}

/** 报告是否落后于当前聊天：有指纹时只比指纹（隐藏楼层变动不触发重跑），
 *  旧报告没有指纹（升级前的存档）时回退到楼层数比较。
 *  只有手动条目（从未分析，based_on_message=0）视为过期，让自动刷新建立基准；
 *  面板的过期提示另按 based_on_message>0 判断，避免出现「基于第 0 楼」。 */
export function isKnowledgeReportStale(): boolean {
  try {
    const cs = useChatSettingsStore();
    const report = cs.settings.knowledge_report;
    if (!report.updated_at) return true;
    if (!report.based_on_message) return true;
    const messages = currentChat();
    if (report.based_on_fingerprint) return report.based_on_fingerprint !== computeChatFingerprint(messages);
    return report.based_on_message !== messages.length;
  } catch {
    return false;
  }
}

/** 当前聊天相对报告新增的楼层数（面板提示用）。 */
export function knowledgeDriftMessages(): number {
  try {
    const report = useChatSettingsStore().settings.knowledge_report;
    return currentMessageCount() - report.based_on_message;
  } catch {
    return 0;
  }
}

export type CommitOutcome = 'committed' | 'stale' | 'chat-changed' | 'revision-changed';

/**
 * 落库一份知识补丁。快照在请求前拍下，这里只负责「守卫 + 合并 + 写入」。
 *
 * 三种守卫的语义不同，不能合并：
 *  - chatIdentity：跨聊天写错文件，必须丢弃且无法补偿；
 *  - fingerprint：聊天内容变了，旧结论已不适用；
 *  - revision：用户手动改过报告，以用户为准。
 * previous 由调用方给出（重建时为空表），避免重建语义散落两处。
 */
export function commitKnowledgePatches(
  patches: KnowledgePatch[],
  snapshot: AnalysisSnapshot,
  previous: Parameters<typeof mergeKnowledgePatch>[0],
  rebuild = false,
): CommitOutcome {
  const after = takeSnapshot();
  if (after.chatIdentity !== snapshot.chatIdentity) return 'chat-changed';
  if (after.fingerprint !== snapshot.fingerprint) return 'stale';
  if (after.revision !== snapshot.revision) return 'revision-changed';

  const cs = useChatSettingsStore();
  const merged = mergeKnowledgePatch(previous, patches, snapshot.messageCount);
  const changed = merged.changed || rebuild;
  cs.settings.knowledge_report = {
    updated_at: Date.now(),
    based_on_message: snapshot.messageCount,
    based_on_fingerprint: snapshot.fingerprint,
    revision: changed ? snapshot.revision + 1 : snapshot.revision,
    entries: merged.entries,
    last_changes: [...merged.changes, ...cs.settings.knowledge_report.last_changes].slice(0, 20),
  };
  return 'committed';
}
