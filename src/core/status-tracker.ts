import { chat, saveChatDebounced, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '@sillytavern/script';
import toastr from 'toastr';
import { callSecondaryApiWithRetry } from '@/core/api-client';
import { buildMessages, resolveCustomApi, applyWIExcl, STRIP_REASONING_TAGS_RE, type Ctx } from '@/core/generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { pinia } from '@/pinia';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { setting_field, type UserStatusEntry, type UserStatusSnapshot } from '@/type/settings';

// 注入正文 AI 的 extension_prompt key（固定，与 ST extension_prompts 对象键一致）
const STATUS_INJECT_KEY = 'choice_user_status';

/** 状态更新加载状态：与 generatorState / poolGenState 分离，互不阻塞 */
export const statusTrackerState = reactive({ loading: false });
let statusController: AbortController | null = null;

export function cancelStatusUpdate() {
  statusController?.abort();
  statusController = null;
}

const getMessage = (messageId: number): StChatMessage | undefined => chat[messageId] as StChatMessage | undefined;

/** 读取某楼层某 swipe 的被动状态快照（null = 该楼层无快照） */
export function getMessageUserStatus(messageId: number, swipeId: number): UserStatusSnapshot | null {
  const message = getMessage(messageId);
  if (!message) return null;
  const data = message.extra?.[setting_field]?.[String(swipeId)];
  const status = data?.userStatus;
  if (!status) return null;
  return klona(status) as UserStatusSnapshot;
}

/** 写入某楼层某 swipe 的被动状态快照 */
export function setMessageUserStatus(messageId: number, swipeId: number, snapshot: UserStatusSnapshot | null) {
  const message = getMessage(messageId);
  if (!message) return;
  message.extra = message.extra || {};
  message.extra[setting_field] = message.extra[setting_field] || {};
  message.extra[setting_field][String(swipeId)] = message.extra[setting_field][String(swipeId)] || {};
  if (snapshot) {
    message.extra[setting_field][String(swipeId)].userStatus = klona(snapshot);
  } else {
    delete message.extra[setting_field][String(swipeId)].userStatus;
  }
  saveChatDebounced();
}

/** 取最新 AI 楼层的 index（与 panel-mount.getPanelMessageId 同逻辑） */
export function getLatestAiMessageId(): number | null {
  for (let i = chat.length - 1; i >= 0; i--) {
    const message = chat[i] as StChatMessage | undefined;
    if (message && !message.is_user && !message.is_system) {
      return i;
    }
  }
  return null;
}

/** 取最新 AI 楼层的 swipe_id */
function getLatestAiSwipeId(): number {
  const id = getLatestAiMessageId();
  if (id === null) return 0;
  return getMessage(id)?.swipe_id ?? 0;
}

/** 解析 AI 返回的状态更新 JSON。
 *  输出契约：JSON 数组，每项 { label, description }。
 *  容错：剥思维链标签、去代码块包裹、修尾随逗号、逐元素宽松取字段。
 *  与 parseOptions / parsePoolGenItems 刻意分离：状态输出契约是纯 JSON 数组，无 <options> 标签。 */
export function parseStatusUpdate(raw: string, maxEntries: number): UserStatusEntry[] {
  let c = raw.replace(STRIP_REASONING_TAGS_RE, '').trim();
  // 去代码块包裹
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const arrStart = c.indexOf('[');
  const arrEnd = c.lastIndexOf(']');
  if (arrStart === -1 || arrEnd <= arrStart) return [];

  // 修尾随逗号（引号感知，避免篡改字符串内逗号）
  const jsonStr = stripTrailingCommas(c.slice(arrStart, arrEnd + 1));
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const now = Date.now();
  const entries: UserStatusEntry[] = [];
  for (const item of parsed) {
    if (entries.length >= maxEntries) break;
    if (typeof item === 'string') {
      // 容错：字符串元素整条当 description，label 留空
      const s = item.trim();
      if (s) entries.push({ id: uuidv4(), label: '其他', description: s, source: 'auto', updatedAt: now });
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const label = typeof (item as any).label === 'string' ? (item as any).label.trim() : '';
    const description = typeof (item as any).description === 'string' ? (item as any).description.trim() : '';
    if (!label && !description) continue;
    entries.push({ id: uuidv4(), label: label || '其他', description, source: 'auto', updatedAt: now });
  }
  return entries;
}

// 字符串感知的尾随逗号清理（与 generator.stripTrailingCommas 同实现，避免循环依赖）
function stripTrailingCommas(s: string): string {
  let out = '';
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      out += ch;
      continue;
    }
    if (ch === ',') {
      let k = i + 1;
      while (k < s.length && (s[k] === ' ' || s[k] === '\t' || s[k] === '\n' || s[k] === '\r')) k++;
      if (s[k] === ']' || s[k] === '}') continue;
    }
    out += ch;
  }
  return out;
}

/** 将状态条目格式化为注入正文 AI 的文本 */
export function formatStatusForPrompt(entries: UserStatusEntry[]): string {
  if (entries.length === 0) return '';
  const lines = entries.map(e => `- [${e.label}] ${e.description}`);
  return `<user_passive_status>\n以下是 {{user}}（主角）此刻正在经历的被动状态——不受其主动意志控制的生理反应、环境感受、身体状态等。请在后续正文生成中自然地体现这些状态对 {{user}} 的影响，不要忽略或遗忘：\n${lines.join('\n')}\n</user_passive_status>`;
}

/** 注入（或清除）状态提示词到正文 AI。
 *  enabled=false 或 entries 为空时清除注入（设空值）。
 *  ST 的 extension_prompts 是全局对象，每次生成都会读取，故只需在状态变化时 set 即可 */
export function applyStatusInjection(enabled: boolean, entries: UserStatusEntry[], depth: number) {
  try {
    if (enabled && entries.length > 0) {
      const text = formatStatusForPrompt(entries);
      setExtensionPrompt(
        STATUS_INJECT_KEY,
        text,
        extension_prompt_types.IN_CHAT,
        depth,
        false,
        extension_prompt_roles.SYSTEM,
      );
    } else {
      // 空值清除：position=IN_CHAT + value='' 即不注入
      setExtensionPrompt(STATUS_INJECT_KEY, '', extension_prompt_types.IN_CHAT, depth, false, extension_prompt_roles.SYSTEM);
    }
  } catch (err) {
    console.warn('[Choice] applyStatusInjection failed', err);
  }
}

/** 刷新注入：从最新 AI 楼层读取状态快照，同步到 extension_prompts。
 *  在 GENERATION_STARTED 及状态变化时调用，确保正文 AI 拿到最新状态 */
export function refreshStatusInjection() {
  const cs = useChatSettingsStore(pinia);
  const st = cs.settings.status_tracking;
  if (!st.enabled || !st.inject_enabled) {
    applyStatusInjection(false, [], st.injection_depth);
    return;
  }
  const messageId = getLatestAiMessageId();
  if (messageId === null) {
    applyStatusInjection(false, [], st.injection_depth);
    return;
  }
  const swipeId = getLatestAiSwipeId();
  const snapshot = getMessageUserStatus(messageId, swipeId);
  const entries = snapshot?.entries ?? [];
  applyStatusInjection(true, entries, st.injection_depth);
}

/** AI 自动更新被动状态：读最新 AI 楼层的当前状态 + 最近正文 → 调副 API → 解析 → 落盘。
 *  复用 buildMessages 完整管线（世界书/过滤/角色卡/聊天历史），但只发 status_only + marker 模块。
 *  独立 loading 状态（statusTrackerState），与 generatorState 互不阻塞 */
export async function updateUserStatus(messageId: number, swipeId: number): Promise<UserStatusEntry[] | null> {
  if (statusTrackerState.loading) {
    toastr.info(t`状态更新中,请稍候`);
    return null;
  }

  const gs = useGlobalSettingsStore(pinia);
  const cs = useChatSettingsStore(pinia);
  const st = cs.settings.status_tracking;

  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) {
    toastr.warning(t`未配置 API，跳过状态更新`);
    return null;
  }

  statusTrackerState.loading = true;

  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;
  const allExcl = [...new Set([...gwi.global_excluded_books, ...cwi.excluded_books])];
  const restore = gwi.enabled
    ? await applyWIExcl(allExcl, cwi.enabled_books, cwi.book_entry_modes, cwi.book_entry_overrides)
    : null;

  try {
    // 当前状态快照 → JSON 文本供 {{status}} 占位
    const currentSnapshot = getMessageUserStatus(messageId, swipeId);
    const currentEntries = currentSnapshot?.entries ?? [];
    const statusJson = currentEntries.length > 0
      ? JSON.stringify(currentEntries.map(e => ({ label: e.label, description: e.description })), null, 2)
      : '[]';

    const ctx: Ctx = {
      count: 0,
      pinnedCount: 0,
      pinned: '',
      poolSelected: '',
      input: '',
      minChars: 0,
      maxChars: 0,
      enrichPersonStyle: '',
      optionPerson: '第三人称',
      enrichPerson: '第三人称',
      statusJson,
      maxEntries: st.max_entries,
    };

    const messages = await buildMessages(
      gs.sortedEnabledModules,
      ctx,
      gwi,
      st.context_rounds,
      false,
      true, // isStatus
    );

    statusController = new AbortController();
    const signal = statusController.signal;

    const raw = await callSecondaryApiWithRetry(messages, api, gs.settings.retry_count, gs.settings.retry_interval, signal);
    const entries = parseStatusUpdate(raw, st.max_entries);

    // 落盘到当前楼层快照
    const snapshot: UserStatusSnapshot = { entries, updatedAt: Date.now() };
    setMessageUserStatus(messageId, swipeId, snapshot);

    // 刷新正文注入
    refreshStatusInjection();

    return entries;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return null;
    console.error('[Choice] 状态更新失败', e);
    toastr.error(t`状态更新失败:${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    if (restore) restore.restore();
    statusController = null;
    statusTrackerState.loading = false;
  }
}
