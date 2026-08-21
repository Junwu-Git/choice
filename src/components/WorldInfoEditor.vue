<template>
  <div class="choice-wi-editor">
    <div class="choice-wi-checks">
      <label class="choice-check">
        <input v-model="chatStore.settings.world_info.enabled" type="checkbox" />
        {{ t`启用世界书` }}
      </label>
      <label class="choice-check">
        <input v-model="chatStore.settings.world_info.redlight_mode" type="checkbox" />
        {{ t`红绿灯过滤` }}
      </label>
      <label class="choice-check">
        <input v-model="chatStore.settings.world_info.ejs_compat" type="checkbox" />
        {{ t`EJS 兼容` }}
      </label>
    </div>

    <button class="menu_button" @click="refreshAll">{{ t`刷新列表` }}</button>

    <div v-if="activeBooks.length > 0">
      <div class="choice-wi-section-title">{{ t`已启用的世界书` }}</div>
      <div class="choice-wi-list">
        <template v-for="book in activeBooks" :key="book.name">
          <div class="choice-wi-row" :class="{ excluded: isBookExcluded(book.name) }" @click="toggleBookExpand(book.name)">
            <i class="fa-solid" :class="bookExpanded.has(book.name) ? 'fa-chevron-down' : 'fa-chevron-right'"></i>
            <span class="choice-wi-light" :class="bookLightClass(book)"></span>
            <span class="choice-wi-name">{{ book.name }}</span>
            <span class="choice-wi-badge" :class="book.source === 'global' ? 'badge-global' : 'badge-character'">
              {{ book.source === 'global' ? t`全局` : t`角色` }}
            </span>
            <input type="checkbox" :checked="!isBookExcluded(book.name)" @click.stop @change="toggleBook(book.name)" />
          </div>
          <div v-if="bookExpanded.has(book.name) && !isBookExcluded(book.name) && bookEntries[book.name]" class="choice-wi-entries">
            <div
              v-for="entry in bookEntries[book.name]"
              :key="entry.uid"
              class="choice-wi-entry"
              :class="{ excluded: isEntryExcluded(book.name, entry.uid) }"
            >
              <span class="choice-wi-entry-light" :class="entryLightClass(entry)"></span>
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
      <div class="choice-wi-section-title">{{ t`未启用的世界书` }}</div>
      <div class="choice-wi-list">
        <div v-for="book in inactiveBooks" :key="book.name" class="choice-wi-row inactive">
          <span class="choice-wi-light"></span>
          <span class="choice-wi-name">{{ book.name }}</span>
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
import { characters, this_chid } from '@sillytavern/script';
import { loadWorldInfo, selected_world_info, world_names } from '@sillytavern/scripts/world-info';
import { useChatSettingsStore } from '@/store/chat-settings';

const chatStore = useChatSettingsStore();

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

const activeBooks = computed(() => allBooks.value.filter(b => b.active && !isBookExcluded(b.name)));
const inactiveBooks = computed(() => allBooks.value.filter(b => !b.active));

const isBookExcluded = (name: string) => chatStore.settings.world_info.excluded_books.includes(name);
const isEntryExcluded = (bookName: string, uid: string | number) =>
  chatStore.settings.world_info.excluded_entries.includes(`${bookName}::${uid}`);

const toggleBook = (name: string) => {
  const excluded = chatStore.settings.world_info.excluded_books;
  const idx = excluded.indexOf(name);
  if (idx !== -1) excluded.splice(idx, 1);
  else excluded.push(name);
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

const entryLightClass = (entry: EntryInfo) => {
  if (entry.disable) return 'red';
  if (entry.constant) return 'green';
  if (entry.vectorized) return 'blue';
  return 'normal';
};

const refreshAll = async () => {
  const global = [...(selected_world_info ?? [])];
  const chid = this_chid;
  const charWorld = chid !== undefined && characters[chid] ? characters[chid]?.data?.extensions?.world : undefined;
  const result: BookInfo[] = [];
  for (const name of world_names ?? []) {
    const isGlobal = global.includes(name);
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
    if (!book.active || isBookExcluded(book.name)) continue;
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
};

onMounted(refreshAll);
onActivated(refreshAll);
</script>

<style scoped>
.choice-wi-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.choice-wi-checks {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.choice-check {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #dcdcdc;
}

.choice-wi-section-title {
  font-size: 12px;
  font-weight: bold;
  color: #b0b0b0;
  margin-top: 4px;
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.25);
}

.choice-wi-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.choice-wi-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
  background: rgba(40, 40, 40, 0.3);
  cursor: pointer;
}

.choice-wi-row:hover {
  background: rgba(255, 255, 255, 0.04);
}

.choice-wi-row.excluded {
  opacity: 0.4;
}

.choice-wi-row.inactive {
  opacity: 0.5;
}

.choice-wi-light {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #555;
  flex-shrink: 0;
}

.choice-wi-light.active {
  background: #4caf50;
  box-shadow: 0 0 4px #4caf50;
}

.choice-wi-name {
  flex: 1;
  font-size: 12px;
  color: #dcdcdc;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-wi-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
  color: #fff;
  flex-shrink: 0;
}

.badge-global {
  background: #4a6a8a;
}
.badge-character {
  background: #8a6a4a;
}

.choice-wi-entries {
  margin-left: 22px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 0 4px;
}

.choice-wi-entry {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 6px;
  font-size: 11px;
}

.choice-wi-entry.excluded {
  opacity: 0.3;
  text-decoration: line-through;
}

.choice-wi-entry-light {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.choice-wi-entry-light.green {
  background: #4caf50;
}
.choice-wi-entry-light.red {
  background: #f44336;
}
.choice-wi-entry-light.blue {
  background: #2196f3;
}
.choice-wi-entry-light.normal {
  background: #888;
}

.choice-wi-entry-name {
  flex: 1;
  color: #b0b0b0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-empty-hint {
  color: #9a9a9a;
  font-size: 12px;
  padding: 8px 0;
}

.choice-hint {
  color: #9a9a9a;
  font-size: 11px;
}
</style>
