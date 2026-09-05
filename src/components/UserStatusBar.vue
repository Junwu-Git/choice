<template>
  <div v-show="visible" ref="barEl" class="choice-status-bar" :class="{ 'is-collapsed': collapsed }">
    <!-- 头部：标题 + 时间提示 + 工具按钮 -->
    <div class="choice-status-header" @click="collapsed = !collapsed">
      <span class="choice-status-title">
        <i class="fa-solid fa-heart-pulse"></i>
        {{ t`被动状态` }}
        <span v-if="snapshot.entries.length > 0" class="choice-status-count">{{ snapshot.entries.length }}</span>
        <span v-if="snapshot.time_hint" class="choice-status-time-hint">
          <i class="fa-regular fa-clock"></i> {{ snapshot.time_hint }}
        </span>
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

    <!-- 状态主体 -->
    <div v-show="!collapsed" class="choice-status-body">
      <!-- 唤起状态卡片 -->
      <div v-if="snapshot.arousal" class="choice-arousal-card" :class="`choice-arousal-card--${snapshot.arousal.phase}`">
        <div class="choice-arousal-header">
          <span class="choice-arousal-badge" :class="`choice-arousal-badge--${snapshot.arousal.phase}`">
            {{ snapshot.arousal.phase }}
          </span>
          <button class="choice-status-chip-btn" :title="editingArousal ? t`取消编辑` : t`编辑`" @click.stop="toggleEditArousal">
            <i :class="editingArousal ? 'fa-solid fa-xmark' : 'fa-solid fa-pen'"></i>
          </button>
        </div>
        <div class="choice-arousal-body">
          <div class="choice-arousal-row">
            <span class="choice-arousal-label">{{ t`硬度` }}</span>
            <div class="choice-arousal-bar">
              <div class="choice-arousal-bar-fill" :style="{ width: snapshot.arousal.hardness + '%' }"></div>
            </div>
            <span class="choice-arousal-value">{{ snapshot.arousal.hardness }}%</span>
          </div>
          <div class="choice-arousal-meta">
            <span class="choice-arousal-tag">{{ snapshot.arousal.secretion }}</span>
            <span class="choice-arousal-text">{{ snapshot.arousal.cause }}</span>
            <span class="choice-arousal-text">{{ snapshot.arousal.recovery }}</span>
          </div>
        </div>
        <!-- 唤起状态编辑面板 -->
        <div v-if="editingArousal" class="choice-arousal-edit">
          <div class="choice-arousal-edit-row">
            <label class="choice-arousal-field-label">{{ t`阶段` }}</label>
            <select v-model="editArousal.phase" class="choice-arousal-select">
              <option v-for="p in arousalPhases" :key="p" :value="p">{{ p }}</option>
            </select>
          </div>
          <div class="choice-arousal-edit-row">
            <label class="choice-arousal-field-label">{{ t`硬度` }}</label>
            <input v-model.number="editArousal.hardness" type="number" min="0" max="100" class="choice-arousal-input" />
          </div>
          <div class="choice-arousal-edit-row">
            <label class="choice-arousal-field-label">{{ t`分泌物` }}</label>
            <select v-model="editArousal.secretion" class="choice-arousal-select">
              <option v-for="s in arousalSecretions" :key="s" :value="s">{{ s }}</option>
            </select>
          </div>
          <div class="choice-arousal-edit-row">
            <label class="choice-arousal-field-label">{{ t`成因` }}</label>
            <input v-model="editArousal.cause" class="choice-arousal-input" />
          </div>
          <div class="choice-arousal-edit-row">
            <label class="choice-arousal-field-label">{{ t`体力` }}</label>
            <input v-model="editArousal.recovery" class="choice-arousal-input" />
          </div>
          <div class="choice-arousal-edit-actions">
            <button class="choice-status-chip-btn choice-status-chip-btn--primary" :title="t`保存`" @click="saveEditArousal">
              <i class="fa-solid fa-check"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- 体感条目列表 -->
      <TransitionGroup v-if="snapshot.entries.length > 0" name="choice-status-chip" tag="div" class="choice-status-chips">
        <div
          v-for="(entry, i) in snapshot.entries"
          :key="entry.id"
          class="choice-status-chip"
          :class="{
            'is-editing': editingIndex === i,
            'is-manual': entry.source === 'manual',
            [`choice-status-chip--${entry.category}`]: true,
          }"
        >
          <!-- 展示态 -->
          <template v-if="editingIndex !== i">
            <span class="choice-status-chip-label">{{ entry.category }}</span>
            <span class="choice-status-chip-desc">{{ entry.text }}</span>
            <span v-if="entry.intensity !== undefined" class="choice-status-chip-intensity">
              {{ entry.intensity }}
            </span>
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
            <select v-model="editCategory" class="choice-status-chip-select">
              <option v-for="cat in STATUS_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
            </select>
            <input
              v-model="editText"
              class="choice-status-chip-input choice-status-chip-input--desc"
              :placeholder="t`描写`"
              @keydown.enter="saveEdit"
              @keydown.escape="cancelEdit"
            />
            <input
              v-model.number="editIntensity"
              class="choice-status-chip-input choice-status-chip-input--intensity"
              type="number"
              min="0"
              max="100"
              :placeholder="t`强度`"
            />
            <div class="choice-status-chip-actions" @click.stop>
              <button class="choice-status-chip-btn choice-status-chip-btn--primary" :title="t`保存`" @click="saveEdit">
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
import type { StatusEntry, ArousalState, UserStatusSnapshot, StatusCategory } from '@/type/settings';
import { STATUS_CATEGORIES } from '@/type/settings';
import { uuidv4 } from '@sillytavern/scripts/utils';

const cs = useChatSettingsStore();
const panelStore = usePanelStateStore();

const config = computed(() => cs.settings.status_tracking);

const snapshot = reactive<UserStatusSnapshot>({
  entries: [],
  arousal: null,
  time_hint: '',
  updatedAt: Date.now(),
});
const collapsed = ref(false);
const editingIndex = ref<number | null>(null);
const editCategory = ref<StatusCategory>(STATUS_CATEGORIES[0]);
const editText = ref('');
const editIntensity = ref<number | ''>('');
const editingArousal = ref(false);
const editArousal = ref<ArousalState>({
  phase: '平静',
  hardness: 0,
  secretion: '干燥',
  cause: '无',
  recovery: '精力充沛',
});

const loading = computed(() => statusTrackerState.loading);

const arousalPhases = ['平静', '兴奋', '临界', '不应期'] as const;
const arousalSecretions = ['干燥', '微润', '湿滑', '射精残留'] as const;

// 状态栏可见性：追踪功能开启时显示，且必须有最新 AI 楼层
const visible = computed(() => {
  if (!config.value.enabled) return false;
  return panelStore.messageId !== null;
});

/** 从最新 AI 楼层快照加载状态 */
function loadStatus() {
  const messageId = panelStore.messageId;
  if (messageId === null) {
    snapshot.entries = [];
    snapshot.arousal = null;
    snapshot.time_hint = '';
    return;
  }
  const s = getMessageUserStatus(messageId, panelStore.swipeId);
  snapshot.entries = s?.entries ?? [];
  snapshot.arousal = s?.arousal ?? null;
  snapshot.time_hint = s?.time_hint ?? '';
}

/** 监听 panelStore 的 messageId/swipeId 变化，重新加载 */
watch(
  () => [panelStore.messageId, panelStore.swipeId],
  () => {
    loadStatus();
  },
  { immediate: true },
);

/** 持久化当前快照到最新 AI 楼层 */
function persist() {
  const messageId = panelStore.messageId;
  if (messageId === null) return;
  setMessageUserStatus(messageId, panelStore.swipeId, {
    entries: snapshot.entries,
    arousal: snapshot.arousal,
    time_hint: snapshot.time_hint,
    updatedAt: Date.now(),
  });
  refreshStatusInjection();
}

function startEdit(index: number) {
  editingIndex.value = index;
  const entry = snapshot.entries[index];
  editCategory.value = entry.category;
  editText.value = entry.text;
  editIntensity.value = entry.intensity ?? '';
}

function saveEdit() {
  if (editingIndex.value === null) return;
  const i = editingIndex.value;
  const category = editCategory.value;
  const text = editText.value.trim();
  if (!text) {
    removeEntry(i);
    return;
  }
  const intensity = typeof editIntensity.value === 'number' && Number.isFinite(editIntensity.value)
    ? Math.max(0, Math.min(100, Math.round(editIntensity.value)))
    : undefined;
  snapshot.entries[i] = {
    ...snapshot.entries[i],
    category,
    text,
    intensity,
    source: 'manual',
    updatedAt: Date.now(),
  };
  editingIndex.value = null;
  persist();
}

function cancelEdit() {
  editingIndex.value = null;
}

function removeEntry(index: number) {
  snapshot.entries.splice(index, 1);
  editingIndex.value = null;
  persist();
}

function addEntry() {
  const entry: StatusEntry = {
    id: uuidv4(),
    category: '体感',
    text: '',
    source: 'manual',
    updatedAt: Date.now(),
  };
  snapshot.entries.push(entry);
  editingIndex.value = snapshot.entries.length - 1;
  editCategory.value = entry.category;
  editText.value = '';
  editIntensity.value = '';
}

function toggleEditArousal() {
  if (editingArousal.value) {
    editingArousal.value = false;
  } else {
    if (snapshot.arousal) {
      editArousal.value = klona(snapshot.arousal);
    }
    editingArousal.value = true;
  }
}

function saveEditArousal() {
  snapshot.arousal = klona(editArousal.value);
  editingArousal.value = false;
  persist();
}

async function onRefresh() {
  const messageId = panelStore.messageId ?? getLatestAiMessageId();
  if (messageId === null) return;
  const result = await updateUserStatus(messageId, panelStore.swipeId);
  if (result) {
    snapshot.entries = result.entries;
    snapshot.arousal = result.arousal;
    snapshot.time_hint = result.time_hint;
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

.choice-status-time-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  font-weight: 400;
}

.choice-status-time-hint i {
  font-size: 10px;
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
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

/* ---- 唤起状态卡片 ---- */
.choice-arousal-card {
  border-radius: var(--choice-radius-sm);
  background: var(--choice-surface-2);
  border: 1px solid var(--choice-border);
  padding: var(--choice-space-2) var(--choice-space-3);
  transition: border-color var(--choice-transition);
}

.choice-arousal-card--平静 { border-left: 3px solid #94a3b8; }
.choice-arousal-card--兴奋 { border-left: 3px solid #fb923c; }
.choice-arousal-card--临界 { border-left: 3px solid #ef4444; }
.choice-arousal-card--不应期 { border-left: 3px solid #3b82f6; }

.choice-arousal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--choice-space-1);
}

.choice-arousal-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--choice-radius-full);
  font-size: var(--choice-text-xs);
  font-weight: 700;
}

.choice-arousal-badge--平静 { background: rgba(148,163,184,0.15); color: #94a3b8; }
.choice-arousal-badge--兴奋 { background: rgba(251,146,60,0.15); color: #fb923c; }
.choice-arousal-badge--临界 { background: rgba(239,68,68,0.15); color: #ef4444; }
.choice-arousal-badge--不应期 { background: rgba(59,130,246,0.15); color: #3b82f6; }

.choice-arousal-body {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-arousal-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-arousal-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  width: 36px;
  flex-shrink: 0;
}

.choice-arousal-bar {
  flex: 1;
  height: 8px;
  border-radius: var(--choice-radius-full);
  background: var(--choice-border);
  overflow: hidden;
}

.choice-arousal-bar-fill {
  height: 100%;
  border-radius: var(--choice-radius-full);
  background: var(--choice-color-warning);
  transition: width var(--choice-transition);
}

.choice-arousal-value {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
  width: 36px;
  text-align: right;
  flex-shrink: 0;
}

.choice-arousal-meta {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-arousal-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--choice-radius-sm);
  background: var(--choice-color-primary-bg);
  color: var(--choice-color-primary);
  font-size: var(--choice-text-xs);
  font-weight: 600;
}

.choice-arousal-text {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-arousal-edit {
  margin-top: var(--choice-space-2);
  padding-top: var(--choice-space-2);
  border-top: 1px solid var(--choice-border);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-arousal-edit-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-arousal-field-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  width: 48px;
  flex-shrink: 0;
}

.choice-arousal-select,
.choice-arousal-input {
  flex: 1;
  font-size: var(--choice-text-xs);
  padding: 4px var(--choice-space-1);
  border-radius: 4px;
  border: 1px solid var(--choice-border-strong);
  background: var(--choice-bg);
  color: var(--choice-text);
  outline: none;
}

.choice-arousal-select:focus,
.choice-arousal-input:focus {
  border-color: var(--choice-border-active);
}

.choice-arousal-edit-actions {
  display: flex;
  justify-content: flex-end;
}

/* ---- 条目列表 ---- */
.choice-status-chips {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-status-chip {
  display: flex;
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
  flex-wrap: wrap;
}

.choice-status-chip-label {
  font-weight: 700;
  color: var(--choice-color-warning);
  white-space: nowrap;
  flex-shrink: 0;
}

.choice-status-chip-desc {
  color: var(--choice-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.choice-status-chip-intensity {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--choice-radius-full);
  background: var(--choice-bg-hover);
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  flex-shrink: 0;
}

.choice-status-chip-select {
  width: 70px;
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-1);
  border-radius: 4px;
  border: 1px solid var(--choice-border-strong);
  background: var(--choice-bg);
  color: var(--choice-text);
  flex-shrink: 0;
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

.choice-status-chip-input:focus {
  border-color: var(--choice-border-active);
}

.choice-status-chip-input--desc {
  flex: 1;
  min-width: 120px;
}

.choice-status-chip-input--intensity {
  width: 56px;
  flex-shrink: 0;
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

.choice-status-chip-btn--primary {
  color: var(--choice-color-primary);
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
  margin-top: var(--choice-space-1);
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
