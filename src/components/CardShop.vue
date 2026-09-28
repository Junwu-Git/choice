<template>
  <div class="choice-card-shop">
    <!-- 行动币余额 -->
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-coins"></i> {{ t`行动币` }}</h4>
      <div class="choice-shop-balance">
        <span class="choice-shop-coins"><i class="fa-solid fa-coins"></i>{{ gs.settings.card_currency }}</span>
        <span class="choice-shop-balance-hint">{{ t`由判定结局收支 + 分解重复高级卡获得，属全局进度，清空统计不清除。` }}</span>
      </div>
    </div>

    <!-- 每日任务 -->
    <ChoiceSectionCard title="每日任务" icon="fa-solid fa-list-check">
      <div v-for="k in CARD_DAILY_KEYS" :key="k" class="choice-daily-task">
        <span class="choice-daily-label">{{ dailyLabel(k) }}</span>
        <span class="choice-daily-progress">{{ dailyProgress(k) }}</span>
        <button
          v-if="dailyState(k)?.done && !dailyState(k)?.claimed"
          class="choice-btn-sm"
          :title="t`领取 1 次免费 3 选 1 开卡包`"
          @click="onClaim(k)"
        >
          {{ t`领取开包` }}
        </button>
        <span v-else-if="dailyState(k)?.claimed" class="choice-daily-claimed">{{ t`已领取` }}</span>
        <span v-else class="choice-daily-pending">{{ t`未完成` }}</span>
      </div>
    </ChoiceSectionCard>

    <!-- 分解重复高级卡 -->
    <ChoiceSectionCard title="分解" icon="fa-solid fa-scissors">
      <p class="choice-shop-hint">{{ t`分解第 2 张及以上史诗/传说，保底留 1，得行动币。` }}</p>
      <div v-if="dismantleList.length" class="choice-shop-list">
        <div v-for="d in dismantleList" :key="d.card.id" class="choice-shop-item">
          <CardBadge :card="d.card" />
          <span class="choice-shop-level">Lv.{{ d.owned.level }}</span>
          <button class="choice-btn-sm" :title="t`分解得 +${d.gain} 行动币`" @click="onDismantle(d.card.id)">
            <i class="fa-solid fa-scissors"></i> +{{ d.gain }}
          </button>
        </div>
      </div>
      <div v-else class="choice-empty">{{ t`暂无第 2 张及以上的史诗/传说可分解` }}</div>
    </ChoiceSectionCard>

    <!-- 定向内置卡货架 -->
    <ChoiceSectionCard title="定向内置卡" icon="fa-solid fa-store">
      <div class="choice-shop-list">
        <div v-for="c in BUILTIN_CARDS" :key="c.id" class="choice-shop-item">
          <CardBadge :card="c" />
          <button class="choice-btn-sm" :disabled="gs.settings.card_currency < CARD_PRICE[c.star]" @click="onBuy(c.id)">
            <i class="fa-solid fa-coins"></i>{{ CARD_PRICE[c.star] }}
            {{ ownedMap[c.id] ? t`升级` : t`购买` }}
          </button>
        </div>
      </div>
    </ChoiceSectionCard>

    <!-- 卡包货架 -->
    <ChoiceSectionCard title="卡包" icon="fa-solid fa-gift">
      <p class="choice-shop-hint">{{ t`恒定 ${CARD_PACK_PRICE} 行动币，买了即开 3 选 1（混合池，含保底）。` }}</p>
      <button class="choice-btn-sm" :disabled="gs.settings.card_currency < CARD_PACK_PRICE" @click="onBuyPack">
        <i class="fa-solid fa-gift"></i>{{ CARD_PACK_PRICE }} {{ t`行动币 · 开卡包` }}
      </button>
    </ChoiceSectionCard>
  </div>
</template>

<script setup lang="ts">
import { BUILTIN_CARDS } from '@/core/cards-builtin';
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import CardBadge from '@/components/CardBadge.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import {
  buyCard,
  buyPack,
  dismantleCard,
  claimDailyReward,
  resetDailyIfStale,
  currentCardConfigId,
} from '@/core/cards';
import { openCardPack } from '@/core/card-pack-state';
import { CARD_DAILY_KEYS, CARD_DAILY_TARGETS, CARD_PRICE, CARD_PACK_PRICE, CARD_DISMANTLE } from '@/core/cards-constraints';
import type { CardDailyKey } from '@/core/cards-constraints';
import toastr from 'toastr';
import type { Card, CardOwned, CardStar } from '@/type/settings';

const gs = useGlobalSettingsStore();
const ownedMap = computed(() => gs.settings.card_collection);

onMounted(() => resetDailyIfStale(gs));

const dailyState = (k: string) => gs.settings.card_daily.tasks[k];
const dailyProgress = (k: string): string => {
  const t = dailyState(k);
  const target = CARD_DAILY_TARGETS[k as CardDailyKey] ?? 0;
  return `${t?.count ?? 0}/${target}`;
};
const dailyLabel = (k: string): string =>
  k === 'generate' ? t`生成一次选项` : k === 'judge' ? t`做 10 次判定` : t`点选 8 个选项`;

const onClaim = (k: string) => {
  const offer = claimDailyReward(k as CardDailyKey);
  if (offer) openCardPack(offer, 'daily');
};

/** 可分解列表：史诗/传说且 level ≥ 2（保底留 1） */
const dismantleList = computed<Array<{ card: Card; owned: CardOwned; gain: number }>>(() =>
  Object.entries(ownedMap.value)
    .filter(([, o]) => o.level >= 2)
    .map(([id, o]) => ({ id, o, def: gs.settings.card_definitions[id] }))
    .filter((x): x is { id: string; o: CardOwned; def: Card } => !!x.def)
    .filter(x => (CARD_DISMANTLE[x.def.star as CardStar] ?? 0) > 0)
    .map(x => ({ card: x.def, owned: x.o, gain: CARD_DISMANTLE[x.def.star as CardStar]! })),
);

const onDismantle = (cardId: string) => {
  const r = dismantleCard(cardId);
  if (!r.ok) toastr.error(r.errors.join('；'));
};

const onBuy = (cardId: string) => {
  const r = buyCard(cardId);
  if (!r.ok) toastr.error(r.errors.join('；'));
};

const onBuyPack = () => {
  const r = buyPack(currentCardConfigId());
  if (!r.ok) toastr.error(r.errors.join('；'));
  else if (r.offer) openCardPack(r.offer, 'shop');
};
</script>

<style scoped>
.choice-card-shop {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-shop-balance {
  display: flex;
  align-items: center;
  gap: var(--choice-space-3);
  flex-wrap: wrap;
}

.choice-shop-coins {
  font-size: var(--choice-text-xl);
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

.choice-daily-task {
  display: flex;
  align-items: center;
  gap: var(--choice-space-3);
  padding: var(--choice-space-2) 0;
}

.choice-daily-label {
  flex: 1;
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
}

.choice-daily-progress {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  font-variant-numeric: tabular-nums;
}

.choice-daily-claimed {
  font-size: var(--choice-text-xs);
  color: var(--choice-success);
  font-weight: bold;
}

.choice-daily-pending {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-shop-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 0 var(--choice-space-2);
}

.choice-shop-list {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--choice-space-2);
}

.choice-shop-item {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  border-left-width: 3px;
}

.choice-shop-level {
  font-size: var(--choice-text-xs);
  color: var(--choice-primary);
}
</style>