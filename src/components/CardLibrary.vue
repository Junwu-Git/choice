<template>
  <div class="choice-card-library">
    <!-- 收藏进度概览 -->
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-box-open"></i> {{ t`收藏进度` }}</h4>
      <div class="choice-lib-progress">
        <span class="choice-lib-stat"
          >{{ t`已收集` }} <b>{{ ownedCount }}/{{ ownableCount }}</b></span
        >
        <span v-for="r in CARD_STAR_ORDER" :key="r" class="choice-lib-stat" :title="CARD_STAR_LABEL[r]">
          <i class="fa-solid fa-sort-down" :style="{ color: CARD_STAR_COLOR[r] }"></i>{{ starCounts[r] }}
        </span>
      </div>
    </div>

    <!-- 内置卡库（不可编辑，只可收集/装备） -->
    <ChoiceSectionCard title="内置卡库" icon="fa-solid fa-database">
      <p class="choice-lib-hint">{{ t`内置卡全球通用、可反复掉落（重复获得 = 升级+修耐久）。` }}</p>
      <div class="choice-lib-cards">
        <div v-for="c in builtinCards" :key="c.id" class="choice-lib-card" :class="`choice-card-star--${c.star}`">
          <CardBadge :card="c" />
          <div class="choice-lib-owned">
            <template v-if="ownedMap[c.id]">
              <span class="choice-lib-owned-chip">Lv.{{ ownedMap[c.id].level }}</span>
              <span class="choice-lib-durability" :class="{ broken: isCardBroken(ownedMap[c.id]) }">
                <i class="fa-solid fa-shield-half"></i>{{ ownedMap[c.id].durability }}/{{
                  ownedMap[c.id].max_durability
                }}
              </span>
              <span v-if="isCardBroken(ownedMap[c.id])" class="choice-lib-broken">{{ t`损坏` }}</span>
              <span v-else class="choice-lib-triggers" :title="t`触发次数`">
                <i class="fa-solid fa-hand-pointer"></i>{{ ownedMap[c.id].trigger_count }}
              </span>
            </template>
            <span v-else class="choice-lib-unowned">{{ t`未拥有` }}</span>
          </div>
        </div>
      </div>
      <div v-if="builtinCards.length === 0" class="choice-empty">{{ t`暂无内置卡` }}</div>
    </ChoiceSectionCard>

    <!-- 当前角色主题池 -->
    <ChoiceSectionCard title="当前角色主题池" icon="fa-solid fa-user">
      <template v-if="currentPoolDefs.length">
        <p class="choice-lib-hint">{{ t`已懒生成并固定此角色的主题卡池；池内卡反复掉落升级并修复耐久。` }}</p>
        <div class="choice-lib-cards">
          <div v-for="c in currentPoolDefs" :key="c.id" class="choice-lib-card" :class="`choice-card-star--${c.star}`">
            <CardBadge :card="c" />
            <div class="choice-lib-owned">
              <span class="choice-lib-durability" :class="{ broken: ownedMap[c.id] && isCardBroken(ownedMap[c.id]) }">
                <i class="fa-solid fa-shield-half"></i>
                {{ ownedMap[c.id] ? `${ownedMap[c.id].durability}/${ownedMap[c.id].max_durability}` : '—' }}
              </span>
              <span v-if="ownedMap[c.id] && isCardBroken(ownedMap[c.id])" class="choice-lib-broken">{{ t`损坏` }}</span>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="choice-empty">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
        <div>{{ t`当前角色主题池尚未生成——游玩中幸运数开卡包时会按角色世界观懒生成并固定。` }}</div>
      </div>
    </ChoiceSectionCard>

    <!-- 其余角色主题池（浏览） -->
    <ChoiceSectionCard v-if="otherPools.length" title="其他角色主题池" icon="fa-solid fa-users">
      <div v-for="pool in otherPools" :key="pool.character_id" class="choice-lib-pool-group">
        <h5 class="choice-lib-pool-title">{{ t`角色主题池 · ${pool.character_id}` }}</h5>
        <div class="choice-lib-cards">
          <div v-for="c in poolDefs(pool)" :key="c.id" class="choice-lib-card" :class="`choice-card-star--${c.star}`">
            <CardBadge :card="c" />
          </div>
        </div>
      </div>
    </ChoiceSectionCard>
  </div>
</template>

<script setup lang="ts">
import { BUILTIN_CARDS } from '@/core/cards-builtin';
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import CardBadge from '@/components/CardBadge.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { CARD_STAR_COLOR, CARD_STAR_LABEL, CARD_STAR_ORDER } from '@/core/cards-meta';
import { isCardBroken } from '@/core/cards';
import type { Card, CardStar } from '@/type/settings';

const gs = useGlobalSettingsStore();

const builtinCards = computed<Card[]>(() => [...BUILTIN_CARDS]);
const ownedMap = computed(() => gs.settings.card_collection);

const starCounts = computed<Record<CardStar, number>>(() => {
  const out: Record<CardStar, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const def of allDefs.value) {
    if (ownedMap.value[def.id]) out[def.star] += 1;
  }
  return out;
});

const allDefs = computed<Card[]>(() => {
  const set = new Map<string, Card>();
  for (const c of BUILTIN_CARDS) set.set(c.id, c);
  for (const pool of Object.values(gs.settings.card_character_pools)) {
    for (const id of pool.card_ids) {
      const d = gs.settings.card_definitions[id];
      if (d) set.set(id, d);
    }
  }
  return [...set.values()];
});
const ownableCount = computed(() => allDefs.value.length);
const ownedCount = computed(() => allDefs.value.filter(d => ownedMap.value[d.id]).length);

const poolDefs = (pool: { card_ids: string[] }): Card[] =>
  pool.card_ids.map(id => gs.settings.card_definitions[id]).filter((d): d is Card => !!d);
const currentPoolDefs = computed<Card[]>(() => {
  const cid = gs.currentCharacterId;
  if (cid == null) return [];
  const pool = gs.settings.card_character_pools[cid];
  return pool ? poolDefs(pool) : [];
});
const otherPools = computed(() =>
  Object.values(gs.settings.card_character_pools).filter(p => p.character_id !== gs.currentCharacterId),
);
</script>

<style scoped>
.choice-card-library {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-lib-progress {
  display: flex;
  gap: var(--choice-space-3);
  flex-wrap: wrap;
  align-items: center;
}

.choice-lib-stat {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.choice-lib-stat b {
  color: var(--choice-text);
}

.choice-lib-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 0 var(--choice-space-2);
}

.choice-lib-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: var(--choice-space-2);
}

.choice-lib-card {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  border-left-width: 3px;
}

.choice-lib-owned {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
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

.choice-lib-durability.broken {
  color: var(--choice-color-error);
}

.choice-lib-broken {
  font-size: var(--choice-text-xs);
  color: var(--choice-color-error);
  font-weight: bold;
}

.choice-lib-triggers {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.choice-lib-unowned {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-lib-pool-group {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  margin-bottom: var(--choice-space-3);
}

.choice-lib-pool-title {
  margin: 0;
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}
</style>
