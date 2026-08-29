<template>
  <Teleport to="body">
    <div v-if="open" class="choice-strdlg-overlay" @click.self="onCancel">
      <div class="choice-strdlg-dialog">
        <div class="choice-strdlg-header">
          <span class="choice-strdlg-title">
            <i class="fa-solid fa-file-import"></i>
            {{ t`从酒馆导入` }}
          </span>
          <button class="choice-strdlg-close" :title="t`取消`" @click="onCancel">&times;</button>
        </div>

        <div class="choice-strdlg-body choice-scrollbar">
          <!-- 导入方式与目标：目标是正则库内部分组（category），与过滤页的三个正则区无关 -->
          <div class="choice-strdlg-fields">
            <label class="choice-strdlg-field">
              <span class="choice-strdlg-field-label">{{ t`导入来源` }}</span>
              <select v-model="zone" class="text_pole">
                <option value="global">{{ t`全局正则（酒馆全局）` }}</option>
                <option value="preset">{{ presetOptionLabel }}</option>
                <option value="character">{{ characterOptionLabel }}</option>
              </select>
            </label>
            <label class="choice-strdlg-field">
              <span class="choice-strdlg-field-label">{{ t`导入到正则库分组` }}</span>
              <select v-model="targetMode" class="text_pole">
                <option v-for="c in categories" :key="c.value" :value="c.value">{{ c.label }}</option>
                <option value="__new__">{{ t`新建分组…` }}</option>
              </select>
            </label>
          </div>
          <!-- 新建分组的命名独立成整行，避免挤在半列里；重名时行内警告并禁用确认 -->
          <div v-if="targetMode === '__new__'" class="choice-strdlg-field choice-strdlg-newname">
            <span class="choice-strdlg-field-label">{{ t`分组名称` }}</span>
            <input
              v-model="newCategoryName"
              class="text_pole"
              :class="{ 'is-conflict': newNameConflict }"
              :placeholder="t`输入新分组名称`"
            />
            <span v-if="newNameConflict" class="choice-strdlg-warn">
              {{ t`已存在同名分组，请换一个名称，或直接在上方选择它` }}
            </span>
          </div>

          <div v-if="scripts.length > 0" class="choice-strdlg-list">
            <label
              v-for="(s, i) in scripts"
              :key="i"
              class="choice-strdlg-entry"
              :class="{ 'is-disabled': s.disabled, 'is-display-only': isDisplayOnly(s) }"
              :title="isDisplayOnly(s) ? t`该正则仅用于聊天显示美化，导入为过滤规则会改废正文，已禁止导入` : undefined"
            >
              <input type="checkbox" :checked="selected.has(i)" :disabled="isDisplayOnly(s)" @change="toggle(i)" />
              <span class="choice-strdlg-name">{{ s.scriptName || s.script_name || t`未命名` }}</span>
              <span v-if="isDisplayOnly(s)" class="choice-strdlg-badge choice-strdlg-badge--warn">{{
                t`仅显示美化`
              }}</span>
              <span v-else-if="s.promptOnly && s.markdownOnly" class="choice-strdlg-badge">{{ t`显示+提示词` }}</span>
              <span v-else-if="s.promptOnly" class="choice-strdlg-badge">{{ t`仅提示词` }}</span>
              <span v-if="s.disabled" class="choice-strdlg-badge">{{ t`已禁用` }}</span>
              <span class="choice-strdlg-pattern" :title="s.findRegex">{{ preview(s.findRegex) }}</span>
              <span v-if="s.replaceString" class="choice-strdlg-replace" :title="s.replaceString">
                → {{ preview(s.replaceString) }}
              </span>
            </label>
          </div>
          <div v-else class="choice-empty-hint">
            <span>{{ emptyHint }}</span>
          </div>
        </div>

        <div class="choice-strdlg-footer">
          <span class="choice-strdlg-count">{{ t`已选 ${selected.size} 条` }}</span>
          <button class="menu_button" @click="onCancel">{{ t`取消` }}</button>
          <button
            class="menu_button menu_button_default"
            :disabled="selected.size === 0 || newNameConflict"
            @click="onConfirm"
          >
            {{ t`确认导入` }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';
import {
  getStCharacterName,
  getStRegexScripts,
  mapStScriptToLibraryEntry,
  type StRegexScript,
} from '@/core/st-regex-source';

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  close: [];
}>();

const gs = useGlobalSettingsStore();
const zone = ref<'global' | 'preset' | 'character'>('global');
const targetMode = ref<string>('__new__');
const newCategoryName = ref('');
const scripts = ref<StRegexScript[]>([]);
const selected = ref<Set<number>>(new Set());

// 打开或切换来源时重读 ST 对应区正则（live，不缓存——酒馆端随时可改），清空勾选，
// 并按来源预填新分组名（可直接改）
watch(
  [() => props.open, zone],
  ([openVal]) => {
    if (openVal) {
      scripts.value = getStRegexScripts(zone.value);
      selected.value = new Set();
      newCategoryName.value =
        zone.value === 'global' ? t`酒馆全局正则` : zone.value === 'preset' ? t`酒馆预设正则` : t`酒馆角色卡正则`;
    }
  },
  { immediate: true },
);

// 正则库现有分组（category 去重），未分组固定在最前
const categories = computed(() => {
  const set = new Set<string>();
  for (const e of gs.settings.filter_settings.regex_library) {
    const c = (e.category ?? '').trim();
    if (c) set.add(c);
  }
  return [
    { value: '', label: t`未分组` },
    ...[...set].sort((a, b) => a.localeCompare(b)).map(c => ({ value: c, label: c })),
  ];
});

// 新分组名与已有分组重名（或占用内置"未分组"名）时禁止导入
const newNameConflict = computed(() => {
  if (targetMode.value !== '__new__') return false;
  const name = newCategoryName.value.trim();
  if (!name) return false;
  return name === t`未分组` || categories.value.some(c => c.value === name);
});

const presetOptionLabel = computed(() =>
  gs.currentPresetName ? `${t`预设正则`}（${gs.currentPresetName}）` : `${t`预设正则`}（${t`未选择预设`}）`,
);
const characterOptionLabel = computed(() => {
  const cname = getStCharacterName(gs.currentCharacterId);
  return cname ? `${t`角色卡正则`}（${cname}）` : `${t`角色卡正则`}（${t`未选择角色卡`}）`;
});

const emptyHint = computed(() =>
  zone.value === 'global'
    ? t`酒馆全局正则为空`
    : zone.value === 'character'
      ? t`未选择角色卡或该角色卡无局部正则`
      : t`未选择预设或该预设无正则`,
);

const preview = (s: string) => (s.length > 56 ? s.slice(0, 56) + '…' : s);

// 纯显示美化：markdownOnly 勾选且未勾 promptOnly（engine.js:348-355，此类脚本只在显示渲染时生效，
// AI 在正常聊天里看到的永远是原文）——导入为过滤规则会把显示侧变换套到提示词历史，改废正文，故禁止
const isDisplayOnly = (s: StRegexScript) => s.markdownOnly === true && s.promptOnly !== true;

const toggle = (i: number) => {
  if (selected.value.has(i)) selected.value.delete(i);
  else selected.value.add(i);
};

const onConfirm = () => {
  if (selected.value.size === 0 || newNameConflict.value) return;
  // 仅写入正则库的目标分组（category），不触碰过滤页三个正则区
  let category = '';
  if (targetMode.value === '__new__') {
    category = newCategoryName.value.trim();
    if (!category) {
      toastr.error(t`请输入新分组名称`);
      return;
    }
  } else {
    category = targetMode.value; // '' = 未分组
  }

  const fs = gs.settings.filter_settings;
  // 去重只看目标分组内：同脚本可分别导入不同分组，各自独立成条目；
  // 仅当目标分组内已有同 (name+pattern+replace) 时跳过（不改动其原分组归属）
  const SEP = '\u0000';
  const libTuples = new Set(
    fs.regex_library
      .filter(e => (e.category ?? '') === category)
      .map(e => `${e.name}${SEP}${e.pattern}${SEP}${e.replace ?? ''}`),
  );
  let added = 0;
  let dup = 0;
  for (const i of selected.value) {
    const entry = mapStScriptToLibraryEntry(scripts.value[i]);
    entry.category = category;
    const key = `${entry.name}${SEP}${entry.pattern}${SEP}${entry.replace}`;
    if (libTuples.has(key)) {
      dup++;
      continue;
    }
    libTuples.add(key);
    fs.regex_library.push(entry);
    added++;
  }

  const label = category || t`未分组`;
  if (added === 0) {
    toastr.info(t`所选正则均已存在于分组「${label}」`);
  } else {
    const parts = [t`已导入 ${added} 条到分组「${label}」`];
    if (dup > 0) parts.push(t`跳过 ${dup} 条重复`);
    toastr.success(parts.join('，'));
  }
  emit('close');
};

const onCancel = () => {
  emit('close');
};
</script>

<style scoped>
.choice-strdlg-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  /* 常态从正则库弹窗内打开，需叠在其上 */
  z-index: calc(var(--choice-z-dialog) + 10);
  background: var(--choice-overlay);
  display: flex;
  justify-content: center;
  overflow-y: auto;
}
.choice-strdlg-dialog {
  width: 560px;
  max-width: 92vw;
  max-height: 80vh;
  margin: auto;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-lg);
  box-shadow:
    inset 0 1px 0 var(--choice-frost-line),
    var(--choice-shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.choice-strdlg-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--choice-space-3) var(--choice-space-4);
  background: linear-gradient(180deg, rgba(var(--choice-primary-rgb), 0.08), transparent);
  border-bottom: 1px solid var(--choice-border);
}
.choice-strdlg-title {
  font-size: var(--choice-text-base);
  font-weight: bold;
  color: var(--choice-text);
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
}
.choice-strdlg-close {
  background: none;
  border: none;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xl);
  cursor: pointer;
  line-height: 1;
  padding: 0 var(--choice-space-1);
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.choice-strdlg-close:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text);
}
.choice-strdlg-body {
  overflow-y: auto;
  padding: var(--choice-space-4);
  flex: 1;
}
.choice-strdlg-fields {
  display: flex;
  gap: var(--choice-space-3);
  margin-bottom: var(--choice-space-3);
}
.choice-strdlg-field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}
.choice-strdlg-field-label {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}
.choice-strdlg-field select,
.choice-strdlg-field input {
  width: 100%;
  font-size: var(--choice-text-sm);
}
/* 新建分组命名行：独立整行铺满 */
.choice-strdlg-newname {
  margin-top: calc(-1 * var(--choice-space-1));
  margin-bottom: var(--choice-space-3);
}
.choice-strdlg-newname input.is-conflict {
  border-color: var(--choice-color-error);
}
.choice-strdlg-warn {
  font-size: var(--choice-text-xs);
  color: var(--choice-color-error);
}
/* 仅显示美化（markdownOnly）脚本：禁选导入 */
.choice-strdlg-entry.is-display-only {
  opacity: 0.45;
  cursor: not-allowed;
}
.choice-strdlg-entry.is-display-only input[type='checkbox'] {
  cursor: not-allowed;
}
.choice-strdlg-badge--warn {
  color: var(--choice-color-warning, #d4a017);
}
.choice-strdlg-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}
.choice-strdlg-entry {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  border: 1px solid var(--choice-border);
  cursor: pointer;
  font-size: var(--choice-text-sm);
}
.choice-strdlg-entry:hover {
  background: var(--choice-bg-hover);
}
.choice-strdlg-entry.is-disabled {
  opacity: 0.5;
}
.choice-strdlg-name {
  font-weight: 600;
  color: var(--choice-text);
  flex-shrink: 0;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-strdlg-badge {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-sm);
  padding: 0 var(--choice-space-1);
  flex-shrink: 0;
}
.choice-strdlg-pattern {
  color: var(--choice-text-secondary);
  font-family: var(--choice-font-mono, monospace);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.choice-strdlg-replace {
  color: var(--choice-text-muted);
  font-family: var(--choice-font-mono, monospace);
  flex-shrink: 0;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.choice-strdlg-footer {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-3) var(--choice-space-4);
  border-top: 1px solid var(--choice-border);
  background: var(--choice-bg-card);
}
.choice-strdlg-count {
  margin-right: auto;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
}
</style>
