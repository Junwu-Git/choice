/**
 * 角色 AI 主题卡池**分批**生成（§6）：开启卡牌 / 幸运数开卡包 / 购买卡包用到某角色时，
 * 若该角色 `card_character_pools` 未满（上限 CARD_POOL_MAX_CARDS），异步调 AI 按当前角色卡
 * **世界观 + 触发时刻的剧情上下文**补充一小批主题卡（首批 CARD_POOL_FIRST_BATCH、
 * 之后每批 CARD_POOL_BATCH_SIZE），经 validateCard + 硬限 clamp 校验后**追加**入池。
 *
 * 为什么分批而不是一次生成整池：生成请求会注入触发时刻激活的绿灯世界书与最近聊天记录，
 * 一次全生成只反映开局面（激活条目少、剧情未展开），池子内容窄且易绑死当前场景；
 * 分批让每批吃到不同剧情阶段的上下文（不同条目激活、角色侧面逐步展现），池随游玩自然变宽，
 * 已有卡摘要随请求下发要求题材错开 + 程序跨批判重兜底，跨批不重样。
 *
 * 设计要点：
 *  - 懒生成、fire-and-forget（由 cards.ts ensureCharacterPool 触发）；该次掉落回退现有池/内置池。
 *  - generated=true 表示池已初始化（首批后置位），此后只追加不重置；满池即停（重新生成需手动清池）。
 *  - 每批每张经 clampEffect 硬限钳制 + validateCard 结构校验：数值越界被静默钳到上限（据此判重），
 *    结构非法（缺名/枚举非法/效果集被滤空等）→ 该张作废；
 *    本批至少保留 1 张合法卡才算成功；全作废返回 []（下次触发重试，不影响现有池）。
 *  - 未配置 API / 无当前角色 / 解析失败 / 断网 → 静默回退，不影响内置抽卡。
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
import {
  cardMaxDurability,
  clampEffect,
  validateCard,
  CARD_POOL_FIRST_BATCH,
  CARD_POOL_BATCH_SIZE,
  CARD_POOL_MAX_CARDS,
} from '@/core/cards-constraints';
import { CARD_TYPE_LABEL } from '@/core/cards-meta';
import { recordCardsObtained } from '@/core/stats';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import type { Card, CardEffect } from '@/type/settings';

/** 生成系统提示：说明产出的是「效果卡规则」而非行动选项，强调触发/效果越界会被作废。
 *  引导 AI 深读角色设定提炼标志性特质、做双刃/代价卡（不止纯利好）。 */
const SYSTEM_PROMPT = `你是一位卡牌设计师，为特定角色的冒险主题设计「效果卡」。
每张卡是可装备的效果规则：满足「触发条件」时对一次行动判定施加效果。

【设计要求——贴合角色】
- 深入读角色的描述/性格/场景设定，提炼该角色跨场景恒定的意象、能力体系、性格矛盾、人际关系与世界观词汇。
- 卡名、叙事文本要体现角色独有特质（不要泛泛的"力量卡/守护卡"，要用该角色会说的词、会做的事、与其背景绑定的物件与场景）。
- 效果与角色设定有逻辑关联：治愈系角色出保命/续命卡，莽撞型出孤注一掷的高风险卡，智谋型出改需求/转化的算计卡，etc。

【设计要求——跨场景通用】
- 卡池是该角色整个冒险历程中反复掉落的常驻池，不是为某一幕剧情定制的：卡名/触发/叙事不得绑定当前场景、地点、正在发生的具体事件或一次性情节道具——剧情推进后这些卡必须仍然适用、仍然可读。
- 设计素材以角色卡设定（身份/能力体系/性格矛盾/人际关系）与世界观（世界书）为准；最近的对话仅用于把握语言风格、称谓与人物口吻。

【设计要求——双刃与取舍】
- 不要每张卡都纯利好。试炼（trial）类型专做「高风险高收益」的双刃卡：允许负向 amount 作为代价。
  例：低骰触发时降骰（roll_bonus 负值）但大失败时强制重掷救命；大胆行动加骰但升需求（demand_mod 正值）让判定更刺激。
- 高星卡可以更强，但代价也应更大；低星卡可做稳健小利或小代价。给出有取舍感的平衡设计。
- demand/roll 触发区间跨度超过 80 的高星卡，若效果全为正向数值（无任何代价/保命/演出效果），会被校验作废——宽触发区间只留给带取舍的设计。

输出必须是 JSON 数组（张数以用户消息要求为准），数组元素结构：
{"name":"卡名","type":"weapon|spell|blessing|trial","star":"1|2|3|4|5","trigger":{"kind":"type|grade|demand|roll|outcome",...},"effects":[...],"narrative":"（可选，卡面叙事文本）"}
字段约束（结构非法/效果集为空必被作废；数值若落在范围外会被钳制到边界，仍请尽量在范围内）：
- star: 1=最常见到 5=最稀有最强，高星卡应更强但不要每张都顶配。
- trigger: 与五种 kind 对应的字段只填一种，其余省略。type→typeValue（选项类型关键词，用 2-4 字宽泛题材词，如 战斗/交涉/潜行/探索——过窄的具体动作词几乎匹配不到选项标题，卡将无法触发）；grade→grade（conservative/balanced/bold）；demand→min/max（需求值区间 0-100，跨度建议 ≤60）；roll→min/max（骰值区间 1-100，跨度建议 ≤60）；outcome→outcome（success/fail/crit_success/crit_fail）。
- effects（数组，至少 1 个，最多 3 个）：{"kind":"roll_bonus","amount":±30以内} 或 {"kind":"demand_mod","amount":±40以内} 或 {"kind":"crit_window","success_delta":±5,"fail_delta":±5} 或 {"kind":"outcome_convert","from":"fail|crit_fail|crit_success","to":"success|crit_success"} 或 {"kind":"reroll","on":"fail|crit_fail"} 或 {"kind":"narrative","text":"≤40字"}。amount 可正可负，负值即代价/减益。
- narrative（卡的卡面叙事文本）≤40字，体现角色特质。
- 数值请严格落在上述范围内。`;

/** 聊天记录前的用途声明（卡牌特有，对齐 SYSTEM_PROMPT 的跨场景通用要求）：
 *  约束放在素材旁边弱模型才看得见——单靠 system 头部的远距离指令，部分模型会把
 *  最近对话里的场景/事件直接当题材写进卡名。仅在有历史时随历史一起发。 */
const CHAT_HISTORY_NOTE =
  '以下是最近的对话记录，仅用于把握语言风格、称谓习惯与人物关系；' +
  '设计卡牌时禁止以当前场景、地点、正在发生的具体事件或一次性情节道具为题材——卡池需在该角色整个冒险历程中反复适用。';

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

/** 生成串行闸门：手动「补充一批」与开包触发的自动批可能同时到达（调用方两套闸门互不相通），
 *  并行两批会各自拿入口池快照算 target/refCards——池可双双超上限、跨批判重互看不到对方产出。
 *  排队串行化后每批实际开跑才读池快照，天然拿到前一批落库结果与「重新生成」清池后的新池。 */
let poolBatchChain: Promise<unknown> = Promise.resolve();

/** 生成本角色主题池的下一批（分批阶段性生成，fire-and-forget 由 ensureCharacterPool 触发；
 *  手动「立即生成/补充一批/重新生成」同样走这里）。返回本批成功入池的卡（空数组 = 失败/满池/全作废），
 *  供调用方 toastr 反馈卡名。调用串行排队：前一批完成并落库后才开跑下一批。 */
export function generateCharacterPool(charId: string): Promise<Card[]> {
  const run = poolBatchChain.then(() => runPoolBatch(charId));
  // 链上吞掉拒绝防断裂（runPoolBatch 内部已全 catch，此处纯防御），让后续批次照常排队
  poolBatchChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function runPoolBatch(charId: string): Promise<Card[]> {
  const gs = useGlobalSettingsStore();
  const ch = getStCharacter(charId);
  if (!ch) return [];
  const charName = ch.name ?? '';
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) return [];

  // 批张数：首批（池空）多出一些保证首开包体验，之后每批小步补充；clamp 到上限余量
  const pool = gs.settings.card_character_pools[charId];
  const existingCount = pool?.card_ids.length ?? 0;
  if (existingCount >= CARD_POOL_MAX_CARDS) return [];
  const target = Math.min(
    existingCount === 0 ? CARD_POOL_FIRST_BATCH : CARD_POOL_BATCH_SIZE,
    CARD_POOL_MAX_CARDS - existingCount,
  );

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

  // 桶序对齐 buildMessages 的 DEFAULT_MODULES（persona 3 → wi_before 4 → 角色字段 5-7 →
  // wi_after 8 → wi_depth_before 10 → 聊天历史 12 → wi_depth_after 13）。此前 after 桶被
  // 放到聊天记录之后，世界书里角色设定类条目跟着跑到历史后面（即「角色定义跑到聊天记录
  // 后面」的病灶），已按酒馆语义归位：after/depthBefore 都属历史之前的背景层。
  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  // 扮演者 persona（persona_description 模块同款措辞与位置：世界书之前）
  const personaDesc = power_user?.persona_description;
  if (personaDesc) {
    messages.push({
      role: 'system',
      content: `<user_persona>\n以下是用户本人（用户=主角=user）的人物设定：\n${substituteParams(personaDesc)}\n</user_persona>`,
    });
  }
  // 世界书背景桶（world_info_before：before+anBefore+em）
  if (wiBuckets) {
    const wiBefore = [wiBuckets.before, wiBuckets.anBefore, wiBuckets.em].filter(Boolean).join('\n\n');
    if (wiBefore) messages.push({ role: 'system', content: wiBefore });
  }
  // 角色背景/性格/场景：V2 data.* 优先、V1/浅卡顶层兜底（readCharacterFields），经 substituteParams 注入——与提示词模块同源同法
  for (const field of Object.values(readCharacterFields(ch))) {
    if (field) messages.push({ role: 'system', content: substituteParams(field) });
  }
  // 世界书常量桶（world_info_after：after+anAfter）——必须在聊天记录之前
  if (wiBuckets) {
    const wiAfter = [wiBuckets.after, wiBuckets.anAfter].filter(Boolean).join('\n\n');
    if (wiAfter) messages.push({ role: 'system', content: wiAfter });
  }
  // 世界书深度背景（wi_depth_before：depth ≥ 3 条目，紧挨聊天历史之前）
  if (wiBuckets?.depthBefore) messages.push({ role: 'system', content: wiBuckets.depthBefore });
  // 聊天记录（chat_history：保持原始 user/assistant 角色）。wrapCurrentScene=false：
  // 卡池跨场景常驻，<current_scene> 锚定会让 AI 围绕当前剧情写卡（见 buildChatHistory）；
  // 历史前插用途声明把「只作文风参考」的约束落在素材旁边，防弱模型远距离失忆。
  const history = buildChatHistory(gs.settings.prompt_rules.context_rounds, false);
  if (history.length > 0) {
    messages.push({ role: 'system', content: CHAT_HISTORY_NOTE });
    for (const m of history) messages.push(m);
  }
  // 世界书即时条目（wi_depth_after：depth ≤ 2 浅层条目，聊天历史之后贴近生成点）
  if (wiBuckets?.depthAfter) messages.push({ role: 'system', content: wiBuckets.depthAfter });
  // 已有卡摘要随请求下发：跨批去重的第一层靠 AI 错开题材（签名判重 isDuplicateCard 只能拦
  // 「同构」卡，拦不住「意思重复但字段不同」的同侧面卡）；分批生成后 refCards 真实非空。
  const refCards = (pool?.card_ids ?? []).map(id => gs.settings.card_definitions[id]).filter((c): c is Card => !!c);
  const refLines = refCards.map(c => `- ${c.name}（${CARD_TYPE_LABEL[c.type]}·${c.star}星）`).join('\n');
  messages.push({
    role: 'user',
    content:
      `请为「${charName}」设计 ${target} 张主题效果卡` +
      (refCards.length ? `（该角色池已有 ${refCards.length} 张，本批为补充生成）` : '（首批）') +
      `。设计基准是角色的身份、能力体系、性格与世界整体设定——卡在其整个冒险历程中反复适用，` +
      `不得绑定当前场景、地点、正在发生的具体事件或一次性情节道具（最近对话仅用于把握文风与人物关系）。` +
      (refCards.length
        ? `\n已有主题卡（本批的题材/意象/触发思路须与它们明显错开，不要重复它们已覆盖的侧面）：\n${refLines}\n` +
          `本批可侧重近期剧情中展现的角色侧面或阶段主题切入，但卡本身仍须跨场景可复用。`
        : '') +
      `要求：卡名用该角色独有的词汇与意象、效果与其设定有逻辑关联、至少含 1 张双刃/代价卡` +
      `（试炼类型优先做高风险高收益）。各张卡的触发与效果应彼此有明显差异，避免效果雷同。` +
      `输出 JSON 数组，若无法或不全生成，数量可以更少，但必须是合法的 JSON。`,
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
    for (const c of parseCardPool(raw)) {
      // 单张异常（字段/效果畸形）只作废该张，不拖垮整批
      try {
        const candidate = sanitizeCard(c as Card, charId, charName);
        // 批内每张校验 + 硬限；超限/非法作废该张（勿让 AI 瞎写越权卡）
        const v = validateCard(candidate);
        if (!v.ok) continue;
        // 防重复（确定性同构签名 + 请求侧已下发已有卡摘要）：与既有池卡或批内已保留卡
        // 同名/效果组合相同 → 作废该张
        if (isDuplicateCard(candidate, [...refCards, ...legal])) continue;
        legal.push(candidate);
      } catch {
        /* 单张作废 */
      }
    }
    // AI 超量返回时截断到本批 target：请求侧只约束「可以更少」，拦不住模型多写；
    // 批张数是节奏设计（每批吃触发时刻上下文小步变宽），超量部分直接丢弃
    if (legal.length > target) legal.length = target;
    if (legal.length === 0) {
      // 全作废/解析失败：不置位不动池，下次触发重试
      return [];
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
          durability: cardMaxDurability(card),
          max_durability: cardMaxDurability(card),
          broken: false,
          source: 'character',
        };
      }
      recordCardsObtained();
    }
    // 追加入池：以落库时刻的最新池为准（生成期间可能被手动清池/排队前批写入，勿用入口快照展开）；
    // slice 是双保险钳到池上限——串行 + target 截断后理论不会超，防历史脏数据兜底
    const latest = gs.settings.card_character_pools[charId];
    gs.settings.card_character_pools[charId] = {
      character_id: charId,
      generated: true,
      card_ids: [...(latest?.card_ids ?? []), ...legal.map(c => c.id)].slice(0, CARD_POOL_MAX_CARDS),
    };
    return legal;
  } catch {
    /* 静默回退：现有池/内置池照常掉落；调用方负责提示，这里不打断 */
    return [];
  }
}
