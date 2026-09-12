<template>
  <div class="choice-config-bindings">
    <span class="choice-config-bindings-label">
      <i class="fa-solid fa-address-card"></i> {{ t`已绑定角色` }}:
    </span>
    <template v-if="boundChars.length > 0">
      <span v-for="bc in boundChars" :key="bc.chid" class="choice-bound-badge choice-bound-char">
        <i class="fa-solid fa-address-card"></i>
        {{ bc.name }}
        <button class="choice-icon-btn choice-binding-unbind" :title="t`解除绑定`" @click.stop="onUnbind(bc.chid)">
          <i class="fa-solid fa-link-slash"></i>
        </button>
      </span>
    </template>
    <span v-else class="choice-bound-badge choice-bound-fallback">{{ t`未绑定角色` }}</span>
  </div>
</template>

<script setup lang="ts">
import { eventSource, event_types } from '@sillytavern/scripts/events';
import { this_chid } from '@sillytavern/script';
import toastr from 'toastr';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { getStCharacter } from '@/core/st-character';
import { setting_field } from '@/type/settings';
import { getBoundCharacters, scheduleCharacterPersist, type BindKind } from '@/util/character-bindings';

const props = defineProps<{
  /** 当前正在编辑的配置 id；null（无配置）时只显示「未绑定角色」 */
  configId: string | null;
  kind: BindKind;
}>();

/**
 * characters 是酒馆普通数组（非 Vue 响应式），全量扫描的结果必须靠手动触发重算：
 * revision 自增驱动 computed；角色列表变化场景由 CHARACTER_PAGE_LOADED / CHAT_CHANGED
 * 事件覆盖（与 index.ts 的 store reload 同源），组件卸载时移除监听。
 */
const revision = ref(0);
const boundChars = computed(() => {
  void revision.value;
  if (!props.configId) return [];
  return getBoundCharacters(props.kind, props.configId);
});

const bump = () => {
  revision.value++;
};

// 当前角色的绑定状态变化（本页「绑定到当前角色」按钮 / 新建配置弹窗勾选绑定）也会改写
// 角色卡扩展数据，但事件不一定触发——watch 角色 store 字段兜底刷新
const cs = useCharacterSettingsStore();
watch(
  () => (props.kind === 'pool' ? cs.settings.config_id : cs.settings.prompt_config_id),
  () => {
    revision.value++;
  },
);

onMounted(() => {
  eventSource.on(event_types.CHARACTER_PAGE_LOADED, bump);
  eventSource.on(event_types.CHAT_CHANGED, bump);
});

onUnmounted(() => {
  eventSource.removeListener(event_types.CHARACTER_PAGE_LOADED, bump);
  eventSource.removeListener(event_types.CHAT_CHANGED, bump);
});

const onUnbind = (chid: string) => {
  const cs = useCharacterSettingsStore();
  const field = props.kind === 'pool' ? 'config_id' : 'prompt_config_id';
  const ch = getStCharacter(chid);
  // 先同步清理：写内存（徽章扫描读 characters 数组需立即生效）+（若是当前角色）写 store。
  // 徽章与「当前生效-角色」立即消失，不等待任何网络往返——这是「解绑迟钝」的根因。
  // 当前角色判断用「对象引用比较」（ch 与 getStCharacter(this_chid)，与 store watch
  // 落盘目标同源）而非 chid 字符串/索引比较：chid 是数组扫描索引、currentCharacterId 是
  // 事件驱动的 this_chid 快照，两者来源不同，失配会把当前角色解绑误判为非当前角色，
  // 导致 store 未清，标记残留到下次事件刷新才消失。
  if (ch) {
    _.set(ch, ['data', 'extensions', setting_field, field], null);
  }
  if (ch && ch === getStCharacter(this_chid)) {
    // store watch 会写回当前角色并持久化，无需在这里再发请求
    cs.setBinding(props.kind, null);
  } else if (ch) {
    // 非当前角色：store 感知不到，需显式落盘；fire-and-forget，不阻塞下面的 UI 刷新
    scheduleCharacterPersist(ch, ok => {
      if (!ok) toastr.warning(t`解绑保存失败，请重试`);
    });
  }
  revision.value++;
  toastr.success(t`已解除绑定`);
};
</script>

<style scoped>
.choice-config-bindings {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
}

.choice-config-bindings-label {
  color: var(--choice-text-muted);
  white-space: nowrap;
}

/* 徽章内解绑按钮：继承徽章颜色、hover 转错误色；仅小尺寸图标，不撑高徽章 */
.choice-binding-unbind {
  color: inherit;
  opacity: 0.75;
  font-size: var(--choice-text-xs);
  width: auto;
  height: auto;
  padding: 0 0 0 var(--choice-space-1);
}

.choice-binding-unbind:hover {
  color: var(--choice-color-error);
  opacity: 1;
}
</style>
