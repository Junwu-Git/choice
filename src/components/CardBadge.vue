<template>
  <div class="cbadge-info">
    <div class="cbadge-top">
      <strong class="cbadge-name">{{ card.name }}</strong>
      <span class="cbadge-badges">
        <em class="cbadge-star">{{ CARD_STAR_LABEL[card.star] }}</em>
        <span class="cbadge-type">{{ CARD_TYPE_LABEL[card.type] }}</span>
      </span>
    </div>
    <div class="cbadge-line">触发：{{ triggerLabel(card.trigger) }}</div>
    <div class="cbadge-line">效果：{{ effectsLabel(card.effects) }}</div>
    <div v-if="card.narrative" class="cbadge-narrative">叙事：{{ card.narrative }}</div>
  </div>
</template>

<script setup lang="ts">
import { CARD_STAR_LABEL, CARD_TYPE_LABEL, triggerLabel, effectsLabel } from '@/core/cards-meta';
import type { Card } from '@/type/settings';

defineProps<{ card: Card }>();
</script>

<style scoped>
.cbadge-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cbadge-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
}

.cbadge-name {
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.cbadge-badges {
  display: inline-flex;
  gap: 4px;
  align-items: center;
}

.cbadge-star {
  font-style: normal;
  font-size: var(--choice-text-xs);
  font-weight: bold;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--choice-bg-element);
}

.cbadge-type {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.cbadge-line {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.cbadge-narrative {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  font-style: italic;
}
</style>