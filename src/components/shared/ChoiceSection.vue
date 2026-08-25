<template>
  <div class="choice-section">
    <div
      v-if="title"
      class="choice-section-header"
      :class="{ 'is-clickable': collapsible }"
      @click="collapsible && toggle()"
    >
      <i v-if="icon" :class="icon" class="choice-section-icon"></i>
      <span class="choice-section-title">{{ title }}</span>
      <i
        v-if="collapsible"
        class="choice-section-chevron fa-solid"
        :class="collapsed ? 'fa-chevron-right' : 'fa-chevron-down'"
      ></i>
    </div>
    <div v-show="!collapsed" class="choice-section-body">
      <slot></slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    title?: string;
    icon?: string;
    collapsible?: boolean;
    defaultOpen?: boolean;
  }>(),
  {
    defaultOpen: true,
  },
);

const collapsed = ref(!props.defaultOpen);

function toggle() {
  collapsed.value = !collapsed.value;
}
</script>

<style scoped>
.choice-section {
  display: flex;
  flex-direction: column;
}

.choice-section-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) 0;
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-sm);
  font-weight: 600;
  user-select: none;
}

.choice-section-header.is-clickable {
  cursor: pointer;
}

.choice-section-header.is-clickable:hover {
  color: var(--choice-text);
}

.choice-section-icon {
  color: var(--choice-primary);
  width: var(--choice-space-4);
  text-align: center;
}

.choice-section-title {
  flex: 1;
}

.choice-section-chevron {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  transition: transform var(--choice-transition);
}

.choice-section-body {
  display: flex;
  flex-direction: column;
}
</style>
