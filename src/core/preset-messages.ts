// 把酒馆 CC 预设（prompts + prompt_order）展开成消息序列。纯函数：宿主对象与宏替换
// 都由调用方以参数注入，本模块不 import @sillytavern/*，可被 vitest 直接单测。
//
// 展开口径对齐酒馆 openai.js 的 populateChatCompletion / populationInjectionPrompts：
// 1. 主序列按 prompt_order 顺序，逐条取内容（原生槽位由调用方提供运行时内容）；
// 2. injection_position === 1（绝对位置）的条目收集起来，按 injection_depth 插进**历史
//    数组内部**（酒馆正是先对历史数组做注入、再整体放到 chatHistory 槽位）；
// 3. 跳过扩展注入条目（extension === true）与未命中 injection_trigger 的条目。
import type { StPresetPrompt, StPresetOrderEntry, StPresetSnapshot } from '@/core/st-preset-source';
import { getPresetOverride, type PresetOverrideMap } from '@/core/preset-overrides';

export type PresetChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

/** 原生槽位（酒馆运行时填充，预设只决定它们出现的位置与顺序）。 */
export const NATIVE_MARKER_SLOTS = [
  'worldInfoBefore',
  'worldInfoAfter',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
  'dialogueExamples',
  'chatHistory',
] as const;

export type NativeMarkerSlot = (typeof NATIVE_MARKER_SLOTS)[number];

/** 槽位内容：字符串槽位直接注入；chatHistory 是消息数组（保留 user/assistant 角色）。 */
export type PresetSlotContents = {
  worldInfoBefore: string;
  worldInfoAfter: string;
  charDescription: string;
  charPersonality: string;
  scenario: string;
  personaDescription: string;
  dialogueExamples: string;
  chatHistory: PresetChatMsg[];
};

/** 预设条目覆盖层（插件侧，不动酒馆预设文件）：disabled=true 整条跳过；enabled=true 强制
 *  参与组装（用于开启酒馆预设里已停用的条目）；content 存在（含空串）即替换条目原内容。
 *  键 = 条目 identifier（新版按预设名隔离，键形如 `预设名::identifier`），见 preset-overrides.ts。 */

export type BuildPresetOptions = {
  /** 生成类型，用于 injection_trigger 过滤。默认 'normal'（预设主要为正文生成设计）。 */
  generationType?: string;
  /** 宏替换（酒馆 substituteParams）；默认恒等，便于单测。 */
  substitute?: (text: string) => string;
  /** 调用方追加的深度注入（本扩展的世界书深度条目——预设无对应槽位，不能丢）。 */
  extraInjections?: InChatInjection[];
  /** 插件侧条目覆盖层：禁用 / 替换内容。8 个原生 marker 槽位由运行时填充，覆盖对它们无效。
   *  键 = 条目 identifier（新版为 `预设名::identifier`，旧键仍作全局回退，见 preset-overrides.ts）。 */
  overrides?: PresetOverrideMap;
  /** 生效预设名：覆盖层按预设名隔离时用。 */
  presetName?: string;
};

const MARKER_SET = new Set<string>(NATIVE_MARKER_SLOTS);

const isMarkerSlot = (identifier: string): identifier is NativeMarkerSlot => MARKER_SET.has(identifier);

/** 条目是否参与组装：酒馆 prompt_order 的 enabled=false 默认跳过，但覆盖层 enabled=true
 *  可强制开启（插件内开启酒馆预设里已停用的条目）；disabled=true 永远优先。
 *  原生 marker 槽位例外——运行时填充，覆盖层的禁用/启用对它一律无效。 */
const isEntryActive = (
  entry: StPresetOrderEntry | undefined,
  overrides: PresetOverrideMap | undefined,
  identifier: string,
  presetName?: string,
): boolean => {
  const ov = getPresetOverride(overrides, presetName, identifier);
  if (ov?.disabled && !isMarkerSlot(identifier)) return false;
  if (ov?.enabled) return true;
  return entry?.enabled !== false;
};

const normalizeRole = (role: unknown): PresetChatMsg['role'] => {
  const value = String(role ?? '').toLowerCase();
  return value === 'user' || value === 'assistant' ? value : 'system';
};

/** injection_trigger 语义（PromptManager.js shouldTrigger 已核实）：空/未设 = 对所有类型生效。 */
const passesTrigger = (prompt: StPresetPrompt, generationType: string): boolean => {
  const trigger = prompt.injection_trigger;
  if (!Array.isArray(trigger) || trigger.length === 0) return true;
  return trigger.includes(generationType);
};

export type InChatInjection = {
  depth: number;
  order: number;
  role: PresetChatMsg['role'];
  content: string;
};

/** 从预设条目解析 in-chat 注入（injection_position === 1）。contentOverride 为覆盖层
 *  解析后的内容（无覆盖时传条目原内容）。 */
const toInjection = (
  prompt: StPresetPrompt,
  substitute: (t: string) => string,
  contentOverride: string,
): InChatInjection => ({
  depth: Math.max(0, Math.floor(Number(prompt.injection_depth) || 0)),
  order: Number.isFinite(Number(prompt.injection_order)) ? Number(prompt.injection_order) : 100,
  role: normalizeRole(prompt.role),
  content: substitute(contentOverride.trim()),
});

/** 覆盖层解析：disabled=true 整条跳过；content 存在（含空串）即替换条目内容——空串覆盖
 *  是明确意图（清空该条目），区别于「无覆盖记录」。无覆盖记录时原样返回条目内容。 */
const resolveOverride = (
  prompt: StPresetPrompt,
  overrides: PresetOverrideMap | undefined,
  identifier: string,
  presetName?: string,
): { skip: boolean; content: string } => {
  const ov = getPresetOverride(overrides, presetName, identifier);
  if (!ov) return { skip: false, content: String(prompt.content ?? '') };
  if (ov.disabled) return { skip: true, content: '' };
  return { skip: false, content: ov.content !== undefined ? ov.content : String(prompt.content ?? '') };
};

/**
 * 展开预设为消息序列（不含本扩展的任务模块——调用方在返回结果之后追加）。
 * 预设为空/无可用条目时返回空数组，由调用方决定降级策略。
 */
export function buildPresetMessages(
  preset: Pick<StPresetSnapshot, 'prompts' | 'order'>,
  slots: PresetSlotContents,
  options: BuildPresetOptions = {},
): PresetChatMsg[] {
  const generationType = options.generationType ?? 'normal';
  const substitute = options.substitute ?? ((text: string) => text);
  const promptMap = new Map<string, StPresetPrompt>();
  for (const prompt of Array.isArray(preset.prompts) ? preset.prompts : []) {
    const id = String(prompt?.identifier ?? '').trim();
    if (id && !promptMap.has(id)) promptMap.set(id, prompt);
  }

  const order: StPresetOrderEntry[] = Array.isArray(preset.order) ? preset.order : [];

  // 第一趟：收集 in-chat 注入（与主序列的先后无关，酒馆同样先收后插）
  const injections: InChatInjection[] = [...(options.extraInjections ?? [])];
  for (const entry of order) {
    const identifier = String(entry?.identifier ?? '').trim();
    if (!identifier || !isEntryActive(entry, options.overrides, identifier, options.presetName)) continue;
    const prompt = promptMap.get(identifier);
    if (!prompt || prompt.extension === true) continue;
    if (isMarkerSlot(identifier)) continue;
    if (Number(prompt.injection_position) !== 1) continue;
    if (!passesTrigger(prompt, generationType)) continue;
    const { skip, content } = resolveOverride(prompt, options.overrides, identifier, options.presetName);
    if (skip) continue;
    if (content.trim()) injections.push(toInjection(prompt, substitute, content));
  }

  // 第二趟：按 order 展开主序列；chatHistory 槽位先吃注入再整体落位
  const messages: PresetChatMsg[] = [];
  const pushContent = (role: PresetChatMsg['role'], raw: string): void => {
    const content = String(raw ?? '').trim();
    if (content) messages.push({ role, content: substitute(content) });
  };
  /** 历史块是否已落位：预设没有 chatHistory 槽位时，深度注入改到末尾追加（不静默丢弃） */
  let emittedChatHistory = false;

  const emitSlot = (slot: NativeMarkerSlot, role: PresetChatMsg['role']): void => {
    if (slot === 'chatHistory') {
      emittedChatHistory = true;
      const historyBlock = slots.chatHistory
        .filter(m => m.content?.trim())
        .map(m => ({ role: m.role, content: m.content }));
      if (injections.length) {
        if (historyBlock.length) applyInChatInjections(historyBlock, injections);
        // 历史为空（新聊天/空会话）：深度注入没有可挂的位置，按顺序平铺到槽位处，
        // 不能整段丢弃——世界书深度条目与记忆摘要都靠这条通道进来
        else messages.push(...flattenInjections(injections));
      }
      messages.push(...historyBlock);
      return;
    }
    pushContent(role, slots[slot]);
  };

  for (const entry of order) {
    const identifier = String(entry?.identifier ?? '').trim();
    if (!identifier || !isEntryActive(entry, options.overrides, identifier, options.presetName)) continue;
    const prompt = promptMap.get(identifier);
    if (!prompt) continue;
    if (prompt.extension === true) continue;
    if (!passesTrigger(prompt, generationType)) continue;

    const role = normalizeRole(prompt.role);
    if (isMarkerSlot(identifier)) {
      emitSlot(identifier, role);
      continue;
    }
    // in-chat 注入条目已在第一趟收集，主序列不再重复发出
    if (Number(prompt.injection_position) === 1) continue;
    const { skip, content } = resolveOverride(prompt, options.overrides, identifier, options.presetName);
    if (skip) continue;
    pushContent(role, content);
  }

  // 预设没有 chatHistory 槽位：深度注入无处可挂，追加到主序列末尾
  // （此前整段丢弃——极简预设下世界书深度条目与记忆摘要会静默消失）
  if (!emittedChatHistory && injections.length) messages.push(...flattenInjections(injections));

  return messages;
}

/** 同 depth 的注入分组：order 降序、role 顺序 system→user→assistant，同组以 \n 合并。 */
const groupInjectionsByDepth = (injections: InChatInjection[], depth: number): PresetChatMsg[] => {
  const group = injections.filter(g => g.depth === depth);
  if (!group.length) return [];
  const roleOrder: PresetChatMsg['role'][] = ['system', 'user', 'assistant'];
  const orders = [...new Set(group.map(g => g.order))].sort((a, b) => b - a);
  const roleMessages: PresetChatMsg[] = [];
  for (const order of orders) {
    for (const role of roleOrder) {
      const content = group
        .filter(g => g.order === order && g.role === role)
        .map(g => g.content.trim())
        .filter(Boolean)
        .join('\n');
      if (content) roleMessages.push({ role, content });
    }
  }
  return roleMessages;
};

/** 无历史可挂时的注入平铺：depth 降序（越深越靠前，与酒馆超界深度的落位一致）。 */
const flattenInjections = (injections: InChatInjection[]): PresetChatMsg[] => {
  const depths = [...new Set(injections.map(i => i.depth))].sort((a, b) => b - a);
  const out: PresetChatMsg[] = [];
  for (const depth of depths) out.push(...groupInjectionsByDepth(injections, depth));
  return out;
};

/**
 * 把 in-chat 深度注入插进历史数组内（就地修改）。深度以历史末尾为基准倒数——depth d 组
 * 落在「前 n−d 条历史消息之后」（d=0 即整块历史末尾、贴近生成点；d≥n 落在历史块最前）。
 * 口径由酒馆 populationInjectionPrompts 的倒序 splice 语义推出（newest-first 数组
 * splice(depth) 后 reverse，等价于按原始顺序数到 n−depth 处插入）。
 * 同 depth 内按 injection_order 降序、role 顺序 system→user→assistant 分组，同组以 \n 合并。
 */
export function applyInChatInjections(messages: PresetChatMsg[], injections: InChatInjection[]): void {
  const n = messages.length;
  if (n <= 0 || !injections.length) return;

  // depth ≥ n 的组（含超出历史长度者）落在历史块最前：酒馆对超界深度一律追加到最旧端，
  // 越深的越先追加 → 反转后越深越靠前，故按 depth 降序排列
  const overflowing = [...new Set(injections.map(i => i.depth))].filter(d => d >= n).sort((a, b) => b - a);
  const rebuilt: PresetChatMsg[] = [];
  for (const depth of overflowing) rebuilt.push(...groupInjectionsByDepth(injections, depth));

  // 主体：单趟重建，插在「已放入 k 条历史消息」之后（k = n − depth），避免多次 splice 的位置漂移
  for (let i = 0; i < n; i++) {
    rebuilt.push(messages[i]);
    rebuilt.push(...groupInjectionsByDepth(injections, n - (i + 1)));
  }
  messages.splice(0, n, ...rebuilt);
}
