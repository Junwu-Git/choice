<template>
  <div class="choice-debug-settings">
    <div class="choice-debug-section">
      <h4>{{ t`版本信息` }}</h4>
      <p>Schema: {{ globalStore.settings.schema_version }}</p>
      <p>Prompt Schema: {{ globalStore.settings.prompt_rules.schema_version }}</p>
      <p>{{ t`模块数` }}: {{ globalStore.settings.prompt_rules.modules.length }}</p>
      <p>{{ t`条目池` }}: {{ globalStore.settings.master_pool.length }} {{ t`条` }}</p>
      <p>{{ t`配置数` }}: {{ globalStore.settings.configs.length }}</p>
      <p>{{ t`API 数` }}: {{ globalStore.settings.apis.length }}</p>
    </div>
    <div class="choice-debug-section">
      <h4>{{ t`危险操作` }}</h4>
      <button class="menu_button" :title="t`删除所有设置并恢复为插件出厂默认值`" @click="factoryReset">
        <i class="fa-solid fa-rotate-left"></i>
        {{ t`恢复出厂设置` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';

const globalStore = useGlobalSettingsStore();

function factoryReset() {
  if (
    !confirm(
      t`确定要恢复插件所有设置为出厂默认值吗？\n\n这将删除所有条目池、提示词配置、API 设置、UI 偏好等。\n此操作不可撤销！`,
    )
  )
    return;
  globalStore.factoryReset();
  toastr.success(t`已恢复出厂设置`);
}
</script>
