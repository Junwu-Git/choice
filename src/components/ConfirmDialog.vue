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
          <button v-if="cancelText" class="menu_button" @click="emit('cancel')">{{ cancelText }}</button>
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
  top: 0;
  left: 0;
  width: 100vw;
  /* 同 dvh 回退：手机上 100vh 按布局视口取值，大于可视高度 */
  height: 100vh;
  height: 100dvh;
  z-index: var(--choice-z-dialog);
  background: var(--choice-overlay);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-cfdlg-dialog {
  width: 380px;
  max-width: 92vw;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.choice-cfdlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(220, 140, 80, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-cfdlg-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-cfdlg-close {
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

.choice-cfdlg-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-cfdlg-body {
  padding: var(--choice-space-4);
}

.choice-cfdlg-message {
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  margin: 0;
  line-height: 1.5;
}

.choice-cfdlg-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  padding: var(--choice-space-3) var(--choice-space-4);
}
</style>
