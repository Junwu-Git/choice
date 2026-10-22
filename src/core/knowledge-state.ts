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
import {
  checkCommitGuards,
  computeChatFingerprint,
  mergeKnowledgePatch,
  type KnowledgePatch,
} from '@/core/knowledge-report';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { KnowledgeReportEntry } from '@/type/settings';

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
  /** 拍快照时的报告表（深拷贝）。合并请求的响应要等数秒，期间表可能被手动操作改过；
   *  落库必须基于「发给模型的那张表」，否则会用新表的 updated_at_message 配旧快照的
   *  messageCount，写出错误的时间戳。 */
  entries: KnowledgeReportEntry[];
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
  const report = useChatSettingsStore().settings.knowledge_report;
  return {
    chatIdentity: snapshotChatIdentity(),
    messageCount: messages.length,
    fingerprint: computeChatFingerprint(messages, knowledgeFingerprintScope()),
    revision: report.revision,
    entries: report.entries.map(e => ({ ...e, aliases: [...e.aliases], keywords: [...e.keywords] })),
  };
}

/** 落库守卫用的轻量快照：只要四个标量，不复制 entries。
 *
 *  守卫只比对「聊天身份 / 内容指纹 / 修订号」，而面板可能已把表撑到 60 条——
 *  每次落库都深拷贝整表是纯浪费（请求前的完整快照才是需要 entries 的那个）。 */
export function takeGuardSnapshot(): {
  chatIdentity: string;
  messageCount: number;
  fingerprint: string;
  revision: number;
} {
  const messages = currentChat();
  const report = useChatSettingsStore().settings.knowledge_report;
  return {
    chatIdentity: snapshotChatIdentity(),
    messageCount: messages.length,
    fingerprint: computeChatFingerprint(messages, knowledgeFingerprintScope()),
    revision: report.revision,
  };
}

/** 当前分析窗口的指纹口径（单一来源）：轮数模式含隐藏楼（分析窗口参与指纹），
 *  「仅可见消息」维持可见口径。knowledge-analysis / panel-mount / 本模块三处
 *  调用都必须经它取口径，两处各算各的会让「改隐藏楼」在轮数模式下漏判重算。 */
export function knowledgeFingerprintScope(): boolean {
  try {
    return useGlobalSettingsStore().settings.knowledge.context_mode === 'rounds';
  } catch {
    return false;
  }
}

/** 报告是否落后于当前聊天：有指纹时只比指纹（口径随分析窗口，隐藏楼在轮数
 *  模式下参与比对），旧报告没有指纹（升级前的存档）时回退到楼层数比较。
 *  只有手动条目（从未分析，based_on_message=0）视为过期，让自动刷新建立基准；
 *  面板的过期提示另按 based_on_message>0 判断，避免出现「基于第 0 楼」。 */
export function isKnowledgeReportStale(): boolean {
  try {
    const cs = useChatSettingsStore();
    const report = cs.settings.knowledge_report;
    if (!report.updated_at) return true;
    if (!report.based_on_message) return true;
    const messages = currentChat();
    if (report.based_on_fingerprint)
      return report.based_on_fingerprint !== computeChatFingerprint(messages, knowledgeFingerprintScope());
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
 * 合并基线一律取 snapshot.entries（= 发给模型的那张表），不读当前 store：
 * 响应回来时表可能已被手动编辑改过，用新表合并会让旧快照的 messageCount 覆盖
 * 新条目的 updated_at_message。重建时调用方传 rebuild=true，基线为空表。
 */
export function commitKnowledgePatches(
  patches: KnowledgePatch[],
  snapshot: AnalysisSnapshot,
  previous: Parameters<typeof mergeKnowledgePatch>[0] = snapshot.entries,
  rebuild = false,
): CommitOutcome {
  // 守卫只需四项标量，不复制 entries（面板可能已把表撑到 60 条）
  const after = takeGuardSnapshot();
  const rejected = checkCommitGuards(snapshot, after);
  if (rejected) return rejected;

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
