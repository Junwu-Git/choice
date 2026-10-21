import { chat, saveChatDebounced } from '@sillytavern/script';
import { eventSource, event_types } from '@sillytavern/scripts/events';
import { setting_field } from '@/type/settings';

export type ChoiceOption = {
  text: string;
  sourceEntryId: string | null;
  /** 生成时文本匹配到的候选条目 id（精确归因，见 option-attribution.ts）；AI 自由发挥
   *  为 null，旧代无本字段（undefined）。统计「命中」只记匹配条目；无字段的旧代点击
   *  回退整轮共现归因（见 stats.ts recordOptionSelected）。 */
  matchedEntryId?: string | null;
};

export type ChoiceGeneration = {
  id: string;
  timestamp: number;
  count: number;
  options: ChoiceOption[];
  /** 本轮实际进入候选菜单的池条目 id 集合（固定必发 pinned 与抽签候选均计入）：
   *  随消息持久化，供条目级统计与参与/期望归因；精确逐项归因见 options[].matchedEntryId */
  poolEntryIds: string[];
  /** 生成时生效的统计维度（config.id；无 config 会话为 '__none__'）。
   *  命中回写优先直用本字段（避免点击时切 config 记错维度）；旧消息缺省时统计层
   *  回退窗口 recent 的 gid 全局搜索定位（findHitScope）。 */
  scopeId?: string;
};

type MessageChoiceData = {
  generations: ChoiceGeneration[];
  currentIndex: number;
  enrichGenerations: ChoiceGeneration[];
  enrichCurrentIndex: number;
  /** 防刷：该楼层（message+swipe）是否已结算过判定（战绩统计同层只记一次）。
   *  字段名 cardSettled 是历史命名（v63 卡牌经济+战绩双口径防刷的遗留），卡牌系统
   *  已移除但持久化字段名保留——改名会让旧消息的已结算标记失效（同层战绩重记）。 */
  cardSettled?: boolean;
};

const getMessage = (messageId: number): StChatMessage | undefined => chat[messageId] as StChatMessage | undefined;

export function getMessageSwipeId(messageId: number): number {
  return getMessage(messageId)?.swipe_id ?? 0;
}

/** 生成开始时捕获楼层身份（消息对象引用）：慢请求期间 CHAT_CHANGED/删楼重编号都会让
 *  chat[messageId] 变成别的对象，写回前用 isSameLayerIdentity 比对引用即可拦下「结果
 *  写进新聊天同序号楼层」的污染；同层 swipe 换挡不换消息对象、不受影响。 */
export function captureLayerIdentity(messageId: number): unknown {
  return getMessage(messageId);
}

export function isSameLayerIdentity(identity: unknown, messageId: number): boolean {
  return identity != null && getMessage(messageId) === identity;
}

export function getMessageChoiceData(messageId: number, swipeId: number): MessageChoiceData | null {
  const message = getMessage(messageId);
  if (!message) {
    return null;
  }
  const data = message.extra?.[setting_field]?.[String(swipeId)];
  return data ? (klona(data) as MessageChoiceData) : null;
}

/** MessageChoiceData 的写路径单一入口集合——store 外禁止构造 MessageChoiceData 字面量
 *  整体覆盖（setMessageChoiceData 已收私有），一律走 storeGeneration / storeEnrichGeneration /
 *  setMessageChoiceIndex。 */

function setMessageChoiceData(messageId: number, swipeId: number, data: MessageChoiceData) {
  const message = getMessage(messageId);
  if (!message) {
    return;
  }
  message.extra = message.extra || {};
  message.extra[setting_field] = message.extra[setting_field] || {};
  message.extra[setting_field][String(swipeId)] = klona(data);
  saveChatDebounced();
}

export function storeGeneration(messageId: number, swipeId: number, generation: ChoiceGeneration) {
  const data = getMessageChoiceData(messageId, swipeId) ?? {
    generations: [],
    currentIndex: 0,
    enrichGenerations: [],
    enrichCurrentIndex: 0,
  };
  data.generations.push(generation);
  data.currentIndex = data.generations.length - 1;
  setMessageChoiceData(messageId, swipeId, data);
}

export function storeEnrichGeneration(messageId: number, swipeId: number, generation: ChoiceGeneration) {
  const data = getMessageChoiceData(messageId, swipeId) ?? {
    generations: [],
    currentIndex: 0,
    enrichGenerations: [],
    enrichCurrentIndex: 0,
  };
  data.enrichGenerations = data.enrichGenerations ?? [];
  data.enrichGenerations.push(generation);
  data.enrichCurrentIndex = data.enrichGenerations.length - 1;
  setMessageChoiceData(messageId, swipeId, data);
}

/** 只更新翻页指针（read-modify-write）：面板 goTo/enrichGoTo 专用入口。禁止在 store 外
 *  构造 MessageChoiceData 字面量整体覆盖——setMessageChoiceData 是整对象替换，字面量缺
 *  cardSettled 等未列出字段时会静默清掉它们（防刷标记被翻页洗掉 → 同层战绩可反复记）。 */
export function setMessageChoiceIndex(
  messageId: number,
  swipeId: number,
  patch: { currentIndex?: number; enrichCurrentIndex?: number },
): void {
  const data = getMessageChoiceData(messageId, swipeId);
  if (!data) return;
  if (patch.currentIndex !== undefined) data.currentIndex = patch.currentIndex;
  if (patch.enrichCurrentIndex !== undefined) data.enrichCurrentIndex = patch.enrichCurrentIndex;
  setMessageChoiceData(messageId, swipeId, data);
}

/** 该楼层是否已结算过判定（防刷「同一层最多结算一次」战绩口径）。 */
export function isLayerSettled(messageId: number, swipeId: number): boolean {
  // 兜底集合同步消费：markLayerSettled 遇 data 缺失（脏楼层）时记到这里，防脏楼层被反复结算
  if (settledLayerFallback.has(layerKey(messageId, swipeId))) return true;
  return !!getMessageChoiceData(messageId, swipeId)?.cardSettled;
}

// data 缺失（脏楼层：消息已被删/extra 残缺）时 markLayerSettled 无法落库——用模块级集合
// 兜底记住已结算层，防该层被反复结算刷战绩。层数有限（≤聊天长度）不做淘汰；不持久化
// （消息层 cardSettled 才是真相源，此处只兜内存态脏层）。
const settledLayerFallback = new Set<string>();
const layerKey = (messageId: number, swipeId: number) => `${messageId}:${swipeId}`;

// 兜底集合键不含聊天标识：切聊天/删楼重编号会让同编号楼层被误判已结算——CHAT_CHANGED 清空
// （持久真相源在消息层 cardSettled、跨聊天各层独立，这里只兜内存态脏层）
try {
  eventSource.on(event_types.CHAT_CHANGED, () => settledLayerFallback.clear());
} catch {
  /* eventSource 不可用时静默跳过 */
}

/** 标记该楼层已结算判定（战绩防重，首次应用后调用；幂等）。 */
export function markLayerSettled(messageId: number, swipeId: number): void {
  const data = getMessageChoiceData(messageId, swipeId);
  if (!data) {
    settledLayerFallback.add(layerKey(messageId, swipeId));
    return;
  }
  if (data.cardSettled) return;
  data.cardSettled = true;
  setMessageChoiceData(messageId, swipeId, data);
}
