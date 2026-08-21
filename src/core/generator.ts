import { chat, characters, substituteParams, this_chid } from '@sillytavern/script';
import { getSortedEntries, selected_world_info } from '@sillytavern/scripts/world-info';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { resolvePool } from '@/core/pool-resolver';
import { evaluateCondition } from '@/core/variable-bridge';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { ChoiceGeneration } from '@/core/options-store';
import type { PromptRules, SecondaryApi, WorldInfoSettings } from '@/type/settings';

export type GenerateTarget = { messageId: number; swipeId: number };

export const generatorState = reactive({ loading: false, generationId: null as string | null });

let cancelled = false;

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

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

const resolveCustomApi = (id: string, apis: SecondaryApi[]): SecondaryApi | undefined =>
  id ? apis.find(a => a.id === id) : undefined;

type Ctx = { count: number; pinned: string; poolSelected: string };
const sub = (t: string, c: Ctx) =>
  t
    .replaceAll('{{count}}', String(c.count))
    .replaceAll('{{pinned}}', c.pinned)
    .replaceAll('{{pool_selected}}', c.poolSelected);

const buildUserInstr = (c: Ctx): string => {
  const l = [`请为角色的当前处境生成 ${c.count} 条行动选项。`];
  if (c.pinned) l.push(`固定行动(必须原样包含):\n${c.pinned}`);
  if (c.poolSelected) l.push(`候选行动(可在其基础上修改或发挥):\n${c.poolSelected}`);
  l.push(`
生成规则：
1. 其中 1 个固定为"跳过场景"类型
2. 其余 ${c.count - 1} 个从以下类型中随机且互不重复地抽取，确保类型、切入点、情绪态度均有明显差异：理性分析、强势试探、温和安抚、幽默化解、纯物理行动、静观其变、视角切换、与此同时
3. 若当前候选类型总数不足以支撑本次抽取数量，允许类型重复，但重复类型生成的选项须在切入点与情绪态度上明显不同
4. 每个选项独立生成"标题"与"内容"两部分，格式约束见系统规则
5. 输出时严格遵守输出纯净度铁律，先输出 <thinking> 分析，再输出 <options> 选项`);
  return l.join('\n');
};

const buildChatHistory = (contextRounds: number): ChatMsg[] => {
  let msgs = chat.filter(m => !m.is_hidden);
  if (contextRounds > 0) msgs = msgs.slice(-contextRounds * 2);
  const h: ChatMsg[] = [];
  for (const m of msgs) {
    if (m.is_system) continue;
    const c = m.message ?? '';
    if (!c) continue;
    h.push({ role: m.is_user ? 'user' : 'assistant', content: c });
  }
  return h;
};

type WIEntry = { uid: string | number; world: string; content: string; disable: boolean; position: number };

const buildWI = async (excl: string[], redlight: boolean, ejs: boolean): Promise<{ before: string; after: string }> => {
  try {
    let e = (await getSortedEntries()) as WIEntry[];
    if (excl.length) e = e.filter(x => !excl.includes(`${x.world}::${x.uid}`));
    const b: string[] = [],
      a: string[] = [];
    for (const x of e) {
      if (redlight && x.disable) continue;
      let t = substituteParams(x.content || '');
      if (ejs && typeof (window as any).ejs?.render === 'function' && t.includes('<%')) {
        try {
          t = (window as any).ejs.render(t, { async: false }) as string;
        } catch (err) {
          console.error('[Choice] EJS render failed', err);
        }
      }
      if (!t) continue;
      (x.position === 1 ? a : b).push(t);
    }
    return { before: b.join('\n\n'), after: a.join('\n\n') };
  } catch (err) {
    console.error('[Choice] buildWI failed', err);
    return { before: '', after: '' };
  }
};

type Restore = { restore: () => void } | null;
const applyWIExcl = (excl: string[]): Restore => {
  if (!excl.length) return null;
  const saved = [...(selected_world_info ?? [])];
  selected_world_info.length = 0;
  selected_world_info.push(...saved.filter(n => !excl.includes(n)));
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

export function parseOptions(text: string, count: number): string[] {
  // 先去除 thinking/reasoning/thought 标签块（包括预填充产生的 <thinking> 块）
  let c = text.replace(/<(?:think|reasoning|thought)>[\s\S]*?<\/(?:think|reasoning|thought)>/gi, '').trim();

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
  return c
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^<\/?\w+>$/i.test(l))
    .slice(0, count);
}

const buildMessages = async (
  systemPrompt: string,
  userInstruction: string,
  wi: WorldInfoSettings,
  contextRounds: number,
): Promise<ChatMsg[]> => {
  const msgs: ChatMsg[] = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  const ch = this_chid !== undefined ? characters[this_chid] : undefined;
  if (ch?.data?.description) msgs.push({ role: 'system', content: substituteParams(ch.data.description) });
  if (ch?.data?.personality) msgs.push({ role: 'system', content: substituteParams(ch.data.personality) });
  if (ch?.data?.scenario) msgs.push({ role: 'system', content: substituteParams(ch.data.scenario) });
  if (wi.enabled) {
    const needManual = !wi.redlight_mode || wi.excluded_entries.length > 0;
    const w = needManual
      ? await buildWI(wi.excluded_entries, wi.redlight_mode, wi.ejs_compat)
      : await buildWI([], true, wi.ejs_compat);
    if (w.before) msgs.push({ role: 'system', content: w.before });
    if (w.after) msgs.push({ role: 'system', content: w.after });
  }
  for (const m of buildChatHistory(contextRounds)) msgs.push(m);
  msgs.push({ role: 'user', content: userInstruction });
  return msgs;
};

/** 思维链引导：在生成选项前，提示模型逐条检查场景与规则，提高输出质量。 */
const THINKING_PROMPT = `【输出前思考】
在生成选项之前，请按以下顺序逐条检查：
1. 场景核查：当前场景有哪些角色在场？哪些已离开？可用道具是什么？
2. 状态锚点：正文末尾各角色的情绪、动作、对白分别是什么？
3. 类型分配：本次选项类型是否互不重复？是否涵盖了不同的应对策略？
4. 差异性检查：每个选项的切入点和情绪态度是否有明显差异？
5. 规范审查：是否有"完成态""越权代演""结果性词汇""概括性说话动词"？
6. 收尾审查：每个选项的收尾是否留白，未预判对方反应？`;

/** 预填充文本：思维链引导，强制模型先输出 <thinking> 分析再输出 <options>。
 *  与柏宝书（ST-BaiBai-Book）的 THINKING_PREFILL 设计理念一致：
 *  开关（send_prefill）只控制是否发送，内容本身由开发者写死，与解析逻辑强绑定。 */
const OPTIONS_PREFILL = `收到。我将根据当前场景与角色状态，先梳理检查点，然后生成行动选项。

<thinking>
`;

const GENERATE_URL = '/api/backends/chat-completions/generate';

const requestViaFetch = async (messages: ChatMsg[], api: SecondaryApi, signal?: AbortSignal): Promise<string> => {
  const body: Record<string, unknown> = {
    chat_completion_source: 'openai',
    reverse_proxy: api.apiurl,
    proxy_password: api.key || '',
    model: api.model,
    messages,
    temperature: api.temperature,
    max_tokens: api.max_tokens,
    stream: api.stream,
  };

  if (api.exclude_params) {
    for (const key of api.exclude_params
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)) {
      delete body[key];
    }
  }

  const ctx = window.SillyTavern?.getContext?.();
  const resp = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: ctx?.getRequestHeaders?.() ?? {},
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API 请求失败 (${resp.status}): ${text.slice(0, 300)}`);
  }

  if (api.stream && resp.body) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? '';
          full += delta;
        } catch {
          /* 忽略解析失败的行 */
        }
      }
    }
    return full;
  }

  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || 'API 返回错误');
  return data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
};

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
  const wi = cs.settings.world_info;
  const restore = wi.enabled && wi.excluded_books.length > 0 ? applyWIExcl(wi.excluded_books) : null;
  try {
    const count = resolveCount(gs.settings.generation.count_mode);
    const pool = resolvePool({
      effectivePool: ps.effectivePool,
      count,
      categoriesEnabled: gs.settings.generation.categories_enabled,
      shuffleFinal: gs.settings.generation.shuffle_final,
      pinnedFollowsCondition: gs.settings.generation.pinned_follows_condition,
      pinnedOverflow: gs.settings.generation.pinned_overflow,
      conditionMet: e => evaluateCondition(e.condition),
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
      poolSelected: pool.drawn.map(e => e.text).join('\n'),
    };
    const rules = gs.settings.prompt_rules;

    const systemPrompt = rules.system_prompt ? substituteParams(sub(rules.system_prompt, c)) : '';

    const userInstruction = sub(buildUserInstr(c), c);
    console.log('[Choice] 发送给AI的指令', userInstruction.slice(0, 1000));
    const messages = await buildMessages(systemPrompt, userInstruction, wi, rules.context_rounds);

    if (rules.core_rules) {
      messages.push({ role: 'system', content: substituteParams(sub(rules.core_rules, c)) });
    }

    const api = resolveCustomApi(cs.settings.active_api_id, gs.settings.apis);
    if (!api) {
      toastr.error(t`请先在设置中配置 API（API 地址 + 模型），然后重新生成`);
      return null;
    }

    if (api.send_prefill) {
      // system 消息：输出前思考检查清单，引导模型在生成前逐条自查
      messages.push({ role: 'system', content: THINKING_PROMPT });
      // assistant 预填充强制模型以思维链模式开始
      messages.push({ role: 'assistant', content: OPTIONS_PREFILL });
    }

    let signal: AbortSignal | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (api.timeout > 0) {
      const controller = new AbortController();
      signal = controller.signal;
      timeoutId = setTimeout(() => controller.abort(), api.timeout * 1000);
    }

    try {
      const raw = await requestViaFetch(messages, api, signal);
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
    generatorState.loading = false;
    generatorState.generationId = null;
  }
}

export function cancelGeneration() {
  cancelled = true;
  generatorState.loading = false;
  generatorState.generationId = null;
}
