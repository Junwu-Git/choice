import { substituteParams, this_chid } from '@sillytavern/script';
import { getStCharacter } from '@/core/st-character';
import toastr from 'toastr';
import {
  getWorldInfoPrompt,
  loadWorldInfo,
  selected_world_info,
  worldInfoCache,
} from '@sillytavern/scripts/world-info';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { power_user } from '@sillytavern/scripts/power-user';
import { resolvePool } from '@/core/pool-resolver';
import { callSecondaryApiWithRetry, type ChatMsg } from '@/core/api-client';
import { getBaiBaiSummary } from '@/core/baibai-bridge';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { ChoiceGeneration } from '@/core/options-store';
import type { PoolEntry, PromptModule, SecondaryApi, WIBookMode, WorldInfoGlobalSettings } from '@/type/settings';
import { DEFAULT_MODULES, CORE_RULES_STATIC, GenerationSettings } from '@/type/settings';

export type GenerateTarget = { messageId: number; swipeId: number };

/** AI 条目池生成结果项：replaceTargetId 存在则替换该已有条目（改 type/content/rule），否则为新增条目。
 *  replaceOriginal 仅用于 UI 预览被替换的原文，不参与注入逻辑。 */
export type PoolGenItem = {
  type: string;
  content: string;
  rule: string;
  replaceTargetId?: string;
  replaceOriginal?: string;
};

export const generatorState = reactive({ loading: false, generationId: null as string | null });

let cancelled = false;
let genController: AbortController | null = null;

/** 条目池生成状态：与行动选项生成的 generatorState 分离，互不干扰。
 *  独立控制器便于对话框「取消」按钮精准 abort 当次条目池生成。 */
export const poolGenState = reactive({ loading: false });
let poolGenController: AbortController | null = null;

export const resolveCount = (cm: string): number => {
  const s = cm.trim();
  const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export const resolveCustomApi = (id: string, apis: SecondaryApi[]): SecondaryApi | undefined =>
  id ? apis.find(a => a.id === id) : undefined;

export type Ctx = {
  count: number;
  pinnedCount: number;
  pinned: string;
  poolSelected: string;
  input: string;
  minChars: number;
  maxChars: number;
  enrichPersonStyle: string;
  optionPerson: string;
  enrichPerson: string;
};
const sub = (t: string, c: Ctx) =>
  t
    .replaceAll('{{count}}', String(c.count))
    .replaceAll('{{pinned_count}}', String(c.pinnedCount))
    .replaceAll('{{count_minus_1}}', String(Math.max(0, c.count - 1)))
    .replaceAll('{{pinned}}', c.pinned)
    .replaceAll('{{pool_selected}}', c.poolSelected)
    .replaceAll('{{input}}', c.input)
    .replaceAll('{{min_chars}}', String(c.minChars))
    .replaceAll('{{max_chars}}', String(c.maxChars))
    .replaceAll('{{enrich_person_style}}', c.enrichPersonStyle)
    .replaceAll('{{option_person}}', c.optionPerson)
    .replaceAll('{{enrich_person}}', c.enrichPerson);

export const buildMessages = async (
  modules: PromptModule[],
  ctx: Ctx,
  wi: WorldInfoGlobalSettings,
  contextRounds: number,
  isEnrich = false,
): Promise<ChatMsg[]> => {
  const gs = useGlobalSettingsStore();
  const prefillEnabled = gs.settings.prompt_rules.prefill_enabled;
  const pr = gs.settings.prompt_rules;
  const augmentedCtx: Ctx = {
    ...ctx,
    minChars: isEnrich ? pr.enrich_min_chars : pr.option_min_chars,
    maxChars: isEnrich ? pr.enrich_max_chars : pr.option_max_chars,
    enrichPersonStyle:
      pr.enrich_person_style || (pr.enrich_person ? `统一使用${pr.enrich_person} {{user}} 为主语` : ''),
    optionPerson: pr.option_person || '第三人称',
    enrichPerson: pr.enrich_person || '第三人称',
  };
  const msgs: ChatMsg[] = [];
  const wiBuckets = wi.enabled ? await buildWI() : null;

  const sorted = [...modules].sort((a, b) => a.order - b.order);

  for (const mod of sorted) {
    if (!mod.enabled) continue;
    if (!prefillEnabled && mod.role === 'assistant') continue;
    if (isEnrich && mod.option_only) continue;

    switch (mod.id) {
      case 'system_prompt': {
        const content = substituteParams(sub(mod.content, augmentedCtx));
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      case 'world_info_before': {
        if (wiBuckets) {
          const merged = [wiBuckets.before, wiBuckets.anBefore, wiBuckets.em].filter(Boolean).join('\n\n');
          if (merged) msgs.push({ role: 'system', content: merged });
        }
        break;
      }
      case 'persona_description': {
        const personaDesc = power_user?.persona_description;
        if (personaDesc) {
          msgs.push({
            role: 'system',
            content: `<user_persona>\n以下是用户本人（用户=主角=user）的人物设定：\n${substituteParams(personaDesc)}\n</user_persona>`,
          });
        }
        break;
      }
      case 'char_description': {
        const ch = getStCharacter(this_chid);
        const desc = ch?.data?.description;
        if (desc) msgs.push({ role: 'system', content: substituteParams(desc) });
        break;
      }
      case 'char_personality': {
        const ch = getStCharacter(this_chid);
        const personality = ch?.data?.personality;
        if (personality) msgs.push({ role: 'system', content: substituteParams(personality) });
        break;
      }
      case 'char_scenario': {
        const ch = getStCharacter(this_chid);
        const scenario = ch?.data?.scenario;
        if (scenario) msgs.push({ role: 'system', content: substituteParams(scenario) });
        break;
      }
      case 'world_info_after': {
        if (wiBuckets) {
          const merged = [wiBuckets.after, wiBuckets.anAfter, wiBuckets.atDepth].filter(Boolean).join('\n\n');
          if (merged) msgs.push({ role: 'system', content: merged });
        }
        break;
      }
      case 'chat_history': {
        const history = buildChatHistory(contextRounds);
        for (const m of history) {
          msgs.push(prefillEnabled ? m : { ...m, role: 'system' });
        }
        break;
      }
      case 'baibai_summary': {
        if (!gs.settings.prompt_rules.baibai_enabled) break;
        const text = getBaiBaiSummary();
        if (text) {
          msgs.push({
            role: 'system',
            content: `<baibai_summary>\n以下为记忆系统对已发生剧情的压缩摘要，记录的是已离开当前上下文窗口、不再直接可见的历史角色扮演事件。仅供你参考以保持剧情连贯，不得在回复中直接引用或复述其中内容。\n${text}\n</baibai_summary>`,
          });
        }
        break;
      }

      case 'user_instruction': {
        const content = sub(mod.content, augmentedCtx);
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      case 'core_rules': {
        const pr = gs.settings.prompt_rules;
        const personStyle = pr.person_style || '';
        const optionRules = pr.option_rules || '';
        // person_style 优先（高级用户覆盖），回退到 option_person 自动生成
        let content: string;
        if (optionRules && (personStyle || pr.option_person)) {
          const effectivePersonStyle =
            personStyle ||
            `选项内容以${pr.option_person || '第三人称'} {{user}} 为绝对主语，融入微表情、肢体语言、语气特征或感官体验，让 {{user}} 看起来是一个鲜活的参与者。例外：他人视角、与此同时、转场推进 三类不受绝对主语约束。鼓励在动作描写中加入与当前环境或道具的物理交互，避免角色像在真空中对话。选项的切入点须紧扣正文末尾其他角色的当前状态。`;
          content = `【核心规则 - 生成选项时严格遵守】
${optionRules}

【叙述风格】
${effectivePersonStyle}

${CORE_RULES_STATIC}`;
        } else {
          content = mod.content;
        }
        content = substituteParams(sub(content, augmentedCtx));
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      case 'thinking_prompt': {
        const content = substituteParams(sub(mod.content, augmentedCtx));
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      case 'assistant_ack':
      case 'assistant_thinking': {
        const content = mod.content;
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      default: {
        const content = substituteParams(sub(mod.content, augmentedCtx));
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
    }
  }

  // 合并相邻同 role 消息，避免连续多个 system/user/assistant
  const merged: ChatMsg[] = [];
  for (const msg of msgs) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content = last.content + '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
};

const buildChatHistory = (contextRounds: number): ChatMsg[] => {
  const ctx = window.SillyTavern?.getContext?.();
  const chatArr: any[] = ctx?.chat ?? [];
  const gs = useGlobalSettingsStore();
  const mode = gs.settings.prompt_rules.context_mode;
  // rounds：取最后 N 轮，含隐藏消息；visible_only：仅未隐藏消息，不限轮数
  let msgs = mode === 'visible_only' ? chatArr.filter(m => !m.is_hidden) : [...chatArr];
  if (mode === 'rounds' && contextRounds > 0) msgs = msgs.slice(-contextRounds * 2);
  const rules = gs.sortedEnabledFilterRules;
  const h: ChatMsg[] = [];
  let lastAssistantIdx = -1;
  for (const m of msgs) {
    if (m.is_system) continue;
    let content = m.mes ?? '';
    if (!content) continue;
    for (const rule of rules) {
      try {
        if (rule.type === 'tag') {
          if (!rule.start && !rule.end) continue;
          const startPat = rule.start ? escapeRegExp(rule.start) : '';
          const endPat = rule.end ? escapeRegExp(rule.end) : '';
          // 仅标签头：从起始标签匹配到字符串末尾；仅标签尾：从开头匹配到结束标签；两者都有：匹配标签对
          const body = rule.start ? (rule.end ? '[\\s\\S]*?' : '[\\s\\S]*') : '[\\s\\S]*?';
          const re = new RegExp(startPat + body + endPat, 'g');
          content = content.replace(re, '');
        } else {
          if (!rule.pattern) continue;
          // replace 为空串时即"整段删除"；导入 ST 正则时承载其 replaceString（如 $1 保留内容去标签壳）
          content = content.replace(new RegExp(rule.pattern, 'gs'), rule.replace ?? '');
        }
      } catch {
        console.warn('[choice] 无效过滤规则:', rule);
      }
    }
    if (!content.trim()) continue;
    const role = m.role === 'user' || m.is_user ? 'user' : 'assistant';
    h.push({ role, content });
    if (role === 'assistant') lastAssistantIdx = h.length - 1;
  }
  // 将最后一条 assistant 消息用 <current_scene> 包裹，让 AI 明确识别"当前场景"边界，
  // 避免在长对话中注意力被稀释到更早的剧情。回退到 h 最后一条（无 assistant 时）。
  if (h.length > 0) {
    const wrapIdx = lastAssistantIdx >= 0 ? lastAssistantIdx : h.length - 1;
    h[wrapIdx].content = `<current_scene>\n${h[wrapIdx].content}\n</current_scene>`;
  }
  return h;
};

// 将标签头/尾按字面量转义，避免 <思考>、[小剧场] 等含正则特殊字符的标签被误解析
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

type WIBuckets = {
  before: string;
  after: string;
  anBefore: string;
  anAfter: string;
  em: string;
  atDepth: string;
};

const buildWI = async (): Promise<WIBuckets> => {
  const empty: WIBuckets = { before: '', after: '', anBefore: '', anAfter: '', em: '', atDepth: '' };
  try {
    const ctx = window.SillyTavern?.getContext?.();
    const chatArr: any[] = ctx?.chat ?? [];
    // getWorldInfoPrompt 要求 chat 为倒序（最新消息在前），与 ST 主生成 script.js
    // 中 .reverse() 保持一致。不倒序会导致 WorldInfoBuffer 把最旧消息当作最新层扫描，
    // 绿灯关键词匹配的是旧上下文而非当前层。
    const chatStrings = chatArr.map((m: any) => m?.mes ?? '').reverse();
    const ch = getStCharacter(this_chid);

    // 世界书预算 = world_info_budget(%) × maxContext。ST 主生成用 ctx.maxContext(如 8192) 算预算，
    // 但行动选项是独立 API 调用，沿用 8192 会让角色世界书的大条目先耗尽预算，
    // 导致额外启用的世界书 constant 条目在预算检查阶段被丢弃（"budget of N reached"）。
    // 这里放宽到较大上下文估算值，使预算不再成为额外世界书条目的瓶颈。
    const maxCtx = 128000;

    const result = await getWorldInfoPrompt(chatStrings, maxCtx, false, {
      trigger: 'normal',
      personaDescription: power_user?.persona_description ?? '',
      characterDescription: ch?.data?.description ?? '',
      characterPersonality: ch?.data?.personality ?? '',
      characterDepthPrompt: ch?.data?.extensions?.depth_prompt?.prompt ?? '',
      scenario: ch?.data?.scenario ?? '',
      creatorNotes: ch?.data?.creator_notes ?? '',
    });

    return {
      before: result.worldInfoBefore ?? '',
      after: result.worldInfoAfter ?? '',
      anBefore: (result.anBefore ?? []).join('\n'),
      anAfter: (result.anAfter ?? []).join('\n'),
      em: (result.worldInfoExamples ?? [])
        .map((e: any) => e?.content ?? '')
        .filter(Boolean)
        .join('\n'),
      atDepth: (result.worldInfoDepth ?? [])
        .flatMap((d: any) => d?.entries ?? [])
        .filter(Boolean)
        .join('\n'),
    };
  } catch (err) {
    console.error('[Choice] buildWI failed', err);
    return empty;
  }
};

type Restore = { restore: () => void } | null;

/** 世界书注入的临时改写（选项/润色两条生成链路共用）：
 *  1. 书级：临时重写 selected_world_info（移除排除书/off 模式书、追加启用书），restore 恢复；
 *  2. 条目级：force/follow/custom 模式下经 loadWorldInfo 取 worldInfoCache 缓存引用（world-info.js:2041
 *     返回缓存对象本身，已核实），临时变异条目 disable 标志，restore 逐条还原——
 *     checkWorldInfo 对 disable==true 的条目跳过（world-info.js:4689），变异即控制注入。
 *  四态语义：off=整本并入临时排除（等价"条目全关"）；follow=酒馆原生 disable（覆盖不生效，
 *  切换模式即脱离自定义）；force=全部条目 disable=false；custom=按 book_entry_overrides 逐条
 *  生效（快照未覆盖的条目保持酒馆原状）。
 *  异步原因：loadWorldInfo 未命中缓存时会 fetch，条目变异必须在 getWorldInfoPrompt 之前完成，
 *  故调用方需 await 本函数。 */
export const applyWIExcl = async (
  excl: string[],
  enabled: string[],
  bookModes?: Record<string, WIBookMode>,
  bookEntryOverrides?: Record<string, Record<string, boolean>>,
): Promise<Restore> => {
  const saved = [...(selected_world_info ?? [])];
  const modes = bookModes ?? {};
  const modeOf = (name: string): WIBookMode => modes[name] ?? 'follow';
  // off 书并入临时排除：整本不注入（等价"条目全关"的生成结果，且无需条目级变异）
  const allExcl = [...new Set([...excl, ...enabled.filter(name => modeOf(name) === 'off')])];
  const hasExcl = allExcl.length > 0;
  const hasEnabled = enabled.length > 0;
  if (!hasExcl && !hasEnabled) return null;

  selected_world_info.length = 0;
  let newList = hasExcl ? saved.filter(n => !allExcl.includes(n)) : [...saved];
  if (hasEnabled) {
    for (const name of enabled) {
      // excluded_books 优先于 enabled_books：被排除的书即使仍在 enabled 列表里也不注入
      if (!newList.includes(name) && !allExcl.includes(name)) newList.push(name);
    }
  }
  selected_world_info.push(...newList);
  const ch = getStCharacter(this_chid);
  const cw = ch?.data?.extensions?.world;
  const cwEx = cw ? allExcl.includes(cw) : false;
  if (cwEx && ch?.data?.extensions) ch.data.extensions.world = '';

  // 条目级 disable 变异：worldInfoCache 是 StructuredCloneMap 且 cloneOnGet:true
  // （world-info.js:882，已核实）——loadWorldInfo 返回的是深拷贝，直接变异拷贝无法影响
  // 生成（getGlobalLore 从缓存原始数据取条目）。必须先 loadWorldInfo 确保书已进缓存，
  // 再经 Map.prototype.get 绕过 clone-on-get 拿到缓存内原始引用变异，restore 逐条还原。
  type MutableEntry = { uid?: number | string; disable?: boolean };
  const mutated: Array<{ entry: MutableEntry; value: boolean }> = [];
  const overrides = bookEntryOverrides ?? {};
  for (const name of enabled) {
    const mode = modeOf(name);
    if (mode === 'off') continue;
    try {
      await loadWorldInfo(name); // 确保书已进缓存（其 set 为 cloneOnSet:false，存引用本身）
      const data = Map.prototype.get.call(worldInfoCache, name) as
        { entries?: Record<string, MutableEntry> } | undefined;
      if (!data?.entries) continue;
      const bookOverrides = overrides[name] ?? {};
      for (const entry of Object.values(data.entries)) {
        if (!entry || typeof entry.disable !== 'boolean') continue;
        const uidKey = `${entry.uid}`;
        if (mode === 'force') {
          // force 全启用：覆盖不生效（条目勾选框显示与生成一致）
          if (entry.disable) {
            mutated.push({ entry, value: entry.disable });
            entry.disable = false;
          }
        } else if (mode === 'custom') {
          // custom：按覆盖逐条；快照未覆盖的条目保持酒馆原状
          const ov = bookOverrides[uidKey];
          if (typeof ov !== 'boolean') continue;
          if (entry.disable === ov) {
            mutated.push({ entry, value: entry.disable });
            entry.disable = !ov;
          }
        } else {
          // follow：纯酒馆原生 disable（覆盖仅 custom 模式生效，切换模式即脱离自定义）
        }
      }
    } catch (err) {
      console.warn('[Choice] applyWIExcl 条目变异失败（保持酒馆原状）:', name, err);
    }
  }

  return {
    restore: () => {
      selected_world_info.length = 0;
      selected_world_info.push(...saved);
      if (cwEx && ch?.data?.extensions) ch.data.extensions.world = cw;
      for (const m of mutated) m.entry.disable = m.value;
    },
  };
};

/** 思维链标签块剥离正则：parseOptions 共用。
 *  新增模型思维标签（如 <reasoning_content>/<antThinking>）时只改这一处即可同步，
 *  避免只补一处而另一处静默漏处理。String.replace 对 /g 正则不保留 lastIndex 状态，跨调用共享安全。 */
export const STRIP_REASONING_TAGS_RE =
  /<(?:think(?:ing)?|reasoning|thought)>[\s\S]*?<\/(?:think(?:ing)?|reasoning|thought)>/gi;

export function parseOptions(text: string, count: number): string[] {
  // 找到最后一个思维链闭合标签，丢弃它之前的所有内容
  // 原因：AI 可能在思维链中以文本形式提到 <options>（如"格式：<options> 标签内..."），
  // 直接在原始文本中 matchAll <options> 会误匹配到这些文本引用，导致提取错误
  const closeTagRe = /<\/(?:think(?:ing)?|reasoning|thought)>/gi;
  const closeMatches = [...text.matchAll(closeTagRe)];
  let c: string;

  if (closeMatches.length > 0) {
    const lastClose = closeMatches[closeMatches.length - 1];
    c = text.slice(lastClose.index! + lastClose[0].length).trim();
  } else {
    // 没有思维链闭合标签，剥离配对的思维链标签后使用全文
    c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();
  }

  // 从剩余文本中提取 <options> 块
  const m = c.match(/<options>([\s\S]*?)<\/options>/i);
  if (m) {
    c = m[1].trim();
  } else {
    const openTagIdx = c.search(/<options>/i);
    if (openTagIdx !== -1) {
      c = c.slice(openTagIdx + '<options>'.length).trim();
    }
  }

  // 剥离 markdown 代码块（LLM 可能输出 ```json...```）
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // 尝试 JSON 解析（纯回退路径，prompt 不要求 AI 输出 JSON）
  if (c.startsWith('['))
    try {
      // 处理 JSON 尾随逗号（LLM 常见错误）
      const fc = c.replace(/,(\s*[\]}])/g, '$1');
      const p = JSON.parse(fc);
      if (Array.isArray(p)) {
        const i = p
          .map(x => {
            if (typeof x === 'string') return x.trim();
            return (
              x?.text?.trim() ??
              x?.option?.trim() ??
              // ?? 右侧用 undefined 而非 ''，确保 '' 假值时链继续回退
              (x?.t && x?.c ? `${x.t}: ${x.c}` : undefined) ??
              (x?.type && x?.content ? `${x.type}: ${x.content}` : undefined)
            );
          })
          .filter(Boolean);
        if (i.length) return i.slice(0, count);
      }
    } catch (err) {
      /* not JSON */
    }

  // 【】或 [] 格式：标题用【】或 [] 包裹，后续文本为内容，跨行自动合并
  // 边界判定按提示词契约"每条选项独占一行"做行锚定：只有行首（间隙含换行或正文）的
  // 括号才开启新选项。同一行内紧邻/仅隔空白的连续括号是"标签堆叠"（如
  // "[回溯闪回]【三年前·初二暑假】正文"），必须并入同一条——AI 常无视禁令在正文里
  // 用【】写场景头，若把每个括号都当边界，一条选项会被切成 "[标签]" 和
  // "【场景头】正文" 两条（实测发生过）
  const bracketTitleRe = /[[【]([^\]】]+?)[\]】]\s*/g;
  const bracketMatches = [...c.matchAll(bracketTitleRe)];
  if (bracketMatches.length > 0) {
    const result: string[] = [];
    // 上一个匹配里闭合括号之后的位置。match[0] 末尾的 \s* 会吞掉行尾换行，
    // 必须用 trimEnd 去掉后计算，否则换行被吞、无法判断下个括号是否在行首
    let prevCloseEnd = 0;
    for (let i = 0; i < bracketMatches.length; i++) {
      const m = bracketMatches[i];
      const start = m.index!;
      const end = i + 1 < bracketMatches.length ? bracketMatches[i + 1].index! : c.length;
      const option = c.slice(start, end).replace(/\r?\n/g, '').trim();
      // 间隙 = 上个闭合括号到本括号开头之间的文本。无换行的纯空白（含空串）→
      // 同一行标签堆叠，并入上一条；含换行或正文 → 新选项（保持既有跨行行为）
      const gap = c.slice(prevCloseEnd, start);
      const isTagStack = /^[^\S\r\n]*$/.test(gap);
      if (i > 0 && isTagStack && result.length > 0) {
        result[result.length - 1] += gap + option;
      } else if (option) {
        result.push(option);
      }
      prevCloseEnd = start + m[0].trimEnd().length;
    }
    return result.slice(0, count);
  }

  // 回退：旧格式 "标题: 内容"，按行解析
  // 先按换行分割，再在每行内按 "标题: 内容" 模式拆分，处理模型将多个选项写在同一行的情况
  const lines = c
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^<\/?\w+>$/i.test(l));
  // 标题格式：2-5 个汉字后跟 ": " 或 "： "（\s* 兼容零空格/双空格/制表符等容错）
  const titleRe = /([\u4e00-\u9fff]{2,5})[:：]\s*/g;
  const result: string[] = [];
  for (const line of lines) {
    // 用 matchAll 获取所有标题匹配位置，按相邻匹配区间切片
    // 替换原有的 lastIdx 算法，解决第一个标题在 index 0 时后续选项丢失的 bug
    const matches = [...line.matchAll(titleRe)];
    if (matches.length === 0) {
      result.push(line);
      continue;
    }
    for (let i = 0; i < matches.length; i++) {
      const start = matches[i].index!;
      const end = i + 1 < matches.length ? matches[i + 1].index! : line.length;
      result.push(line.slice(start, end).trim());
    }
  }
  return result.slice(0, count);
}

// _target 预留：调用方语义上指定生成目标楼层，当前实现始终读取最新楼层上下文
export async function generateOptions(_target: GenerateTarget): Promise<ChoiceGeneration | null> {
  if (generatorState.loading) {
    toastr.info(t`选项生成中,请稍候`);
    return null;
  }
  const gs = useGlobalSettingsStore(),
    cs = useChatSettingsStore(),
    ps = usePoolSelectorStore();
  const gid = uuidv4();
  generatorState.loading = true;
  generatorState.generationId = gid;
  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;
  const allExcl = [...new Set([...gwi.global_excluded_books, ...cwi.excluded_books])];
  const restore = gwi.enabled
    ? await applyWIExcl(allExcl, cwi.enabled_books, cwi.book_entry_modes, cwi.book_entry_overrides)
    : null;
  try {
    const count = resolveCount(gs.settings.global_count_mode);
    // ?? 兜底：无命中 config（effectiveConfig 为 null）时用 schema 默认生成参数，
    // 不硬编码字面量——默认值曾与真实 schema 默认相反，改 schema 后这里自动跟随
    const gen = ps.effectiveConfig?.generation ?? GenerationSettings.parse({});
    const pool = resolvePool({
      effectivePool: ps.effectivePool,
      count,
      categoriesEnabled: gen.categories_enabled,
      shuffleFinal: gen.shuffle_final,
      pinnedOverflow: gen.pinned_overflow,
    });
    const pinnedCount = pool.pinned.length;
    // rule 在固定/候选两个分区都只作写作约束（v21 起不再是跳过条目的触发条件，
    // 候选条目必须全部使用），渲染不做分区差异，分区语义由提示词文本的说明承担
    const renderEntryLine = (e: PoolEntry): string => {
      let line = e.type;
      if (e.content.trim()) line += ': ' + e.content.trim();
      if (e.rule.trim()) line += ` [规则: ${e.rule.trim()}]`;
      return line;
    };
    const poolSelectedText = pool.drawn.map(renderEntryLine).join('\n');
    const c: Ctx = {
      count,
      pinnedCount,
      pinned: pool.pinned.map(renderEntryLine).join('\n'),
      poolSelected: poolSelectedText || '无',
      input: '',
      minChars: 30,
      maxChars: 80,
      enrichPersonStyle: '',
      optionPerson: '第三人称',
      enrichPerson: '第三人称',
    };
    const rules = gs.settings.prompt_rules;

    let enabledModules = gs.sortedEnabledModules.filter(m => !m.enrich_only);
    if (!enabledModules || enabledModules.length === 0) {
      enabledModules = [...DEFAULT_MODULES].filter(m => !m.enrich_only).sort((a, b) => a.order - b.order);
    }
    let messages = await buildMessages(enabledModules, c, gwi, rules.context_rounds);

    const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
    if (!api) {
      toastr.error(t`请先在设置中配置 API（API 地址 + 模型），然后重新生成`);
      return null;
    }

    genController = new AbortController();
    const signal = genController.signal;

    const raw = await callSecondaryApiWithRetry(messages, api, gs.settings.retry_count, signal);
    if (cancelled) return null;
    const options = parseOptions(raw, count).map(t => ({ text: t, sourceEntryId: null }));
    if (!options.length) {
      toastr.error(t`未能解析出任何选项,请检查模型输出`);
      return null;
    }
    const generation = { id: gid, timestamp: Date.now(), count, options };
    return generation;
  } catch (e) {
    if (cancelled) return null;
    console.error('Choice generation failed', e);
    toastr.error(t`选项生成失败:${e instanceof Error ? e.message : String(e)}`);
    return null;
  } finally {
    if (restore) restore.restore();
    cancelled = false;
    genController = null;
    generatorState.loading = false;
    generatorState.generationId = null;
  }
}

export function cancelGeneration() {
  cancelled = true;
  genController?.abort();
  genController = null;
  generatorState.loading = false;
  generatorState.generationId = null;
}

/** 条目池生成系统提示词：写死，不进 PromptEditor、不依赖预设。
 *  与行动选项生成提示词刻意分离：输出契约是 JSON 数组（type/content/rule/replace），
 *  与行动选项输出改 JSON 的决策同向，但结构不同，故不复用 parseOptions。
 *  输出格式在此钉死（四字类型/纯文本指令/可选规则），条目种类语义由弹窗自由输入并经
 *  poolGenKindBlock 注入；条目库重构后 type/rule 是一等字段，生成结果必须能落进这两个字段，
 *  否则类型标签会被塞回 content（UI 的"AI 生成指令"框）。
 *  下游会传入带序号的"当前层已有条目"，要求 AI 去重并可用 replace 字段提替换建议。 */
const POOL_GEN_SYSTEM_PROMPT = `你是「行动条目池生成器」，负责为角色扮演对话的"行动选项"功能产出候选条目。

用户消息中会给出【当前层已有条目】（带序号 1、2、3…）。

【输出格式（严格 JSON）】
只输出一个 JSON 数组，每个元素为一个对象：
- "type"：条目类型，必须为四字中文标签（如"顺势而为"、"选项指导"），概括条目定位，逐条独立判断，不得留空。
- "content"：AI生成指令。纯文本，直接写指令/指引/行动方向本身，禁止任何符号装饰——不得带类型前缀（如"[针锋相对]"）、序号、引号包裹、表情；类型只能写在 "type" 字段。字数与写法跟随条目种类与用户要求；未指明时默认简洁行动方向（5-25 个中文字符，只写行动方向，不写对白原文、不预判他人反应、不写动作细节描写）。
- "rule"：规则指导（可选）——生成对应选项时的补充约束，没有则写空字符串 ""。
- "replace"：仅替换建议填写：要替换的【当前层已有条目】序号（数字，1-based）；新增条目必须省略此字段。

【生成要求】
1. 条目总数以用户消息为准；条目种类必须跟随用户要求——用户要"选项指导"就写指导/约束文本，要"行动方向"才写具体行动，严禁把指导类要求做成具体选项。
2. 新增条目不得与已有条目重复或高度雷同。
3. 若某条已有条目较弱、与其他条目重叠或表达不佳，可输出替换建议（携带 "replace" 序号），并给出新的 type/content/rule。
4. 新增之间、以及与已有之间，切入点/情绪态度/应对策略须有明显差异，禁止同质化。
5. 不输出思考过程、解释或前后缀语；除 JSON 数组本身（可包在代码块中）外不输出任何文字。`;

/** 解析条目池生成输出：主路径 JSON（[{type,content,rule,replace?}]，与行动选项输出改 JSON 的决策同向），
 *  回退路径按行解析并提取类型前缀。与 parseOptions 刻意分离：条目池不依赖 <options> 标签，勿合并逻辑。
 *  返回 {type, content, rule, replaceTarget?}：replaceTarget 为已有条目的 1-based 序号，
 *  由 generatePoolEntries 映射为已解析的 replaceTargetId（解析器不接触 store）。
 *  键名必须与 generatePoolEntries 的消费端一致（曾因 text→type+content 迁移漏改此处
 *  导致生成条目 type/content 全为 undefined，勿再把键名单独改回）。 */
type ParsedPoolGenItem = { type: string; content: string; rule: string; replaceTarget?: number };

/** 宽松取条目对象字段：缺省字段补空串；replace 兼容数字/数字字符串，非正数视为新增 */
const pickPoolGenFields = (x: any): ParsedPoolGenItem | null => {
  if (!x || typeof x !== 'object') return null;
  const type = typeof x.type === 'string' ? x.type.trim() : '';
  const content = typeof x.content === 'string' ? x.content.trim() : '';
  if (!type && !content) return null;
  const replaceRaw = typeof x.replace === 'number' ? x.replace : parseInt(String(x.replace ?? ''), 10);
  return {
    type,
    content,
    rule: typeof x.rule === 'string' ? x.rule.trim() : '',
    replaceTarget: Number.isFinite(replaceRaw) && replaceRaw >= 1 ? replaceRaw : undefined,
  };
};

/** 字符串感知的尾随逗号清理：跳过引号区间，仅删除引号外 `,`+空白+`]`/`}` 处的逗号。
 *  不能用全局正则 `,(\s*[\]}])` 替换——它会命中字符串值内部的 ",]"/",}" 字面量，
 *  静默篡改条目正文（如列举示例"苹果,橘子]"）。 */
const stripTrailingCommas = (s: string): string => {
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
};

export function parsePoolGenItems(text: string, count: number): ParsedPoolGenItem[] {
  // 先去除 thinking/reasoning/thought 标签块，与 parseOptions 共用同一正则（见 STRIP_REASONING_TAGS_RE）
  let c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();
  // 去掉可能的代码块包裹
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  const items: ParsedPoolGenItem[] = [];
  const push = (item: ParsedPoolGenItem | null) => {
    if (item && items.length < count) items.push(item);
  };

  // JSON 主路径：取首个 [ 到最后一个 ]，修尾随逗号后解析；字符串元素整条落 content
  const arrStart = c.indexOf('[');
  const arrEnd = c.lastIndexOf(']');
  // 主路径与抢救路径共用的数组落地：字符串元素整条落 content，对象取字段
  const pushFromArray = (p: unknown[]): boolean => {
    for (const x of p) {
      if (typeof x === 'string') {
        const s = x.trim();
        if (s) push({ type: '', content: s, rule: '' });
      } else {
        push(pickPoolGenFields(x));
      }
      if (items.length >= count) break;
    }
    return items.length > 0;
  };
  if (arrStart !== -1 && arrEnd > arrStart) {
    try {
      const p = JSON.parse(stripTrailingCommas(c.slice(arrStart, arrEnd + 1)));
      if (Array.isArray(p)) {
        if (pushFromArray(p)) return items;
      }
    } catch {
      /* 非 JSON，走截断抢救/回退 */
    }
  }

  // 截断抢救：流式代理可能在 JSON 中途以 finish_reason=length 掐断输出（实测假流式代理
  // 163 token 即截断），数组没有闭合的 ']'，主路径必然失败，而按行回退解析对 JSON 碎片
  // 只会产出垃圾条目。找字符串感知的最后一个完整对象结尾 '}'，截断到该处补 ']' 再解析——
  // 能救回多少条算多少，救回条数少于请求数属可接受降级；仍失败才落入按行回退解析。
  if (arrStart !== -1) {
    let lastBrace = -1;
    let inStr = false;
    let esc = false;
    for (let i = arrStart; i < c.length; i++) {
      const ch = c[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '}') lastBrace = i;
    }
    if (lastBrace > arrStart) {
      try {
        const p = JSON.parse(stripTrailingCommas(c.slice(arrStart, lastBrace + 1) + ']'));
        if (Array.isArray(p) && pushFromArray(p)) return items;
      } catch {
        /* 抢救失败，走回退 */
      }
    }
  }

  // 回退路径：宽松按行解析，兼容编号列表/无序列表/逐行 JSON 对象
  // 替换前缀："替换#N：文本" 或 "替换N: 文本"（N=已有条目序号），序号后须紧跟 : 或 ：
  const replaceRe = /^替换\s*#?(\d+)\s*[:：]\s*(.+)$/;
  // 去掉行首编号 "1." / "2)" / "3、" 与无序列表符 "- " / "• "；
  // 编号分隔符后须非数字，避免误吞 "10.5" 这类十进制开头的条目
  const stripMarker = (l: string) => l.replace(/^\s*(?:\d+[.)、](?!\d)|[-•])\s*/, '').trim();
  // 类型前缀提取：【短标签】正文 / [短标签] 正文 / 短标签：正文（标签限长，降低正文自带冒号被误判为标签的概率）。
  // 半角方括号必须支持：renderPoolEntryLine 喂给 AI 的已有条目格式就是 [type] content，
  // 模型在回退场景模仿该格式输出时类型才能被还原，否则丢失到 content
  const bracketTypeRe = /^【(.{1,10}?)】\s*(.+)$/;
  const halfBracketTypeRe = /^\[([^\[\]]{1,10})\]\s*(.+)$/;
  const colonTypeRe = /^([^：:]{1,6})[：:]\s+(.+)$/;
  for (const raw of c.split(/\r?\n/)) {
    let l = raw.trim();
    if (!l || /^<\/?\w+>$/i.test(l)) continue;
    // 先剥行首列表标记，再去判别是否为替换前缀
    l = stripMarker(l);
    if (!l) continue;
    // 逐行 JSON 对象兜底（模型输出 {...} 而非数组时）
    if (l.startsWith('{') && l.endsWith('}')) {
      try {
        push(pickPoolGenFields(JSON.parse(l)));
        if (items.length >= count) break;
        continue;
      } catch {
        /* 普通文本行，继续按前缀解析 */
      }
    }
    let type = '';
    const rm = l.match(replaceRe);
    if (rm) {
      // 替换行的文本也剥一次列表标记（模型可能写 "替换#2：1. 新文本"）
      l = stripMarker(rm[2]);
      if (!l) continue;
    }
    // 类型提取须在替换判定之后：替换行正文可能自带类型前缀
    const bm = l.match(bracketTypeRe);
    const hm = bm ? null : l.match(halfBracketTypeRe);
    const cm = !bm && !hm ? l.match(colonTypeRe) : null;
    if (bm) {
      type = bm[1].trim();
      l = bm[2].trim();
    } else if (hm) {
      type = hm[1].trim();
      l = hm[2].trim();
    } else if (cm) {
      type = cm[1].trim();
      l = cm[2].trim();
    }
    push({ type, content: l, rule: '', replaceTarget: rm ? parseInt(rm[1], 10) : undefined });
    if (items.length >= count) break;
  }
  return items;
}

/** 已有条目列表/替换预览的统一渲染：[type] content（type 空则只列 content）。
 *  该格式被回退解析器的 halfBracketTypeRe 支持往返还原——喂给 AI 的已有条目格式
 *  必须能被模型模仿输出后再解析出类型，改动渲染格式前先确认解析器覆盖。 */
const renderPoolEntryLine = (e: { type: string; content: string }): string => {
  const t = e.type.trim();
  const c = e.content.trim();
  return t ? `[${t}] ${c}` : c;
};

/** 条目种类注入块：条目库 AI 生成的种类由弹窗自由输入（预设：选项指导/行动方向/由AI判断，
 *  其他任意文本=自定义种类），不再依赖提示词兜底猜测。
 *  guide=指导AI生成选项的条目（content 是给选项生成 AI 的要求，不是具体行动），type 由 AI 逐条判断四字标签；
 *  action=简洁行动方向；由AI判断=不注入，沿用系统提示词的"跟随用户要求"兜底；
 *  自定义种类=把种类名嵌进语义块，content 按该种类定位撰写。
 *  与【生成要求】冲突时以本块为准——自由文本要求无法可靠传达种类语义，这正是本功能的由来。 */
const poolGenKindBlock = (kind: string): string => {
  const k = kind.trim();
  if (k === '行动方向') {
    return `\n\n【条目种类：行动方向】本次所有条目的 "content" 为简洁行动方向（5-25 个中文字符，只写行动方向，不写对白原文、不预判他人反应、不写动作细节描写）。`;
  }
  if (k === '由AI判断') {
    return '';
  }
  if (k === '' || k === '选项指导') {
    return `\n\n【条目种类：选项指导】本次所有条目都是写给"生成选项的AI"的指导，不是具体行动方向：
- "content" 必须是对选项生成的要求/约束/取舍指引（如"每批选项中至少一条推进当前事件"、"涉及对白的选项对白不超过两句"、"出现危险情境时必须有可回避的选项"），不得是"下一步做什么"的具体行动。
- "rule" 通常留空 ""（content 本身就是约束），确有补充约束时才写。
本块与用户消息【生成要求】中关于条目种类的描述冲突时，以本块为准。`;
  }
  return `\n\n【条目种类：${k}】本次所有条目属于「${k}」类：content 按该种类的定位撰写，并结合用户消息中的生成要求；输出格式要求（四字类型、纯文本指令、可选规则指导）不变。`;
};

/** 条目池 AI 生成：复用活动 API（与 generateOptions 同一套 resolveCustomApi），
 *  始终带角色描述/性格/场景以贴合角色语气；includeContext 时纳入近 N 轮聊天历史。
 *  kind 为弹窗自由输入的条目种类（空串=选项指导；"行动方向"/"由AI判断"=专用预设；
 *  其他文本=自定义种类，语义块见 poolGenKindBlock）。
 *  targetType 非空时写入 system+user 强制所有生成条目使用该类型（显式覆盖，优先于四字判断），
 *  留空则 type 由 AI 逐条判断四字标签；不做生成后改写标签——那会给不匹配的内容错挂类型。
 *  不走思维链预填充（区别于行动选项生成），stream 由 api.stream 决定。 */
export async function generatePoolEntries(params: {
  count: number;
  requirements: string;
  includeContext: boolean;
  targetType: string;
  kind: string;
}): Promise<PoolGenItem[]> {
  if (poolGenState.loading) {
    toastr.info(t`条目生成中,请稍候`);
    return [];
  }
  const gs = useGlobalSettingsStore();
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) {
    toastr.error(t`请先在设置中配置 API（API 地址 + 模型），然后重新生成`);
    return [];
  }
  poolGenState.loading = true;
  poolGenController = new AbortController();
  try {
    // 快照总条目库已有条目：喂给 AI 的编号列表 + inject 时序号→id 映射；
    // rule 一并快照，用于替换行在 AI 未给规则时预填原规则（避免注入时静默清空）
    const existing = gs.settings.master_pool.map(e => ({ id: e.id, type: e.type, content: e.content, rule: e.rule }));
    const existingList = existing.length
      ? existing.map((e, i) => `${i + 1}. ${renderPoolEntryLine(e)}`).join('\n')
      : '（无）';
    const forceType = params.targetType.trim();
    // type 一律由 AI 逐条判断四字标签（与默认条目库的四字惯例一致）；guide 不再强制统一
    // "选项指导"——种类语义由 poolGenKindBlock 承担，手填目标类型仍是显式覆盖
    // 强制类型双路下发（system + user）：只改 user 或只改 system 时，部分模型会忽略较弱一侧
    const systemPrompt =
      POOL_GEN_SYSTEM_PROMPT +
      poolGenKindBlock(params.kind) +
      (forceType ? `\n\n【强制类型】本次所有生成条目的 "type" 字段必须为 "${forceType}"，不得使用其他类型。` : '');
    const messages: ChatMsg[] = [{ role: 'system', content: systemPrompt }];
    // 角色描述/性格/场景：贴合角色语气，与 buildMessages 同源同法（substituteParams）
    const ch = getStCharacter(this_chid);
    if (ch?.data?.description) messages.push({ role: 'system', content: substituteParams(ch.data.description) });
    if (ch?.data?.personality) messages.push({ role: 'system', content: substituteParams(ch.data.personality) });
    if (ch?.data?.scenario) messages.push({ role: 'system', content: substituteParams(ch.data.scenario) });
    if (params.includeContext) {
      for (const m of buildChatHistory(gs.settings.prompt_rules.context_rounds)) messages.push(m);
    }
    messages.push({
      role: 'user',
      content:
        `请生成 ${params.count} 条行动条目建议。\n` +
        (forceType ? `强制类型：所有生成条目的 type 必须为 "${forceType}"。\n` : '') +
        `已有条目：\n${existingList}\n用户要求：\n${params.requirements}`,
    });
    const raw = await callSecondaryApiWithRetry(messages, api, gs.settings.retry_count, poolGenController.signal);
    const parsed = parsePoolGenItems(raw, params.count);
    // 把 1-based 序号映射为已解析的 replaceTargetId + 原文；越界序号降级为新增条目
    const items: PoolGenItem[] = parsed.map(p => {
      const idx = p.replaceTarget;
      if (idx !== undefined && idx >= 1 && idx <= existing.length) {
        const tgt = existing[idx - 1];
        return {
          type: p.type,
          content: p.content,
          // 替换行规则预填：AI 未给规则时回退原条目规则，结果行所见即注入所写
          rule: p.rule || tgt.rule,
          replaceTargetId: tgt.id,
          replaceOriginal: renderPoolEntryLine(tgt),
        };
      }
      return { type: p.type, content: p.content, rule: p.rule };
    });
    if (!items.length) {
      toastr.error(t`未解析出条目,请检查模型输出`);
    }
    return items;
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return [];
    console.error('[Choice] pool generation failed', e);
    toastr.error(t`条目生成失败:${e instanceof Error ? e.message : String(e)}`);
    return [];
  } finally {
    poolGenController = null;
    poolGenState.loading = false;
  }
}

export function cancelPoolGen() {
  poolGenController?.abort();
  poolGenController = null;
  poolGenState.loading = false;
}
