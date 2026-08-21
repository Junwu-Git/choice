<template>
  <div class="choice-api-editor">
    <label class="choice-field">
      <span>{{ t`生成 API` }}</span>
      <select v-model="chatStore.settings.active_api_id" class="text_pole">
        <option :value="null">{{ t`主 API` }}</option>
        <option v-for="api in globalStore.settings.apis" :key="api.id" :value="api.id">{{ api.name }}</option>
      </select>
    </label>

    <div v-for="api in globalStore.settings.apis" :key="api.id" class="choice-api-card">
      <div class="choice-api-head">
        <input v-model="api.name" class="text_pole" :placeholder="t`配置名称`" />
        <button class="choice-icon-btn" :title="t`删除`" @click="removeApi(api)">
          <i class="fa-solid fa-trash-can"></i>
        </button>
      </div>
      <input v-model="api.apiurl" class="text_pole" :placeholder="t`API 地址`" />
      <input v-model="api.key" class="text_pole" type="password" :placeholder="t`API 密钥`" />
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
          {{ isFetching(api.id) ? t`拉取中` : t`拉取` }}
        </button>
      </div>
      <datalist :id="`choice-models-${api.id}`">
        <option v-for="model in modelLists[api.id] ?? []" :key="model" :value="model"></option>
      </datalist>
      <input v-model="api.source" class="text_pole" :placeholder="t`源(默认 openai)`" />
    </div>

    <button class="menu_button" @click="addApi">{{ t`添加 API` }}</button>
    <div class="choice-hint">{{ t`副 API 需要酒馆助手(JS-Slash-Runner)支持;未启用时自动回退主 API` }}</div>
  </div>
</template>

<script setup lang="ts">
import { uuidv4 } from '@sillytavern/scripts/utils';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { SecondaryApi } from '@/type/settings';

const globalStore = useGlobalSettingsStore();
const chatStore = useChatSettingsStore();

const modelLists = ref<Record<string, string[]>>({});
const fetching = ref<Record<string, boolean>>({});

const isFetching = (id: string) => fetching.value[id] === true;

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
  globalStore.settings.apis.push({
    id: uuidv4(),
    name: '',
    apiurl: '',
    key: '',
    model: '',
    source: 'openai',
  });
};

const removeApi = (api: SecondaryApi) => {
  const index = globalStore.settings.apis.indexOf(api);
  if (index !== -1) {
    globalStore.settings.apis.splice(index, 1);
  }
  if (chatStore.settings.active_api_id === api.id) {
    chatStore.settings.active_api_id = null;
  }
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
  gap: 6px;
  border: 1px solid rgba(128, 128, 128, 0.3);
  border-radius: 8px;
  padding: 8px;
  background: rgba(40, 40, 40, 0.4);
}

.choice-api-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.choice-icon-btn {
  background: transparent;
  color: #c86a6a;
  border: none;
  cursor: pointer;
  font-size: 14px;
  margin-left: auto;
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
  gap: 4px;
}

.choice-hint {
  color: #9a9a9a;
  font-size: 11px;
}
</style>
