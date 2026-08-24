<template>
  <div class="choice-page-guide" :class="{ 'choice-page-guide--guide': type === 'guide', 'choice-page-guide--collapsed': !expanded }">
    <div class="choice-page-guide-header" @click="expanded = !expanded">
      <i :class="icon"></i>
      <span class="choice-page-guide-title">
        <slot name="title">{{ title }}</slot>
      </span>
      <i class="fa-solid" :class="expanded ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
    </div>
    <div v-show="expanded" class="choice-page-guide-body">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  pageId: string
  icon?: string
  title?: string
  type?: 'desc' | 'guide'
  defaultCollapsed?: boolean
}>(), {
  icon: 'fa-solid fa-circle-info',
  title: '',
  type: 'desc',
  defaultCollapsed: false,
});

const expanded = useStorage(`choice_pg_${props.pageId}`, !props.defaultCollapsed);
</script>

<style scoped>
.choice-page-guide {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-card);
  overflow: hidden;
  transition: border-color var(--choice-transition);
}

.choice-page-guide--guide {
  border-color: var(--choice-primary);
  background: linear-gradient(135deg, rgba(74, 144, 217, 0.04), rgba(74, 144, 217, 0.01));
}

.choice-page-guide-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  color: var(--choice-text-secondary);
  font-size: 12px;
  transition: color var(--choice-transition);
}

.choice-page-guide-header:hover {
  color: var(--choice-text);
}

.choice-page-guide--guide .choice-page-guide-header {
  color: var(--choice-primary);
}

.choice-page-guide-title {
  flex: 1;
  font-weight: 600;
}

.choice-page-guide-body {
  padding: 0 12px 10px;
  font-size: 11px;
  color: var(--choice-text-muted);
  line-height: 1.6;
}
</style>