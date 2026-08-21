<template>
  <div class="choice-prompt-editor">
    <div class="choice-prompt-cols">
      <label class="choice-field">
        <div class="choice-field-head">
          <span>{{ t`破限` }}</span>
          <div class="choice-field-actions">
            <button class="menu_button" @click="loadSystemPrompt">{{ t`载入默认` }}</button>
            <button class="menu_button" @click="resetSystemPrompt">{{ t`恢复默认` }}</button>
          </div>
        </div>
        <textarea
          v-model="rules.system_prompt"
          class="text_pole"
          rows="8"
          :placeholder="t`点击「载入默认」获取推荐提示词`"
        ></textarea>
      </label>
      <label class="choice-field">
        <div class="choice-field-head">
          <span>{{ t`规则` }}</span>
          <div class="choice-field-actions">
            <button class="menu_button" @click="loadCoreRules">{{ t`载入默认` }}</button>
            <button class="menu_button" @click="resetCoreRules">{{ t`恢复默认` }}</button>
          </div>
        </div>
        <textarea
          v-model="rules.core_rules"
          class="text_pole"
          rows="8"
          :placeholder="t`点击「载入默认」获取推荐规则`"
        ></textarea>
      </label>
    </div>

    <div class="choice-prompt-row">
      <label class="choice-field">
        <span>{{ t`上下文轮数(0=全部)` }}</span>
        <input v-model.number="rules.context_rounds" class="text_pole" type="number" min="0" style="width: 80px" />
      </label>
      <button class="menu_button" @click="togglePreview">
        <i class="fa-solid" :class="showPreview ? 'fa-eye-slash' : 'fa-eye'"></i>
        {{ showPreview ? t`隐藏预览` : t`预览提示词(含聊天历史)` }}
      </button>
    </div>

    <div v-if="showPreview" class="choice-preview-box">
      <div v-if="previewMessages.length === 0" class="choice-preview-empty">
        {{ t`暂无聊天历史` }}
      </div>
      <div
        v-for="(msg, i) in previewMessages"
        :key="i"
        class="choice-preview-msg"
        :class="`choice-preview-${msg.role}`"
      >
        <span class="choice-preview-role">{{ msg.role.toUpperCase() }}</span>
        <pre class="choice-preview-content">{{ msg.content }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import { DEFAULT_SYSTEM_PROMPT, DEFAULT_CORE_RULES } from '@/type/settings';
import { chat, characters, this_chid } from '@sillytavern/script';

const globalStore = useGlobalSettingsStore();
const rules = globalStore.settings.prompt_rules;

const loadSystemPrompt = () => {
  rules.system_prompt = DEFAULT_SYSTEM_PROMPT;
};
const resetSystemPrompt = () => {
  rules.system_prompt = DEFAULT_SYSTEM_PROMPT;
};
const loadCoreRules = () => {
  rules.core_rules = DEFAULT_CORE_RULES;
};
const resetCoreRules = () => {
  rules.core_rules = DEFAULT_CORE_RULES;
};

const showPreview = ref(false);

type PreviewMsg = { role: string; content: string };

const previewMessages = computed<PreviewMsg[]>(() => {
  if (!showPreview.value) return [];
  const msgs: PreviewMsg[] = [];
  if (rules.system_prompt) msgs.push({ role: 'system', content: rules.system_prompt.slice(0, 200) + '...' });
  const ch = this_chid !== undefined ? characters[this_chid] : undefined;
  if (ch?.data?.description) msgs.push({ role: 'system', content: `[角色描述] ${ch.data.description.slice(0, 100)}` });
  if (ch?.data?.personality) msgs.push({ role: 'system', content: `[性格] ${ch.data.personality.slice(0, 100)}` });
  if (ch?.data?.scenario) msgs.push({ role: 'system', content: `[场景] ${ch.data.scenario.slice(0, 100)}` });

  let history = chat.filter(m => !m.is_hidden);
  if (rules.context_rounds > 0) history = history.slice(-rules.context_rounds * 2);
  for (const m of history) {
    if (m.is_system) continue;
    const c = m.message ?? '';
    if (!c) continue;
    msgs.push({ role: m.is_user ? 'user' : 'assistant', content: c.slice(0, 200) + (c.length > 200 ? '...' : '') });
  }
  msgs.push({ role: 'user', content: '[生成指令] 请为角色生成行动选项...' });
  if (rules.core_rules) msgs.push({ role: 'system', content: `[规则] ${rules.core_rules.slice(0, 150)}...` });
  return msgs;
});

const togglePreview = () => {
  showPreview.value = !showPreview.value;
};
</script>

<style scoped>
.choice-prompt-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-prompt-cols {
  display: flex;
  gap: 10px;
}

.choice-prompt-cols .choice-field {
  flex: 1;
  min-width: 0;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #dcdcdc;
}

.choice-field-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.choice-field-actions {
  display: flex;
  gap: 3px;
}

.choice-prompt-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.choice-preview-box {
  max-height: 250px;
  overflow-y: auto;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.choice-preview-empty {
  color: #8a8a8a;
  font-size: 11px;
  text-align: center;
  padding: 12px 0;
}

.choice-preview-msg {
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 11px;
}

.choice-preview-system {
  background: rgba(74, 144, 217, 0.12);
  border-left: 3px solid #4a90d9;
}

.choice-preview-user {
  background: rgba(100, 180, 100, 0.12);
  border-left: 3px solid #5aaf5a;
}

.choice-preview-assistant {
  background: rgba(180, 140, 80, 0.12);
  border-left: 3px solid #b8943a;
}

.choice-preview-role {
  font-weight: bold;
  font-size: 10px;
  color: #a0a0a0;
  margin-bottom: 2px;
}

.choice-preview-content {
  white-space: pre-wrap;
  word-break: break-all;
  color: #c8c8c8;
  margin: 0;
  font-family: inherit;
  line-height: 1.4;
}
</style>
