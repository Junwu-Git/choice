<template>
  <div ref="fieldEl" class="choice-field" :class="{ 'is-compact': isCompact }">
    <label v-if="label" class="choice-field-label">{{ label }}</label>
    <div class="choice-field-control">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useCompactLayout } from './useCompactLayout';

withDefaults(defineProps<{
  label?: string;
}>(), {});

const fieldEl = ref<HTMLElement | null>(null);
const { isCompact } = useCompactLayout(fieldEl);
</script>

<style scoped>
.choice-field {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-field.is-compact {
  flex-direction: column;
  align-items: flex-start;
}

.choice-field-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  white-space: nowrap;
  flex-shrink: 0;
  min-width: 60px;
}

.choice-field.is-compact .choice-field-label {
  min-width: unset;
}

.choice-field-control {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  flex: 1;
}
</style>