<template>
  <Teleport to="body">
    <div v-if="open" class="choice-dialog-overlay" @click.self="$emit('close')">
      <div class="choice-dialog" :style="{ width: width, maxHeight: maxHeight }">
        <div class="choice-dialog-header">
          <span class="choice-dialog-title">
            <i v-if="icon" :class="icon"></i>
            {{ title }}
          </span>
          <div class="choice-dialog-header-actions">
            <slot name="header-actions"></slot>
            <button class="choice-dialog-close" title="关闭" @click="$emit('close')">&times;</button>
          </div>
        </div>

        <div class="choice-dialog-body">
          <slot></slot>
        </div>

        <div v-if="$slots.footer" class="choice-dialog-footer">
          <slot name="footer"></slot>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  open: boolean;
  title: string;
  icon?: string;
  width?: string;
  maxHeight?: string;
}>(), {
  width: '560px',
  maxHeight: '85vh',
});

defineEmits<{
  close: [];
}>();
</script>

<style scoped>
.choice-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: var(--choice-z-dialog);
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-dialog {
  width: 560px;
  max-width: 92vw;
  max-height: 85vh;
  background: var(--choice-bg-panel);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow: var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  border-bottom: 1px solid var(--choice-border);
  flex-shrink: 0;
}

.choice-dialog-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-dialog-header-actions {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-dialog-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-dialog-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-dialog-body {
  padding: var(--choice-space-4);
  overflow-y: auto;
  flex: 1;
}

.choice-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-3) var(--choice-space-4);
  flex-shrink: 0;
}
</style>