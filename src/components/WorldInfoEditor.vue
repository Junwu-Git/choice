<template>
  <div class="choice-wi-editor">
    <div class="choice-wi-checks" data-tour="wi-checks">
      <label class="choice-check">
        <input v-model="globalStore.settings.world_info.enabled" type="checkbox" />
        {{ t`启用世界书` }}
      </label>
      <label
        class="choice-check"
        :title="
          t`开启后世界书条目先展开 {{宏}}；若装了『提示词模板』插件且条目含 <% %>，会执行其中 JS，让按好感度切换人设等动态条目拿到成品而非原文。未装插件时仅展宏。含写变量（setvar）的 EJS 每次生成会执行并可能改变变量状态，遇到这类世界书可关闭。`
        "
      >
        <input v-model="globalStore.settings.world_info.render_world_info_ejs" type="checkbox" />
        {{ t`EJS 渲染` }}
      </label>
    </div>

    <button class="menu_button" :title="t`从酒馆重新加载世界书列表和条目`" @click="refreshAll">
      {{ t`刷新列表` }}
    </button>

    <div class="choice-wi-global-excl" data-tour="wi-excl">
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
        <input v-model="globalExclSearch" class="text_pole choice-wi-search" :placeholder="t`搜索世界书名`" />
        <div class="choice-wi-list choice-wi-available">
          <div v-if="availableGlobalExclBooks.length === 0" class="choice-empty-hint">
            {{ t`无可添加的世界书` }}
          </div>
          <div
            v-for="name in availableGlobalExclBooks"
            :key="name"
            class="choice-wi-row available"
            @click.stop="addGlobalExcl(name)"
          >
            <span class="choice-wi-name">{{ name }}</span>
            <button class="choice-wi-enable-btn" @click.stop="addGlobalExcl(name)">{{ t`添加` }}</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="activeBooks.length > 0" data-tour="wi-books">
      <div class="choice-wi-section-title">{{ t`已启用的世界书` }}</div>
      <div class="choice-wi-list">
        <template v-for="book in activeBooks" :key="book.name">
          <div
            class="choice-wi-row"
            :class="{ excluded: getBookMode(book.name) === 'off' || isBookGloballyExcluded(book.name) }"
            @click="toggleBookExpand(book.name)"
          >
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
            <span v-if="getBookMode(book.name) === 'custom'" class="choice-wi-badge badge-custom">{{ t`自定义` }}</span>
            <!-- 三态钩 + 自定义：循环 条目全关 → 条目启用（默认）→ 条目全启用；勾选条目进入自定义 -->
            <span
              class="choice-wi-mode"
              :class="[`mode-${getBookMode(book.name)}`, { 'mode-disabled': isBookGloballyExcluded(book.name) }]"
              :title="bookModeTitle(book.name)"
              @click.stop="cycleBookMode(book.name)"
            >
              <i v-if="getBookMode(book.name) === 'force'" class="fa-solid fa-check choice-wi-mode-check"></i>
              <span v-else-if="getBookMode(book.name) !== 'off'" class="choice-wi-mode-block"></span>
            </span>
            <span v-if="isBookGloballyExcluded(book.name)" class="choice-wi-badge badge-global-excl">{{
              t`全局排除`
            }}</span>
          </div>
          <div v-if="bookExpanded.has(book.name) && bookEntries[book.name]" class="choice-wi-entries">
            <div
              v-for="entry in bookEntries[book.name]"
              :key="entry.uid"
              class="choice-wi-entry"
              :class="{ disabled: getBookMode(book.name) === 'follow' && entry.disable }"
            >
              <span class="choice-wi-entry-state">{{ entryStateIcon(entry) }}</span>
              <span class="choice-wi-entry-name">{{ entry.comment || entry.key?.[0] || `#${entry.uid}` }}</span>
              <!-- 条目勾选跟随书模式联动：全关=全空、启用=按酒馆/覆盖、全启用=全勾；任意模式勾选即进入自定义 -->
              <input
                type="checkbox"
                :checked="isEntryOn(book.name, entry)"
                :title="t`点击开启/关闭该条目（进入自定义模式）`"
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

    <div class="choice-hint">
      {{ t`钩子点击循环条目模式：全关 → 启用（默认）→ 全启用（☑️）；直接勾选条目进入自定义模式，逐条开关` }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { this_chid, eventSource, event_types } from '@sillytavern/script';
import { getStCharacter } from '@/core/st-character';
import { loadWorldInfo, selected_world_info, world_names } from '@sillytavern/scripts/world-info';
import toastr from 'toastr';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { WIBookMode } from '@/type/settings';

const chatStore = useChatSettingsStore();
const globalStore = useGlobalSettingsStore();

/** loadWorldInfo 的酒馆官方 JSDoc 只写了 Object|null（world-info.js），实际返回世界书数据
 *  { entries: Record<uid, 条目> }；本组件只消费这几个字段，按使用面声明，调用点显式断言 */
type LoadedWorldInfo = {
  entries?: Record<
    string,
    {
      uid?: number;
      comment?: string;
      key?: string[] | string;
      content?: string;
      constant?: boolean;
      disable?: boolean;
      vectorized?: boolean;
    }
  >;
} | null;

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
const globalExclSearch = ref('');

const activeBooks = computed(() =>
  allBooks.value.filter(b => b.active || chatStore.settings.world_info.enabled_books.includes(b.name)),
);
const inactiveBooks = computed(() =>
  allBooks.value.filter(b => !b.active && !chatStore.settings.world_info.enabled_books.includes(b.name)),
);

const globalExcludedBooks = computed(() => globalStore.settings.world_info.global_excluded_books);

const availableGlobalExclBooks = computed(() => {
  const excluded = new Set(globalExcludedBooks.value);
  const kw = globalExclSearch.value.trim().toLowerCase();
  return (world_names ?? []).filter(name => !excluded.has(name) && (!kw || name.toLowerCase().includes(kw)));
});

const isBookGloballyExcluded = (name: string) => globalStore.settings.world_info.global_excluded_books.includes(name);

const addGlobalExcl = (name: string) => {
  if (!name) return;
  const list = globalStore.settings.world_info.global_excluded_books;
  if (!list.includes(name)) list.push(name);
};

const removeGlobalExcl = (name: string) => {
  const list = globalStore.settings.world_info.global_excluded_books;
  const idx = list.indexOf(name);
  if (idx !== -1) list.splice(idx, 1);
};

// 三态条目模式：无记录按 follow（条目启用）处理
const getBookMode = (name: string): WIBookMode => chatStore.settings.world_info.book_entry_modes[name] ?? 'follow';

const cycleBookMode = (name: string) => {
  if (isBookGloballyExcluded(name)) return;
  const modes = chatStore.settings.world_info.book_entry_modes;
  // 循环顺序与用户列举一致：全关 → 启用（默认）→ 全启用 → 全关
  const next: WIBookMode = getBookMode(name) === 'off' ? 'follow' : getBookMode(name) === 'follow' ? 'force' : 'off';
  modes[name] = next;
};

const bookModeTitle = (name: string) => {
  const mode = getBookMode(name);
  if (mode === 'off') return t`条目全部关闭（点击：条目启用）`;
  if (mode === 'force') return t`条目全启用——无视酒馆关闭条目（点击：条目全部关闭）`;
  if (mode === 'custom') return t`自定义条目开关（点击：条目全部关闭）`;
  return t`条目启用——酒馆里关闭的条目也关闭（默认；点击：条目全启用）`;
};

// 条目勾选框状态跟随书模式联动：全关=全空；条目启用=酒馆原生 disable（纯酒馆态）；
// 全启用=全勾；自定义=按覆盖逐条（覆盖仅自定义模式生效，切换模式即脱离自定义）
const isEntryOn = (bookName: string, entry: EntryInfo) => {
  const mode = getBookMode(bookName);
  if (mode === 'off') return false;
  if (mode === 'force') return true;
  if (mode === 'custom') {
    const ov = chatStore.settings.world_info.book_entry_overrides[bookName]?.[String(entry.uid)];
    return typeof ov === 'boolean' ? ov : !entry.disable;
  }
  return !entry.disable;
};

const enableBook = async (name: string) => {
  const enabled = chatStore.settings.world_info.enabled_books;
  const excluded = chatStore.settings.world_info.excluded_books;
  if (!enabled.includes(name)) enabled.push(name);
  const xi = excluded.indexOf(name);
  if (xi !== -1) excluded.splice(xi, 1);
  try {
    const data = (await loadWorldInfo(name)) as LoadedWorldInfo;
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

/** 任意模式下手动勾选条目：非 custom 先快照当前显示态（该书全部条目的勾选显示）进 overrides
 *  并切入 custom（toastr 提醒），再翻转所点条目；custom 下直接翻转对应覆盖位。 */
const toggleEntry = (bookName: string, uid: string | number) => {
  const wi = chatStore.settings.world_info;
  const uidKey = String(uid);
  if (getBookMode(bookName) !== 'custom') {
    const snap: Record<string, boolean> = {};
    for (const e of bookEntries.value[bookName] ?? []) {
      snap[String(e.uid)] = isEntryOn(bookName, e);
    }
    wi.book_entry_overrides[bookName] = snap;
    wi.book_entry_modes[bookName] = 'custom';
    toastr.info(t`已进入自定义模式：「${bookName}」条目按手动开关逐条生效`);
  }
  const bookOverrides = wi.book_entry_overrides[bookName] ?? {};
  const cur = bookOverrides[uidKey] ?? (isEntryOn(bookName, { uid: uid } as EntryInfo) as boolean);
  wi.book_entry_overrides[bookName] = { ...bookOverrides, [uidKey]: !cur };
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
  const charWorld = getStCharacter(this_chid)?.data?.extensions?.world as string | undefined;
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
      const data = (await loadWorldInfo(book.name)) as LoadedWorldInfo;
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
  // v22 起不再把酒馆 disable 的条目自动复制进 excluded_entries：ST 关闭状态由三态模式的
  // follow 档直接承担，excluded_entries 只存用户在本扩展里的显式条目排除（否则 force
  // 档"无视酒馆关闭条目"会被自动复制的旧数据破坏）
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

/* 已排除列表与可添加列表同样限高滚动，防止排除上百本时撑长整页；
 * 行需 flex-shrink:0——否则 flex 列容器会把全部行压缩进限高内（无滚动条、行不可读） */
.choice-wi-global-excl-body > .choice-wi-list {
  max-height: 180px;
  overflow-y: auto;
}

.choice-wi-global-excl-body .choice-wi-row {
  flex-shrink: 0;
}

.choice-wi-row.excluded-global {
  opacity: 0.6;
  background: rgba(255, 100, 100, 0.08);
  border-color: rgba(255, 100, 100, 0.3);
}

.choice-wi-search {
  width: 100%;
  padding: var(--choice-space-1) var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  color: var(--choice-text-secondary);
  font-size: var(--choice-text-sm);
}

.choice-wi-available {
  max-height: 180px;
  overflow-y: auto;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  padding: var(--choice-space-1);
}

.choice-wi-row.available {
  cursor: pointer;
}

/* 三态钩自绘指示器：空框（off）→ 内嵌块留间隔（follow，默认）→ 框内 ☑️ 打勾（force）；横杠（custom） */
.choice-wi-mode {
  width: 14px;
  height: 14px;
  border: 1px solid var(--choice-border-strong);
  border-radius: 2px;
  background: var(--choice-bg-card);
  position: relative;
  flex-shrink: 0;
  cursor: pointer;
}

.choice-wi-mode.mode-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.choice-wi-mode-block {
  position: absolute;
  display: none;
}

.choice-wi-mode.mode-follow .choice-wi-mode-block {
  display: block;
  inset: 3px;
  background: var(--choice-text-secondary);
}

/* custom：横杠（indeterminate 样式） */
.choice-wi-mode.mode-custom .choice-wi-mode-block {
  display: block;
  inset: 5px 3px;
  background: var(--choice-text-muted);
}

.choice-wi-mode-check {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: var(--choice-text);
}

.badge-custom {
  background: var(--choice-color-warning-bg);
}

.choice-wi-entry input[type='checkbox']:disabled {
  cursor: not-allowed;
}

.badge-global-excl {
  background: rgba(255, 100, 100, 0.5);
  color: var(--choice-text-on-primary);
}
</style>
