<template>
  <Teleport to="body">
    <div v-if="cardPack" class="choice-cardpack-overlay" @click.self="closeCardPack()">
      <div class="choice-cardpack-dialog">
        <div class="choice-cardpack-header">
          <span class="choice-cardpack-title"> <i class="fa-solid fa-gift"></i> {{ t`开卡包` }} </span>
          <span v-if="cardPack.offer.pityGuaranteed" class="choice-cardpack-pity">
            <i class="fa-solid fa-shield-halved"></i>{{ t`保底已触发` }}
          </span>
          <button class="choice-cardpack-close" :title="t`关闭`" @click="closeCardPack()">&times;</button>
        </div>
        <p class="choice-cardpack-tip">{{ t`选 1 张纳入收藏；抽中已拥有/损坏卡将升级并修复耐久。` }}</p>
        <div class="choice-cardpack-cards">
          <button
            v-for="(opt, i) in cardPack?.offer.options ?? []"
            :key="opt.card.id"
            class="choice-cardpack-card"
            :class="`choice-card-star--${opt.card.star}`"
            @click="onPick(i)"
          >
            <span class="choice-cardpack-card-star">{{ CARD_STAR_LABEL[opt.card.star] }}</span>
            <span class="choice-cardpack-card-type">{{ CARD_TYPE_LABEL[opt.card.type] }}</span>
            <strong class="choice-cardpack-card-name">{{ opt.card.name }}</strong>
            <span class="choice-cardpack-card-line">{{ cardLine(opt.card) }}</span>
            <span v-if="opt.upgrade" class="choice-cardpack-card-upgrade">
              <i class="fa-solid fa-arrow-up"></i>{{ t`已拥有·升级+修复` }}
            </span>
          </button>
        </div>
        <div class="choice-cardpack-footer">
          <button class="menu_button" @click="closeCardPack()">{{ t`稍后再选` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { cardPack, closeCardPack } from '@/core/card-pack-state';
import { applyPackSelection } from '@/core/cards';
import { CARD_STAR_LABEL, CARD_TYPE_LABEL, cardLine } from '@/core/cards-meta';

const onPick = (idx: number) => {
  const p = cardPack.value;
  if (!p) return;
  applyPackSelection(p.offer, idx, p.via);
  closeCardPack();
};
</script>

<style scoped>
.choice-cardpack-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-dialog);
  background: var(--choice-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-cardpack-dialog {
  width: 520px;
  max-width: 94vw;
  max-height: 86dvh;
  overflow: auto;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
  padding: var(--choice-space-4);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
}

.choice-cardpack-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-cardpack-title {
  font-size: var(--choice-text-lg);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex: 1;
}

.choice-cardpack-pity {
  font-size: var(--choice-text-xs);
  color: var(--choice-warning);
  border: 1px solid var(--choice-warning);
  border-radius: 999px;
  padding: 2px var(--choice-space-2);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.choice-cardpack-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
}

.choice-cardpack-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-cardpack-tip {
  margin: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-cardpack-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--choice-space-2);
}

.choice-cardpack-card {
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  padding: var(--choice-space-3);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  align-items: flex-start;
  text-align: left;
  cursor: pointer;
  position: relative;
  transition:
    transform var(--choice-transition),
    border-color var(--choice-transition),
    box-shadow var(--choice-transition);
}

.choice-cardpack-card:hover {
  transform: translateY(-2px);
}

.choice-cardpack-card-star {
  font-size: var(--choice-text-xs);
  font-weight: bold;
  padding: 1px var(--choice-space-2);
  border-radius: 999px;
}

.choice-cardpack-card-type {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-cardpack-card-name {
  font-size: var(--choice-text-base);
  color: var(--choice-text);
}

.choice-cardpack-card-line {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  line-height: 1.4;
}

.choice-cardpack-card-upgrade {
  font-size: var(--choice-text-xs);
  color: var(--choice-primary);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: auto;
}

.choice-cardpack-footer {
  display: flex;
  justify-content: flex-end;
}
</style>
