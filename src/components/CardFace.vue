<template>
  <div
    class="choice-card-face"
    :class="{
      'choice-card-face--disabled': state === 'disabled',
      'choice-card-face--obscured': obscured,
      'choice-card-face--rare': isRare,
      'choice-card-face--selectable': selectable,
    }"
    :style="starVars"
    role="button"
    tabindex="-1"
    @click="onSelect"
    @keydown.enter.prevent="onSelect"
  >
    <div class="choice-card-face__frame">
      <!-- 墙面：星级色顶栏（星数 + 类型角标）。星级色来自 :style 注入的 --choice-card-star -->
      <div class="choice-card-face__top">
        <span class="choice-card-face__stars" :title="CARD_STAR_LABEL[card.star]">
          <i v-for="n in starN" :key="n" class="fa-solid fa-star"></i>
        </span>
        <span class="choice-card-face__type">{{ CARD_TYPE_LABEL[card.type] }}</span>
      </div>

      <!-- 装饰插画区：星级色渐变 + 类型图标水印 + 卡名叠加 -->
      <div class="choice-card-face__illu" :title="CARD_STAR_LABEL[card.star]">
        <i class="choice-card-face__illu-icon" :class="CARD_TYPE_ICON[card.type]"></i>
        <div class="choice-card-face__name">{{ card.name }}</div>
        <span
          v-if="!owned"
          class="choice-card-face__unowned-badge"
          :class="{ 'choice-card-face__unowned-badge--dismantled': previouslyOwned }"
        >
          <i :class="previouslyOwned ? 'fa-solid fa-scissors' : 'fa-solid fa-lock'"></i
          >{{ previouslyOwned ? t`曾获得` : t`未拥有` }}
        </span>
      </div>

      <!-- 效果区：套装徽标（如有）+ 触发行 + 效果行 + 可选叙事行 -->
      <div class="choice-card-face__meta">
        <div v-if="setName" class="choice-card-face__set">
          <i class="fa-solid fa-layer-group"></i>{{ t`套装` }}·{{ setName }}
        </div>
        <div v-else-if="characterName" class="choice-card-face__character" :title="t`${characterName} 主题池`">
          <i class="fa-solid fa-user"></i>{{ characterName }}
        </div>
        <div class="choice-card-face__line">触发：{{ triggerLabel(card.trigger) }}</div>
        <div class="choice-card-face__line">效果：{{ effectsLabel(card.effects) }}</div>
        <div v-if="card.narrative" class="choice-card-face__narrative">{{ card.narrative }}</div>
      </div>

      <!-- 页脚：持有态 + 动作插槽 -->
      <div class="choice-card-face__footer">
        <div class="choice-card-face__stats">
          <template v-if="owned">
            <span class="choice-card-face__owned"><i class="fa-solid fa-circle-check"></i>{{ t`已拥有` }}</span>
          </template>
          <span v-else class="choice-card-face__unowned">{{ previouslyOwned ? t`曾获得` : t`未拥有` }}</span>
        </div>
        <div v-if="$slots.footer" class="choice-card-face__actions" @click.stop>
          <slot name="footer" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  CARD_STAR_LABEL,
  CARD_TYPE_LABEL,
  CARD_TYPE_ICON,
  cardSetById,
  triggerLabel,
  effectsLabel,
} from '@/core/cards-meta';
import { isHighStar } from '@/core/cards-constraints';
import type { Card, CardOwned } from '@/type/settings';

const props = withDefaults(
  defineProps<{
    card: Card;
    owned?: CardOwned;
    /** normal 默认态（有 owned 显持有标记，无则「未拥有」）；disabled 半透明禁选。 */
    state?: 'normal' | 'disabled';
    /** 未获得卡的模糊遮盖（收藏页图鉴用）：看不清名称与效果、只留轮廓，制造收集悬念。
     *  仅影响视觉；不影响开包弹窗等需清晰展示候选的场景（它们不传本字段）。 */
    obscured?: boolean;
    /** 曾获得但当前未持有（旧版分解遗留数据）：与 obscured（从未获得）区分展示。 */
    previouslyOwned?: boolean;
    /** 整卡可点选（开包弹窗 3 选 1）：开启后根节点可点击并 emit 'select' */
    selectable?: boolean;
  }>(),
  { state: 'normal', selectable: false, obscured: false, previouslyOwned: false, owned: undefined },
);

defineSlots<{ footer?: () => unknown }>();
const emit = defineEmits<{ select: [] }>();

const starN = computed(() => Number(props.card.star) || 0);
const isRare = computed(() => isHighStar(props.card.star));
/** 套装名（card.set 对应 CARD_SETS；空套装不显示徽标） */
const setName = computed(() => cardSetById(props.card.set)?.name);
/** 角色主题卡归属名（source='character' 且 character_name 非空时显示，与套装徽标互斥） */
const characterName = computed(() => props.card.character_name || '');

const onSelect = () => {
  if (props.selectable) emit('select');
};

/** 星级色板注入：CardFace 内部统一经这两个 var 取色（边框/顶栏/渐变/辉光）。
 *  不在根上挂全局 .choice-card-star--N（那是判定行内 chip 的用途），避免左缘单色条干扰整卡边框。 */
const starVars = computed(() => ({
  '--choice-card-star': `var(--choice-star-${props.card.star})`,
  '--choice-card-star-soft': `var(--choice-star-${props.card.star}-soft)`,
}));
</script>

<style scoped>
.choice-card-face {
  --choice-card-star: var(--choice-star-1);
  --choice-card-star-soft: var(--choice-star-1-soft);
  /* 竖版卡牌卡面：固定 5/7 纵向比例（参考 63×88mm 卡牌），随所在列宽伸缩 */
  aspect-ratio: 5 / 7;
  border-radius: var(--choice-radius-md);
  border: 1px solid var(--choice-card-star);
  background: var(--choice-bg-card);
  overflow: hidden;
  display: flex;
  position: relative;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--choice-card-star) 18%, transparent 82%);
  transition:
    transform var(--choice-transition-motion),
    box-shadow var(--choice-transition);
}

/* 高星（4/5 星）带柔和辉光与亮边，强化稀有度 */
.choice-card-face--rare {
  border-width: 1px;
  box-shadow:
    0 0 0 1px var(--choice-card-star),
    0 4px 18px var(--choice-card-star-soft);
}

.choice-card-face:hover {
  transform: translateY(-2px);
}

.choice-card-face--disabled {
  opacity: 0.5;
  filter: saturate(0.6);
}

/* 未获得卡的模糊遮盖（收藏页图鉴）：只模糊卡面正文，保留卡边框/背景/星级色轮廓，
   让每张未拥有卡仍是一张独立可辨的「卡」——否则整片糊成一团、观感像整页模糊 */
.choice-card-face--obscured {
  cursor: default;
  user-select: none;
}
.choice-card-face--obscured .choice-card-face__frame {
  filter: blur(5px) saturate(0.3);
  opacity: 0.85;
}

.choice-card-face--selectable {
  cursor: pointer;
}

.choice-card-face--selectable:hover {
  box-shadow:
    0 0 0 1px var(--choice-card-star),
    0 6px 22px var(--choice-card-star-soft);
}

.choice-card-face__frame {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: var(--choice-space-1);
  gap: var(--choice-space-1);
}

/* 墙顶栏 */
.choice-card-face__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) var(--choice-space-2);
  border-radius: var(--choice-radius-sm);
  background: linear-gradient(
    180deg,
    var(--choice-card-star-soft),
    color-mix(in srgb, var(--choice-card-star-soft) 40%, transparent 60%)
  );
  color: var(--choice-card-star);
  font-size: var(--choice-text-2xs);
}

.choice-card-face__stars {
  display: inline-flex;
  gap: 2px;
  font-size: 10px;
  letter-spacing: -0.5px;
  color: var(--choice-card-star);
}

.choice-card-face__type {
  font-weight: bold;
  color: var(--choice-card-star);
}

/* 装饰插画区：相对定位放卡名/升级标，图标水印居中 */
.choice-card-face__illu {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--choice-radius-sm);
  background:
    radial-gradient(circle at 30% 20%, var(--choice-card-star-soft), transparent 70%),
    linear-gradient(
      135deg,
      var(--choice-card-star-soft),
      color-mix(in srgb, var(--choice-card-star-soft) 25%, transparent 75%)
    );
  overflow: hidden;
}

.choice-card-face__illu-icon {
  font-size: 46px;
  color: color-mix(in srgb, var(--choice-card-star) 42%, transparent 58%);
}

.choice-card-face__name {
  position: absolute;
  left: var(--choice-space-2);
  right: var(--choice-space-2);
  bottom: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-text);
  text-shadow: 0 1px 2px var(--choice-card-star-soft);
  line-height: 1.2;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* 未拥有角标：置于卡面左上，与已拥有态拉开视觉差距 */
.choice-card-face__unowned-badge {
  position: absolute;
  top: var(--choice-space-1);
  left: var(--choice-space-1);
  font-size: var(--choice-text-2xs);
  font-weight: bold;
  color: var(--choice-text-muted);
  background: color-mix(in srgb, var(--choice-bg-element) 82%, transparent 18%);
  border-radius: 999px;
  padding: 1px 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

/* 曾获得角标（旧版分解遗留数据的展示区分，v66 起无分解）：与「未拥有」区分的次级色 */
.choice-card-face__unowned-badge--dismantled {
  color: var(--choice-text-secondary);
  border: 1px dashed var(--choice-border-strong);
}

/* 效果区 */
.choice-card-face__meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: none;
  max-height: 40%;
  overflow: auto;
  padding: 0 var(--choice-space-1);
}

.choice-card-face__line {
  font-size: var(--choice-text-2xs);
  color: var(--choice-text-secondary);
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.choice-card-face__narrative {
  font-size: var(--choice-text-2xs);
  color: var(--choice-text-muted);
  font-style: italic;
  line-height: 1.4;
}

/* 套装徽标：卡面效果区首行，区分背景套组卡 */
.choice-card-face__set {
  font-size: var(--choice-text-2xs);
  color: var(--choice-accent, var(--choice-primary));
  font-weight: bold;
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 角色主题徽标：与套装徽标同位、互斥，区分主题卡归属哪个角色（多池混排时认得出） */
.choice-card-face__character {
  font-size: var(--choice-text-2xs);
  color: var(--choice-text-secondary);
  font-weight: 600;
  line-height: 1.4;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  opacity: 0.85;
}

/* 页脚 */
.choice-card-face__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-1);
  flex-wrap: wrap;
  padding: var(--choice-space-1) 0 0;
  border-top: 1px solid var(--choice-border);
}

.choice-card-face__stats {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-2xs);
  color: var(--choice-text-secondary);
  min-width: 0;
}

.choice-card-face__owned {
  color: var(--choice-color-success);
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.choice-card-face__unowned {
  color: var(--choice-text-muted);
}

.choice-card-face__actions {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}
</style>
