import { characters, substituteParams, this_chid } from '@sillytavern/script';
import { getWorldInfoPrompt, selected_world_info } from '@sillytavern/scripts/world-info';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { resolvePool } from '@/core/pool-resolver';
import { callSecondaryApi, type ChatMsg } from '@/core/api-client';
import { getBaiBaiSummary, getBaiBaiState } from '@/core/baibai-bridge';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { ChoiceGeneration } from '@/core/options-store';
import type { PoolEntry, PromptModule, PromptRules, SecondaryApi, WorldInfoGlobalSettings } from '@/type/settings';
import { DEFAULT_MODULES, GenerationSettings, CORE_RULES_STATIC } from '@/type/settings';

export type GenerateTarget = { messageId: number; swipeId: number };

/** AI 条目池生成结果项：replaceTargetId 存在则替换该已有条目（仅改 text），否则为新增条目。
 *  replaceOriginal 仅用于 UI 预览被替换的原文，不参与注入逻辑。 */
export type PoolGenItem = {
  text: string;
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

const resolveCount = (cm: string): number => {
  const s = cm.trim();
  if (!s) return 4;
  // 范围格式 "4-8"：前端随机，每次生成时在 [min, max] 内取一个整数
  const rangeMatch = s.match(/^(\d+)\s*-\s*(\d+)$/);
  if (rangeMatch) {
    const min = parseInt(rangeMatch[1], 10);
    const max = parseInt(rangeMatch[2], 10);
    if (min >= max || min <= 0) return 4;
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : 4;
};

export const resolveCustomApi = (id: string, apis: SecondaryApi[]): SecondaryApi | undefined =>
  id ? apis.find(a => a.id === id) : undefined;

type Ctx = { count: number; pinned: string; poolSelected: string; input: string };
const sub = (t: string, c: Ctx) =>
  t
    .replaceAll('{{count}}', String(c.count))
    .replaceAll('{{count_minus_1}}', String(Math.max(0, c.count - 1)))
    .replaceAll('{{pinned}}', c.pinned)
    .replaceAll('{{pool_selected}}', c.poolSelected)
    .replaceAll('{{input}}', c.input);

export const buildMessages = async (
  modules: PromptModule[],
  ctx: Ctx,
  wi: WorldInfoGlobalSettings,
  contextRounds: number,
  isEnrich = false,
): Promise<ChatMsg[]> => {
  const gs = useGlobalSettingsStore();
  const prefillEnabled = gs.settings.prompt_rules.prefill_enabled;
  const msgs: ChatMsg[] = [];
  const wiBuckets = wi.enabled ? await buildWI() : null;

  const sorted = [...modules].sort((a, b) => a.order - b.order);

  for (const mod of sorted) {
    if (!mod.enabled) continue;
    if (!prefillEnabled && mod.role === 'assistant') continue;
    if (isEnrich && mod.option_only) continue;

    switch (mod.id) {
      case 'system_prompt': {
        const content = substituteParams(sub(mod.content, ctx));
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
        const personaDesc = (window as any).power_user?.persona_description;
        if (personaDesc) {
          msgs.push({ role: 'system', content: substituteParams(personaDesc) });
        }
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
        if (text) msgs.push({ role: 'system', content: text });
        break;
      }
      case 'baibai_state': {
        if (!gs.settings.prompt_rules.baibai_enabled) break;
        const text = getBaiBaiState();
        if (text) msgs.push({ role: 'system', content: text });
        break;
      }
      case 'user_instruction': {
        const content = sub(mod.content, ctx);
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      case 'core_rules': {
        const pr = gs.settings.prompt_rules;
        const personStyle = pr.person_style || '';
        const optionRules = pr.option_rules || '';
        // 两个新手字段都非空时，动态组装 core_rules 内容；否则用模块原有 content（向后兼容旧用户）
        let content: string;
        if (personStyle && optionRules) {
          content = `【核心规则 - 生成选项时严格遵守】
${optionRules}

【叙述风格】
${personStyle}

${CORE_RULES_STATIC}`;
        } else {
          content = mod.content;
        }
        content = substituteParams(sub(content, ctx));
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      case 'assistant_ack':
      case 'thinking_prompt':
      case 'assistant_thinking': {
        const content = mod.content;
        if (content) msgs.push({ role: mod.role, content });
        break;
      }
      default: {
        const content = substituteParams(sub(mod.content, ctx));
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
          content = content.replace(new RegExp(rule.pattern, 'gs'), '');
        }
      } catch {
        console.warn('[choice] 无效过滤规则:', rule);
      }
    }
    if (!content.trim()) continue;
    const role = m.role === 'user' || m.is_user ? 'user' : 'assistant';
    h.push({ role, content });
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
    const chatStrings = chatArr.map((m: any) => m?.mes ?? '');
    const ch = this_chid !== undefined ? characters[this_chid] : undefined;

    // 世界书预算 = world_info_budget(%) × maxContext。ST 主生成用 ctx.maxContext(如 8192) 算预算，
    // 但行动选项是独立 API 调用，沿用 8192 会让角色世界书的大条目先耗尽预算，
    // 导致额外启用的世界书 constant 条目在预算检查阶段被丢弃（"budget of N reached"）。
    // 这里放宽到较大上下文估算值，使预算不再成为额外世界书条目的瓶颈。
    const maxCtx = 128000;

    const result = await getWorldInfoPrompt(chatStrings, maxCtx, false, {
      trigger: 'normal',
      personaDescription: (window as any).power_user?.persona_description ?? '',
      characterDescription: ch?.data?.description ?? '',
      characterPersonality: ch?.data?.personality ?? '',
      characterDepthPrompt: '',
      scenario: ch?.data?.scenario ?? '',
      creatorNotes: '',
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
export const applyWIExcl = (excl: string[], enabled: string[]): Restore => {
  const saved = [...(selected_world_info ?? [])];
  const hasExcl = excl.length > 0;
  const hasEnabled = enabled.length > 0;
  if (!hasExcl && !hasEnabled) return null;

  selected_world_info.length = 0;
  let newList = hasExcl ? saved.filter(n => !excl.includes(n)) : [...saved];
  if (hasEnabled) {
    for (const name of enabled) {
      // excluded_books 优先于 enabled_books：被排除的书即使仍在 enabled 列表里也不注入
      if (!newList.includes(name) && !excl.includes(name)) newList.push(name);
    }
  }
  selected_world_info.push(...newList);
  const chid = this_chid;
  const cw = chid !== undefined && characters[chid] ? characters[chid]?.data?.extensions?.world : undefined;
  const cwEx = cw ? excl.includes(cw) : false;
  if (cwEx && chid !== undefined && characters[chid]?.data?.extensions) characters[chid].data.extensions.world = '';
  return {
    restore: () => {
      selected_world_info.length = 0;
      selected_world_info.push(...saved);
      if (cwEx && chid !== undefined && characters[chid]?.data?.extensions) characters[chid].data.extensions.world = cw;
    },
  };
};

/** 思维链标签块剥离正则：parseOptions 与 parsePoolGenItems 共用。
 *  新增模型思维标签（如 <reasoning_content>/<antThinking>）时只改这一处即可同步两处解析，
 *  避免只补一处而另一处静默漏处理。String.replace 对 /g 正则不保留 lastIndex 状态，跨调用共享安全。 */
const STRIP_REASONING_TAGS_RE = /<(?:think|reasoning|thought)>[\s\S]*?<\/(?:think|reasoning|thought)>/gi;

export function parseOptions(text: string, count: number): string[] {
  // 先去除 thinking/reasoning/thought 标签块（包括预填充产生的 <thinking> 块）
  let c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();

  const m = c.match(/<options>([\s\S]*?)<\/options>/i);
  if (m) c = m[1].trim();
  else
    c = c
      .replace(/^```[a-zA-Z]*\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

  // 尝试 JSON 解析
  if (c.startsWith('['))
    try {
      const p = JSON.parse(c);
      if (Array.isArray(p)) {
        const i = p
          .map(x => (typeof x === 'string' ? x.trim() : (x?.text?.trim() ?? x?.option?.trim() ?? '')))
          .filter(Boolean);
        if (i.length) return i.slice(0, count);
      }
    } catch (err) {
      /* not JSON */
    }

  // 按行解析，兼容 "标题: 内容" 格式和纯文本格式
  // 先按换行分割，再在每行内按 "标题: 内容" 模式拆分，处理模型将多个选项写在同一行的情况
  const lines = c
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^<\/?\w+>$/i.test(l));
  // 标题格式：2-5 个汉字后跟 ": " 或 "："
  const titleRe = /([\u4e00-\u9fff]{2,5})[:：] /g;
  const result: string[] = [];
  for (const line of lines) {
    let lastIdx = 0;
    let match;
    let found = false;
    titleRe.lastIndex = 0;
    while ((match = titleRe.exec(line)) !== null) {
      found = true;
      if (lastIdx > 0) result.push(line.slice(lastIdx, match.index).trim());
      lastIdx = match.index;
    }
    if (found) {
      result.push(line.slice(lastIdx).trim());
    } else {
      result.push(line);
    }
  }
  return result.slice(0, count);
}

/** 条目池生成系统提示词：写死，不进 PromptEditor、不依赖预设。
 *  与行动选项生成提示词刻意分离：条目池只要简短"行动方向"，
 *  不要求标题/对白/格式标签，输出契约不同，故不复用 parseOptions。
 *  下游会传入带序号的"当前层已有条目"，要求 AI 去重并可用 替换#序号 提替换建议。 */
const POOL_GEN_SYSTEM_PROMPT = `你是「行动条目池生成器」，负责为角色扮演对话的"行动选项"功能产出候选条目。

用户消息中会给出【当前层已有条目】（带序号 1、2、3…）。

【输出要求】
1. 共输出 N 条建议，每条文本 5-25 个中文字符，只写行动方向，不写对白原文/越权结果（不预判他人反应）/动作细节描写。
2. 新增条目不得与已有条目重复或高度雷同。
3. 若某条已有条目较弱、与其他条目重叠或表达不佳，可用"替换#序号：新文本"提出替换建议，序号对应【当前层已有条目】列表中的序号。
4. 新增之间、以及与已有之间，切入点/情绪态度/应对策略须有明显差异，禁止同质化。
5. 不输出思考过程、不输出任何标签、不输出解释或前后缀语；只输出条目列表，每行一条。
6. 格式：新增条目直接写文本；替换条目写作 "替换#序号：新文本"（序号必须对应已给出的已有条目序号）。`;

export async function generateOptions(target: GenerateTarget): Promise<ChoiceGeneration | null> {
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
  const restore = gwi.enabled ? applyWIExcl(cwi.excluded_books, cwi.enabled_books) : null;
  try {
    const gen = ps.effectiveConfig?.generation ?? GenerationSettings.prefault({});
    const count = resolveCount(gen.count_mode);
    const pool = resolvePool({
      effectivePool: ps.effectivePool,
      count,
      categoriesEnabled: gen.categories_enabled,
      shuffleFinal: gen.shuffle_final,
      pinnedOverflow: gen.pinned_overflow,
    });
    console.log('[Choice] 池抽取结果', {
      生效池条目数: ps.effectivePool.length,
      目标数量: count,
      固定条目: pool.pinned.length,
      抽取条目: pool.drawn.length,
      固定文本: pool.pinned.map(e => e.text),
      抽取文本: pool.drawn.map(e => e.text),
    });
    const c: Ctx = {
      count,
      pinned: pool.pinned.map(e => e.text).join('\n'),
      poolSelected: pool.drawn
        .map(e => (e.condition.trim() ? `[条件: ${e.condition.trim()}] ${e.text}` : e.text))
        .join('\n'),
      input: '',
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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (api.timeout > 0) {
      timeoutId = setTimeout(() => genController.abort(), api.timeout * 1000);
    }

    try {
      const raw = await callSecondaryApi(messages, api, signal);
      if (cancelled) return null;
      const options = parseOptions(raw, count).map(t => ({ text: t, sourceEntryId: null }));
      if (!options.length) {
        toastr.error(t`未能解析出任何选项,请检查模型输出`);
        return null;
      }
      return { id: gid, timestamp: Date.now(), count, options };
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
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

/** 解析条目池生成输出：宽松按行解析，兼容编号列表/无序列表/纯文本。
 *  与 parseOptions 刻意分离：条目池不依赖 <options> 标签，输出契约不同，勿合并逻辑。
 *  返回中间结构 {text, replaceTarget?}：replaceTarget 为已有条目的 1-based 序号，
 *  由 generatePoolEntries 映射为已解析的 replaceTargetId（解析器不接触 store）。 */
export function parsePoolGenItems(text: string, count: number): { text: string; replaceTarget?: number }[] {
  // 先去除 thinking/reasoning/thought 标签块，与 parseOptions 共用同一正则（见 STRIP_REASONING_TAGS_RE）
  let c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();
  // 去掉可能的代码块包裹
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  // 替换前缀："替换#N：文本" 或 "替换N: 文本"（N=已有条目序号），序号后须紧跟 : 或 ：
  const replaceRe = /^替换\s*#?(\d+)\s*[:：]\s*(.+)$/;
  // 去掉行首编号 "1." / "2)" / "3、" 与无序列表符 "- " / "• "；
  // 编号分隔符后须非数字，避免误吞 "10.5" 这类十进制开头的条目
  const stripMarker = (l: string) => l.replace(/^\s*(?:\d+[.)、](?!\d)|[-•])\s*/, '').trim();
  const items: { text: string; replaceTarget?: number }[] = [];
  for (const raw of c.split(/\r?\n/)) {
    let l = raw.trim();
    if (!l || /^<\/?\w+>$/i.test(l)) continue;
    // 先剥行首列表标记，再去判别是否为替换前缀
    l = stripMarker(l);
    if (!l) continue;
    const m = l.match(replaceRe);
    if (m) {
      // 替换行的文本也剥一次列表标记（模型可能写 "替换#2：1. 新文本"）
      const t = stripMarker(m[2]);
      if (t) items.push({ text: t, replaceTarget: parseInt(m[1], 10) });
    } else {
      items.push({ text: l });
    }
    if (items.length >= count) break;
  }
  return items;
}

/** 条目池 AI 生成：复用活动 API（与 generateOptions 同一套 resolveCustomApi），
 *  始终带角色描述/性格/场景以贴合角色语气；includeContext 时纳入近 N 轮聊天历史。
 *  不走思维链预填充（区别于行动选项生成），stream 由 api.stream 决定。 */
export async function generatePoolEntries(params: {
  count: number;
  requirements: string;
  includeContext: boolean;
}): Promise<PoolGenItem[]> {
  if (poolGenState.loading) {
    toastr.info(t`条目生成中,请稍候`);
    return [];
  }
  const gs = useGlobalSettingsStore();
  const cs = useChatSettingsStore();
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) {
    toastr.error(t`请先在设置中配置 API（API 地址 + 模型），然后重新生成`);
    return [];
  }
  poolGenState.loading = true;
  poolGenController = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  if (api.timeout > 0) {
    timeoutId = setTimeout(() => poolGenController?.abort(), api.timeout * 1000);
  }
  try {
    // 快照总条目库已有条目（id+text）：用于喂给 AI 的编号列表，以及 inject 时序号→id 的映射
    const existing = gs.settings.master_pool.map(e => ({ id: e.id, text: e.text }));
    const existingList = existing.length ? existing.map((e, i) => `${i + 1}. ${e.text}`).join('\n') : '（无）';
    const messages: ChatMsg[] = [{ role: 'system', content: POOL_GEN_SYSTEM_PROMPT }];
    // 角色描述/性格/场景：贴合角色语气，与 buildMessages 同源同法（substituteParams）
    const ch = this_chid !== undefined ? characters[this_chid] : undefined;
    if (ch?.data?.description) messages.push({ role: 'system', content: substituteParams(ch.data.description) });
    if (ch?.data?.personality) messages.push({ role: 'system', content: substituteParams(ch.data.personality) });
    if (ch?.data?.scenario) messages.push({ role: 'system', content: substituteParams(ch.data.scenario) });
    if (params.includeContext) {
      for (const m of buildChatHistory(gs.settings.prompt_rules.context_rounds)) messages.push(m);
    }
    messages.push({
      role: 'user',
      content: `请生成 ${params.count} 条行动条目建议。\n已有条目：\n${existingList}\n用户要求：\n${params.requirements}`,
    });
    const raw = await callSecondaryApi(messages, api, poolGenController.signal);
    const parsed = parsePoolGenItems(raw, params.count);
    // 把 1-based 序号映射为已解析的 replaceTargetId + 原文；越界序号降级为新增条目
    const items: PoolGenItem[] = parsed.map(p => {
      const idx = p.replaceTarget;
      if (idx !== undefined && idx >= 1 && idx <= existing.length) {
        const tgt = existing[idx - 1];
        return { text: p.text, replaceTargetId: tgt.id, replaceOriginal: tgt.text };
      }
      return { text: p.text };
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
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    poolGenController = null;
    poolGenState.loading = false;
  }
}

export function cancelPoolGen() {
  poolGenController?.abort();
  poolGenController = null;
  poolGenState.loading = false;
}
