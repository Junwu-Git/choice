<template>
  <div class="choice-card-editor">
    <!-- 页壳顶部：总开关只在默认的「卡组」子区显示，避免每个卡牌子区重复 -->
    <div v-if="area === 'deck'" class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-chess-knight"></i> {{ t`卡牌系统` }}</h4>
      <div class="choice-behavior-grid">
        <label class="choice-toggle">
          <input v-model="gs.settings.card_enabled" type="checkbox" @change="onEnableToggle" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`启用卡牌` }}</strong>
            <small>{{ t`判定叠加可装备效果卡、幸运数开卡包、行动币收支；关闭则与旧版完全一致` }}</small>
          </span>
        </label>
        <!-- 依赖提示：卡牌的判定叠加/触发/行动币/幸运开包全挂在骰子判定分支内，
             骰子未开时整套卡牌静默无效（新手「开了卡牌没反应」的首要原因） -->
        <p v-if="gs.settings.card_enabled && !gs.settings.dice.enabled" class="choice-card-deps-hint">
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{
            t`卡牌触发、行动币与幸运开包都依赖骰子判定——当前骰子判定未启用，卡牌不会生效。请在「生成设置 → 骰子判定」开启。`
          }}</span>
        </p>
        <!-- 互斥提示：骰式表达式路径不走卡牌管线（三处判定/预览/生成注入同门控），
             骰子与卡牌都开但选了骰式时卡牌静默停摆，与「骰子未开」同样需要显式告知 -->
        <p
          v-else-if="gs.settings.dice.enabled && gs.settings.dice.allow_formula"
          class="choice-card-deps-hint"
        >
          <i class="fa-solid fa-triangle-exclamation"></i>
          <span>{{
            t`骰式表达式判定与卡牌互斥——当前骰式开启时卡触发、行动币与幸运开包不生效；如需卡牌玩法请在「生成设置 → 骰子判定」关闭骰式表达式。`
          }}</span>
        </p>
      </div>
    </div>

    <CardLibrary v-if="area === 'library'" />
    <CardCollection v-else-if="area === 'collection'" />
    <CardDeckEditor v-else-if="area === 'deck'" />
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import { ensureStarterCards, ensureCharacterPool } from '@/core/cards';
import toastr from 'toastr';
import CardLibrary from '@/components/CardLibrary.vue';
import CardCollection from '@/components/CardCollection.vue';
import CardDeckEditor from '@/components/CardDeckEditor.vue';

defineProps<{ area: 'library' | 'deck' | 'collection' }>();

const gs = useGlobalSettingsStore();

/** 启用卡牌时发放新手 starter + 触发角色主题池懒生成（判定/购买入口也有双保险，
 *  这里让启用即开始后台生成，无需等幸运命中）。骰子未开则整套卡牌静默无效，
 *  给出一次性指引（页壳另有常驻提示行）。 */
const onEnableToggle = () => {
  if (gs.settings.card_enabled) {
    ensureStarterCards();
    ensureCharacterPool();
    if (!gs.settings.dice.enabled) {
      toastr.warning(t`卡牌效果依赖骰子判定——请在「生成设置 → 骰子判定」启用，否则卡牌不会生效`);
    }
  }
};
</script>

<style scoped>
.choice-card-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-4);
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--choice-space-2);
}

/* 卡牌×骰子依赖提示行：与开关同区常驻，随 dice.enabled 显隐 */
.choice-card-deps-hint {
  margin: 0;
  font-size: var(--choice-text-xs);
  line-height: 1.5;
  color: var(--choice-color-warning, var(--choice-color-error));
  display: flex;
  align-items: flex-start;
  gap: 6px;
}

.choice-card-deps-hint i {
  flex: 0 0 auto;
  margin-top: 2px;
}
</style>
