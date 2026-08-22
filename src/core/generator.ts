import { chat, characters, substituteParams, this_chid } from '@sillytavern/script';
import { getSortedEntries, loadWorldInfo, selected_world_info } from '@sillytavern/scripts/world-info';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { resolvePool } from '@/core/pool-resolver';
import { evaluateCondition } from '@/core/variable-bridge';
import { callSecondaryApi, type ChatMsg } from '@/core/api-client';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore, type PoolLayer } from '@/store/pool-selector';
import type { ChoiceGeneration } from '@/core/options-store';
import type { PoolEntry, PromptRules, SecondaryApi, WorldInfoChatSettings, WorldInfoGlobalSettings } from '@/type/settings';

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

const resolveCustomApi = (id: string, apis: SecondaryApi[]): SecondaryApi | undefined =>
  id ? apis.find(a => a.id === id) : undefined;

/** 读取指定层当前池数组（store 读取集中在 core，与 generateOptions 同模式）。
 *  返回的是 store 内的响应式数组引用；调用方做快照后再用于编号/映射。 */
const poolOfLayer = (layer: PoolLayer): PoolEntry[] => {
  switch (layer) {
    case 'global':
      return useGlobalSettingsStore().settings.pool;
    case 'character':
      return useCharacterSettingsStore().settings.pool;
    case 'chat':
      return useChatSettingsStore().settings.pool;
  }
};

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

type WIEntry = { uid: string | number; world: string; content: string; disable: boolean; constant: boolean; vectorized: boolean; position: number };

const getAllWIEntries = async (): Promise<WIEntry[]> => {
  const result: WIEntry[] = [];
  const activeBooks = [...(selected_world_info ?? [])];
  const chid = this_chid;
  const charWorld = chid !== undefined && characters[chid] ? characters[chid]?.data?.extensions?.world : undefined;
  if (charWorld && !activeBooks.includes(charWorld)) {
    activeBooks.push(charWorld);
  }
  for (const name of activeBooks) {
    try {
      const data = await loadWorldInfo(name);
      if (data?.entries) {
        for (const entry of Object.values(data.entries) as any[]) {
          result.push({
            uid: entry.uid,
            world: name,
            content: entry.content || '',
            disable: entry.disable || false,
            constant: entry.constant || false,
            vectorized: entry.vectorized || false,
            position: entry.position || 0,
          });
        }
      }
    } catch {
      // ignore load errors
    }
  }
  return result;
};

const buildWI = async (excl: string[], redlight: boolean, ejs: boolean): Promise<{ before: string; after: string }> => {
  try {
    let e = redlight ? ((await getSortedEntries()) as WIEntry[]) : await getAllWIEntries();
    if (excl.length) e = e.filter(x => !excl.includes(`${x.world}::${x.uid}`));
    const b: string[] = [],
      a: string[] = [];
    for (const x of e) {
      if (redlight && x.disable) continue;
      if (redlight && x.vectorized) continue;
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
const applyWIExcl = (excl: string[], enabled: string[]): Restore => {
  const saved = [...(selected_world_info ?? [])];
  const hasExcl = excl.length > 0;
  const hasEnabled = enabled.length > 0;
  if (!hasExcl && !hasEnabled) return null;

  selected_world_info.length = 0;
  let newList = hasExcl ? saved.filter(n => !excl.includes(n)) : [...saved];
  if (hasEnabled) {
    for (const name of enabled) {
      if (!newList.includes(name)) newList.push(name);
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
  return c
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l.length > 0 && !/^<\/?\w+>$/i.test(l))
    .slice(0, count);
}

const buildMessages = async (
  systemPrompt: string,
  userInstruction: string,
  wi: WorldInfoGlobalSettings,
  wiChat: WorldInfoChatSettings,
  contextRounds: number,
): Promise<ChatMsg[]> => {
  const msgs: ChatMsg[] = [];
  if (systemPrompt) msgs.push({ role: 'system', content: systemPrompt });
  const ch = this_chid !== undefined ? characters[this_chid] : undefined;
  if (ch?.data?.description) msgs.push({ role: 'system', content: substituteParams(ch.data.description) });
  if (ch?.data?.personality) msgs.push({ role: 'system', content: substituteParams(ch.data.personality) });
  if (ch?.data?.scenario) msgs.push({ role: 'system', content: substituteParams(ch.data.scenario) });
  if (wi.enabled) {
    const w = await buildWI(wiChat.excluded_entries, wi.redlight_mode, wi.ejs_compat);
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
    const messages = await buildMessages(systemPrompt, userInstruction, gwi, cwi, rules.context_rounds);

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
    generatorState.loading = false;
    generatorState.generationId = null;
  }
}

export function cancelGeneration() {
  cancelled = true;
  generatorState.loading = false;
  generatorState.generationId = null;
}

/** 解析条目池生成输出：宽松按行解析，兼容编号列表/无序列表/纯文本。
 *  与 parseOptions 刻意分离：条目池不依赖 <options> 标签，输出契约不同，勿合并逻辑。
 *  返回中间结构 {text, replaceTarget?}：replaceTarget 为已有条目的 1-based 序号，
 *  由 generatePoolEntries 映射为已解析的 replaceTargetId（解析器不接触 store）。 */
export function parsePoolGenItems(
  text: string,
  count: number,
): { text: string; replaceTarget?: number }[] {
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
  layer: PoolLayer;
}): Promise<PoolGenItem[]> {
  if (poolGenState.loading) {
    toastr.info(t`条目生成中,请稍候`);
    return [];
  }
  const gs = useGlobalSettingsStore();
  const cs = useChatSettingsStore();
  const api = resolveCustomApi(cs.settings.active_api_id, gs.settings.apis);
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
    // 快照当前层已有条目（id+text）：用于喂给 AI 的编号列表，以及 inject 时序号→id 的映射
    const existing = poolOfLayer(params.layer).map(e => ({ id: e.id, text: e.text }));
    const existingList = existing.length
      ? existing.map((e, i) => `${i + 1}. ${e.text}`).join('\n')
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
      content: `请生成 ${params.count} 条行动条目建议。\n当前层已有条目：\n${existingList}\n用户要求：\n${params.requirements}`,
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
