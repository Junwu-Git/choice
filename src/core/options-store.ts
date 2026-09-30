import { chat, saveChatDebounced } from '@sillytavern/script';
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
  /** v63 防刷：该楼层（message+swipe）是否已结算过卡牌经济。同一层只结算一次
   *  （行动币/幸运开包/扣耐/套装/成就都只在首次判定发生），防「单层反复判定」刷卡。 */
  cardSettled?: boolean;
};

const getMessage = (messageId: number): StChatMessage | undefined => chat[messageId] as StChatMessage | undefined;

export function getMessageSwipeId(messageId: number): number {
  return getMessage(messageId)?.swipe_id ?? 0;
}

export function getMessageChoiceData(messageId: number, swipeId: number): MessageChoiceData | null {
  const message = getMessage(messageId);
  if (!message) {
    return null;
  }
  const data = message.extra?.[setting_field]?.[String(swipeId)];
  return data ? (klona(data) as MessageChoiceData) : null;
}

export function setMessageChoiceData(messageId: number, swipeId: number, data: MessageChoiceData) {
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

/** 该楼层是否已结算过卡牌经济（防刷「同一层最多结算一次」）。 */
export function isCardSettled(messageId: number, swipeId: number): boolean {
  return !!getMessageChoiceData(messageId, swipeId)?.cardSettled;
}

/** 标记该楼层已结算卡牌经济（首次判定结算后调用；幂等）。 */
export function markCardSettled(messageId: number, swipeId: number): void {
  const data = getMessageChoiceData(messageId, swipeId);
  if (!data || data.cardSettled) return;
  data.cardSettled = true;
  setMessageChoiceData(messageId, swipeId, data);
}
