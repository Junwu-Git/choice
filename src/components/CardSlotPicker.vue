<template>
  <Teleport to="body">
    <div class="choice-slotpicker-overlay" @click.self="emit('close')">
      <div class="choice-slotpicker-dialog">
        <div class="choice-slotpicker-header">
          <span class="choice-slotpicker-title">
            <i :class="CARD_TYPE_ICON[type]"></i>{{ t`装备 ${CARD_TYPE_LABEL[type]}卡` }}
          </span>
          <button class="choice-slotpicker-close" :title="t`关闭`" @click="emit('close')">&times;</button>
        </div>
        <p class="choice-slotpicker-tip">{{ t`仅列出该类型已拥有的卡；星级预算超限项置灰。` }}</p>

        <div v-if="candidates.length" class="choice-slotpicker-cards">
          <div v-for="c in candidates" :key="c.id" class="choice-slotpicker-card">
            <CardFace :card="c" :owned="ownedMap[c.id]" :state="isCurrent(c) ? 'disabled' : canEquip(c) ? 'normal' : 'disabled'">
              <template #footer>
                <span v-if="isCurrent(c)" class="choice-slotpicker-current">{{ t`已装备` }}</span>
                <button
                  v-else
                  class="choice-btn-sm"
                  :disabled="!canEquip(c)"
                  :title="canEquip(c) ? '' : equipReason(c)"
                  @click="onEquip(c)"
                >
                  {{ t`装备` }}
                </button>
              </template>
            </CardFace>
          </div>
        </div>
        <div v-else class="choice-empty">
          <i class="fa-solid fa-layer-group"></i>
          <span>{{ t`该类型暂无可用卡——通过开卡包/幸运数掉落获得后即可装备。` }}</span>
        </div>

        <div class="choice-slotpicker-footer">
          <button class="menu_button" @click="() => emit('close')">{{ t`取消` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import CardFace from '@/components/CardFace.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { canEquipInDeck, cardDefById, equipCard, resolveDeckSlots } from '@/core/cards';
import { CARD_TYPE_ICON, CARD_TYPE_LABEL } from '@/core/cards-meta';
import toastr from 'toastr';
import type { Card, CardType } from '@/type/settings';

const props = defineProps<{ type: CardType; configId: string }>();
const emit = defineEmits<{ close: [] }>();

const gs = useGlobalSettingsStore();
const ownedMap = computed(() => gs.settings.card_collection);

/** 当前该类型槽已装的卡 id（resolveDeckSlots 按 CARD_SLOT_TYPES 找） */
const currentId = computed(() => resolveDeckSlots(props.configId).find(s => s.type === props.type)?.card_id ?? '');

const isCurrent = (c: Card): boolean => c.id === currentId.value;

/** 该类型已拥有的卡。用 cardDefById 解析（含内置卡；card_definitions 只存角色池卡） */
const candidates = computed<Card[]>(() =>
  Object.values(gs.settings.card_collection)
    .map(o => cardDefById(o.card_id))
    .filter((d): d is Card => !!d && d.type === props.type),
);

/** 4 装备槽走 canEquipInDeck 星级预算校验。 */
const canEquip = (c: Card): boolean => canEquipInDeck(props.configId, c).ok;
const equipReason = (c: Card): string => canEquipInDeck(props.configId, c).errors.join('；');

const onEquip = (c: Card) => {
  const r = equipCard(props.configId, c.id);
  if (!r.ok) toastr.error(r.errors.join('；'));
  else emit('close');
};
</script>

<style scoped>
.choice-slotpicker-overlay {
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

.choice-slotpicker-dialog {
  width: 560px;
  max-width: 94vw;
  max-height: 86dvh;
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
  padding: var(--choice-space-4);
}

.choice-slotpicker-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-slotpicker-title {
  font-size: var(--choice-text-lg);
  font-weight: bold;
  color: var(--choice-text);
  flex: 1;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-slotpicker-close {
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

.choice-slotpicker-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-slotpicker-tip {
  margin: 0;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-slotpicker-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: var(--choice-space-3);
  overflow: auto;
}

.choice-slotpicker-card {
  min-width: 0;
}

.choice-slotpicker-current {
  font-size: var(--choice-text-2xs);
  font-weight: bold;
  color: var(--choice-color-success);
}

.choice-slotpicker-footer {
  display: flex;
  justify-content: flex-end;
}
</style>