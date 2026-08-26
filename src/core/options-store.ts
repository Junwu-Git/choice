import { chat, saveChatDebounced } from '@sillytavern/script';
import { setting_field } from '@/type/settings';

export type ChoiceOption = {
  text: string;
  sourceEntryId: string | null;
};

export type ChoiceGeneration = {
  id: string;
  timestamp: number;
  count: number;
  options: ChoiceOption[];
};

export type MessageChoiceData = {
  generations: ChoiceGeneration[];
  currentIndex: number;
  enrichGenerations: ChoiceGeneration[];
  enrichCurrentIndex: number;
};

const getMessage = (messageId: number) => chat[messageId];

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
