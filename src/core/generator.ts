import { chat, characters, substituteParams, this_chid } from '@sillytavern/script';
import { getSortedEntries, selected_world_info } from '@sillytavern/scripts/world-info';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { resolvePool } from '@/core/pool-resolver';
import { evaluateCondition } from '@/core/variable-bridge';
import { useChatSettingsStore } from '@/store/chat-settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { ChoiceGeneration } from '@/core/options-store';
import type { GenerationSettings, PromptRules, SecondaryApi, WorldInfoSettings } from '@/type/settings';

export type GenerateTarget = { messageId: number; swipeId: number };

export const generatorState = reactive({ loading: false, generationId: null as string | null });

let cancelled = false;

type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

const resolveCount = (cm: GenerationSettings['count_mode']): number => {
  switch (cm) {
    case 'fixed4':
      return 4;
    case 'fixed6':
      return 6;
    case 'random4to8':
      return 4 + Math.floor(Math.random() * 5);
  }
  return 4;
};

const resolveCustomApi = (id: string | null, apis: SecondaryApi[]): SecondaryApi | undefined =>
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
  l.push(
    '请将所有行动选项放在 <options></options> 标签内,每行一条,不要编号,不要序号,不要解释。标签外的任何内容将被忽略。',
  );
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
  let c = text.replace(/<(?:think|reasoning|thought)>[\s\S]*?<\/(?:think|reasoning|thought)>/gi, '').trim();
  const m = c.match(/<options>([\s\S]*?)<\/options>/i);
  if (m) c = m[1].trim();
  else
    c = c
      .replace(/^```[a-zA-Z]*\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
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
  return c
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•·]|\d+[.)、]|\[.\])\s*/, '').trim())
    .filter(l => l.length > 0 && !/^<\/?\w+>$/i.test(l))
    .slice(0, count);
}

const buildMessages = async (
  systemRules: string,
  userInstruction: string,
  wi: WorldInfoSettings,
  contextRounds: number,
): Promise<ChatMsg[]> => {
  const msgs: ChatMsg[] = [];
  if (systemRules) msgs.push({ role: 'system', content: systemRules });
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

const GENERATE_URL = '/api/backends/chat-completions/generate';

const requestViaFetch = async (messages: ChatMsg[], api: SecondaryApi): Promise<string> => {
  const body: Record<string, unknown> = {
    chat_completion_source: api.source || 'openai',
    reverse_proxy: api.apiurl,
    proxy_password: api.key || '',
    model: api.model,
    messages,
    temperature: 1,
    max_tokens: 65535,
    stream: false,
    presence_penalty: 0,
    frequency_penalty: 0,
  };
  const ctx = window.SillyTavern?.getContext?.();
  const resp = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: ctx?.getRequestHeaders?.() ?? {},
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API 请求失败 (${resp.status}): ${text.slice(0, 300)}`);
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
    const c: Ctx = {
      count,
      pinned: pool.pinned.map(e => e.text).join('\n'),
      poolSelected: pool.drawn.map(e => e.text).join('\n'),
    };
    const rules = gs.settings.prompt_rules;

    const sp: string[] = [];
    if (rules.ai_persona) sp.push(sub(rules.ai_persona, c));
    if (rules.person) sp.push(sub(rules.person, c));
    if (rules.output_format) sp.push(sub(rules.output_format, c));
    if (rules.option_length > 0) sp.push(`每条选项长度:${rules.option_length}字左右`);
    if (rules.extra_requirements) sp.push(sub(rules.extra_requirements, c));
    const systemRules = sp.join('\n');

    const userInstruction = sub(buildUserInstr(c), c);
    const messages = await buildMessages(systemRules, userInstruction, wi, rules.context_rounds);

    const api = resolveCustomApi(cs.settings.active_api_id, gs.settings.apis);
    if (!api) {
      toastr.error(t`请先在设置中配置副 API（API 地址 + 模型），然后重新生成`);
      return null;
    }

    const raw = await requestViaFetch(messages, api);
    if (cancelled) return null;
    const options = parseOptions(raw, count).map(t => ({ text: t, sourceEntryId: null }));
    if (!options.length) {
      toastr.error(t`未能解析出任何选项,请检查模型输出`);
      return null;
    }
    return { id: gid, timestamp: Date.now(), count, options };
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
