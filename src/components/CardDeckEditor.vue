<template>
  <div class="choice-card-deck">
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-table-cells"></i> {{ t`当前卡组` }}</h4>
      <p class="choice-deck-config">
        <span class="choice-cfg-chip" :title="t`装备位随生效条目池配置切换`">
          <i class="fa-solid fa-tag"></i>{{ t`当前配置` }}：{{ configId }}
        </span>
        <span class="choice-deck-count">{{ equipped.length }}/5</span>
      </p>

      <div v-if="equipped.length" class="choice-deck-slots">
        <div
          v-for="e in equipped"
          :key="e.card.id"
          class="choice-deck-slot"
          :class="`choice-card-star--${e.card.star}`"
        >
          <CardBadge :card="e.card" />
          <div class="choice-deck-slot-owned">
            <span class="choice-lib-owned-chip">Lv.{{ ownedMap[e.card.id]?.level }}</span>
            <span class="choice-lib-durability">
              <i class="fa-solid fa-shield-half"></i>{{ ownedMap[e.card.id]?.durability }}/{{
                ownedMap[e.card.id]?.max_durability
              }}
            </span>
          </div>
          <button class="choice-btn-sm" @click="onUnequip(e.card.id)">{{ t`卸下` }}</button>
        </div>
      </div>
      <div v-else class="choice-empty">
        <i class="fa-solid fa-table-cells"></i>
        <span>{{ t`尚未装备卡——从下方收藏中选卡入位（同类 ≤1，高星卡限装）。` }}</span>
      </div>
    </div>

    <ChoiceSectionCard title="可装备收藏" icon="fa-solid fa-layer-group">
      <p class="choice-deck-hint">{{ t`损坏的卡不可装备；灰色禁用项说明未满足同类/等级预算/格数限制。` }}</p>
      <div class="choice-deck-collection">
        <div
          v-for="c in equipableCards"
          :key="c.id"
          class="choice-deck-col-card"
          :class="[`choice-card-star--${c.star}`, { disabled: !canEquip(c) }]"
        >
          <CardBadge :card="c" />
          <button
            class="choice-btn-sm"
            :disabled="!canEquip(c)"
            :title="canEquip(c) ? '' : equipReason(c)"
            @click="onEquip(c.id)"
          >
            {{ t`装备` }}
          </button>
        </div>
      </div>
      <div v-if="equipableCards.length === 0" class="choice-empty">{{ t`收藏中暂无可用卡` }}</div>
    </ChoiceSectionCard>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import CardBadge from '@/components/CardBadge.vue';
import {
  currentCardConfigId,
  equipCard,
  unequipCard,
  isCardBroken,
  resolveEquippedCards,
  type EquippedCard,
} from '@/core/cards';
import { CARD_STAR_BUDGET } from '@/core/cards-constraints';
import toastr from 'toastr';
import type { Card } from '@/type/settings';

const gs = useGlobalSettingsStore();

const configId = computed(() => currentCardConfigId());
const ownedMap = computed(() => gs.settings.card_collection);

const equipped = computed<EquippedCard[]>(() => resolveEquippedCards(configId.value));

const equippedTypes = computed(() => new Set(equipped.value.map(e => e.card.type)));
const equippedStarCount = computed<Record<string, number>>(() => {
  const out: Record<string, number> = {};
  for (const e of equipped.value) out[e.card.star] = (out[e.card.star] ?? 0) + 1;
  return out;
});

/** 收藏中可装备的候选（已拥有、未损坏） */
const equipableCards = computed<Card[]>(() =>
  Object.values(gs.settings.card_collection)
    .filter(o => !isCardBroken(o))
    .map(o => gs.settings.card_definitions[o.card_id])
    .filter((d): d is Card => !!d),
);

const canEquip = (c: Card): boolean => {
  if (equippedTypes.value.has(c.type)) return false;
  if (equipped.value.length >= 5) return false;
  const max = CARD_STAR_BUDGET[c.star];
  if (max !== undefined && (equippedStarCount.value[c.star] ?? 0) >= max) return false;
  return true;
};

const equipReason = (c: Card): string => {
  if (equippedTypes.value.has(c.type)) return t`同类卡最多装备 1 张`;
  if (equipped.value.length >= 5) return t`装备位已满（≤5）`;
  const max = CARD_STAR_BUDGET[c.star];
  if (max !== undefined && (equippedStarCount.value[c.star] ?? 0) >= max) return t`${c.star}星卡最多 ${max} 张`;
  return '';
};

const onEquip = (cardId: string) => {
  const r = equipCard(configId.value, cardId);
  if (!r.ok) toastr.error(r.errors.join('；'));
};
const onUnequip = (cardId: string) => unequipCard(configId.value, cardId);
</script>

<style scoped>
.choice-card-deck {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-deck-config {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  margin: 0 0 var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-cfg-chip {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  background: var(--choice-bg-element);
  border-radius: 999px;
  padding: 2px var(--choice-space-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.choice-deck-count {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  margin-left: auto;
}

.choice-deck-slots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--choice-space-2);
}

.choice-deck-slot {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  border-left-width: 3px;
}

.choice-deck-slot-owned {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-lib-owned-chip {
  font-size: var(--choice-text-xs);
  font-weight: bold;
  color: var(--choice-primary);
}

.choice-lib-durability {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.choice-deck-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 0 var(--choice-space-2);
}

.choice-deck-collection {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--choice-space-2);
}

.choice-deck-col-card {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  border-left-width: 3px;
}

.choice-deck-col-card.disabled {
  opacity: 0.55;
}
</style>
