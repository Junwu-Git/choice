<template>
  <div class="choice-api-editor">
    <label class="choice-field">
      <span>{{ t`生成 API` }}</span>
      <select v-model="draftActiveApiId" class="text_pole">
        <option v-for="api in draftApis" :key="api.id" :value="api.id">{{ api.name || t`<未命名>` }}</option>
      </select>
    </label>

    <div class="choice-api-actions">
      <button class="menu_button" @click="save">{{ t`保存` }}</button>
      <button class="menu_button" @click="reset">{{ t`取消` }}</button>
      <button class="menu_button" @click="addApi">{{ t`添加 API` }}</button>
    </div>

    <div v-for="api in draftApis" :key="api.id" class="choice-api-card">
      <div class="choice-api-head" @click="toggleCard(api.id)">
        <i class="fa-solid" :class="expandedCards.has(api.id) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        <span class="choice-api-card-title">{{ api.name || t`<未命名>` }}</span>
        <span class="choice-api-card-model">{{ api.model || t`<无模型>` }}</span>
        <button class="choice-icon-btn" :title="t`删除`" @click.stop="removeApi(api)">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
      <div v-if="expandedCards.has(api.id)" class="choice-api-card-body">
        <div class="choice-api-url-row">
          <input v-model="api.apiurl" class="text_pole" :placeholder="t`API 地址`" />
          <input
            v-model="api.key"
            class="text_pole"
            type="password"
            :placeholder="t`API 密钥`"
            style="width: 140px; flex-shrink: 0"
          />
        </div>
        <div class="choice-model-row">
          <input v-model="api.model" class="text_pole" :list="`choice-models-${api.id}`" :placeholder="t`模型名称`" />
          <button
            class="menu_button choice-fetch-btn"
            :disabled="isFetching(api.id)"
            :title="t`从 API 拉取可用模型列表`"
            @click="fetchModels(api)"
          >
            <i v-if="isFetching(api.id)" class="fa-solid fa-spinner fa-spin"></i>
            <i v-else class="fa-solid fa-cloud-arrow-down"></i>
            {{ isFetching(api.id) ? '' : t`拉取` }}
          </button>
        </div>
        <datalist :id="`choice-models-${api.id}`">
          <option v-for="model in modelLists[api.id] ?? []" :key="model" :value="model"></option>
        </datalist>
        <div class="choice-api-row">
          <label class="choice-field">
            <span>{{ t`温度` }}</span>
            <input v-model.number="api.temperature" type="number" class="text_pole" min="0" max="2" step="0.1" />
          </label>
          <label class="choice-field">
            <span>{{ t`最大 Token` }}</span>
            <input v-model.number="api.max_tokens" type="number" class="text_pole" min="1" />
          </label>
          <label class="choice-field">
            <span>{{ t`超时(秒)` }}</span>
            <input v-model.number="api.timeout" type="number" class="text_pole" min="0" placeholder="0" />
          </label>
        </div>
        <div class="choice-api-bottom-row">
          <div class="choice-api-checks">
            <label class="choice-check">
              <input v-model="api.stream" type="checkbox" />
              {{ t`流式` }}
            </label>
            <label class="choice-check">
              <input v-model="api.send_prefill" type="checkbox" />
              {{ t`预填充` }}
            </label>
          </div>
          <input
            v-model="api.exclude_params"
            class="text_pole"
            :placeholder="t`排除参数`"
            style="flex: 1; min-width: 0"
          />
          <input v-model="api.name" class="text_pole" :placeholder="t`配置名称`" style="width: 120px; flex-shrink: 0" />
        </div>
      </div>
    </div>

    <div v-if="draftApis.length === 0" class="choice-empty-hint">{{ t`暂无 API 配置,点击「添加 API」创建` }}</div>
  </div>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { SecondaryApi } from '@/type/settings';

const globalStore = useGlobalSettingsStore();
const chatStore = useChatSettingsStore();

const draftApis = ref<SecondaryApi[]>(klona(globalStore.settings.apis));
const draftActiveApiId = ref<string>(chatStore.settings.active_api_id);

const modelLists = ref<Record<string, string[]>>({});
const fetching = ref<Record<string, boolean>>({});
const expandedCards = ref<Set<string>>(new Set(draftApis.value.map(a => a.id)));

const isFetching = (id: string) => fetching.value[id] === true;

const toggleCard = (id: string) => {
  if (expandedCards.value.has(id)) expandedCards.value.delete(id);
  else expandedCards.value.add(id);
};

const fetchModels = async (api: SecondaryApi) => {
  const helper = window.TavernHelper;
  if (!helper) {
    toastr.warning(t`酒馆助手未启用,无法拉取模型列表`);
    return;
  }
  if (!api.apiurl) {
    toastr.warning(t`请先填写 API 地址`);
    return;
  }
  fetching.value[api.id] = true;
  try {
    const models = await helper.getModelList({ apiurl: api.apiurl, key: api.key || undefined });
    modelLists.value[api.id] = models;
    if (models.length === 0) {
      toastr.info(t`模型列表为空`);
    } else {
      toastr.success(t`拉取到 ${models.length} 个模型`);
    }
  } catch (error) {
    toastr.error(t`拉取模型列表失败:${error instanceof Error ? error.message : String(error)}`);
  } finally {
    fetching.value[api.id] = false;
  }
};

const addApi = () => {
  const api: SecondaryApi = {
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
  };
  draftApis.value.push(api);
  expandedCards.value.add(api.id);
};

const removeApi = (api: SecondaryApi) => {
  const index = draftApis.value.indexOf(api);
  if (index !== -1) {
    draftApis.value.splice(index, 1);
  }
  if (draftActiveApiId.value === api.id) {
    draftActiveApiId.value = '';
  }
  expandedCards.value.delete(api.id);
};

const save = () => {
  globalStore.settings.apis = klona(draftApis.value);
  chatStore.settings.active_api_id = draftActiveApiId.value;
  toastr.success(t`已保存`);
};

const reset = () => {
  draftApis.value = klona(globalStore.settings.apis);
  draftActiveApiId.value = chatStore.settings.active_api_id;
  expandedCards.value = new Set(draftApis.value.map(a => a.id));
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
  color: #dcdcdc;
}

.choice-api-card {
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(128, 128, 128, 0.25);
  border-radius: 6px;
  background: rgba(40, 40, 40, 0.35);
  overflow: hidden;
}

.choice-api-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  cursor: pointer;
}

.choice-api-head:hover {
  background: rgba(255, 255, 255, 0.04);
}

.choice-api-card-title {
  font-size: 12px;
  font-weight: bold;
  color: #e0e0e0;
}

.choice-api-card-model {
  font-size: 11px;
  color: #8a8a8a;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-api-card-body {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 0 8px 8px;
  border-top: 1px solid rgba(128, 128, 128, 0.12);
  padding-top: 6px;
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
  color: #dcdcdc;
}

.choice-api-actions {
  display: flex;
  gap: 6px;
}

.choice-empty-hint {
  color: #9a9a9a;
  font-size: 12px;
  padding: 8px 0;
}
</style>
