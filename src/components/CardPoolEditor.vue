<template>
  <div class="choice-card-editor">
    <!-- 页壳顶部：总开关只在默认的「卡组」子区显示，避免每个卡牌子区重复 -->
    <div v-if="area === 'deck'" class="choice-section">
      <h4 class="choice-section-title">
        <i class="fa-solid fa-chess-knight"></i> {{ t`卡牌系统` }}
      </h4>
      <div class="choice-behavior-grid">
        <label class="choice-toggle">
          <input v-model="gs.settings.card_enabled" type="checkbox" @change="onEnableToggle" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`启用卡牌` }}</strong>
            <small>{{ t`判定叠加可装备效果卡、幸运数开卡包、行动币收支；关闭则与旧版完全一致` }}</small>
          </span>
        </label>
      </div>
    </div>

    <CardLibrary v-if="area === 'library'" />
    <CardCollection v-else-if="area === 'collection'" />
    <CardDeckEditor v-else-if="area === 'deck'" />
    <CardShop v-else-if="area === 'shop'" />
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import { ensureStarterCards } from '@/core/cards';
import CardLibrary from '@/components/CardLibrary.vue';
import CardCollection from '@/components/CardCollection.vue';
import CardDeckEditor from '@/components/CardDeckEditor.vue';
import CardShop from '@/components/CardShop.vue';

defineProps<{ area: 'library' | 'deck' | 'shop' | 'collection' }>();

const gs = useGlobalSettingsStore();

/** 启用卡牌时发放新手 starter（判定入口也有双保险，这里用于开启开关的即时反馈）。 */
const onEnableToggle = () => {
  if (gs.settings.card_enabled) ensureStarterCards();
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
</style>
