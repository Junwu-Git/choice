<template>
  <div class="choice-card-deck">
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-table-cells"></i> {{ t`当前卡组` }}</h4>
      <p class="choice-deck-config">
        <span class="choice-cfg-chip" :title="t`装备位随生效条目池配置切换`">
          <i class="fa-solid fa-tag"></i>{{ t`当前配置` }}：{{ configId }}
        </span>
        <span v-if="autoDeck" class="choice-deck-auto" :title="t`自动从已拥有卡填满 4 槽，省去手动编组`">
          <i class="fa-solid fa-wand-magic-sparkles"></i>{{ t`自动编组中` }}
        </span>
        <span class="choice-deck-count">{{ t`已装备` }} {{ filledCount }}/{{ fixedSlots.length }}</span>
      </p>
      <p class="choice-deck-hint">{{ t`角色装备区：4 个类型槽位环绕，各装对应类型 1 张；整组受星级预算（3★≤2/4★≤1/5★≤1）约束。` }}</p>
      <label class="choice-toggle">
        <input type="checkbox" :checked="autoDeck" @change="onAutoToggle" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`自动编组` }}</strong>
          <small>{{ autoDeck ? t`已自动填满 4 槽——点任意槽位可改为手动调整` : t`手动编辑卡组（自动编组已关）` }}</small>
        </span>
      </label>

      <div class="choice-paperdoll">
        <!-- 中央通用半身像（不用角色头像） -->
        <div class="choice-paperdoll-bust" aria-hidden="true">
          <i class="fa-solid fa-user"></i>
        </div>

        <!-- 环绕槽位：祝福=顶 / 武器=左 / 法术=右 / 试炼=底 -->
        <div
          v-for="slot in slotViews"
          :key="slot.type"
          class="choice-doll-slot"
          :class="[
            `choice-doll-slot--${slotPos[slot.type]}`,
            { 'choice-doll-slot--empty': !slot.card, 'choice-doll-slot--broken': slot.card && brokenOf(slot.card_id) },
          ]"
          :style="slot.card ? { borderColor: CARD_STAR_COLOR[slot.card.star] } : undefined"
          :title="slot.card ? t`${slot.card.name}：点击更换` : t`点击装备 ${CARD_TYPE_LABEL[slot.type]}卡`"
        >
          <button class="choice-doll-slot__btn" @click="openPicker(slot.type)">
            <i class="choice-doll-slot__icon" :class="CARD_TYPE_ICON[slot.type]"></i>

            <template v-if="slot.card">
              <span class="choice-doll-slot__name">{{ slot.card.name }}</span>
              <span class="choice-doll-slot__meta">
                <span class="choice-doll-slot__lv">Lv.{{ ownedMap[slot.card_id]?.level }}</span>
                <span class="choice-doll-slot__dur"
                  ><i class="fa-solid fa-shield-halved"></i>{{ ownedMap[slot.card_id]?.durability }}/{{ ownedMap[slot.card_id]?.max_durability }}</span
                >
              </span>
              <span v-if="brokenOf(slot.card_id)" class="choice-doll-slot__broken">{{ t`损坏` }}</span>
            </template>
            <template v-else>
              <span class="choice-doll-slot__label">{{ CARD_TYPE_LABEL[slot.type] }}</span>
              <small class="choice-doll-slot__add">{{ t`点击装备` }}</small>
            </template>
          </button>

          <!-- 已装槽的卸下 -->
          <button v-if="slot.card" class="choice-doll-slot__unequip" :title="t`卸下`" @click.stop="onUnequip(slot.card_id)">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>
    </div>

    <CardSlotPicker
      v-if="activeSlotType"
      :type="activeSlotType"
      :config-id="configId"
      @close="activeSlotType = null"
    />
  </div>
</template>

<script setup lang="ts">
import CardSlotPicker from '@/components/CardSlotPicker.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { cardDefById, isCardBroken, currentCardConfigId, unequipCard, resolveDeckSlots, autoDeckCards } from '@/core/cards';
import { CARD_STAR_COLOR, CARD_TYPE_ICON, CARD_TYPE_LABEL } from '@/core/cards-meta';
import type { CardType } from '@/type/settings';

const gs = useGlobalSettingsStore();

const configId = computed(() => currentCardConfigId());
const ownedMap = computed(() => gs.settings.card_collection);

/** 固定槽（按 CARD_SLOT_TYPES 权威顺序规整），card_id='' 为空槽 */
const fixedSlots = computed(() => resolveDeckSlots(configId.value));
const filledCount = computed(() => fixedSlots.value.filter(s => s.card_id).length);

/** 供渲染的槽视图：把卡已装但定义缺失的异常一并归为占位 */
const slotViews = computed(() =>
  fixedSlots.value.map(s => ({ type: s.type, card_id: s.card_id, card: s.card_id ? cardDefById(s.card_id) : undefined })),
);

/** 类型 → 纸娃娃环绕方位（仅展示映射；数据顺序仍以 CARD_SLOT_TYPES 为准） */
const slotPos: Record<CardType, 'top' | 'left' | 'right' | 'bottom'> = {
  blessing: 'top',
  weapon: 'left',
  spell: 'right',
  trial: 'bottom',
};

const brokenOf = (cardId: string) => isCardBroken(ownedMap.value[cardId]);

/** 当前要挑选的槽类型；非 null 时挂载 CardSlotPicker */
const activeSlotType = ref<CardType | null>(null);

/** 自动编组态（读全局设置；auto 时 resolveDeckSlots 已返回自动结果） */
const autoDeck = computed(() => gs.settings.auto_deck_enabled);

/** 自动→手动：把当前自动编组结果快照进存储（手动编辑起点）。仅在 auto 态调用，幂等。 */
const snapshotFromAuto = () => {
  if (!autoDeck.value) return;
  const slots = autoDeckCards();
  (gs.settings.card_decks[configId.value] ??= { config_id: configId.value, slots: [] }).slots = slots;
};

/** 自动编组开关：关时先快照当前自动结果再切手动；开时无需快照（auto 直接接管展示）。 */
const onAutoToggle = (e: Event) => {
  if ((e.target as HTMLInputElement).checked) {
    gs.settings.auto_deck_enabled = true;
  } else {
    snapshotFromAuto();
    gs.settings.auto_deck_enabled = false;
  }
};

/** 点槽位：auto 下先切到手动（快照当前自动结果）再选卡，避免「手动改了 auto 无视」的困惑。 */
const openPicker = (type: CardType) => {
  snapshotFromAuto();
  gs.settings.auto_deck_enabled = false;
  activeSlotType.value = type;
};

/** 卸下：auto 下同样先切手动，再对快照槽位卸卡。 */
const onUnequip = (cardId: string) => {
  snapshotFromAuto();
  gs.settings.auto_deck_enabled = false;
  unequipCard(configId.value, cardId);
};
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
  margin: 0 0 var(--choice-space-1);
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

.choice-deck-auto {
  font-size: var(--choice-text-xs);
  color: var(--choice-color-success);
  background: var(--choice-bg-element);
  border-radius: 999px;
  padding: 2px var(--choice-space-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-left: var(--choice-space-2);
}

.choice-deck-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  margin: 0 0 var(--choice-space-2);
}

/* 角色装备区：3×3 grid，中央半身像 + 四向环绕槽位（响应式，无绝对定位错位风险） */
.choice-paperdoll {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: 1fr 1.7fr 1fr;
  grid-template-areas:
    '. top .'
    'left bust right'
    '. bottom .';
  gap: var(--choice-space-3);
  align-items: center;
  justify-items: stretch;
  width: 100%;
  max-width: 640px;
  margin: 0 auto;
}

.choice-doll-slot--top {
  grid-area: top;
}
.choice-doll-slot--left {
  grid-area: left;
}
.choice-doll-slot--right {
  grid-area: right;
}
.choice-doll-slot--bottom {
  grid-area: bottom;
}

.choice-paperdoll-bust {
  grid-area: bust;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--choice-radius-lg);
  background: radial-gradient(circle at 50% 24%, var(--choice-bg-element), transparent 72%);
  color: var(--choice-text-muted);
  font-size: 100px;
  user-select: none;
}

/* 槽位物品框：方形容器，星级色描边 */
.choice-doll-slot {
  position: relative;
  min-width: 0;
  aspect-ratio: 1 / 1;
  border-radius: var(--choice-radius-md);
  border: 1.5px solid var(--choice-border-strong);
  background: var(--choice-bg-card);
  overflow: hidden;
  transition:
    border-color var(--choice-transition),
    transform var(--choice-transition-motion),
    box-shadow var(--choice-transition);
}

.choice-doll-slot:hover {
  transform: translateY(-2px);
  box-shadow: 0 2px 10px var(--choice-bg-active);
}

.choice-doll-slot__btn {
  width: 100%;
  height: 100%;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2);
  text-align: center;
}

.choice-doll-slot__icon {
  font-size: 40px;
}

.choice-doll-slot__name {
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-text);
  line-height: 1.2;
  max-width: 100%;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.choice-doll-slot__meta {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  flex-wrap: wrap;
  justify-content: center;
}

.choice-doll-slot__dur {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-variant-numeric: tabular-nums;
}

.choice-doll-slot__label {
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-text);
}

.choice-doll-slot__add {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-doll-slot--empty {
  color: var(--choice-text-muted);
  border-style: dashed;
}

.choice-doll-slot--empty:hover {
  border-style: solid;
  border-color: var(--choice-border-active);
  color: var(--choice-text);
}

.choice-doll-slot--broken {
  filter: grayscale(0.85);
  opacity: 0.72;
}

.choice-doll-slot__broken {
  font-size: var(--choice-text-xs);
  font-weight: bold;
  color: var(--choice-color-error);
}

/* 卸下按钮：右上角小 X */
.choice-doll-slot__unequip {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: var(--choice-bg-element);
  color: var(--choice-text-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-doll-slot__unequip:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-color-error);
}
</style>