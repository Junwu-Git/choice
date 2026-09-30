/**
 * 卡牌系统核心（纯逻辑 + 轻 store 交互）：装备解析、触发匹配、判定管线集成、
 * 开卡包/行动币等全部卡牌操作的共享层。
 *
 * 判定管线集成（option-action.ts 调用）：
 *   resolveCardRoll 在既有 D100 判定路径上叠加卡效果——预掷效果（roll_bonus 改骰值、
 *   demand_mod 改需求、crit_window 改彩蛋窗口，数值经 cards-constraints clamp）在掷骰前
 *   施加（掷前触发卡）；后置分两遍：掷后触发卡的修正型效果先补算到已掷骰值/需求/窗口上
 *   并重判结局（武器系「roll 触发 + 骰值加成」的低骰补力即此语义），再按最终结局施加
 *   outcome_convert 结局转化、reroll 强制重掷、narrative 注入演绎指令。触发条件
 *  （type/grade/demand 前置可知，roll/outcome 掷后可知）决定卡是否触发。
 *
 * 关键分层：卡效果**只走 card_enabled=true 分支**；card_enabled=false（默认）时本模块
 * 的判定集成完全跳过，option-action 走与现状一致的路径——存量升级零行为变化。
 *
 * 游戏进度（货币/收藏/卡组/角色池/卡定义）直接读写 gs.settings 的 GlobalSettings
 * 字段，属「配置/进度层」；「清空统计」不清它们。仅统计读数（触发/收支等）走
 * core/stats.ts 的 recordCard* 函数（stats_enabled 门控）。
 */

import { BUILTIN_CARDS } from '@/core/cards-builtin';
import { CARD_TYPE_LABEL, CARD_SETS, cardSetById, effectSummary } from '@/core/cards-meta';
import { getStCharacter } from '@/core/st-character';
import { useGlobalSettingsStore } from '@/store/global-settings';
import toastr from 'toastr';
import { usePoolSelectorStore } from '@/store/pool-selector';
import { parseOptionStyle, parseOptionType, type OptionStyleGrade } from '@/util/option-format';
import { resolveOptionSuccessRateWithAttr } from '@/core/attribute-dc';
import {
  clampEffect,
  checkDeckBudget,
  CARD_DUPLICATE_VALUE,
  CARD_DROP_WEIGHT,
  CARD_OUTCOME_CURRENCY,
  CARD_PACK_PRICE,
  CARD_STAR_BUDGET,
  CARD_SLOT_TYPES,
  CARD_LUCKY_NUMBER,
  CARD_LUCKY_NUMBER_LOW,
  CARD_PACK_OFFER,
  CARD_TYPE_FULL_STARS,
  CARD_TROPHY_COLLECT_MILESTONES,
} from '@/core/cards-constraints';
import { diceMargin, judgeOutcome, type DiceOutcome, type DiceRollMode } from '@/core/dice';
import type { Card, CardDeck, CardOwned, CardStar, CardTrigger, GlobalSettings } from '@/type/settings';

// ── 领域类型 ─────────────────────────────────────────────────────────────

/** 触发匹配上下文：type = 选项类型（parseOptionType），grade = 风险档位，
 *  rate = 判定需求值（attr 解析后，供 demand 区间匹配）。 */
export type CardContext = { type: string; grade: OptionStyleGrade | null; rate: number };

/** 已触发卡（chip 展示 + 扣耐久 + 统计共用） */
export type CardTriggeredInfo = { card: Card; summary: string };

/** 一次开卡包的单个候选（3 选 1 之一）：upgrade = 已拥有 → 选它=重复折算行动币；
 *  owned = 采样时的持有条目（供弹窗角标显示「已拥有」而非「未拥有」）。 */
export type CardOfferOption = { card: Card; upgrade: boolean; owned?: CardOwned };

/** 一次开卡包 offer（混合池按星级权重固定抽 CARD_PACK_OFFER 张）。
 *  configId 供选择落库时记统计维度。 */
export type CardOffer = {
  options: CardOfferOption[];
  configId: string;
};

/** 一次判定中的卡牌决议（随 DiceRollResult 返回）：触发卡/幸运命中/行动币收支/卡叙事行。 */
export type CardResolution = {
  triggered: CardTriggeredInfo[];
  luckyHit: boolean;
  packOffer?: CardOffer;
  currencyDelta: number;
  narrativeLines: string[];
  /** 最终结局：commitCardRun 用其在失败分支触发"判定中招诅咒" */
  outcome: DiceOutcome;
};

/** 装备位解析结果（装备 + 持有态） */
export type EquippedCard = { card: Card; owned: CardOwned };

// ── 配置解析（chat > character > default，复用 pool-selector 思路） ──────

/** 当前生效卡组所属 config id（与条目池同一解析链）。无 config → '__none__'。 */
export function currentCardConfigId(): string {
  return usePoolSelectorStore().effectiveConfig?.id ?? '__none__';
}

// ── 卡定义与持有解析 ─────────────────────────────────────────────────────

/** 把卡组槽规整为固定 CARD_SLOT_TYPES 个（按权威顺序）：每类型只保留首个非空卡、缺的类型补空槽
 *  （card_id=''）。兼容旧版动态 ≤5 张、同类 ≤1 的存量数据；幂等。 */
function normalizeDeckSlots(slots: CardDeck['slots']): CardDeck['slots'] {
  const used = new Set<string>();
  return CARD_SLOT_TYPES.map(type => {
    const hit = slots.find(s => s.type === type && s.card_id && !used.has(s.card_id));
    if (hit) {
      used.add(hit.card_id);
      return { type, card_id: hit.card_id };
    }
    return { type, card_id: '' };
  });
}

/** 按 card_id 取卡定义：内置卡来自 BUILTIN_CARDS，角色主题卡来自 card_definitions。
 *  找不到返回 undefined（已删除/异常 id）。旧主题卡（character_name 为空，生成于
 *  归属字段引入前）在此幂等回填 character_id/name——从 card_character_pools 反查归属池，
 *  名字经 st-character 解析；回填后由 store deep watch 落盘，后续不再算。 */
export function cardDefById(id: string): Card | undefined {
  if (!id) return undefined;
  const b = BUILTIN_CARDS.find(c => c.id === id);
  if (b) return b;
  const gs = useGlobalSettingsStore();
  const def = gs.settings.card_definitions[id];
  if (def && def.source === 'character' && !def.character_name) {
    backfillCharacterAttribution(gs.settings, def);
  }
  return def;
}

/** 旧主题卡无归属字段时从角色池反查 character_id + 名字回填（幂等：仅补空字段）。 */
function backfillCharacterAttribution(s: GlobalSettings, def: Card): void {
  for (const pool of Object.values(s.card_character_pools)) {
    if (pool.card_ids.includes(def.id)) {
      def.character_id = pool.character_id;
      const ch = pool.character_id ? getStCharacter(pool.character_id) : undefined;
      def.character_name = ch?.name ?? '';
      return;
    }
  }
}

/** 历史获得 id 集合：card_obtained（曾获得）∪ card_collection（当前持有）的并集。
 *  收藏进度/成就/套装基于它永久保留，与当前是否持有无关。 */
export function collectedCardIds(): Set<string> {
  const s = useGlobalSettingsStore().settings;
  return new Set([...Object.keys(s.card_obtained), ...Object.keys(s.card_collection)]);
}

/** 混合卡池（抽卡用）：内置全量 + 当前角色已生成主题池全量。返回去重后的完整卡定义数组。 */
export function mixedPoolCards(): Card[] {
  const gs = useGlobalSettingsStore();
  const byId = new Map<string, Card>();
  for (const c of BUILTIN_CARDS) byId.set(c.id, c);
  const charId = gs.currentCharacterId;
  const pool = charId != null ? gs.settings.card_character_pools[charId] : undefined;
  if (pool?.generated) {
    for (const cid of pool.card_ids) {
      const def = gs.settings.card_definitions[cid];
      if (def) byId.set(cid, def);
    }
  }
  return [...byId.values()];
}

/** 解析某 config 已装备的卡（遍历规整后的固定槽，跳过空槽/定义缺失，防御历史脏数据）。
 *  auto 模式自动编组，手动模式读存储 slots。 */
export function resolveEquippedCards(configId: string): EquippedCard[] {
  const gs = useGlobalSettingsStore();
  const equipped: EquippedCard[] = [];
  for (const slot of effectiveDeckSlots(configId)) {
    if (!slot.card_id) continue;
    const card = cardDefById(slot.card_id);
    const owned = gs.settings.card_collection[slot.card_id];
    if (!card || !owned) continue;
    equipped.push({ card, owned });
  }
  return applyBudget(equipped);
}

/** 防御性星级预算过滤：只保留各高星卡不超过 CARD_STAR_BUDGET 上限的组合（装备编辑页已强校验，此处兜底）。 */
function applyBudget(equipped: EquippedCard[]): EquippedCard[] {
  const ok = checkDeckBudget(equipped.map(e => e.card));
  if (ok.ok) return equipped;
  const counts: Partial<Record<CardStar, number>> = {};
  return equipped.filter(e => {
    const star = e.card.star;
    const max = CARD_STAR_BUDGET[star];
    if (max === undefined) return true;
    const n = (counts[star] ?? 0) + 1;
    if (n > max) return false;
    counts[star] = n;
    return true;
  });
}

// ── 触发匹配 ─────────────────────────────────────────────────────────────

/** 触发匹配纯函数：按 kind 对 (context, roll, outcome) 求值。outcome 为 null 表示
 *  掷骰前（roll/outcome 类触发此时恒 false——它们需掷后结果）。 */
export function matchTrigger(
  t: CardTrigger,
  ctx: CardContext,
  roll: number | null,
  outcome: DiceOutcome | null,
): boolean {
  switch (t.kind) {
    case 'type':
      return !!t.typeValue && ctx.type.includes(t.typeValue);
    case 'grade':
      return t.grade !== null && ctx.grade === t.grade;
    case 'demand':
      return ctx.rate >= (t.min ?? 0) && ctx.rate <= (t.max ?? Infinity);
    case 'roll':
      return roll !== null && roll >= (t.min ?? 0) && roll <= (t.max ?? Infinity);
    case 'outcome':
      return outcome !== null && t.outcome !== null && outcome === t.outcome;
  }
}

// ── 判定管线集成（resolveCardRoll） ──────────────────────────────────────

const clamp0100 = (v: number): number => Math.min(100, Math.max(1, Math.round(v)));
const rollD100 = (): number => Math.floor(Math.random() * 100) + 1;

/** 解析触发上下文（供 type/grade/demand 匹配）：type/grade 走 option-format，
 *  rate 走 attr 解析（与骰子判定同一口径）。rate 为 null 时不走卡判定（无需求值）。 */
export function buildCardContext(
  optionText: string,
  character: { data?: unknown } | undefined,
  attrEnabled: boolean,
  lowRoll: boolean,
): CardContext | null {
  const rate = resolveOptionSuccessRateWithAttr(optionText, character, attrEnabled, lowRoll);
  if (rate === null) return null;
  return { type: parseOptionType(optionText), grade: parseOptionStyle(optionText), rate };
}

/** 点选前触发预览（选项行提示用）：只匹配掷前可知的触发（type/grade/demand）——
 *  roll/outcome 两类需掷后结果，天然不命中（matchTrigger 的 null 守卫）。纯读不改状态
 *  （不发放 starter、不落库）。供主面板与悬浮球选项行共用；措辞按「可触发」，
 *  因 demand 区间依赖最终 attr 解析口径，非 100% 保证触发。
 *  与判定路径同门控：骰子关闭或骰式（allow_formula）时点选不走卡判定，
 *  此时预告即为永不触发的谎言，直接返回空。楼层已结算由调用方把守（需 message 标识）。 */
export function previewTriggeredCards(
  optionText: string,
  character: { data?: unknown } | undefined,
  dice: { attr_dc_enabled: boolean; low_roll: boolean },
): Card[] {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.card_enabled) return [];
  if (!gs.settings.dice.enabled || gs.settings.dice.allow_formula) return [];
  const equipped = resolveEquippedCards(currentCardConfigId());
  if (equipped.length === 0) return [];
  const ctx = buildCardContext(optionText, character, dice.attr_dc_enabled, dice.low_roll);
  if (ctx === null) return [];
  return equipped
    .filter(eq => {
      const t = eq.card.trigger;
      return (t.kind === 'type' || t.kind === 'grade' || t.kind === 'demand') && matchTrigger(t, ctx, null, null);
    })
    .map(eq => eq.card);
}

/** 抽卡随机：按星级权重取 1 张（CARD_DROP_WEIGHT）。 */
function pickWeighted(pool: Card[]): Card {
  const total = pool.reduce((s, c) => s + CARD_DROP_WEIGHT[c.star], 0);
  let r = Math.random() * total;
  for (const c of pool) {
    r -= CARD_DROP_WEIGHT[c.star];
    if (r <= 0) return c;
  }
  return pool[pool.length - 1];
}

/** 抽 1 张不重复候选（避免同包内重复 id）。 */
function pickDistinct(pool: Card[], exclude: Set<string>): Card | null {
  const candidates = pool.filter(c => !exclude.has(c.id));
  if (candidates.length === 0) return null;
  return pickWeighted(candidates);
}

/** 混合池 3 选 1 开卡包：按星级权重抽固定 CARD_PACK_OFFER 张不重复候选；已拥有卡转「重复折算」。
 *  纯采样不改状态——实际落库由 applyPackSelection 完成。 */
export function samplePackOffer(configId: string): CardOffer {
  const gs = useGlobalSettingsStore();
  const pool = mixedPoolCards();
  const n = CARD_PACK_OFFER;
  const options: CardOfferOption[] = [];
  const exclude = new Set<string>();
  for (let i = 0; i < n; i++) {
    const c = pickDistinct(pool, exclude);
    if (!c) break;
    exclude.add(c.id);
    const owned = gs.settings.card_collection[c.id];
    options.push({ card: c, upgrade: !!owned, owned });
  }
  return { options, configId };
}

/** 判定主入口（card_enabled=true 分支）：叠加卡效果完成一次 D100 判定并返回扩展结果。
 *  除开头 ensureStarterCards 的一次性幂等发放（预览路径同样会触发，无害）外不改持久状态
 *  （货币/开包都在 commitCardRun 统一落库）——使就地重掷两步流的「预览」不记账，
 *  只有真正应用时才 commit。返回 null 表示无需求值（与既有判定一致，不掷骰）。 */
export function resolveCardRoll(
  optionText: string,
  character: { data?: unknown } | undefined,
  dice: {
    attr_dc_enabled: boolean;
    low_roll: boolean;
    crit_success_min: number;
    crit_fail_max: number;
    low_roll_crit_success_max: number;
    low_roll_crit_fail_min: number;
  },
  cardEnabled: boolean,
): {
  outcome: DiceOutcome;
  roll: number;
  rate: number;
  margin: number;
  mode: DiceRollMode;
  cards?: CardResolution;
} | null {
  const configId = currentCardConfigId();
  if (cardEnabled) ensureStarterCards();
  const equipped = cardEnabled ? resolveEquippedCards(configId) : [];
  const mode: DiceRollMode = dice.low_roll ? 'low' : 'high';
  const crits = dice.low_roll
    ? { success: dice.low_roll_crit_success_max, fail: dice.low_roll_crit_fail_min }
    : { success: dice.crit_success_min, fail: dice.crit_fail_max };
  const ctx = buildCardContext(optionText, character, dice.attr_dc_enabled, dice.low_roll);
  if (ctx === null) return null;

  let rate = ctx.rate;
  let critS = crits.success;
  let critF = crits.fail;
  let rollBonus = 0;
  const preFired: EquippedCard[] = [];

  // ── 预掷效果（触发条件前置可知：type/grade/demand） ─────────────────
  for (const eq of equipped) {
    const t = eq.card.trigger;
    if (t.kind === 'type' || t.kind === 'grade' || t.kind === 'demand') {
      if (!matchTrigger(t, ctx, null, null)) continue;
      preFired.push(eq);
      for (const raw of eq.card.effects) {
        const eff = clampEffect(raw);
        if (!eff) continue;
        if (eff.kind === 'roll_bonus') rollBonus += eff.amount;
        else if (eff.kind === 'demand_mod') rate = clamp0100(rate + eff.amount);
        else if (eff.kind === 'crit_window') {
          critS = clamp0100(critS + eff.success_delta);
          critF = clamp0100(critF + eff.fail_delta);
        }
      }
    }
  }

  // ── 掷骰 ──────────────────────────────────────────────────────────────
  const rawRoll = rollD100();
  let roll = clamp0100(rawRoll + rollBonus);
  let outcome = judgeOutcome(roll, rate, critS, critF, mode);

  // ── 后置触发卡收集（按初始骰值/结局匹配，不因后续补算重匹配） ─────────
  const postFired: EquippedCard[] = [];
  for (const eq of equipped) {
    if (preFired.includes(eq)) continue;
    const t = eq.card.trigger;
    if ((t.kind === 'roll' || t.kind === 'outcome') && matchTrigger(t, ctx, roll, outcome)) {
      postFired.push(eq);
    }
  }
  const fired = [...preFired, ...postFired];

  // ── 后置一遍：掷后触发卡的修正型效果补算重判（武器系「低骰补力」语义） ─
  // roll_bonus/demand_mod/crit_window 在掷后补到已掷结果上再判一次；无补算则不重判，
  // 避免无意义重算。
  let postRollBonus = 0;
  let postModified = false;
  for (const eq of postFired) {
    for (const raw of eq.card.effects) {
      const eff = clampEffect(raw);
      if (!eff) continue;
      if (eff.kind === 'roll_bonus') {
        postRollBonus += eff.amount;
        roll = clamp0100(roll + eff.amount);
        postModified = true;
      } else if (eff.kind === 'demand_mod') {
        rate = clamp0100(rate + eff.amount);
        postModified = true;
      } else if (eff.kind === 'crit_window') {
        critS = clamp0100(critS + eff.success_delta);
        critF = clamp0100(critF + eff.fail_delta);
        postModified = true;
      }
    }
  }
  if (postModified) outcome = judgeOutcome(roll, rate, critS, critF, mode);

  // ── 后置二遍：转化/重掷/叙事（按槽序、按当时结局匹配；上面的重判可能已
  //  改变 outcome，outcome 触发卡的转化条件沿此顺序依赖，与既有语义一致） ─
  const narrativeLines: string[] = [];
  let rerolled = false;
  let rerollRaw: number | null = null;
  for (const eq of fired) {
    for (const raw of eq.card.effects) {
      const eff = clampEffect(raw);
      if (!eff) continue;
      if (eff.kind === 'outcome_convert' && eff.from === outcome) {
        outcome = eff.to;
      } else if (eff.kind === 'reroll' && eff.on === outcome && !rerolled) {
        rerolled = true;
        rerollRaw = rollD100();
        const rr = clamp0100(rerollRaw + rollBonus + postRollBonus);
        outcome = judgeOutcome(rr, rate, critS, critF, mode);
        roll = rr;
      } else if (eff.kind === 'narrative' && eff.text) {
        narrativeLines.push(eff.text);
      }
    }
    if (eq.card.narrative) narrativeLines.push(eq.card.narrative);
  }

  // 满编齐整套装联动：4 槽全装且至少有卡触发 → 注入套装修辞 + 小额奖励（鼓励凑满一套）
  let setBonus = 0;
  if (cardEnabled && equipped.length === CARD_SLOT_TYPES.length && fired.length > 0) {
    narrativeLines.push('整套卡牌同频共鸣，攻防一体，气势一时无两。');
    setBonus = 1;
  }
  // 套装共鸣（v64）：装备 ≥2 张「已集齐」套装的卡且本次有卡触发 → 注入该套装特殊叙事 + 小额奖励。
  // 激励收集：成套才解锁，装备成套才在判定中显现。两套封顶 +2。
  if (cardEnabled && fired.length > 0) {
    const equippedSetCounts = new Map<string, number>();
    for (const eq of equipped) {
      if (eq.card.set) equippedSetCounts.set(eq.card.set, (equippedSetCounts.get(eq.card.set) ?? 0) + 1);
    }
    for (const [setId, n] of equippedSetCounts) {
      if (n >= 2 && isSetComplete(setId)) {
        const def = cardSetById(setId);
        if (def?.resonance) narrativeLines.push(def.resonance);
        setBonus += 1;
      }
    }
  }

  const margin = diceMargin(mode, roll, rate);
  // 幸运命中判原骰（不含卡牌加成，roll_bonus 不推高开包率）；low 模式取对偶极值，
  // 消除「加成凑 100」通胀与「大失败开包」两种口径失真。重掷的原骰命中同样计。
  const luckyNumber = mode === 'low' ? CARD_LUCKY_NUMBER_LOW : CARD_LUCKY_NUMBER;
  const luckyHit =
    cardEnabled && (isLuckyHit(rawRoll, luckyNumber) || (rerollRaw !== null && isLuckyHit(rerollRaw, luckyNumber)));
  const packOffer = luckyHit ? samplePackOffer(configId) : undefined;
  const currencyDelta = (cardEnabled ? CARD_OUTCOME_CURRENCY[outcome] : 0) + setBonus;

  return {
    outcome,
    roll,
    rate,
    margin,
    mode,
    cards: {
      triggered: fired.map(eq => ({ card: eq.card, summary: eq.card.effects.map(effectSummary).join('·') })),
      luckyHit,
      packOffer,
      currencyDelta,
      narrativeLines,
      outcome,
    },
  };
}

/** 幸运数命中：原骰恰好掷中当前模式的幸运数（high=100 / low=1，见 cards-constraints）。 */
export function isLuckyHit(roll: number, luckyNumber: number): boolean {
  return roll === luckyNumber;
}

// ── 落库（应用判定结果，真正改动状态） ──────────────────────────────────

/** 提交一次已应用判定：按结局收支行动币（≥0 不扣穿）、幸运命中开卡包。
 *  仅真正应用（发送框可用 + 行为已执行）后调用。 */
export function commitCardRun(resolution: CardResolution): CardOffer | undefined {
  const gs = useGlobalSettingsStore();
  if (!resolution) return undefined;
  // 触发计数（每张触发卡 +1，供统计页「每卡触发」榜）
  for (const t of resolution.triggered) {
    const owned = gs.settings.card_collection[t.card.id];
    if (!owned) continue;
    owned.trigger_count += 1;
    recordCardTrigger(t.card.id);
  }
  // 行动币收支（结局驱动；0 时失败不再减，不扣穿）
  if (resolution.currencyDelta !== 0) {
    if (resolution.currencyDelta > 0) {
      gs.settings.card_currency += resolution.currencyDelta;
    } else if (gs.settings.card_currency > 0) {
      gs.settings.card_currency = Math.max(0, gs.settings.card_currency + resolution.currencyDelta);
    }
    recordCurrencyOutcome(resolution.currencyDelta, resolution.outcome);
  }
  // 幸运命中 → 开卡包：开包统计，返回 offer 供组件弹窗
  if (resolution.luckyHit && resolution.packOffer) {
    recordPackOpened();
    recordCardLuckyHit();
    // 触发角色主题池懒生成（fire-and-forget）：本次 offer 用现有池，生成后进后续混合池
    ensureCharacterPool();
    return resolution.packOffer;
  }
  return undefined;
}

// ── 开卡包选择（幸运 / 卡牌页购买共用） ──────────────────────────────────

/** 应用一次 3 选 1 的选择：新卡 → 建 CardOwned；已拥有 → 按 CARD_DUPLICATE_VALUE 折算行动币。
 *  via：'lucky'|'shop'（shop 已扣币，仅影响统计埋点）。 */
export function applyPackSelection(offer: CardOffer, chosenIdx: number, via: 'lucky' | 'shop'): void {
  const gs = useGlobalSettingsStore();
  const opt = offer.options[chosenIdx];
  if (!opt) return;
  void via;
  const before = achievedTrophyKeys(); // 快照：区分「本次促成」与「历史积压」的成就
  acquireOrConvert(gs.settings, opt.card);
  recordCardsObtained();
  maybeGrantTrophy(before);
}

/** 新得或折算一张卡（开卡包共用）：未拥有 → 建持有条目；已拥有 → 折算小额行动币
 *  （卡为永久收藏，无耐久/等级，重复获得给币让 3 选 1 始终有意义）。 */
function acquireOrConvert(s: GlobalSettings, card: Card): void {
  // 历史获得记录：新得/重复抽中都累计 → 图鉴/成就/套装永久保留
  const rec = s.card_obtained[card.id] ?? { card_id: card.id, obtained_at: Date.now(), count: 0 };
  rec.count += 1;
  if (!rec.obtained_at) rec.obtained_at = Date.now();
  s.card_obtained[card.id] = rec;

  const existing = s.card_collection[card.id];
  if (existing) {
    const gain = CARD_DUPLICATE_VALUE[card.star] ?? 1;
    s.card_currency += gain;
    toastr.info(`「${card.name}」已拥有，折算 +${gain} 行动币`);
    return;
  }
  s.card_collection[card.id] = {
    card_id: card.id,
    obtained_at: Date.now(),
    trigger_count: 0,
    source: card.source,
  };
}

// ── 收藏成就（趣味彩蛋，零操作）：单类型全收集 + 总数里程碑 + 套装集齐 ─────

/** 各套装的收藏进度（供卡库套装区 + 套装共鸣 + 套装成就共用）。 */
export type CardSetProgress = {
  id: string;
  name: string;
  theme: string;
  owned: number;
  total: number;
  complete: boolean;
};

export function cardSetProgress(): CardSetProgress[] {
  const owned = collectedCardIds();
  return CARD_SETS.map(set => {
    const setCards = BUILTIN_CARDS.filter(c => c.set === set.id);
    const ownedN = setCards.filter(c => owned.has(c.id)).length;
    return {
      id: set.id,
      name: set.name,
      theme: set.theme,
      owned: ownedN,
      total: setCards.length,
      complete: setCards.length > 0 && ownedN === setCards.length,
    };
  });
}

/** 该套装是否已集齐（全部内置套卡已拥有）。 */
export const isSetComplete = (setId: string): boolean => cardSetProgress().find(s => s.id === setId)?.complete ?? false;

/** 全部可达成成就及当前达成态（条件即达成，不论是否庆祝过）。供收藏页展示 + 庆祝触发共用。 */
export function cardTrophyList(): Array<{ key: string; label: string; achieved: boolean }> {
  const owned = collectedCardIds();
  const out: Array<{ key: string; label: string; achieved: boolean }> = [];
  for (const type of CARD_SLOT_TYPES) {
    const full = CARD_TYPE_FULL_STARS.every(s => owned.has(`builtin_${type}_${s}`));
    out.push({ key: `set_${type}`, label: `${CARD_TYPE_LABEL[type]}卡全收集（1–5 星）`, achieved: full });
  }
  for (const set of cardSetProgress()) {
    out.push({ key: `set_full_${set.id}`, label: `「${set.name}」集齐`, achieved: set.complete });
  }
  const count = owned.size;
  for (const n of CARD_TROPHY_COLLECT_MILESTONES) {
    out.push({ key: `collect_${n}`, label: `收藏 ${n} 张卡`, achieved: count >= n });
  }
  return out;
}

/** 当前已达成成就 key 集合（供获得动作前后对比，判断哪项是「本次真正促成」而非历史积压）。 */
export function achievedTrophyKeys(): Set<string> {
  return new Set(
    cardTrophyList()
      .filter(t => t.achieved)
      .map(t => t.key),
  );
}

/** 达成且未庆祝过的成就 → 标记 + 庆祝 toast。获得卡后（applyPackSelection/buyCard）调用。
 *  before 为获得动作前的已达成 key 快照（achievedTrophyKeys）：历史已满足的成就只静默标记不弹，
 *  只对「本次获得把它从未达成推向达成」的项弹 toast；多项合并为一条，避免刷屏/补弹历史积压。 */
export function maybeGrantTrophy(before: Set<string>): void {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.card_enabled) return;
  const newly: string[] = [];
  for (const t of cardTrophyList()) {
    if (gs.settings.card_achievements[t.key]) continue;
    gs.settings.card_achievements[t.key] = true;
    if (!before.has(t.key)) newly.push(t.label);
  }
  if (newly.length === 1) {
    toastr.success(`🏆 达成成就：${newly[0]}`);
  } else if (newly.length > 1) {
    toastr.success(`🏆 达成 ${newly.length} 项成就：${newly.join('、')}`);
  }
}

// ── 卡组编辑（CardDeckEditor 用） ────────────────────────────────────────

/** 生效卡组槽（auto 时取自动编组，否则取存储 slots 规整版）——判定与 UI 显示共用同一口径。 */
function effectiveDeckSlots(configId: string): CardDeck['slots'] {
  const gs = useGlobalSettingsStore();
  if (gs.settings.auto_deck_enabled) return autoDeckCards();
  return normalizeDeckSlots(gs.settings.card_decks[configId]?.slots ?? []);
}

/** 自动编组：从已拥有卡里按类型各选最优填满 4 槽（星最高、平手按获得时间早优先），
 *  守星级预算（3★≤2/4★≤1/5★≤1）；预算冲突时退而取更低星或留空。确定性、纯投影不改状态。 */
export function autoDeckCards(): CardDeck['slots'] {
  const gs = useGlobalSettingsStore();
  const budgetCount: Partial<Record<CardStar, number>> = {};
  return CARD_SLOT_TYPES.map(type => {
    // 该类型已拥有卡，星降序（平手按获得时间早优先，稳定且可预期）
    const cands = Object.entries(gs.settings.card_collection)
      .filter(([id, o]) => cardDefById(id)?.type === type && o.card_id)
      .sort((a, b) => {
        const sa = Number(cardDefById(a[0])!.star);
        const sb = Number(cardDefById(b[0])!.star);
        if (sa !== sb) return sb - sa;
        return a[1].obtained_at - b[1].obtained_at;
      })
      .map(([id]) => id);
    for (const id of cands) {
      const star = cardDefById(id)!.star;
      const max = CARD_STAR_BUDGET[star];
      if (max !== undefined && (budgetCount[star] ?? 0) >= max) continue;
      if (max !== undefined) budgetCount[star] = (budgetCount[star] ?? 0) + 1;
      return { type, card_id: id };
    }
    return { type, card_id: '' };
  });
}

/** 某 config 的固定槽（规整版，按 CARD_SLOT_TYPES 顺序），供卡组编辑按槽位有序渲染。 */
export function resolveDeckSlots(configId: string): CardDeck['slots'] {
  return effectiveDeckSlots(configId);
}

/** 新手 starter（一次性）：启用卡牌且收藏为空时赠 4 张 1★（每类型一张），auto-deck 立即满编、
 *  让首次使用即刻有卡可触发。幂等：已发放或已有收藏则跳过。
 *  在 resolveCardRoll（判定真正接入卡）与 CardPoolEditor 开启开关时调用，作为双保险。 */
export function ensureStarterCards(): void {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.card_enabled || gs.settings.card_starter_granted) return;
  gs.settings.card_starter_granted = true;
  if (Object.keys(gs.settings.card_collection).length > 0) return; // 已有收藏，跳过发放
  const starterIds = ['builtin_weapon_1', 'builtin_spell_1', 'builtin_blessing_1', 'builtin_trial_1'];
  for (const id of starterIds) {
    const def = cardDefById(id);
    if (!def) continue;
    gs.settings.card_collection[id] = {
      card_id: id,
      obtained_at: Date.now(),
      trigger_count: 0,
      source: 'builtin',
    };
    // 首次发放同样计入历史获得，保证套装/成就进度完整
    const rec = gs.settings.card_obtained[id] ?? { card_id: id, obtained_at: Date.now(), count: 0 };
    rec.count += 1;
    rec.obtained_at = rec.obtained_at || Date.now();
    gs.settings.card_obtained[id] = rec;
  }
}

/** 把一张卡装进其类型槽后，整组星级预算是否通过（纯投影，不落库）。 */
export function canEquipInDeck(configId: string, card: Card): { ok: boolean; errors: string[] } {
  const slots = resolveDeckSlots(configId);
  const projected = slots
    .map(s => (s.type === card.type ? card : cardDefById(s.card_id)))
    .filter((c): c is Card => !!c);
  return checkDeckBudget(projected);
}

/** 装备一张卡到其类型对应的固定槽位（替换该槽旧卡 + 全组星级预算校验）。返回 { ok, errors[] }。
 *  首次手动装备会自动关掉 auto_deck_enabled：auto 只做无感起步兜底，玩家一旦配卡即接管。 */
export function equipCard(configId: string, cardId: string): { ok: boolean; errors: string[] } {
  const gs = useGlobalSettingsStore();
  const card = cardDefById(cardId);
  const owned = gs.settings.card_collection[cardId];
  if (!card || !owned) return { ok: false, errors: ['卡不存在或未拥有'] };
  if (!CARD_SLOT_TYPES.includes(card.type)) return { ok: false, errors: ['该类型卡没有对应槽位'] };
  const deck = (gs.settings.card_decks[configId] ??= { config_id: configId, slots: [] });
  // 手动装备即接管：先快照 auto 编组并关开关（与卡组页 snapshotFromAuto 同语义），
  // 后续预算校验才以「即将生效的手动卡组」为基数，否则 auto 态下校验用错投影
  if (gs.settings.auto_deck_enabled) {
    deck.slots = autoDeckCards();
    gs.settings.auto_deck_enabled = false;
    toastr.info('已切换为手动卡组（可在卡组页重新开启自动编组）');
  }
  deck.slots = normalizeDeckSlots(deck.slots);
  if (deck.slots.some(s => s.card_id === cardId)) return { ok: false, errors: ['该卡已装备'] };
  const budget = canEquipInDeck(configId, card);
  if (!budget.ok) return budget;
  const slot = deck.slots.find(s => s.type === card.type);
  if (slot) slot.card_id = cardId;
  return { ok: true, errors: [] };
}

/** 卸下一张卡：先规整槽位（历史脏数据下原始 slots 与展示口径可能不一致），再清空其所在固定槽。 */
export function unequipCard(configId: string, cardId: string): void {
  const gs = useGlobalSettingsStore();
  const deck = gs.settings.card_decks[configId];
  if (!deck) return;
  deck.slots = normalizeDeckSlots(deck.slots);
  const slot = deck.slots.find(s => s.card_id === cardId);
  if (slot) slot.card_id = '';
}

// ── 购买卡包（行动币唯一消费出口） ───────────────────────────────────────

/** 购买卡包：恒定 CARD_PACK_PRICE，扣币后返回 offer 立即开。 */
export function buyPack(configId: string): { ok: boolean; errors: string[]; offer?: CardOffer } {
  const gs = useGlobalSettingsStore();
  if (gs.settings.card_currency < CARD_PACK_PRICE) {
    return { ok: false, errors: [`行动币不足（需 ${CARD_PACK_PRICE}）`] };
  }
  gs.settings.card_currency -= CARD_PACK_PRICE;
  recordCurrencySpent(CARD_PACK_PRICE);
  // 购买开包同样计一次「开包次数」（与幸运命中开包同口径），否则统计页三数字互相矛盾
  recordPackOpened();
  // 购买开包同样触发角色主题池懒生成（幂等）：不依赖幸运数命中，本次 offer 仍用现有池，
  // 生成后进后续混合池
  ensureCharacterPool();
  return { ok: true, errors: [], offer: samplePackOffer(configId) };
}

// ── 角色主题池懒生成（§6，见 cards-ai.ts） ───────────────────────────────

/** 清空某角色的主题池及其关联卡数据（定义/收藏/历史获得）——供「重新生成」测试/换新风格用。
 *  破坏性：会删除已收集的该角色主题卡；调用方须先确认。 */
export function clearCharacterPool(charId: string): void {
  const gs = useGlobalSettingsStore();
  const pool = gs.settings.card_character_pools[charId];
  if (!pool) return;
  for (const id of pool.card_ids) {
    delete gs.settings.card_definitions[id];
    delete gs.settings.card_collection[id];
    delete gs.settings.card_obtained[id];
  }
  delete gs.settings.card_character_pools[charId];
}

let poolGenRunning = false;
let poolGenPending = false;

/** 触发当前角色主题池懒生成（fire-and-forget）：该角色池未生成时异步调 AI 生成并固定。
 *  无 API / 无当前角色 / 失败 → 静默回退纯内置池，不影响内置抽卡；生成中重复调用去重。 */
export function ensureCharacterPool(): void {
  const gs = useGlobalSettingsStore();
  const charId = gs.currentCharacterId;
  if (charId == null) return;
  const pool = gs.settings.card_character_pools[charId];
  if (pool?.generated) return;
  if (poolGenRunning) {
    poolGenPending = true;
    return;
  }
  poolGenRunning = true;
  void (async () => {
    try {
      const { generateCharacterPool } = await import('@/core/cards-ai');
      await generateCharacterPool(charId);
    } catch {
      /* 生成失败静默回退内置池，不 toastr */
    } finally {
      poolGenRunning = false;
      if (poolGenPending) {
        poolGenPending = false;
        ensureCharacterPool();
      }
    }
  })();
}

// ── 统计记录（stats_enabled 门控，见 core/stats.ts） ─────────────────────

import {
  recordCardTrigger,
  recordCardLuckyHit,
  recordPackOpened,
  recordCardsObtained,
  recordCurrencySpent,
  recordCurrencyOutcome,
} from '@/core/stats';
