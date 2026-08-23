<template>
  <div class="choice-api-editor">
    <label class="choice-field">
      <span>{{ t`生成 API` }}</span>
      <select :value="selectedApiId" class="text_pole" @change="selectApi(($event.target as HTMLSelectElement).value)">
        <option v-for="api in globalStore.settings.apis" :key="api.id" :value="api.id">
          {{ api.name || t`<未命名>` }}
        </option>
      </select>
    </label>

    <div class="choice-api-form">
      <div class="choice-api-form-head">
        <span class="choice-form-title">{{ draftForm.name || t`<未命名>` }}</span>
        <button
          v-if="globalStore.settings.apis.length > 0"
          class="choice-icon-btn"
          :title="t`删除`"
          @click="removeApi"
        >
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
      <div class="choice-api-form-body">
        <div class="choice-api-name-row">
          <input v-model="draftForm.name" class="text_pole" :placeholder="t`配置名称`" />
        </div>
        <div class="choice-api-url-row">
          <input v-model="draftForm.apiurl" class="text_pole" :placeholder="t`API 地址`" />
          <input
            v-model="draftForm.key"
            class="text_pole"
            type="password"
            :placeholder="t`API 密钥`"
            style="width: 140px; flex-shrink: 0"
          />
        </div>
        <div class="choice-model-row">
          <input v-model="draftForm.model" class="text_pole" :placeholder="t`模型名称`" />
          <button
            class="menu_button choice-fetch-btn"
            :disabled="isFetching"
            :title="t`从 API 拉取可用模型列表`"
            @click="fetchModels"
          >
            <i v-if="isFetching" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-cloud-arrow-down"></i>
            {{ isFetching ? '' : t`拉取` }}
          </button>
          <button
            class="menu_button choice-model-dropdown-btn"
            :disabled="(modelList.length ?? 0) === 0"
            :title="t`选择模型`"
            @click="modelDropdownOpen = !modelDropdownOpen"
          >
            <i class="fa-solid" :class="modelDropdownOpen ? 'fa-chevron-up' : 'fa-chevron-down'"></i>
          </button>
        </div>
        <div v-if="modelDropdownOpen && modelList.length > 0" class="choice-model-list">
          <div
            v-for="model in modelList"
            :key="model"
            class="choice-model-item"
            :class="{ 'choice-model-item--active': draftForm.model === model }"
            @click="draftForm.model = model; modelDropdownOpen = false"
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
            <label class="choice-check">
              <input v-model="draftForm.send_prefill" type="checkbox" />
              {{ t`预填充` }}
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
      <button class="menu_button" @click="save">{{ t`保存` }}</button>
      <button class="menu_button" @click="reset">{{ t`取消` }}</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { SecondaryApi } from '@/type/settings';

const globalStore = useGlobalSettingsStore();

const EMPTY_API = (): SecondaryApi => ({
  id: uuidv4(),
  name: '',
  apiurl: '',
  key: '',
  model: '',
  temperature: 1,
  max_tokens: 4096,
  timeout: 0,
  stream: false,
  send_prefill: false,
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

const isFetching = fetching;

const selectApi = (id: string) => {
  selectedApiId.value = id;
  const api = globalStore.settings.apis.find(a => a.id === id);
  draftForm.value = api ? klona(api) : EMPTY_API();
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
    const models = await helper.getModelList({ apiurl: draftForm.value.apiurl, key: draftForm.value.key || undefined });
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
  const original = globalStore.settings.apis.find(a => a.id === selectedApiId.value);
  if (!original || !_.isEqual(original, draftForm.value)) {
    const newId = uuidv4();
    const newApi = { ...draftForm.value, id: newId };
    const newApis = [...globalStore.settings.apis];
    if (original) {
      newApis.push(newApi);
    } else {
      newApis.push(newApi);
    }
    globalStore.settings.apis = newApis;
    globalStore.settings.active_api_id = newId;
    selectedApiId.value = newId;
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
  gap: 8px;
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
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

.choice-api-form-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 8px;
  background: linear-gradient(180deg, var(--choice-bg-element), transparent);
  border-bottom: 1px solid var(--choice-border);
}

.choice-form-title {
  font-size: 12px;
  font-weight: bold;
  color: var(--choice-text);
}

.choice-api-form-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0 8px 8px;
  padding-top: 6px;
}

.choice-api-name-row {
  display: flex;
}

.choice-api-name-row .text_pole {
  flex: 1;
}

.choice-api-url-row {
  display: flex;
  gap: 6px;
}

.choice-api-url-row .text_pole:first-child {
  flex: 1;
  min-width: 0;
}

.choice-icon-btn {
  background: transparent;
  color: #c86a6a;
  border: none;
  cursor: pointer;
  font-size: 13px;
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
  gap: 6px;
}

.choice-model-row .text_pole {
  flex: 1;
}

.choice-fetch-btn {
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.choice-model-dropdown-btn {
  flex-shrink: 0;
  width: 28px;
  padding: 0;
  justify-content: center;
}

.choice-model-list {
  max-height: 160px;
  overflow-y: auto;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
}

.choice-model-item {
  padding: 4px 8px;
  font-size: 11px;
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
  gap: 8px;
  flex-wrap: nowrap;
}

.choice-api-row .choice-field {
  flex: 1;
  min-width: 0;
}

.choice-api-bottom-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.choice-api-checks {
  display: flex;
  gap: 10px;
  flex-shrink: 0;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--choice-text-secondary);
}

.choice-api-bottom-actions {
  display: flex;
  gap: 6px;
  padding-top: 8px;
  border-top: 1px solid var(--choice-border);
  margin-top: 4px;
}
</style>