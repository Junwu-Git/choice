<template>
  <div class="choice-card-library">
    <!-- 收藏进度概览 + 行动币/开卡包入口（原商店收编） -->
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-box-open"></i> {{ t`收藏进度` }}</h4>
      <div class="choice-lib-progress">
        <span class="choice-lib-stat"
          >{{ t`已收集` }} <b>{{ ownedCount }}/{{ ownableCount }}</b></span
        >
        <span v-for="r in CARD_STAR_ORDER" :key="r" class="choice-lib-stat" :title="CARD_STAR_LABEL[r]">
          <i class="fa-solid fa-sort-down" :style="{ color: CARD_STAR_COLOR[r] }"></i>{{ starCounts[r] }}
        </span>
        <span class="choice-lib-stat choice-lib-coins"
          ><i class="fa-solid fa-coins"></i><b>{{ gs.settings.card_currency }}</b></span
        >
        <button
          class="choice-btn-sm choice-pack-buy"
          :disabled="gs.settings.card_currency < CARD_PACK_PRICE"
          @click="onBuyPack"
        >
          <i class="fa-solid fa-box"></i>{{ t`开卡包（${CARD_PACK_PRICE} 币）` }}
        </button>
      </div>
    </div>

    <!-- 收藏成就（趣味彩蛋，零操作） -->
    <ChoiceSectionCard title="成就" icon="fa-solid fa-trophy">
      <p class="choice-lib-hint">{{ t`单类型集齐 1–5 星、或收藏达里程碑即自动达成，无需额外操作。` }}</p>
      <div class="choice-lib-trophies">
        <span
          v-for="t in trophies"
          :key="t.key"
          class="choice-lib-trophy"
          :class="{ 'choice-lib-trophy--done': t.achieved }"
          :title="t.label"
        >
          <i class="fa-solid" :class="t.achieved ? 'fa-circle-check' : 'fa-lock'"></i>{{ t.label }}
        </span>
      </div>
    </ChoiceSectionCard>

    <!-- 套装收藏（背景套组卡进度，集齐解锁特殊效果） -->
    <ChoiceSectionCard title="套装收藏" icon="fa-solid fa-layer-group">
      <p class="choice-lib-hint">{{ t`集齐某套装的卡解锁其特殊效果；装备 ≥2 张成套卡时判定触发。` }}</p>
      <div class="choice-lib-sets">
        <div
          v-for="s in setProgress"
          :key="s.id"
          class="choice-lib-set"
          :class="{ 'choice-lib-set--done': s.complete }"
        >
          <div class="choice-lib-set-head">
            <span class="choice-lib-set-name"><i class="fa-solid fa-layer-group"></i>{{ s.name }}</span>
            <span class="choice-lib-set-count">{{ s.owned }}/{{ s.total }}</span>
          </div>
          <p class="choice-lib-set-theme">{{ s.theme }}</p>
          <div class="choice-lib-set-bar"><i :style="{ width: setPct(s) }"></i></div>
        </div>
      </div>
    </ChoiceSectionCard>

    <!-- 内置卡库（不可编辑，只可收集/装备；未获得卡模糊遮盖） -->
    <ChoiceSectionCard title="内置卡库" icon="fa-solid fa-database">
      <p class="choice-lib-hint">
        {{ t`内置卡全球通用、可反复掉落；未获得的卡模糊遮盖，靠开卡包/幸运掉落随机获得（重复获得自动折算行动币）。` }}
      </p>
      <div class="choice-lib-cards">
        <CardFace
          v-for="c in builtinCards"
          :key="c.id"
          :card="c"
          :owned="ownedMap[c.id]"
          :state="cardState(c)"
          :obscured="!isCollected(c)"
          :previously-owned="isDismantled(c)"
        >
          <template v-if="ownedMap[c.id]" #footer>
            <span class="choice-lib-triggers" :title="t`触发次数`">
              <i class="fa-solid fa-hand-pointer"></i>{{ ownedMap[c.id].trigger_count }}
            </span>
          </template>
        </CardFace>
      </div>
      <div v-if="builtinCards.length === 0" class="choice-empty">{{ t`暂无内置卡` }}</div>
    </ChoiceSectionCard>

    <!-- 当前角色主题池 -->
    <ChoiceSectionCard title="当前角色主题池" icon="fa-solid fa-user">
      <template v-if="currentPoolDefs.length">
        <div class="choice-lib-pool-actions">
          <p class="choice-lib-hint">{{ t`已懒生成并固定此角色的主题卡池；池内卡随开卡包反复掉落。` }}</p>
          <button class="menu_button choice-lib-gen-btn" :disabled="generating" @click="onRegeneratePool">
            <i class="fa-solid fa-rotate"></i>{{ generating ? t`生成中…` : t`重新生成` }}
          </button>
        </div>
        <div class="choice-lib-cards">
          <CardFace
            v-for="c in currentPoolDefs"
            :key="c.id"
            :card="c"
            :owned="ownedMap[c.id]"
            :state="cardState(c)"
            :obscured="!isCollected(c)"
            :previously-owned="isDismantled(c)"
          />
        </div>
      </template>
      <div v-else class="choice-empty">
        <i class="fa-solid fa-wand-magic-sparkles"></i>
        <div>
          {{ t`当前角色主题池尚未生成。可手动立即生成，或游玩中幸运数/购买开卡包时按角色世界观懒生成并固定。` }}
        </div>
        <button class="menu_button choice-lib-gen-btn" :disabled="generating" @click="onGeneratePool">
          <i class="fa-solid fa-wand-magic-sparkles"></i>{{ generating ? t`生成中…` : t`立即生成主题卡` }}
        </button>
      </div>
    </ChoiceSectionCard>

    <!-- 其余角色主题池（浏览） -->
    <ChoiceSectionCard v-if="otherPools.length" title="其他角色主题池" icon="fa-solid fa-users">
      <div v-for="pool in otherPools" :key="pool.character_id" class="choice-lib-pool-group">
        <h5 class="choice-lib-pool-title">{{ t`角色主题池 · ${pool.character_id}` }}</h5>
        <div class="choice-lib-cards">
          <CardFace
            v-for="c in poolDefs(pool)"
            :key="c.id"
            :card="c"
            :owned="ownedMap[c.id]"
            :state="cardState(c)"
            :obscured="!isCollected(c)"
            :previously-owned="isDismantled(c)"
          />
        </div>
      </div>
    </ChoiceSectionCard>
  </div>
</template>

<script setup lang="ts">
import { BUILTIN_CARDS } from '@/core/cards-builtin';
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
import CardFace from '@/components/CardFace.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { CARD_STAR_COLOR, CARD_STAR_LABEL, CARD_STAR_ORDER } from '@/core/cards-meta';
import {
  collectedCardIds,
  cardTrophyList,
  cardSetProgress,
  buyPack,
  currentCardConfigId,
  clearCharacterPool,
} from '@/core/cards';
import { generateCharacterPool } from '@/core/cards-ai';
import { getStCharacter } from '@/core/st-character';
import { openCardPack } from '@/core/card-pack-state';
import { CARD_PACK_PRICE } from '@/core/cards-constraints';
import toastr from 'toastr';
import type { Card, CardStar } from '@/type/settings';

const gs = useGlobalSettingsStore();

/** 主题池生成中（防连点/防「立即生成」与「重新生成」互撞） */
const generating = ref(false);

/** 手动生成当前角色主题池（测试/手动获取用）：await 到 AI 返回并 toastr 反馈张数或失败原因。 */
const onGeneratePool = async () => {
  const cid = gs.currentCharacterId;
  if (cid == null) {
    toastr.warning('请先打开一个角色的聊天再生成主题卡。');
    return;
  }
  if (generating.value) return;
  generating.value = true;
  try {
    const n = await generateCharacterPool(String(cid));
    if (n > 0) {
      const name = getStCharacter(String(cid))?.name ?? '';
      toastr.success(`已生成 ${n} 张「${name}」主题卡：${n} 张（收集完毕，卡面已标注角色归属）。`);
    } else {
      toastr.warning('未生成主题卡——请确认已在「API 设置」配置副 API，且本次生成结果有效。');
    }
  } finally {
    generating.value = false;
  }
};

/** 重新生成当前角色主题池：先清空现有池（删除已收集的该角色主题卡）再重出，供测试/换新风格。 */
const onRegeneratePool = async () => {
  const cid = gs.currentCharacterId;
  if (cid == null || generating.value) return;
  if (
    !confirm(
      `将清空当前角色主题池并重新生成（已收集的 ${currentPoolDefs.value.length} 张该角色主题卡会被删除），确定继续？`,
    )
  )
    return;
  clearCharacterPool(String(cid));
  await onGeneratePool();
};

/** 行动币开卡包（原「兑换与任务」页收编到页顶）：不足额按钮置灰。 */
const onBuyPack = () => {
  const r = buyPack(currentCardConfigId());
  if (!r.ok) {
    toastr.warning(r.errors.join('；'));
    return;
  }
  openCardPack(r.offer!, 'shop');
};

const builtinCards = computed<Card[]>(() => [...BUILTIN_CARDS]);
const ownedMap = computed(() => gs.settings.card_collection);
/** 历史获得集合（曾获得 ∪ 当前持有）：进度/成就/内置卡库基于它——分解只移除持有、不抹掉图鉴。 */
const collected = computed(() => collectedCardIds());
const trophies = computed(() => cardTrophyList());
const setProgress = computed(() => cardSetProgress());

/** 套装收集进度百分比（卡库套装收藏区进度条）。 */
const setPct = (s: { owned: number; total: number }): string =>
  s.total ? `${Math.round((s.owned / s.total) * 100)}%` : '0%';

/** 卡面状态：未拥有置灰 disabled；其余 normal。 */
const cardState = (c: Card): 'normal' | 'disabled' => {
  return ownedMap.value[c.id] ? 'normal' : 'disabled';
};

/** 是否已收集（历史获得过）：未收集才模糊遮盖。 */
const isCollected = (c: Card): boolean => collected.value.has(c.id);
/** 曾获得但当前未持有（旧版分解遗留）：区分「曾获得」与「从未获得」的展示。 */
const isDismantled = (c: Card): boolean => !ownedMap.value[c.id] && !!gs.settings.card_obtained[c.id];

const starCounts = computed<Record<CardStar, number>>(() => {
  const out: Record<CardStar, number> = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const def of allDefs.value) {
    if (collected.value.has(def.id)) out[def.star] += 1;
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
const ownedCount = computed(() => allDefs.value.filter(d => collected.value.has(d.id)).length);

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

/* 行动币 + 开卡包入口（原商店功能收编到收藏页顶部） */
.choice-lib-coins {
  color: var(--choice-text);
  margin-left: auto;
}

.choice-pack-buy {
  color: var(--choice-primary);
  background: color-mix(in srgb, var(--choice-primary) 12%, transparent 88%);
}

.choice-pack-buy:hover:not(:disabled) {
  color: var(--choice-primary);
  background: color-mix(in srgb, var(--choice-primary) 22%, transparent 78%);
}

.choice-pack-buy:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.choice-lib-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 0 var(--choice-space-2);
}

/* 主题池区操作行：提示文案 + 生成/重新生成按钮横向排布 */
.choice-lib-pool-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}
.choice-lib-pool-actions .choice-lib-hint {
  margin: 0;
  flex: 1 1 auto;
}
.choice-lib-gen-btn {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.choice-lib-gen-btn[disabled] {
  opacity: 0.6;
  cursor: wait;
}

.choice-lib-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--choice-space-3);
}

.choice-lib-triggers {
  font-size: var(--choice-text-2xs);
  color: var(--choice-text-muted);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

/* 成就 chip：未达成灰锁，达成高亮 */
.choice-lib-trophies {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-2);
}
.choice-lib-trophy {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  border: 1px solid var(--choice-border-strong);
  border-radius: 999px;
  padding: 2px var(--choice-space-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.choice-lib-trophy--done {
  color: var(--choice-color-success);
  border-color: var(--choice-color-success);
  background: color-mix(in srgb, var(--choice-color-success) 10%, transparent 90%);
}

/* 套装收藏：每套一行名称+进度+背景，集齐高亮 */
.choice-lib-sets {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}
.choice-lib-set {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-2) var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  background: var(--choice-bg-card);
}
.choice-lib-set--done {
  border-color: var(--choice-color-success);
}
.choice-lib-set-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
}
.choice-lib-set-name {
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.choice-lib-set-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  font-variant-numeric: tabular-nums;
}
.choice-lib-set-theme {
  margin: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}
.choice-lib-set-bar {
  height: 4px;
  border-radius: 999px;
  background: var(--choice-bg-element);
  overflow: hidden;
}
.choice-lib-set-bar i {
  display: block;
  height: 100%;
  background: var(--choice-primary);
  transition: width var(--choice-transition);
}
.choice-lib-set--done .choice-lib-set-bar i {
  background: var(--choice-color-success);
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
