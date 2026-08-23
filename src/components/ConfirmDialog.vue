<template>
  <Teleport to="body">
    <div v-if="open" class="choice-cfdlg-overlay" @click.self="emit('cancel')">
      <div class="choice-cfdlg-dialog">
        <div class="choice-cfdlg-header">
          <span class="choice-cfdlg-title">
            <i class="fa-solid fa-triangle-exclamation"></i>
            {{ title }}
          </span>
          <button class="choice-cfdlg-close" :title="t`取消`" @click="emit('cancel')">&times;</button>
        </div>

        <div class="choice-cfdlg-body">
          <p class="choice-cfdlg-message">{{ message }}</p>
        </div>

        <div class="choice-cfdlg-footer">
          <button class="menu_button" @click="emit('cancel')">{{ cancelText }}</button>
          <button class="menu_button menu_button_default" @click="emit('confirm')">{{ confirmText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();
</script>

<style scoped>
.choice-cfdlg-overlay {
  position: fixed;
  inset: 0;
  z-index: 10004;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-cfdlg-dialog {
  width: 380px;
  max-width: 92vw;
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

.choice-cfdlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(220, 140, 80, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-cfdlg-title {
  font-size: 14px;
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice-cfdlg-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: 20px;
  cursor: pointer;
  line-height: 1;
  padding: 0 4px;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--choice-transition), color var(--choice-transition);
}

.choice-cfdlg-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-cfdlg-body {
  padding: 14px;
}

.choice-cfdlg-message {
  font-size: 13px;
  color: var(--choice-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.choice-cfdlg-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  border-top: 1px solid var(--choice-border);
  padding: 10px 14px;
}
</style>