<template>
  <div class="choice-wi-editor">
    <div class="choice-wi-checks">
      <label class="choice-check">
        <input v-model="globalStore.settings.world_info.enabled" type="checkbox" />
        {{ t`启用世界书` }}
      </label>
    </div>

    <button class="menu_button" :title="t`从酒馆重新加载世界书列表和条目`" @click="refreshAll">
      {{ t`刷新列表` }}
    </button>

    <div class="choice-wi-global-excl">
      <div class="choice-wi-section-title choice-wi-collapsible" @click="showGlobalExcl = !showGlobalExcl">
        <i class="fa-solid" :class="showGlobalExcl ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        {{ t`全局排除` }}
        <span class="choice-wi-count" v-if="globalExcludedBooks.length > 0">({{ globalExcludedBooks.length }})</span>
      </div>
      <div v-if="showGlobalExcl" class="choice-wi-global-excl-body">
        <div v-if="globalExcludedBooks.length === 0" class="choice-empty-hint">
          {{ t`未设置全局排除。全局排除的世界书在所有聊天中永久不被选项生成参考。` }}
        </div>
        <div class="choice-wi-list">
          <div v-for="name in globalExcludedBooks" :key="name" class="choice-wi-row excluded-global">
            <span class="choice-wi-name">{{ name }}</span>
            <button class="choice-wi-enable-btn" @click.stop="removeGlobalExcl(name)">{{ t`移除` }}</button>
          </div>
        </div>
        <select class="choice-wi-global-excl-select" v-model="selectedGlobalExcl" @change="addGlobalExcl">
          <option value="">{{ t`-- 添加世界书到全局排除 --` }}</option>
          <option v-for="name in availableGlobalExclBooks" :key="name" :value="name">{{ name }}</option>
        </select>
      </div>
    </div>

    <div v-if="activeBooks.length > 0">
      <div class="choice-wi-section-title">{{ t`已启用的世界书` }}</div>
      <div class="choice-wi-list">
        <template v-for="book in activeBooks" :key="book.name">
          <div class="choice-wi-row" :class="{ excluded: !isBookChecked(book) }" @click="toggleBookExpand(book.name)">
            <i class="fa-solid" :class="bookExpanded.has(book.name) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            <span class="choice-wi-light" :class="bookLightClass(book)"></span>
            <span class="choice-wi-name">{{ book.name }}</span>
            <span
              class="choice-wi-badge"
              :class="
                book.source === 'global'
                  ? 'badge-global'
                  : book.source === 'character'
                    ? 'badge-character'
                    : 'badge-plugin'
              "
            >
              {{ book.source === 'global' ? t`全局` : book.source === 'character' ? t`角色` : t`插件` }}
            </span>
            <input
              type="checkbox"
              :checked="isBookChecked(book)"
              :disabled="isBookGloballyExcluded(book)"
              @click.stop
              @change="toggleBook(book)"
            />
            <span v-if="isBookGloballyExcluded(book)" class="choice-wi-badge badge-global-excl">{{ t`全局排除` }}</span>
          </div>
          <div v-if="bookExpanded.has(book.name) && bookEntries[book.name]" class="choice-wi-entries">
            <div
              v-for="entry in bookEntries[book.name]"
              :key="entry.uid"
              class="choice-wi-entry"
              :class="{ excluded: isEntryExcluded(book.name, entry.uid), disabled: entry.disable }"
            >
              <span class="choice-wi-entry-state">{{ entryStateIcon(entry) }}</span>
              <span class="choice-wi-entry-name">{{ entry.comment || entry.key?.[0] || `#${entry.uid}` }}</span>
              <input
                type="checkbox"
                :checked="!isEntryExcluded(book.name, entry.uid)"
                @change="toggleEntry(book.name, entry.uid)"
              />
            </div>
          </div>
        </template>
      </div>
    </div>

    <div v-if="inactiveBooks.length > 0">
      <div class="choice-wi-section-title choice-wi-collapsible" @click="showInactive = !showInactive">
        <i class="fa-solid" :class="showInactive ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
        {{ t`未启用的世界书` }}
        <span class="choice-wi-count">({{ inactiveBooks.length }})</span>
      </div>
      <div v-if="showInactive" class="choice-wi-list">
        <div v-for="book in inactiveBooks" :key="book.name" class="choice-wi-row inactive">
          <span class="choice-wi-light"></span>
          <span class="choice-wi-name">{{ book.name }}</span>
          <button class="choice-wi-enable-btn" @click.stop="enableBook(book.name)">{{ t`启用` }}</button>
        </div>
      </div>
    </div>

    <div v-if="activeBooks.length === 0 && inactiveBooks.length === 0" class="choice-empty-hint">
      {{ t`未找到任何世界书` }}
    </div>

    <div class="choice-hint">{{ t`取消勾选可排除书或条目` }}</div>
  </div>
</template>

<script setup lang="ts">
import { characters, this_chid, eventSource, event_types } from '@sillytavern/script';
import { loadWorldInfo, selected_world_info, world_names } from '@sillytavern/scripts/world-info';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

const chatStore = useChatSettingsStore();
const globalStore = useGlobalSettingsStore();

type BookInfo = {
  name: string;
  source: 'global' | 'character' | '';
  active: boolean;
};

type EntryInfo = {
  uid: string | number;
  comment: string;
  key: string[];
  content: string;
  constant: boolean;
  disable: boolean;
  vectorized: boolean;
};

const allBooks = ref<BookInfo[]>([]);
const bookEntries = ref<Record<string, EntryInfo[]>>({});
const bookExpanded = ref<Set<string>>(new Set());
const showInactive = ref(false);
const showGlobalExcl = ref(false);
const selectedGlobalExcl = ref('');

const activeBooks = computed(() =>
  allBooks.value.filter(b => b.active || chatStore.settings.world_info.enabled_books.includes(b.name)),
);
const inactiveBooks = computed(() =>
  allBooks.value.filter(b => !b.active && !chatStore.settings.world_info.enabled_books.includes(b.name)),
);

const isBookExcluded = (name: string) => chatStore.settings.world_info.excluded_books.includes(name);
const isEntryExcluded = (bookName: string, uid: string | number) =>
  chatStore.settings.world_info.excluded_entries.includes(`${bookName}::${uid}`);

const isExtEnabled = (name: string) => chatStore.settings.world_info.enabled_books.includes(name);

const globalExcludedBooks = computed(() => globalStore.settings.world_info.global_excluded_books);

const availableGlobalExclBooks = computed(() => {
  const excluded = new Set(globalExcludedBooks.value);
  return (world_names ?? []).filter(name => !excluded.has(name));
});

const isBookGloballyExcluded = (book: BookInfo) =>
  globalStore.settings.world_info.global_excluded_books.includes(book.name);

const addGlobalExcl = () => {
  if (!selectedGlobalExcl.value) return;
  const list = globalStore.settings.world_info.global_excluded_books;
  if (!list.includes(selectedGlobalExcl.value)) {
    list.push(selectedGlobalExcl.value);
  }
  selectedGlobalExcl.value = '';
};

const removeGlobalExcl = (name: string) => {
  const list = globalStore.settings.world_info.global_excluded_books;
  const idx = list.indexOf(name);
  if (idx !== -1) list.splice(idx, 1);
};

const isBookChecked = (book: BookInfo) => {
  if (globalStore.settings.world_info.global_excluded_books.includes(book.name)) return false;
  if (chatStore.settings.world_info.excluded_books.includes(book.name)) return false;
  if (book.active) return true;
  return chatStore.settings.world_info.enabled_books.includes(book.name);
};

const toggleBook = (book: BookInfo) => {
  if (globalStore.settings.world_info.global_excluded_books.includes(book.name)) return;
  const enabled = chatStore.settings.world_info.enabled_books;
  const excluded = chatStore.settings.world_info.excluded_books;
  const wasChecked = isBookChecked(book);

  const removeFrom = (arr: string[], name: string) => {
    const i = arr.indexOf(name);
    if (i !== -1) arr.splice(i, 1);
  };

  if (wasChecked) {
    removeFrom(enabled, book.name);
    if (book.active && !excluded.includes(book.name)) excluded.push(book.name);
  } else {
    removeFrom(excluded, book.name);
    if (!book.active && !enabled.includes(book.name)) enabled.push(book.name);
  }
};

const enableBook = async (name: string) => {
  const enabled = chatStore.settings.world_info.enabled_books;
  const excluded = chatStore.settings.world_info.excluded_books;
  if (!enabled.includes(name)) enabled.push(name);
  const xi = excluded.indexOf(name);
  if (xi !== -1) excluded.splice(xi, 1);
  try {
    const data = await loadWorldInfo(name);
    if (data?.entries) {
      bookEntries.value = {
        ...bookEntries.value,
        [name]: Object.values(data.entries).map((e: any) => ({
          uid: e.uid,
          comment: e.comment ?? '',
          key: e.key ?? [],
          content: e.content ?? '',
          constant: e.constant ?? false,
          disable: e.disable ?? false,
          vectorized: e.vectorized ?? false,
        })),
      };
    }
  } catch {
    // ignore load errors
  }
};

const toggleBookExpand = (name: string) => {
  if (bookExpanded.value.has(name)) bookExpanded.value.delete(name);
  else bookExpanded.value.add(name);
};

const toggleEntry = (bookName: string, uid: string | number) => {
  const excluded = chatStore.settings.world_info.excluded_entries;
  const key = `${bookName}::${uid}`;
  const idx = excluded.indexOf(key);
  if (idx !== -1) excluded.splice(idx, 1);
  else excluded.push(key);
};

const bookLightClass = (book: BookInfo) => {
  if (!book.active) return '';
  return 'active';
};

const entryStateIcon = (entry: EntryInfo) => {
  if (entry.constant) return '🔵';
  if (entry.vectorized) return '🔗';
  return '🟢';
};

const refreshAll = async () => {
  const global = [...(selected_world_info ?? [])];
  const enabledSet = new Set(chatStore.settings.world_info.enabled_books);
  const chid = this_chid;
  const charWorld = chid !== undefined && characters[chid] ? characters[chid]?.data?.extensions?.world : undefined;
  const result: BookInfo[] = [];
  for (const name of world_names ?? []) {
    const isGlobal = global.includes(name) && !enabledSet.has(name);
    const isCharacter = charWorld === name;
    result.push({
      name,
      source: isGlobal ? 'global' : isCharacter ? 'character' : '',
      active: isGlobal || isCharacter,
    });
  }
  allBooks.value = result;

  const entries: Record<string, EntryInfo[]> = {};
  for (const book of result) {
    const isExtEnabled = chatStore.settings.world_info.enabled_books.includes(book.name);
    if (!book.active && !isExtEnabled) continue;
    try {
      const data = await loadWorldInfo(book.name);
      if (data?.entries) {
        entries[book.name] = Object.values(data.entries).map((e: any) => ({
          uid: e.uid,
          comment: e.comment ?? '',
          key: e.key ?? [],
          content: e.content ?? '',
          constant: e.constant ?? false,
          disable: e.disable ?? false,
          vectorized: e.vectorized ?? false,
        }));
      }
    } catch {
      // ignore load errors
    }
  }
  bookEntries.value = entries;

  const currentExcluded = new Set(chatStore.settings.world_info.excluded_entries);
  for (const [bookName, entryList] of Object.entries(entries)) {
    for (const entry of entryList) {
      if (entry.disable) {
        const key = `${bookName}::${entry.uid}`;
        if (!currentExcluded.has(key)) {
          chatStore.settings.world_info.excluded_entries.push(key);
        }
      }
    }
  }
};

onMounted(() => {
  refreshAll();
  if (this_chid === undefined) setTimeout(refreshAll, 500);
  eventSource.on(event_types.CHAT_CHANGED, refreshAll);
});
onActivated(refreshAll);
onUnmounted(() => {
  eventSource.removeListener(event_types.CHAT_CHANGED, refreshAll);
});
</script>

<style scoped>
.choice-wi-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-wi-checks {
  display: flex;
  gap: var(--choice-space-4);
  flex-wrap: wrap;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-xs);
  color: var(--choice-text-secondary);
}

.choice-wi-section-title {
  font-size: var(--choice-text-sm);
  font-weight: bold;
  color: var(--choice-text-muted);
  margin-top: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid var(--choice-border);
}

.choice-wi-collapsible {
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  user-select: none;
  transition: color var(--choice-transition);
}

.choice-wi-collapsible:hover {
  color: var(--choice-text-secondary);
}

.choice-wi-count {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  font-weight: normal;
}

.choice-wi-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
}

.choice-wi-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-1) var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  cursor: pointer;
  transition: background var(--choice-transition);
}

.choice-wi-row:hover {
  background: var(--choice-bg-hover);
}

.choice-wi-row.excluded {
  opacity: 0.4;
}

.choice-wi-row.inactive {
  opacity: 0.5;
}

.choice-wi-light {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--choice-bg-element);
  flex-shrink: 0;
}

.choice-wi-light.active {
  background: var(--choice-color-success);
  box-shadow: 0 0 6px var(--choice-color-success);
}

.choice-wi-name {
  flex: 1;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-wi-badge {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  color: var(--choice-text-on-primary);
  flex-shrink: 0;
}

.badge-global {
  background: var(--choice-color-info-bg);
}
.badge-character {
  background: var(--choice-color-warning-bg);
}
.badge-plugin {
  background: #4a8a6a;
}

.choice-wi-entries {
  margin-left: 24px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0 var(--choice-space-1) var(--choice-space-3);
  border-left: 1px solid var(--choice-border);
}

.choice-wi-entry {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: 2px var(--choice-space-2);
  font-size: var(--choice-text-xs);
}

.choice-wi-entry.excluded {
  opacity: 0.3;
  text-decoration: line-through;
}

.choice-wi-entry-state {
  font-size: var(--choice-text-sm);
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.choice-wi-entry.disabled {
  opacity: 0.4;
  filter: grayscale(1);
}

.choice-wi-entry-name {
  flex: 1;
  color: var(--choice-text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-wi-enable-btn {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-element);
  color: var(--choice-text-muted);
  cursor: pointer;
  flex-shrink: 0;
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition),
    color var(--choice-transition);
}
.choice-wi-enable-btn:hover {
  background: rgba(76, 175, 80, 0.2);
  border-color: rgba(76, 175, 80, 0.5);
  color: var(--choice-color-success);
}

.choice-empty-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-sm);
  padding: var(--choice-space-2) 0;
}

.choice-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
}

.choice-wi-global-excl {
  margin-bottom: var(--choice-space-1);
}

.choice-wi-global-excl-body {
  padding: var(--choice-space-2) 0;
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-wi-row.excluded-global {
  opacity: 0.6;
  background: rgba(255, 100, 100, 0.08);
  border-color: rgba(255, 100, 100, 0.3);
}

.choice-wi-global-excl-select {
  width: 100%;
  padding: var(--choice-space-1) var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-sm);
}

.badge-global-excl {
  background: rgba(255, 100, 100, 0.5);
  color: var(--choice-text-on-primary);
}
</style>
