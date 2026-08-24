<template>
  <div class="choice-behavior-editor">
    <PageGuide page-id="behavior-editor" icon="fa-solid fa-circle-info">
      <template #title>⚙️ 选项规则</template>
      <p><strong>自动生成</strong>：开启后，每次 AI 回复完成时自动触发选项生成，无需手动点击"生成"按钮。</p>
      <p><strong>输入润色</strong>：在发送消息前，用 AI 将你的输入改写成多个润色版本供选择。右侧数字控制生成几个版本。</p>
      <p><strong>叙述风格</strong>：告诉 AI 以什么视角/人称生成选项（如"第三人称"、"第一人称女主视角"）。</p>
      <p><strong>选项规则</strong>：AI 生成选项时必须遵守的核心约束，每行一条。如"每条选项不超过 30 字"、"禁止预判其他角色反应"。</p>
    </PageGuide>

    <div class="choice-behavior-grid">
      <label class="choice-check">
        <input v-model="chatStore.settings.auto_generate" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`自动生成` }}
      </label>
      <label class="choice-check">
        <input v-model="globalStore.settings.ui.enrich_enabled" type="checkbox" />
        <span class="choice-check-custom"></span>
        {{ t`输入润色` }}
        <input
          v-model.number="globalStore.settings.ui.enrich_count"
          type="number"
          min="1"
          max="20"
          class="text_pole"
          style="width: 50px; margin-left: 6px"
        />
      </label>
    </div>

    <div class="choice-field">
      <div class="choice-field-label">
        <label>{{ t`叙述风格` }}</label>
        <span class="choice-field-module">{{ t`对应模块: core_rules` }}</span>
        <button class="menu_button choice-restore-btn" @click="resetPersonStyleTarget = true">
          {{ t`恢复默认` }}
        </button>
      </div>
      <textarea
        v-model="globalStore.settings.prompt_rules.person_style"
        rows="3"
        class="text_pole"
      ></textarea>
      <small class="choice-field-hint">{{ t`描述选项的叙述视角和人称要求，如"第三人称"、"第一人称女主视角"等` }}</small>
    </div>

    <div class="choice-field">
      <div class="choice-field-label">
        <label>{{ t`选项规则` }}</label>
        <span class="choice-field-module">{{ t`对应模块: core_rules` }}</span>
        <button class="menu_button choice-restore-btn" @click="resetOptionRulesTarget = true">
          {{ t`恢复默认` }}
        </button>
      </div>
      <textarea
        v-model="globalStore.settings.prompt_rules.option_rules"
        rows="10"
        class="text_pole"
      ></textarea>
      <small class="choice-field-hint">{{ t`生成选项时 AI 必须遵守的核心规则，每行一条` }}</small>
    </div>

    <ConfirmDialog
      :open="resetPersonStyleTarget"
      :title="t`恢复默认`"
      :message="resetPersonStyleMsg"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onResetPersonStyleConfirm"
      @cancel="resetPersonStyleTarget = false"
    />
    <ConfirmDialog
      :open="resetOptionRulesTarget"
      :title="t`恢复默认`"
      :message="resetOptionRulesMsg"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onResetOptionRulesConfirm"
      @cancel="resetOptionRulesTarget = false"
    />
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import PageGuide from '@/components/PageGuide.vue';
import { DEFAULT_PERSON_STYLE, DEFAULT_OPTION_RULES } from '@/type/settings';

const chatStore = useChatSettingsStore();
const globalStore = useGlobalSettingsStore();

const resetPersonStyleTarget = ref(false);
const resetOptionRulesTarget = ref(false);

const onResetPersonStyleConfirm = () => {
  globalStore.settings.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
  resetPersonStyleTarget.value = false;
};
const onResetOptionRulesConfirm = () => {
  globalStore.settings.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
  resetOptionRulesTarget.value = false;
};

const resetPersonStyleMsg = computed(() => t`确定要将"叙述风格"恢复为默认值吗？当前修改将丢失。`);
const resetOptionRulesMsg = computed(() => t`确定要将"选项规则"恢复为默认值吗？当前修改将丢失。`);
</script>

<style scoped>
.choice-behavior-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-behavior-row {
  display: flex;
  gap: 10px;
}

.choice-behavior-row .choice-field {
  flex: 1;
  min-width: 0;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: var(--choice-text-secondary);
}

.choice-behavior-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  padding: 10px 12px;
  cursor: pointer;
  white-space: nowrap;
  transition: background var(--choice-transition);
}

.choice-check:hover {
  background: var(--choice-bg-hover);
}

.choice-check input[type='checkbox'] {
  display: none;
}

.choice-check-custom {
  width: 16px;
  height: 16px;
  border: 1px solid var(--choice-border-strong);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
  position: relative;
}

.choice-check input[type='checkbox']:checked + .choice-check-custom {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
}

.choice-check input[type='checkbox']:checked + .choice-check-custom::after {
  content: '✓';
  color: #fff;
  font-size: 11px;
  font-weight: bold;
  position: absolute;
  line-height: 1;
}

.choice-field-hint {
  color: var(--choice-text-muted);
  font-size: 11px;
  line-height: 1.4;
}

.choice-field-label {
  display: flex;
  align-items: center;
  gap: 8px;
}

.choice-field-label label {
  font-weight: 600;
}

.choice-field-module {
  font-size: 10px;
  color: var(--choice-text-muted);
  background: var(--choice-bg-card);
  padding: 1px 6px;
  border-radius: var(--choice-radius-full);
}

.choice-restore-btn {
  font-size: 11px;
  padding: 2px 8px;
  margin-left: auto;
}
</style>
