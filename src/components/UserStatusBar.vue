<template>
  <div v-show="visible" ref="barEl" class="choice-status-bar" :class="{ 'is-collapsed': collapsed }">
    <!-- 头部：标题 + 工具按钮 -->
    <div class="choice-status-header" @click="collapsed = !collapsed">
      <span class="choice-status-title">
        <i class="fa-solid fa-heart-pulse"></i>
        {{ t`被动状态` }}
        <span v-if="entries.length > 0" class="choice-status-count">{{ entries.length }}</span>
      </span>
      <div class="choice-status-tools" @click.stop>
        <button
          v-if="!collapsed && config.enabled"
          class="choice-status-btn"
          :disabled="loading"
          :title="t`AI 更新状态`"
          @click="onRefresh"
        >
          <i :class="loading ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-arrows-rotate'"></i>
        </button>
        <button class="choice-status-btn" :title="collapsed ? t`展开` : t`收起`">
          <i :class="collapsed ? 'fa-solid fa-chevron-down' : 'fa-solid fa-chevron-up'"></i>
        </button>
      </div>
    </div>

    <!-- 状态条目列表 -->
    <div v-show="!collapsed" class="choice-status-body">
      <TransitionGroup v-if="entries.length > 0" name="choice-status-chip" tag="div" class="choice-status-chips">
        <div
          v-for="(entry, i) in entries"
          :key="entry.id"
          class="choice-status-chip"
          :class="{ 'is-editing': editingIndex === i, 'is-manual': entry.source === 'manual' }"
        >
          <!-- 展示态 -->
          <template v-if="editingIndex !== i">
            <span class="choice-status-chip-label">{{ entry.label }}</span>
            <span class="choice-status-chip-desc">{{ entry.description }}</span>
            <div class="choice-status-chip-actions" @click.stop>
              <button class="choice-status-chip-btn" :title="t`编辑`" @click="startEdit(i)">
                <i class="fa-solid fa-pen"></i>
              </button>
              <button class="choice-status-chip-btn" :title="t`删除`" @click="removeEntry(i)">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </template>
          <!-- 编辑态 -->
          <template v-else>
            <input
              v-model="editLabel"
              class="choice-status-chip-input choice-status-chip-input--label"
              :placeholder="t`标签`"
            />
            <input
              v-model="editDesc"
              class="choice-status-chip-input choice-status-chip-input--desc"
              :placeholder="t`描述`"
              @keydown.enter="saveEdit"
              @keydown.escape="cancelEdit"
            />
            <div class="choice-status-chip-actions" @click.stop>
              <button class="choice-status-chip-btn" :title="t`保存`" @click="saveEdit">
                <i class="fa-solid fa-check"></i>
              </button>
              <button class="choice-status-chip-btn" :title="t`取消`" @click="cancelEdit">
                <i class="fa-solid fa-xmark"></i>
              </button>
            </div>
          </template>
        </div>
      </TransitionGroup>

      <!-- 空状态 -->
      <div v-else class="choice-status-empty">
        <span v-if="config.enabled">{{ t`暂无被动状态，点击刷新让 AI 从正文提取` }}</span>
        <span v-else>{{ t`被动状态追踪未启用` }}</span>
      </div>

      <!-- 新增按钮 -->
      <button v-if="config.enabled" class="choice-status-add" @click="addEntry">
        <i class="fa-solid fa-plus"></i>
        {{ t`新增状态` }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePanelStateStore } from '@/store/panel-state';
import {
  getMessageUserStatus,
  setMessageUserStatus,
  updateUserStatus,
  refreshStatusInjection,
  statusTrackerState,
  getLatestAiMessageId,
} from '@/core/status-tracker';
import type { UserStatusEntry } from '@/type/settings';
import { uuidv4 } from '@sillytavern/scripts/utils';

const cs = useChatSettingsStore();
const panelStore = usePanelStateStore();

const config = computed(() => cs.settings.status_tracking);

const entries = ref<UserStatusEntry[]>([]);
const collapsed = ref(false);
const editingIndex = ref<number | null>(null);
const editLabel = ref('');
const editDesc = ref('');

const loading = computed(() => statusTrackerState.loading);

// 状态栏可见性：追踪功能开启时显示，且必须有最新 AI 楼层
const visible = computed(() => {
  if (!config.value.enabled) return false;
  return panelStore.messageId !== null;
});

/** 从最新 AI 楼层快照加载状态 */
function loadStatus() {
  const messageId = panelStore.messageId;
  if (messageId === null) {
    entries.value = [];
    return;
  }
  const snapshot = getMessageUserStatus(messageId, panelStore.swipeId);
  entries.value = snapshot?.entries ?? [];
}

/** 监听 panelStore 的 messageId/swipeId 变化，重新加载 */
watch(
  () => [panelStore.messageId, panelStore.swipeId],
  () => {
    loadStatus();
  },
  { immediate: true },
);

/** 持久化当前 entries 到最新 AI 楼层快照 */
function persist() {
  const messageId = panelStore.messageId;
  if (messageId === null) return;
  setMessageUserStatus(messageId, panelStore.swipeId, {
    entries: entries.value,
    updatedAt: Date.now(),
  });
  // 手动编辑后刷新正文注入
  refreshStatusInjection();
}

function startEdit(index: number) {
  editingIndex.value = index;
  editLabel.value = entries.value[index].label;
  editDesc.value = entries.value[index].description;
}

function saveEdit() {
  if (editingIndex.value === null) return;
  const i = editingIndex.value;
  const label = editLabel.value.trim() || '其他';
  const description = editDesc.value.trim();
  if (!description) {
    removeEntry(i);
    return;
  }
  entries.value[i] = { ...entries.value[i], label, description, source: 'manual', updatedAt: Date.now() };
  editingIndex.value = null;
  persist();
}

function cancelEdit() {
  editingIndex.value = null;
}

function removeEntry(index: number) {
  entries.value.splice(index, 1);
  editingIndex.value = null;
  persist();
}

function addEntry() {
  const entry: UserStatusEntry = {
    id: uuidv4(),
    label: '其他',
    description: '',
    source: 'manual',
    updatedAt: Date.now(),
  };
  entries.value.push(entry);
  // 直接进入编辑态
  editingIndex.value = entries.value.length - 1;
  editLabel.value = entry.label;
  editDesc.value = '';
  // 暂不 persist——用户保存/删除时才 persist，避免空条目落盘
}

async function onRefresh() {
  // 用 panelStore.messageId（与 loadStatus/persist 同源），保证 swipeId 配对一致；
  // panelStore 尚未同步时回退到实时扫描最新 AI 楼层
  const messageId = panelStore.messageId ?? getLatestAiMessageId();
  if (messageId === null) return;
  const result = await updateUserStatus(messageId, panelStore.swipeId);
  if (result) {
    entries.value = result;
  }
}
</script>

<style scoped>
.choice-status-bar {
  margin: var(--choice-space-2) var(--choice-space-3);
  border-radius: var(--choice-radius-md);
  background: var(--choice-surface);
  border: 1px solid var(--choice-border);
  box-shadow: var(--choice-shadow-sm);
  overflow: hidden;
  transition: border-color var(--choice-transition);
}

.choice-status-bar:hover {
  border-color: var(--choice-border-strong);
}

.choice-status-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-2) var(--choice-space-3);
  cursor: pointer;
  user-select: none;
  border-bottom: 1px solid transparent;
  transition: border-color var(--choice-transition);
}

.choice-status-bar:not(.is-collapsed) .choice-status-header {
  border-bottom-color: var(--choice-border);
}

.choice-status-title {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text-secondary);
}

.choice-status-title i {
  color: var(--choice-color-warning);
  font-size: var(--choice-text-sm);
}

.choice-status-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--choice-radius-full);
  background: var(--choice-color-warning-bg);
  color: var(--choice-color-warning);
  font-size: var(--choice-text-xs);
  font-weight: 700;
}

.choice-status-tools {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
}

.choice-status-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--choice-radius-sm);
  background: transparent;
  color: var(--choice-text-muted);
  cursor: pointer;
  font-size: var(--choice-text-xs);
  transition: background var(--choice-transition), color var(--choice-transition);
}

.choice-status-btn:hover:not(:disabled) {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-status-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.choice-status-body {
  padding: var(--choice-space-2) var(--choice-space-3);
}

.choice-status-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--choice-space-2);
}

.choice-status-chip {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  padding: var(--choice-space-1) var(--choice-space-2);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-surface-2);
  border: 1px solid var(--choice-border);
  font-size: var(--choice-text-xs);
  transition: border-color var(--choice-transition), background var(--choice-transition);
}

.choice-status-chip:hover {
  border-color: var(--choice-border-strong);
}

.choice-status-chip.is-manual {
  border-color: var(--choice-border-active);
}

.choice-status-chip.is-editing {
  background: var(--choice-surface);
  border-color: var(--choice-border-active);
  flex-basis: 100%;
}

.choice-status-chip-label {
  font-weight: 700;
  color: var(--choice-color-warning);
  white-space: nowrap;
}

.choice-status-chip-desc {
  color: var(--choice-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
}

.choice-status-chip-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  opacity: 0;
  transition: opacity var(--choice-transition);
}

.choice-status-chip:hover .choice-status-chip-actions,
.choice-status-chip.is-editing .choice-status-chip-actions {
  opacity: 1;
}

.choice-status-chip-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--choice-text-muted);
  cursor: pointer;
  font-size: 10px;
  transition: background var(--choice-transition), color var(--choice-transition);
}

.choice-status-chip-btn:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}

.choice-status-chip-input {
  border: 1px solid var(--choice-border-strong);
  border-radius: 4px;
  background: var(--choice-bg);
  color: var(--choice-text);
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-1);
  outline: none;
}

.choice-status-chip-input--label {
  width: 70px;
  flex-shrink: 0;
}

.choice-status-chip-input--desc {
  flex: 1;
  min-width: 120px;
}

.choice-status-chip-input:focus {
  border-color: var(--choice-border-active);
}

.choice-status-empty {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  padding: var(--choice-space-1) 0;
  text-align: center;
}

.choice-status-add {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  margin-top: var(--choice-space-2);
  padding: var(--choice-space-1) var(--choice-space-2);
  border: 1px dashed var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  background: transparent;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  cursor: pointer;
  transition: border-color var(--choice-transition), color var(--choice-transition);
}

.choice-status-add:hover {
  border-color: var(--choice-primary);
  color: var(--choice-primary);
}

/* chip 进出动画 */
.choice-status-chip-enter-active,
.choice-status-chip-leave-active {
  transition: all var(--choice-transition);
}

.choice-status-chip-enter-from {
  opacity: 0;
  transform: scale(0.8);
}

.choice-status-chip-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* 手机压缩 */
@media (pointer: coarse) {
  .choice-status-chip-actions {
    opacity: 1;
  }
}
</style>
