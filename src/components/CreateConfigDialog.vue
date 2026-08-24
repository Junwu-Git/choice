<template>
  <Teleport to="body">
    <div v-if="open" class="choice-ccdlg-overlay" @click.self="emit('close')">
      <div class="choice-ccdlg-dialog">
        <div class="choice-ccdlg-header">
          <span class="choice-ccdlg-title">
            <i class="fa-solid fa-plus"></i>
            {{ t`新建配置` }}
          </span>
          <button class="choice-ccdlg-close" :title="t`取消`" @click="emit('close')">&times;</button>
        </div>

        <div class="choice-ccdlg-body">
          <div class="choice-ccdlg-field">
            <label class="choice-ccdlg-label">{{ t`配置名称` }}</label>
            <input v-model="name" class="text_pole" :placeholder="t`输入配置名称`" @keyup.enter="onCreate" />
          </div>

          <div class="choice-ccdlg-checks">
            <label class="choice-check">
              <input v-model="isDefault" type="checkbox" />
              {{ t`设为默认` }}
            </label>
            <label class="choice-check">
              <input v-model="bindChat" type="checkbox" />
              {{ t`绑定聊天` }}
            </label>
            <label class="choice-check">
              <input v-model="bindChar" type="checkbox" />
              {{ t`绑定角色` }}
            </label>
          </div>
        </div>

        <div class="choice-ccdlg-footer">
          <button class="menu_button" @click="emit('close')">{{ t`取消` }}</button>
          <button class="menu_button" :disabled="!name.trim()" @click="onCreate">{{ t`创建` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
  create: [payload: { name: string; isDefault: boolean; bindChat: boolean; bindChar: boolean }];
}>();

const name = ref('');
const isDefault = ref(false);
const bindChat = ref(false);
const bindChar = ref(false);

const onCreate = () => {
  const trimmed = name.value.trim();
  if (!trimmed) return;
  emit('create', {
    name: trimmed,
    isDefault: isDefault.value,
    bindChat: bindChat.value,
    bindChar: bindChar.value,
  });
  name.value = '';
  isDefault.value = false;
  bindChat.value = false;
  bindChar.value = false;
};
</script>

<style scoped>
.choice-ccdlg-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: 10003;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
}

.choice-ccdlg-dialog {
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

.choice-ccdlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: linear-gradient(180deg, rgba(74, 144, 217, 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-ccdlg-title {
  font-size: 14px;
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.choice-ccdlg-close {
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
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-ccdlg-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-ccdlg-body {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 14px;
}

.choice-ccdlg-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.choice-ccdlg-label {
  font-size: 12px;
  color: var(--choice-text-secondary);
  font-weight: bold;
}

.choice-ccdlg-checks {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--choice-text-secondary);
  cursor: pointer;
}

.choice-ccdlg-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  border-top: 1px solid var(--choice-border);
  padding: 10px 14px;
}
</style>
