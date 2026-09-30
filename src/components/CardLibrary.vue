<template>
  <div class="choice-card-library">
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-layer-group"></i> {{ t`我的卡` }}</h4>
      <p class="choice-lib-hint">
        {{ t`你拥有的卡（含内置/套装/角色主题卡），可装备到卡组；重复抽到的卡在开卡包时自动折算行动币。` }}
      </p>
      <div class="choice-lib-balance">
        <span class="choice-shop-coins"><i class="fa-solid fa-coins"></i>{{ gs.settings.card_currency }}</span>
        <span class="choice-shop-balance-hint">{{ t`行动币` }}</span>
      </div>
    </div>

    <div v-if="ownedCards.length" class="choice-lib-cards">
      <CardFace v-for="c in ownedCards" :key="c.card.id" :card="c.card" :owned="c.owned" />
    </div>
    <div v-else class="choice-empty">
      <i class="fa-solid fa-coins"></i>
      <div>{{ t`还没有卡——到收藏页开卡包或游玩中幸运掉落获得。` }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import CardFace from '@/components/CardFace.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { cardDefById } from '@/core/cards';
import type { Card, CardOwned } from '@/type/settings';

const gs = useGlobalSettingsStore();
const ownedMap = computed(() => gs.settings.card_collection);

/** 我的卡：收藏中全部已拥有、能解析定义的卡（含内置/套装/角色主题卡）。 */
const ownedCards = computed<Array<{ card: Card; owned: CardOwned }>>(() =>
  Object.entries(ownedMap.value)
    .map(([id, o]) => ({ card: cardDefById(id), o }))
    .filter((x): x is { card: Card; o: CardOwned } => !!x.card)
    .map(({ card, o }) => ({ card, owned: o })),
);
</script>

<style scoped>
.choice-card-library {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-lib-balance {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-shop-coins {
  font-size: var(--choice-text-lg);
  font-weight: bold;
  color: var(--choice-warning);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-shop-balance-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-lib-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 0 var(--choice-space-2);
}

.choice-lib-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--choice-space-3);
}
</style>
