import { chat, saveChatDebounced, setExtensionPrompt, extension_prompt_types, extension_prompt_roles } from '@sillytavern/script';
import toastr from 'toastr';
import { callSecondaryApiWithRetry } from '@/core/api-client';
import { buildMessages, resolveCustomApi, applyWIExcl, STRIP_REASONING_TAGS_RE, type Ctx } from '@/core/generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { pinia } from '@/pinia';
import { uuidv4 } from '@sillytavern/scripts/utils';
import {
  setting_field,
  type StatusEntry,
  type ArousalState,
  type UserStatusSnapshot,
  type StatusCategory,
  STATUS_CATEGORIES,
  normalizeUserStatusSnapshot,
} from '@/type/settings';

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

/** 读取某楼层某 swipe 的被动状态快照（null = 该楼层无快照）。
 *  v38：读取时自动将老存档（label/description 结构）标准化为新结构（category/text/arousal/time_hint）。 */
export function getMessageUserStatus(messageId: number, swipeId: number): UserStatusSnapshot | null {
  const message = getMessage(messageId);
  if (!message) return null;
  const data = message.extra?.[setting_field]?.[String(swipeId)];
  const status = data?.userStatus;
  if (!status) return null;
  return normalizeUserStatusSnapshot(klona(status));
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
 *  输出契约：JSON 对象，含 time_hint（string）、entries（array）、arousal（object | omitted）。
 *  容错：剥思维链标签、去代码块包裹、修尾随逗号、逐字段宽松取值。
 *  老存档兼容：entries 内仍接受旧 label/description 字段，映射为 category/text。 */
export function parseStatusUpdate(raw: string, maxEntries: number): { entries: StatusEntry[]; arousal: ArousalState | null; time_hint: string } {
  let c = raw.replace(STRIP_REASONING_TAGS_RE, '').trim();
  // 去代码块包裹
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const objStart = c.indexOf('{');
  const objEnd = c.lastIndexOf('}');
  if (objStart === -1 || objEnd <= objStart) return { entries: [], arousal: null, time_hint: '' };

  // 修尾随逗号（引号感知）
  const jsonStr = stripTrailingCommas(c.slice(objStart, objEnd + 1));
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return { entries: [], arousal: null, time_hint: '' };
  }
  if (!parsed || typeof parsed !== 'object') return { entries: [], arousal: null, time_hint: '' };

  const p = parsed as Record<string, unknown>;
  const time_hint = typeof p.time_hint === 'string' ? p.time_hint : '';

  // 解析 entries 数组
  const rawEntries = Array.isArray(p.entries) ? p.entries : [];
  const entries: StatusEntry[] = [];
  for (const item of rawEntries) {
    if (entries.length >= maxEntries) break;
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    // 兼容老字段：优先 category，其次 label；优先 text，其次 description
    const rawCat = typeof o.category === 'string' ? o.category : (typeof o.label === 'string' ? o.label : '');
    const category = STATUS_CATEGORIES.includes(rawCat as StatusCategory)
      ? (rawCat as StatusCategory)
      : '情绪';
    const text = typeof o.text === 'string' ? o.text : (typeof o.description === 'string' ? o.description : '');
    if (!text) continue;
    const intensity = typeof o.intensity === 'number' && Number.isFinite(o.intensity)
      ? Math.max(0, Math.min(100, Math.round(o.intensity)))
      : undefined;
    entries.push({
      id: typeof o.id === 'string' ? o.id : uuidv4(),
      category,
      text,
      intensity,
      source: 'auto',
      updatedAt: Date.now(),
    });
  }

  // 解析 arousal 对象
  let arousal: ArousalState | null = null;
  if (p.arousal && typeof p.arousal === 'object') {
    const a = p.arousal as Record<string, unknown>;
    const validPhases = ['平静', '兴奋', '临界', '不应期'] as const;
    const validSecretions = ['干燥', '微润', '湿滑', '射精残留'] as const;
    const phase = validPhases.includes(a.phase as typeof validPhases[number]) ? (a.phase as typeof validPhases[number]) : '平静';
    const hardness = typeof a.hardness === 'number' ? Math.max(0, Math.min(100, Math.round(a.hardness))) : 0;
    const secretion = validSecretions.includes(a.secretion as typeof validSecretions[number]) ? (a.secretion as typeof validSecretions[number]) : '干燥';
    const cause = typeof a.cause === 'string' ? a.cause : '无';
    const recovery = typeof a.recovery === 'string' ? a.recovery : '精力充沛';
    arousal = { phase, hardness, secretion, cause, recovery };
  }

  return { entries, arousal, time_hint };
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

/** 将状态快照格式化为注入正文 AI 的结构化文本 */
export function formatStatusForPrompt(snapshot: UserStatusSnapshot | null): string {
  if (!snapshot || snapshot.entries.length === 0) return '';
  const lines: string[] = [];
  lines.push(`${t`{{user}}（主角）此刻的被动状态：`}`);
  lines.push('');

  // 唤起状态卡片
  if (snapshot.arousal) {
    const a = snapshot.arousal;
    lines.push(`[${t`唤起状态`}] ${t`兴奋阶段`}：${a.phase} | ${t`硬度`}：${a.hardness}% | ${t`分泌物`}：${a.secretion} | ${t`成因`}：${a.cause} | ${t`体力`}：${a.recovery}`);
    lines.push('');
  }

  // 按 category 分组输出
  const groups = new Map<StatusCategory, StatusEntry[]>();
  for (const e of snapshot.entries) {
    if (!groups.has(e.category)) groups.set(e.category, []);
    groups.get(e.category)!.push(e);
  }

  const categoryOrder: StatusCategory[] = ['体感', '生理反应', '唤起', '衣着', '情绪'];
  for (const cat of categoryOrder) {
    const group = groups.get(cat);
    if (!group || group.length === 0) continue;
    lines.push(`[${cat}]`);
    for (const e of group) {
      if (e.intensity !== undefined) {
        lines.push(`- ${e.text}（${t`强度`}${e.intensity}）`);
      } else {
        lines.push(`- ${e.text}`);
      }
    }
    lines.push('');
  }

  if (snapshot.time_hint) {
    lines.push(`${t`时间`}：${snapshot.time_hint}`);
    lines.push('');
  }

  // 清理尾部多余空行
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  return `<user_passive_status>\n${lines.join('\n')}\n</user_passive_status>`;
}

/** 注入（或清除）状态提示词到正文 AI。
 *  enabled=false 或 entries 为空时清除注入（设空值）。 */
export function applyStatusInjection(enabled: boolean, snapshot: UserStatusSnapshot | null, depth: number) {
  try {
    if (enabled && snapshot && snapshot.entries.length > 0) {
      const text = formatStatusForPrompt(snapshot);
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
    applyStatusInjection(false, null, st.injection_depth);
    return;
  }
  const messageId = getLatestAiMessageId();
  if (messageId === null) {
    applyStatusInjection(false, null, st.injection_depth);
    return;
  }
  const swipeId = getLatestAiSwipeId();
  const snapshot = getMessageUserStatus(messageId, swipeId);
  applyStatusInjection(true, snapshot, st.injection_depth);
}

/** AI 自动更新被动状态：读最新 AI 楼层的当前状态 + 最近正文 → 调副 API → 解析 → 落盘。
 *  复用 buildMessages 完整管线（世界书/过滤/角色卡/聊天历史），但只发 status_only + marker 模块。
 *  独立 loading 状态（statusTrackerState），与 generatorState 互不阻塞 */
export async function updateUserStatus(messageId: number, swipeId: number): Promise<UserStatusSnapshot | null> {
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
    const statusJson = currentSnapshot ? JSON.stringify(currentSnapshot) : '{}';

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
    const parsed = parseStatusUpdate(raw, st.max_entries);

    // 落盘到当前楼层快照
    const snapshot: UserStatusSnapshot = {
      entries: parsed.entries,
      arousal: parsed.arousal,
      time_hint: parsed.time_hint,
      updatedAt: Date.now(),
    };
    setMessageUserStatus(messageId, swipeId, snapshot);

    // 刷新正文注入
    refreshStatusInjection();

    return snapshot;
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
