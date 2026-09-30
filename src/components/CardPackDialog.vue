<template>
  <Teleport to="body">
    <div v-if="cardPack" class="choice-cardpack-overlay" @click.self="closeCardPack()">
      <div class="choice-cardpack-dialog">
        <div class="choice-cardpack-header">
          <span class="choice-cardpack-title">
            <i class="fa-solid fa-gift"></i> {{ t`开卡包` }}
          </span>
          <button class="choice-cardpack-close" :title="t`关闭`" @click="closeCardPack()">&times;</button>
        </div>
        <p class="choice-cardpack-tip">
          <template v-if="hasRare"><i class="fa-solid fa-star"></i> {{ t`稀有卡出没——抓住它！` }}</template>
          <template v-else>{{ t`选 1 张纳入收藏；选到已拥有的卡会自动折算行动币。` }}</template>
        </p>
        <div class="choice-cardpack-cards">
          <div
            v-for="(opt, i) in (cardPack?.offer.options ?? [])"
            :key="opt.card.id"
            class="choice-cardpack-slot"
            :class="{ 'choice-cardpack-slot--rare': isHighStar(opt.card.star) }"
          >
            <CardFace
              :card="opt.card"
              :selectable="true"
              :title="cardLine(opt.card)"
              @select="onPick(i)"
            />
          </div>
        </div>
        <div class="choice-cardpack-footer">
          <button class="menu_button" @click="closeCardPack()">{{ t`稍后再选` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import CardFace from '@/components/CardFace.vue';
import { cardPack, closeCardPack } from '@/core/card-pack-state';
import { applyPackSelection } from '@/core/cards';
import { cardLine } from '@/core/cards-meta';
import { isHighStar } from '@/core/cards-constraints';

/** 本次 offer 是否含 4/5 星稀有卡（用于「稀有出没」提示 + 闪光动画）。 */
const hasRare = computed(() => cardPack.value?.offer.options.some(o => isHighStar(o.card.star)) ?? false);

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
  width: 560px;
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
  grid-template-columns: repeat(3, 1fr);
  gap: var(--choice-space-4);
  align-items: start;
}

/* 卡槽包装：让 CardFace 撑满格 + 相对定位挂稀有闪光 */
.choice-cardpack-slot {
  position: relative;
  display: flex;
  min-width: 0;
}

/* 稀有卡开出：轻微脉冲 + 一道亮光扫过（纯视觉彩蛋，零操作） */
.choice-cardpack-slot--rare {
  animation: choice-pack-burst 0.9s ease-out;
}
.choice-cardpack-slot--rare::after {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 3;
  background: linear-gradient(105deg, transparent 42%, rgba(255, 255, 255, 0.35) 50%, transparent 58%);
  transform: translateX(-130%);
  animation: choice-pack-shine 0.9s ease-in forwards;
}
@keyframes choice-pack-burst {
  0% {
    transform: scale(1);
  }
  30% {
    transform: scale(1.06);
  }
  100% {
    transform: scale(1);
  }
}
@keyframes choice-pack-shine {
  0% {
    transform: translateX(-130%);
  }
  100% {
    transform: translateX(130%);
  }
}

.choice-cardpack-footer {
  display: flex;
  justify-content: flex-end;
}

@media (max-width: 480px) {
  /* 窄屏 3 列挤爆高度：退成 1 列流式，保留卡面可读 */
  .choice-cardpack-cards {
    grid-template-columns: 1fr;
    gap: var(--choice-space-3);
  }
}
</style>