<template>
  <div class="choice-card" :class="{ 'is-expanded': expanded, 'is-selected': selected }">
    <div class="choice-card-summary" @click="$emit('toggleExpand')">
      <slot name="summary"></slot>
      <div class="choice-card-summary-right">
        <slot name="badges"></slot>
        <div class="choice-card-actions">
          <slot name="actions"></slot>
        </div>
      </div>
    </div>
    <div v-if="expanded" class="choice-card-details">
      <slot name="details"></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  expanded?: boolean;
  selected?: boolean;
}>();

defineEmits<{
  toggleExpand: [];
}>();
</script>

<style scoped>
.choice-card {
  background: var(--choice-bg-card);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  box-shadow: inset 0 1px 0 var(--choice-frost-line);
  overflow: hidden;
  transition: border-color var(--choice-transition);
}

.choice-card.is-selected {
  border-color: var(--choice-border-active);
  background: var(--choice-bg-active);
}

.choice-card-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2);
  cursor: pointer;
  /* 走触控目标 token 而非写死：窄触屏由 theme.css 手机压缩块下调到 32px，
     桌面/平板维持 40px 行高 */
  min-height: var(--choice-tap-min);
}

.choice-card-summary:hover {
  background: var(--choice-bg-hover);
}

.choice-card-summary-right {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  flex-shrink: 0;
}

.choice-card-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-card-details {
  padding: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--choice-space-2);
}
</style>
