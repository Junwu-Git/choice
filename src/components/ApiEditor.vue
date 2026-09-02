<template>
  <div class="choice-api-editor">
    <div class="choice-retry-section">
      <label class="choice-field">
        <span>{{ t`失败重试次数` }}</span>
        <input
          v-model.number="globalStore.settings.retry_count"
          type="number"
          class="text_pole"
          min="0"
          max="10"
          placeholder="0"
        />
      </label>
      <span class="choice-retry-hint">{{ t`0 = 不重试；网络错误或 5xx 时自动重试，每次间隔 1 秒` }}</span>
    </div>

    <div class="choice-retry-section">
      <label class="choice-check">
        <input v-model="globalStore.settings.api_tool_choice_none" type="checkbox" />
        {{ t`请求附带 tool_choice:none` }}
      </label>
      <span class="choice-retry-hint">{{
        t`绕过预设防截断类脚本（如 Aether）对生成请求的改写；该字段不会被转发给上游 API，一般无需关闭`
      }}</span>
    </div>

    <div class="choice-api-select-row">
      <label class="choice-field" style="flex: 1; min-width: 0">
        <span>{{ t`生成 API` }}</span>
        <select
          :value="selectedApiId"
          class="text_pole"
          @change="selectApi(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="api in globalStore.settings.apis" :key="api.id" :value="api.id">
            {{ api.name || t`<未命名>` }}
          </option>
        </select>
      </label>
      <button class="menu_button" style="flex-shrink: 0; margin-top: auto" :title="t`新建 API 配置`" @click="createApi">
        <i class="fa-solid fa-plus"></i> {{ t`新建` }}
      </button>
      <button
        class="menu_button"
        style="flex-shrink: 0; margin-top: auto; color: var(--choice-color-error)"
        :disabled="!selectedApiId"
        :title="t`删除当前 API`"
        @click="removeApi"
      >
        <i class="fa-solid fa-trash-can"></i> {{ t`删除` }}
      </button>
    </div>

    <div class="choice-api-form" data-tour="api-form">
      <div class="choice-api-form-body">
        <div class="choice-api-name-row">
          <input v-model="draftForm.name" class="text_pole" :placeholder="t`配置名称`" />
        </div>
        <div class="choice-api-url-row" data-tour="api-url">
          <input v-model="draftForm.apiurl" class="text_pole" :placeholder="t`API 地址`" />
        </div>
        <div class="choice-api-key-row">
          <input v-model="draftForm.key" class="text_pole" type="password" :placeholder="t`API 密钥`" />
        </div>
        <div class="choice-model-row">
          <input
            v-model="draftForm.model"
            class="text_pole"
            :placeholder="t`模型名称`"
            @focus="modelDropdownOpen = true"
            @blur="onModelBlur"
          />
          <button
            class="menu_button choice-fetch-btn"
            :disabled="fetching"
            :title="t`从 API 拉取可用模型列表`"
            @click="fetchModels"
          >
            <i v-if="fetching" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-cloud-arrow-down"></i>
            {{ fetching ? '' : t`拉取` }}
          </button>
        </div>
        <div v-if="modelDropdownOpen && modelList.length > 0" class="choice-model-list">
          <div
            v-for="model in modelList"
            :key="model"
            class="choice-model-item"
            :class="{ 'choice-model-item--active': draftForm.model === model }"
            @click="
              draftForm.model = model;
              modelDropdownOpen = false;
            "
          >
            {{ model }}
          </div>
        </div>
        <div class="choice-api-row">
          <label class="choice-field">
            <span>{{ t`温度` }}</span>
            <input v-model.number="draftForm.temperature" type="number" class="text_pole" min="0" max="2" step="0.1" />
          </label>
          <label class="choice-field">
            <span>{{ t`最大 Token` }}</span>
            <input v-model.number="draftForm.max_tokens" type="number" class="text_pole" min="1" />
          </label>
          <label class="choice-field">
            <span>{{ t`超时(秒)` }}</span>
            <input v-model.number="draftForm.timeout" type="number" class="text_pole" min="0" placeholder="0" />
          </label>
        </div>
        <div class="choice-api-bottom-row">
          <div class="choice-api-checks">
            <label class="choice-check">
              <input v-model="draftForm.stream" type="checkbox" />
              {{ t`流式` }}
            </label>
          </div>
          <input
            v-model="draftForm.exclude_params"
            class="text_pole"
            :placeholder="t`排除参数`"
            style="flex: 1; min-width: 0"
          />
        </div>
      </div>
    </div>

    <div class="choice-api-bottom-actions">
      <button class="menu_button" data-tour="api-save" @click="save">{{ t`保存` }}</button>
      <button class="menu_button" @click="reset">{{ t`取消` }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { SecondaryApi } from '@/type/settings';
import { normalizeApiUrl } from '@/core/api-client';

const globalStore = useGlobalSettingsStore();

const EMPTY_API = (): SecondaryApi => ({
  id: uuidv4(),
  name: '',
  apiurl: '',
  key: '',
  model: '',
  temperature: 1,
  max_tokens: 4096,
  timeout: 180,
  stream: false,
  exclude_params: '',
});

const initForm = (): SecondaryApi => {
  const api = globalStore.settings.apis.find(a => a.id === selectedApiId.value);
  return api ? klona(api) : EMPTY_API();
};

const selectedApiId = ref<string>(globalStore.settings.active_api_id);
const draftForm = ref<SecondaryApi>(initForm());

const modelList = ref<string[]>([]);
const fetching = ref(false);
const modelDropdownOpen = ref(false);

const onModelBlur = () => {
  setTimeout(() => {
    modelDropdownOpen.value = false;
  }, 150);
};

const selectApi = (id: string) => {
  selectedApiId.value = id;
  const api = globalStore.settings.apis.find(a => a.id === id);
  draftForm.value = api ? klona(api) : EMPTY_API();
  modelDropdownOpen.value = false;
};

const createApi = () => {
  selectedApiId.value = '';
  modelList.value = [];
  modelDropdownOpen.value = false;
};

const fetchModels = async () => {
  const helper = window.TavernHelper;
  if (!helper) {
    toastr.warning(t`酒馆助手未启用,无法拉取模型列表`);
    return;
  }
  if (!draftForm.value.apiurl) {
    toastr.warning(t`请先填写 API 地址`);
    return;
  }
  fetching.value = true;
  try {
    const models = await helper.getModelList({
      apiurl: normalizeApiUrl(draftForm.value.apiurl),
      key: draftForm.value.key || undefined,
    });
    modelList.value = models;
    if (models.length === 0) {
      toastr.info(t`模型列表为空`);
    } else {
      toastr.success(t`拉取到 ${models.length} 个模型`);
    }
  } catch (error) {
    toastr.error(t`拉取模型列表失败:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fetching.value = false;
  }
};

const removeApi = () => {
  const id = selectedApiId.value;
  const newApis = globalStore.settings.apis.filter(a => a.id !== id);
  globalStore.settings.apis = newApis;
  if (globalStore.settings.active_api_id === id) {
    globalStore.settings.active_api_id = newApis[0]?.id ?? '';
  }
  const nextId = newApis[0]?.id ?? '';
  selectedApiId.value = nextId;
  const api = newApis.find(a => a.id === nextId);
  draftForm.value = api ? klona(api) : EMPTY_API();
  modelList.value = [];
  modelDropdownOpen.value = false;
  toastr.success(t`已删除`);
};

const save = () => {
  const normalized = { ...draftForm.value, apiurl: normalizeApiUrl(draftForm.value.apiurl) };
  const dupName = normalized.name.trim();
  if (dupName) {
    const duplicate = globalStore.settings.apis.find(a => a.id !== selectedApiId.value && a.name.trim() === dupName);
    if (duplicate) {
      toastr.warning(t`API 名称「${dupName}」已存在`);
      return;
    }
  }
  const original = globalStore.settings.apis.find(a => a.id === selectedApiId.value);
  if (original) {
    Object.assign(original, normalized);
    globalStore.settings.apis = [...globalStore.settings.apis];
    draftForm.value = klona(original);
  } else {
    const newApi = { ...normalized, id: uuidv4() };
    globalStore.settings.apis = [...globalStore.settings.apis, newApi];
    globalStore.settings.active_api_id = newApi.id;
    selectedApiId.value = newApi.id;
    draftForm.value = klona(newApi);
  }
  toastr.success(t`已保存`);
};

const reset = () => {
  selectedApiId.value = globalStore.settings.active_api_id;
  draftForm.value = initForm();
  modelList.value = [];
  modelDropdownOpen.value = false;
};
</script>

<style scoped>
.choice-api-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-api-select-row {
  display: flex;
  align-items: flex-end;
  gap: var(--choice-space-2);
}

.choice-retry-section {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  padding: var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
}

.choice-retry-hint {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-api-form {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  overflow: hidden;
}

.choice-api-form-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2);
}

.choice-api-name-row {
  display: flex;
}

.choice-api-name-row .text_pole {
  flex: 1;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-api-name-row .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-api-url-row {
  display: flex;
}

.choice-api-key-row {
  display: flex;
}

.choice-api-key-row .text_pole {
  flex: 1;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-api-key-row .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-icon-btn {
  background: transparent;
  color: var(--choice-color-error);
  border: none;
  cursor: pointer;
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: var(--choice-radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--choice-transition);
}

.choice-icon-btn:hover {
  background: var(--choice-bg-hover);
}

.choice-model-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-model-row .text_pole {
  flex: 1;
  background: var(--choice-bg-element);
  border: 1px solid var(--choice-border-strong);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  color: var(--choice-text);
}

.choice-model-row .text_pole:focus {
  border-color: var(--choice-border-active);
  outline: none;
}

.choice-fetch-btn {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  flex-shrink: 0;
}

.choice-model-list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
}

.choice-model-item {
  padding: var(--choice-space-1) var(--choice-space-2);
  font-size: var(--choice-text-xs);
  color: var(--choice-text);
  cursor: pointer;
  border-bottom: 1px solid var(--choice-border);
}

.choice-model-item:last-child {
  border-bottom: none;
}

.choice-model-item:hover {
  background: var(--choice-bg-hover);
}

.choice-model-item--active {
  color: var(--choice-accent);
  font-weight: bold;
}

.choice-api-row {
  display: flex;
  gap: var(--choice-space-2);
  flex-wrap: nowrap;
}

.choice-api-row .choice-field {
  flex: 1;
  min-width: 0;
}

.choice-api-bottom-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-api-checks {
  display: flex;
  gap: var(--choice-space-3);
  flex-shrink: 0;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-api-bottom-actions {
  display: flex;
  gap: var(--choice-space-2);
  padding-top: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  margin-top: 4px;
}
</style>
