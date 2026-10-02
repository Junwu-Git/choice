/**
 * 角色 AI 主题卡池懒生成（§6）：开启卡牌 / 幸运数开卡包 / 购买卡包用到某角色时，若该角色
 * `card_character_pools` 未生成（generated=false），异步调 AI 按当前角色卡**世界观**生成
 * 一小批主题卡（4–8 张、与内置四类型对齐），经 validateCard + 硬限 clamp 校验后固定入池。
 *
 * 设计要点：
 *  - 懒生成、fire-and-forget（由 cards.ts ensureCharacterPool 触发）；该次掉落回退纯内置池。
 *  - 池生成后 generated=true 固定不再重生成，但池内卡反复掉落（可重复获得折算）。
 *  - 批内每张经 clampEffect 硬限钳制 + validateCard 结构校验：数值越界被静默钳到上限（据此判重），
 *    结构非法（缺名/枚举非法/效果集被滤空等）→ 该张作废；
 *    整批至少保留合法张才置 generated=true；全作废则不置位（下次掉落重试，避免拉低掉落体验）。
 *  - 未配置 API / 无当前角色 / 解析失败 / 断网 → 静默回退纯内置池，不影响内置抽卡。
 *  - 合法张入 card_collection（source='character'、按角色池归组）。
 */

import { uuidv4 } from '@sillytavern/scripts/utils';
import { substituteParams } from '@sillytavern/script';
import { power_user } from '@sillytavern/scripts/power-user';
import { callSecondaryApiWithRetry, resolveCustomApi, type ChatMsg } from '@/core/api-client';
import { getStCharacter, readCharacterFields } from '@/core/st-character';
import {
  buildWI,
  buildChatHistory,
  applyWIExcl,
  resolveWIParticipation,
  runWIExclWindow,
  type WIBuckets,
} from '@/core/generator';
import { clampEffect, validateCard } from '@/core/cards-constraints';
import { recordCardsObtained } from '@/core/stats';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import type { Card, CardEffect } from '@/type/settings';

/** 生成系统提示：说明产出的是「效果卡规则」而非行动选项，强调触发/效果越界会被作废。
 *  引导 AI 深读角色设定提炼标志性特质、做双刃/代价卡（不止纯利好）。 */
const SYSTEM_PROMPT = `你是一位卡牌设计师，为特定角色的冒险主题设计「效果卡」。
每张卡是可装备的效果规则：满足「触发条件」时对一次行动判定施加效果。

【设计要求——贴合角色】
- 深入读角色的描述/性格/场景设定，提炼该角色独有的意象、能力体系、性格矛盾、人际关系与世界观词汇。
- 卡名、叙事文本要体现角色独有特质（不要泛泛的"力量卡/守护卡"，要用该角色会说的词、会做的事、与其背景绑定的物件与场景）。
- 效果与角色设定有逻辑关联：治愈系角色出保命/续命卡，莽撞型出孤注一掷的高风险卡，智谋型出改需求/转化的算计卡，etc。

【设计要求——双刃与取舍】
- 不要每张卡都纯利好。试炼（trial）类型专做「高风险高收益」的双刃卡：允许负向 amount 作为代价。
  例：低骰触发时降骰（roll_bonus 负值）但大失败时强制重掷救命；大胆行动加骰但升需求（demand_mod 正值）让判定更刺激。
- 高星卡可以更强，但代价也应更大；低星卡可做稳健小利或小代价。给出有取舍感的平衡设计。

输出必须是 JSON 数组，4-8 张，数组元素结构：
{"name":"卡名","type":"weapon|spell|blessing|trial","star":"1|2|3|4|5","trigger":{"kind":"type|grade|demand|roll|outcome",...},"effects":[...],"narrative":"（可选，一段叙事注入指令）"}
字段约束（结构非法/效果集为空必被作废；数值若落在范围外会被钳制到边界，仍请尽量在范围内）：
- star: 1=最常见到 5=最稀有最强，高星卡应更强但不要每张都顶配。
- trigger: 与四种 kind 对应的字段只填一种，其余省略。type→typeValue（选项类型关键词）；grade→grade（conservative/balanced/bold）；demand→min/max（需求值区间 0-100）；roll→min/max（骰值区间 1-100）；outcome→outcome（success/fail/crit_success/crit_fail）。
- effects（数组，至少 1 个，最多 3 个）：{"kind":"roll_bonus","amount":±30以内} 或 {"kind":"demand_mod","amount":±40以内} 或 {"kind":"crit_window","success_delta":±5,"fail_delta":±5} 或 {"kind":"outcome_convert","from":"fail|crit_fail|crit_success","to":"success|crit_success"} 或 {"kind":"reroll","on":"fail|crit_fail"} 或 {"kind":"narrative","text":"≤40字"}。amount 可正可负，负值即代价/减益。
- narrative（卡的叙事演绎指令）≤40字，体现角色特质。
- 数值请严格落在上述范围内。`;

/** 输出契约：解析 AI 返回的 JSON 数组，容忍被 ```json ... ``` 包裹，失败返回 []。 */
function parseCardPool(raw: string): Card[] {
  const text = raw.trim();
  const inner = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = inner.indexOf('[');
  const end = inner.lastIndexOf(']');
  if (start < 0 || end < 0 || start >= end) return [];
  try {
    const arr = JSON.parse(inner.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is Card => !!x && typeof x === 'object');
  } catch {
    return [];
  }
}

/** clamp 一张卡的所有效果（数值硬限 + 未知 kind 剔除）并保证必填字段存在（缺 id 补 uuid、
 *  source 补 character、归属角色 id/名回填）——角色归属字段让卡面能标明主题池，避免多池混排认不出。 */
function sanitizeCard(input: Card, charId: string, charName: string): Card {
  const base = { ...input };
  if (!base.id) base.id = `char_${uuidv4()}`;
  base.source = 'character';
  base.character_id = charId;
  base.character_name = charName;
  base.effects = (base.effects ?? []).map(clampEffect).filter((e): e is CardEffect => !!e);
  base.narrative = (base.narrative ?? '').slice(0, 40);
  return base;
}

/** name 归一化：去空白（含全角）、统一大小写、去常见标点，用于「同名即重复」判重。 */
const normalizeName = (s: string): string =>
  s
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、,.!?；:；：“”"''()（）【】[\]]/g, '')
    .trim()
    .toLowerCase();

/** 卡效果组合的规范签名：type + trigger(按 kind 只取相关字段) + effects(规范化序列)。
 *  effects 按 kind+数值字段序列排序再 join，消除 AI 输出顺序差异。不含 name/narrative/source/归属字段。 */
const cardSignature = (c: Card): string => {
  const t = c.trigger;
  const trig =
    t.kind === 'grade'
      ? `g:${t.grade}`
      : t.kind === 'demand'
        ? `d:${t.min}-${t.max}`
        : t.kind === 'roll'
          ? `r:${t.min}-${t.max}`
          : t.kind === 'outcome'
            ? `o:${t.outcome}`
            : `t:${t.typeValue}`;
  const eff = c.effects
    .map(e =>
      e.kind === 'crit_window'
        ? `cw:${e.success_delta}/${e.fail_delta}`
        : e.kind === 'outcome_convert'
          ? `oc:${e.from}->${e.to}`
          : e.kind === 'reroll'
            ? `re:${e.on}`
            : e.kind === 'narrative'
              ? `n:${e.text}`
              : `${e.kind}:${(e as { amount: number }).amount}`,
    )
    .sort()
    .join('|');
  return `${c.type}#${trig}#${eff}`;
};

/** 判重（确定性同构签名，零误杀）：name 归一化相同，或 效果组合签名相同，任一命中即视为重复。 */
const isDuplicateCard = (cand: Card, refs: Card[]): boolean =>
  refs.some(ref => normalizeName(ref.name) === normalizeName(cand.name) || cardSignature(ref) === cardSignature(cand));

/** 懒生成某角色主题卡池（fire-and-forget，失败静默）。 */
/** 生成某角色主题卡池（fire-and-forget，失败静默）。返回成功生成的合法卡张数（0 = 失败/全作废），
 *  供手动「立即生成」按钮反馈；后台懒生成路径忽略返回值。 */
export async function generateCharacterPool(charId: string): Promise<number> {
  const gs = useGlobalSettingsStore();
  const ch = getStCharacter(charId);
  if (!ch) return 0;
  const charName = ch.name ?? '';
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) return 0;

  // 世界书激活（对齐 generateOptions）：WI 排他窗口（互斥 + 即用即还，见 generator.runWIExclWindow）
  // ——仅 buildWI 读取酒馆世界书，构建完立即还原，不再持有到请求结束。buildWI 内部已对解析失败
  // 兜底返回空 buckets，不阻断卡片生成。
  const gwi = gs.settings.world_info;
  const cwi = useChatSettingsStore().settings.world_info;
  let wiBuckets: WIBuckets | null = null;
  if (gwi.enabled) {
    try {
      wiBuckets = await runWIExclWindow(async () => {
        const { allExcl, enabled } = await resolveWIParticipation(gwi, cwi);
        const restore = await applyWIExcl(allExcl, enabled, cwi.book_entry_modes, cwi.book_entry_overrides);
        try {
          return await buildWI();
        } finally {
          restore?.restore();
        }
      });
    } catch {
      /* 世界书激活失败：buildWI 已兜底；wiBuckets 保持 null 避免污染酒馆状态 */
    }
  }

  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  // 世界书背景（对齐 world_info_before / wi_depth_before：before+anBefore+em、深度背景条目）
  if (wiBuckets) {
    const wiBefore = [wiBuckets.before, wiBuckets.anBefore, wiBuckets.em].filter(Boolean).join('\n\n');
    if (wiBefore) messages.push({ role: 'system', content: wiBefore });
    if (wiBuckets.depthBefore) messages.push({ role: 'system', content: wiBuckets.depthBefore });
  }
  // 扮演者 persona（与 buildMessages 的 persona_description 模块同款措辞）：让卡牌贴合玩家扮演者身份
  const personaDesc = power_user?.persona_description;
  if (personaDesc) {
    messages.push({
      role: 'system',
      content: `<user_persona>\n以下是用户本人（用户=主角=user）的人物设定：\n${substituteParams(personaDesc)}\n</user_persona>`,
    });
  }
  // 角色背景/性格/场景：V2 data.* 优先、V1/浅卡顶层兜底（readCharacterFields），经 substituteParams 注入——与提示词模块同源同法
  for (const field of Object.values(readCharacterFields(ch))) {
    if (field) messages.push({ role: 'system', content: substituteParams(field) });
  }
  // 聊天记录（对齐 chat_history：buildChatHistory，保持原始 user/assistant 角色，含 <current_scene> 标记）
  for (const m of buildChatHistory(gs.settings.prompt_rules.context_rounds)) messages.push(m);
  // 世界书即时条目（对齐 world_info_after / wi_depth_after：after+anAfter、浅层贴近生成点条目）
  if (wiBuckets) {
    const wiAfter = [wiBuckets.after, wiBuckets.anAfter].filter(Boolean).join('\n\n');
    if (wiAfter) messages.push({ role: 'system', content: wiAfter });
    if (wiBuckets.depthAfter) messages.push({ role: 'system', content: wiBuckets.depthAfter });
  }
  messages.push({
    role: 'user',
    content: `请依据上述角色信息，为「${charName}」设计 4-8 张主题效果卡。要求：卡名与叙事用该角色独有的词汇与意象、效果与其设定有逻辑关联、至少含 1 张双刃/代价卡（试炼类型优先做高风险高收益）。各张卡的触发与效果应彼此有明显差异，避免效果雷同。输出 JSON 数组，若无法或不全生成，数量可以更少，但必须是合法的 JSON。`,
  });

  try {
    const raw = await callSecondaryApiWithRetry(
      messages,
      api,
      gs.settings.retry_count,
      gs.settings.retry_interval,
      undefined,
      true, // quiet：后台任务，不 toastr 重试进度
    );
    const legal: Card[] = [];
    // 参照集：该角色池已有主题卡（去重防跨批复用同一效果）；批内已保留的卡在循环里累积进 legal 一并比对。
    // 不含内置卡/其它角色卡——卡按角色池归组、内置风格独立，避免误撞。
    const refCards = (gs.settings.card_character_pools[charId]?.card_ids ?? [])
      .map(id => gs.settings.card_definitions[id])
      .filter((c): c is Card => !!c);
    for (const c of parseCardPool(raw)) {
      // 单张异常（字段/效果畸形）只作废该张，不拖垮整批
      try {
        const candidate = sanitizeCard(c as Card, charId, charName);
        // 批内每张校验 + 硬限；超限/非法作废该张（勿让 AI 瞎写越权卡）
        const v = validateCard(candidate);
        if (!v.ok) continue;
        // 防重复（确定性同构签名）：与已有主题卡或批内已保留卡同名/效果组合相同 → 作废该张
        if (isDuplicateCard(candidate, [...refCards, ...legal])) continue;
        legal.push(candidate);
      } catch {
        /* 单张作废 */
      }
    }
    if (legal.length === 0) {
      // 全作废：不置位，下次掉落重试
      return 0;
    }
    // 合法的角色主题卡入册：定义 + 持有 + 历史获得（source=character、按角色池归组）；
    // obtained 与 starter/开包口径一致，图鉴计数/来源可追溯
    for (const card of legal) {
      gs.settings.card_definitions[card.id] = card;
      const rec = gs.settings.card_obtained[card.id] ?? { card_id: card.id, obtained_at: Date.now(), count: 0 };
      rec.count += 1;
      if (!rec.obtained_at) rec.obtained_at = Date.now();
      gs.settings.card_obtained[card.id] = rec;
      if (!gs.settings.card_collection[card.id]) {
        gs.settings.card_collection[card.id] = {
          card_id: card.id,
          obtained_at: Date.now(),
          trigger_count: 0,
          source: 'character',
        };
      }
      recordCardsObtained();
    }
    gs.settings.card_character_pools[charId] = {
      character_id: charId,
      generated: true,
      card_ids: legal.map(c => c.id),
    };
    return legal.length;
  } catch {
    /* 静默回退：任何失败都不 toastr，不影响内置抽卡；next 掉落重试 */
    return 0;
  }
}
