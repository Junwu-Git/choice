import { characters, substituteParams, this_chid } from '@sillytavern/script';
import { getWorldInfoPrompt, selected_world_info } from '@sillytavern/scripts/world-info';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { power_user } from '@sillytavern/scripts/power-user';
import { resolvePool } from '@/core/pool-resolver';
import { callSecondaryApiWithRetry, type ChatMsg } from '@/core/api-client';
import { getBaiBaiSummary, getBaiBaiState } from '@/core/baibai-bridge';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { ChoiceGeneration } from '@/core/options-store';
import type { PoolEntry, PromptModule, SecondaryApi, WorldInfoGlobalSettings } from '@/type/settings';
import { DEFAULT_MODULES, GenerationSettings, CORE_RULES_STATIC } from '@/type/settings';

export type GenerateTarget = { messageId: number; swipeId: number };

/** AI 条目池生成结果项：replaceTargetId 存在则替换该已有条目（仅改 type/content），否则为新增条目。
 *  replaceOriginal 仅用于 UI 预览被替换的原文，不参与注入逻辑。 */
export type PoolGenItem = {
  type: string;
  content: string;
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

export type Ctx = { count: number; pinnedCount: number; pinned: string; poolSelected: string; input: string; minChars: number; maxChars: number; enrichPersonStyle: string; optionPerson: string; enrichPerson: string };
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
    enrichPersonStyle: pr.enrich_person_style || (pr.enrich_person ? `统一使用${pr.enrich_person} {{user}} 为主语` : ''),
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
          msgs.push({ role: 'system', content: substituteParams(personaDesc) });
        }
        break;
      }
      case 'char_description': {
        const ch = this_chid !== undefined ? characters[this_chid] : undefined;
        const desc = ch?.data?.description;
        if (desc) msgs.push({ role: 'system', content: substituteParams(desc) });
        break;
      }
      case 'char_personality': {
        const ch = this_chid !== undefined ? characters[this_chid] : undefined;
        const personality = ch?.data?.personality;
        if (personality) msgs.push({ role: 'system', content: substituteParams(personality) });
        break;
      }
      case 'char_scenario': {
        const ch = this_chid !== undefined ? characters[this_chid] : undefined;
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
      case 'baibai_state': {
        if (!gs.settings.prompt_rules.baibai_enabled) break;
        const text = getBaiBaiState();
        if (text) {
          msgs.push({
            role: 'system',
            content: `<baibai_state>\n以下为记忆系统对当前场景状态的实时记录，仅供你参考以保持剧情连贯，不得在回复中直接引用或复述其中内容。\n${text}\n</baibai_state>`,
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
          const effectivePersonStyle = personStyle || `选项内容以${pr.option_person || '第三人称'} {{user}} 为绝对主语，融入微表情、肢体语言、语气特征或感官体验，让 {{user}} 看起来是一个鲜活的参与者。例外：他人视角、与此同时、转场推进 三类不受绝对主语约束。鼓励在动作描写中加入与当前环境或道具的物理交互，避免角色像在真空中对话。选项的切入点须紧扣正文末尾其他角色的当前状态。`;
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
  // 将最后一条消息用 <current_scene> 包裹，让 AI 明确识别"当前场景"边界，
  // 避免在长对话中注意力被稀释到更早的剧情。
  if (h.length > 0) {
    const last = h[h.length - 1];
    last.content = `<current_scene>\n${last.content}\n</current_scene>`;
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
    const ch = this_chid !== undefined ? characters[this_chid] : undefined;

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
  const bracketTitleRe = /[\[【]([^\]】]+?)[\]】]\s*/g;
  const bracketMatches = [...c.matchAll(bracketTitleRe)];
  if (bracketMatches.length > 0) {
    const result: string[] = [];
    for (let i = 0; i < bracketMatches.length; i++) {
      const start = bracketMatches[i].index!;
      const end = i + 1 < bracketMatches.length ? bracketMatches[i + 1].index! : c.length;
      const option = c.slice(start, end).replace(/\r?\n/g, '').trim();
      if (option) result.push(option);
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
    const count = resolveCount(gs.settings.global_count_mode);
    const gen = ps.effectiveConfig?.generation;
    const pool = resolvePool({
      effectivePool: ps.effectivePool,
      count,
      categoriesEnabled: gen.categories_enabled,
      shuffleFinal: gen.shuffle_final,
      pinnedOverflow: gen.pinned_overflow,
    });
    const pinnedCount = pool.pinned.length;
    const poolSelectedText = pool.drawn
      .map(e => {
        let line = e.type;
        if (e.content.trim()) line += ': ' + e.content.trim();
        if (e.condition.trim()) line = `[条件: ${e.condition.trim()}] ${line}`;
        if (e.rule.trim()) line += ` [规则: ${e.rule.trim()}]`;
        return line;
      })
      .join('\n');
    const c: Ctx = {
      count,
      pinnedCount,
      pinned: pool.pinned
        .map(e => {
          let line = e.type;
          if (e.content.trim()) line += ': ' + e.content.trim();
          return line;
        })
        .join('\n'),
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
  try {
    // 快照总条目库已有条目（id+text）：用于喂给 AI 的编号列表，以及 inject 时序号→id 的映射
    const existing = gs.settings.master_pool.map(e => ({ id: e.id, type: e.type, content: e.content }));
    const existingList = existing.length
      ? existing.map((e, i) => `${i + 1}. ${e.type}: ${e.content}`).join('\n')
      : '（无）';
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
          replaceTargetId: tgt.id,
          replaceOriginal: `${tgt.type}: ${tgt.content}`,
        };
      }
      return { type: p.type, content: p.content };
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
