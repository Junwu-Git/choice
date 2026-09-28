<template>
  <div class="choice-card-editor">
    <!-- 页壳顶部：总开关 + 幸运数/抽卡数设置，常驻（所有卡牌子区可见） -->
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-chess-knight"></i> {{ t`卡牌系统` }}</h4>
      <div class="choice-behavior-grid">
        <label class="choice-toggle">
          <input v-model="gs.settings.card_enabled" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`启用卡牌` }}</strong>
            <small>{{ t`判定叠加可装备效果卡、幸运数开卡包、行动币收支；关闭则与旧版完全一致` }}</small>
          </span>
        </label>
      </div>
      <div class="choice-card-settings-row">
        <label class="choice-card-field">
          <span class="choice-card-field-label">{{ t`幸运数 (1-100)` }}</span>
          <input v-model.number="gs.settings.card_lucky_number" type="number" min="1" max="100" />
        </label>
        <label class="choice-card-field">
          <span class="choice-card-field-label">{{ t`开包张数` }}</span>
          <input v-model.number="gs.settings.card_pack_offer" type="number" min="2" max="5" />
        </label>
        <span class="choice-card-settings-note">
          <i
            class="fa-solid fa-circle-info"
            :title="t`判定恰巧掷中幸运数时触发开卡包；抽卡按稀有度权重抽卡库（内置+当前角色主题池），选 1 入收藏`"
          ></i>
        </span>
      </div>
    </div>

    <CardLibrary v-if="area === 'library'" />
    <CardDeckEditor v-else-if="area === 'deck'" />
    <CardShop v-else-if="area === 'shop'" />
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import CardLibrary from '@/components/CardLibrary.vue';
import CardDeckEditor from '@/components/CardDeckEditor.vue';
import CardShop from '@/components/CardShop.vue';

defineProps<{ area: 'library' | 'deck' | 'shop' }>();

const gs = useGlobalSettingsStore();
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

.choice-card-settings-row {
  display: flex;
  align-items: flex-end;
  gap: var(--choice-space-3);
  flex-wrap: wrap;
  margin-top: var(--choice-space-2);
}

.choice-card-field {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-card-field-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-card-field input {
  width: 90px;
}

.choice-card-settings-note {
  color: var(--choice-text-muted);
  padding-bottom: 4px;
}
</style>
