/**
 * 卡牌系统核心（纯逻辑 + 轻 store 交互）：装备解析、触发匹配、判定管线集成、
 * 开卡包/商店/分解/每日任务/货币等全部卡牌操作的共享层。
 *
 * 判定管线集成（option-action.ts 调用）：
 *   resolveCardRoll 在既有 D100 判定路径上叠加卡效果——预掷效果（roll_bonus 改骰值、
 *   demand_mod 改需求、crit_window 改彩蛋窗口，数值经 cards-constraints clamp）在掷骰前
 *   施加；后置效果（outcome_convert 结局转化、reroll 强制重掷、narrative 注入演绎指令）
 *   在掷骰后按最终结局施加。触发条件（type/grade/demand 前置可知，roll/outcome 掷后可知）
 *   决定卡是否触发；触发卡「效果实际触发」时扣 1 耐久（0 → 损坏，不再触发）。
 *
 * 关键分层：卡效果**只走 card_enabled=true 分支**；card_enabled=false（默认）时本模块
 * 的判定集成完全跳过，option-action 走与现状一致的路径——存量升级零行为变化。
 *
 * 游戏进度（货币/保底/每日/收藏/卡组/角色池/卡定义）直接读写 gs.settings 的 GlobalSettings
 * 字段，属「配置/进度层」；「清空统计」不清它们（见 §8 与 AGENTS.md）。仅统计读数（触发/
 * 领取/收支等）走 core/stats.ts 的 recordCard* 函数（stats_enabled 门控）。
 */

import { BUILTIN_CARDS } from '@/core/cards-builtin';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import {
  parseOptionStyle,
  parseOptionType,
  type OptionStyleGrade,
} from '@/util/option-format';
import { resolveOptionSuccessRateWithAttr } from '@/core/attribute-dc';
import {
  clampEffect,
  cardMaxDurability,
  checkDeckBudget,
  CARD_DISMANTLE,
  CARD_DROP_WEIGHT,
  CARD_MAX_LEVEL,
  CARD_OUTCOME_CURRENCY,
  CARD_PACK_PRICE,
  CARD_PITY_SOFT,
  CARD_PRICE,
  CARD_STAR_BUDGET,
  isHighStar,
  CARD_DAILY_KEYS,
  CARD_DAILY_TARGETS,
  type CardDailyKey,
} from '@/core/cards-constraints';
import { diceMargin, judgeOutcome, type DiceOutcome, type DiceRollMode } from '@/core/dice';
import type {
  Card,
  CardDeck,
  CardEffect,
  CardOwned,
  CardStar,
  CardTrigger,
  GlobalSettings,
} from '@/type/settings';

// ── 领域类型 ─────────────────────────────────────────────────────────────

/** 触发匹配上下文：type = 选项类型（parseOptionType），grade = 风险档位，
 *  rate = 判定需求值（attr 解析后，供 demand 区间匹配）。 */
export type CardContext = { type: string; grade: OptionStyleGrade | null; rate: number };

/** 已触发卡（chip 展示 + 扣耐久 + 统计共用） */
export type CardTriggeredInfo = { card: Card; summary: string };

/** 一次开卡包的单个候选（3 选 1 之一）：upgrade = 已拥有 → 选它=升级+修耐久 */
export type CardOfferOption = { card: Card; upgrade: boolean };

/** 开卡包 offer（混合池稀有度加权抽 card_pack_offer 张）：pityGuaranteed = 保底轮
 *  （必含史诗+）。configId 供选择落库时记保底维度。 */
export type CardOffer = {
  options: CardOfferOption[];
  pityGuaranteed: boolean;
  configId: string;
};

/** 一次判定中的卡牌决议（随 DiceRollResult 返回）：触发卡/幸运命中/行动币收支/卡叙事行。 */
export type CardResolution = {
  triggered: CardTriggeredInfo[];
  luckyHit: boolean;
  packOffer?: CardOffer;
  currencyDelta: number;
  narrativeLines: string[];
};

/** 装备位解析结果（装备 + 持有态） */
export type EquippedCard = { card: Card; owned: CardOwned };

// ── 配置解析（chat > character > default，复用 pool-selector 思路） ──────

/** 当前生效卡组所属 config id（与条目池同一解析链）。无 config → '__none__'。 */
export function currentCardConfigId(): string {
  return usePoolSelectorStore().effectiveConfig?.id ?? '__none__';
}

/** 按 config id 解析生效卡组（chat > character > default）。独立于条目池 configs——
 *  卡组用独立 card_decks record，不写进 PoolConfig.entries（保持「config 是纯条目引用清单」）。 */
export function deckForConfig(configId: string): CardDeck | null {
  const gs = useGlobalSettingsStore();
  return gs.settings.card_decks[configId] ?? null;
}

// ── 卡定义与持有解析 ─────────────────────────────────────────────────────

/** 按 card_id 取卡定义：内置卡来自 BUILTIN_CARDS，角色主题卡来自 card_definitions。
 *  找不到返回 undefined（已删除/异常 id）。 */
export function cardDefById(id: string): Card | undefined {
  if (!id) return undefined;
  const b = BUILTIN_CARDS.find(c => c.id === id);
  if (b) return b;
  return useGlobalSettingsStore().settings.card_definitions[id];
}

/** 卡是否损坏（耐久 ≤ 0）：损坏卡不可装备/触发，靠重复获得/兑换/分解修复 */
export const isCardBroken = (owned: CardOwned | undefined): boolean => !owned || owned.durability <= 0;

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

/** 解析某 config 已装备的卡（过滤损坏 + 超等级预算，防御历史脏数据）。 */
export function resolveEquippedCards(configId: string): EquippedCard[] {
  const gs = useGlobalSettingsStore();
  const deck = gs.settings.card_decks[configId];
  if (!deck) return [];
  const equipped: EquippedCard[] = [];
  for (const slot of deck.slots) {
    const card = cardDefById(slot.card_id);
    const owned = gs.settings.card_collection[slot.card_id];
    if (!card || !owned || isCardBroken(owned)) continue;
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

/** 生成效果的人类可读摘要（chip/卡库展示用）。数值取 clamp 后最终值。 */
export function effectSummary(e: CardEffect): string {
  switch (e.kind) {
    case 'roll_bonus':
      return `骰值${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'demand_mod':
      return `需求${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'crit_window':
      return `彩蛋 ±${e.success_delta}/${e.fail_delta}`;
    case 'outcome_convert':
      return `${e.from}→${e.to}`;
    case 'reroll':
      return `${e.on}重掷`;
    case 'narrative':
      return '叙事注入';
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

/** 保底强制注入 1 张 3 星+（替换一个非高星候选，最多替换 1 张）。 */
function enforcePity(offer: CardOfferOption[], pool: Card[]): boolean {
  if (offer.some(o => isHighStar(o.card.star))) return false;
  const epicPlus = pool.filter(c => isHighStar(c.star));
  if (epicPlus.length === 0) return false;
  const injected = epicPlus[Math.floor(Math.random() * epicPlus.length)];
  // 替换首个非高星候选
  const idx = offer.findIndex(o => !isHighStar(o.card.star));
  if (idx < 0) return false;
  const gs = useGlobalSettingsStore();
  offer[idx] = { card: injected, upgrade: !!gs.settings.card_collection[injected.id] };
  return true;
}

/** 混合池 3 选 1 开卡包：按稀有度权重抽 card_pack_offer 张不重复候选；应用连抽保底
 *  （card_pity[configId] ≥ CARD_PITY_SOFT 时本轮必含史诗+）；已拥有/损坏卡转「升级+修复」。
 *  纯采样不改状态——实际落库由 applyPackSelection 完成。 */
export function samplePackOffer(configId: string): CardOffer {
  const gs = useGlobalSettingsStore();
  const pool = mixedPoolCards();
  const n = Math.max(2, Math.min(5, gs.settings.card_pack_offer || 3));
  const options: CardOfferOption[] = [];
  const exclude = new Set<string>();
  for (let i = 0; i < n; i++) {
    const c = pickDistinct(pool, exclude);
    if (!c) break;
    exclude.add(c.id);
    options.push({ card: c, upgrade: !!gs.settings.card_collection[c.id] });
  }
  let pityGuaranteed = false;
  if (options.length > 0 && (gs.settings.card_pity[configId] ?? 0) >= CARD_PITY_SOFT) {
    pityGuaranteed = enforcePity(options, pool);
  }
  return { options, pityGuaranteed, configId };
}

/** 判定主入口（card_enabled=true 分支）：叠加卡效果完成一次 D100 判定并返回扩展结果。
 *  不改任何持久状态（预掷/后置/扣耐/货币/保底都在 commitCardRun 统一落库）——
 *  使就地重掷两步流的「预览」不扣耐久、不记账，只有真正应用时才 commit。
 *  返回 null 表示无需求值（与既有判定一致，不掷骰）。 */
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
  const gs = useGlobalSettingsStore();
  const configId = currentCardConfigId();
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

  // ── 后置效果（触发条件掷后可知：roll/outcome + 预掷卡也带的后置） ─────
  const fired = [...preFired];
  for (const eq of equipped) {
    if (preFired.includes(eq)) continue;
    const t = eq.card.trigger;
    if ((t.kind === 'roll' || t.kind === 'outcome') && matchTrigger(t, ctx, roll, outcome)) {
      fired.push(eq);
    }
  }
  const narrativeLines: string[] = [];
  let rerolled = false;
  for (const eq of fired) {
    for (const raw of eq.card.effects) {
      const eff = clampEffect(raw);
      if (eff.kind === 'outcome_convert' && eff.from === outcome) {
        outcome = eff.to;
      } else if (eff.kind === 'reroll' && eff.on === outcome && !rerolled) {
        rerolled = true;
        const rr = clamp0100(rollD100() + rollBonus);
        outcome = judgeOutcome(rr, rate, critS, critF, mode);
        roll = rr;
      } else if (eff.kind === 'narrative' && eff.text) {
        narrativeLines.push(eff.text);
      }
    }
    if (eq.card.narrative) narrativeLines.push(eq.card.narrative);
  }

  const margin = diceMargin(mode, roll, rate);
  const luckyHit = cardEnabled && isLuckyHit(roll, gs.settings.card_lucky_number);
  const packOffer = luckyHit ? samplePackOffer(configId) : undefined;
  const currencyDelta = cardEnabled ? CARD_OUTCOME_CURRENCY[outcome] : 0;

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
    },
  };
}

/** 幸运数命中：D100 恰好掷中 card_lucky_number（默认 100，比普通大成功更难）。 */
export function isLuckyHit(roll: number, luckyNumber: number): boolean {
  return roll === luckyNumber;
}

// ── 落库（应用判定结果，真正改动状态） ──────────────────────────────────

/** 提交一次已应用判定：扣触发卡耐久（0 → 损坏）、按结局收支行动币（≥0 不扣穿）、
 *  幸运命中触发开卡包（计保底抽次 + 生成 offer 供弹窗）。仅真正应用（发送框可用 +
 *  行为已执行）后调用——与「效果实际触发才扣耐久」语义对齐。 */
export function commitCardRun(resolution: CardResolution): CardOffer | undefined {
  const gs = useGlobalSettingsStore();
  if (!resolution) return undefined;
  // 扣耐久（每张触发卡 1 点；0 → 损坏，后续 resolveEquippedCards 不再返回）
  const brokenIds: string[] = [];
  for (const t of resolution.triggered) {
    const owned = gs.settings.card_collection[t.card.id];
    if (!owned || owned.durability <= 0) continue;
    owned.durability = Math.max(0, owned.durability - 1);
    owned.trigger_count += 1;
    recordCardTrigger(t.card.id);
    if (owned.durability <= 0) brokenIds.push(t.card.id);
  }
  // 行动币收支（结局驱动；0 时失败不再减，不扣穿）
  if (resolution.currencyDelta !== 0) {
    if (resolution.currencyDelta > 0) {
      gs.settings.card_currency += resolution.currencyDelta;
    } else if (gs.settings.card_currency > 0) {
      gs.settings.card_currency = Math.max(0, gs.settings.card_currency + resolution.currencyDelta);
    }
    recordCurrencyOutcome(resolution.currencyDelta);
  }
  // 幸运命中 → 开卡包：计保底抽次 + 开包统计，返回 offer 供组件弹窗
  if (resolution.luckyHit && resolution.packOffer) {
    const configId = resolution.packOffer.configId;
    gs.settings.card_pity[configId] = (gs.settings.card_pity[configId] ?? 0) + 1;
    recordPackOpened();
    recordCardLuckyHit();
    // 触发角色主题池懒生成（fire-and-forget）：本次 offer 用现有池，生成后进后续混合池
    ensureCharacterPool();
    return resolution.packOffer;
  }
  void brokenIds;
  return undefined;
}

// ── 开卡包选择（幸运 / 每日 / 商店卡包共用） ────────────────────────────

/** 应用一次 3 选 1 的选择：抽中已拥有/损坏 → 升级 + 修复到满（level++ 后重算耐久上限）；
 *  新卡 → 建 CardOwned（耐久按功能×稀有度初始化）。出史诗+ → 重置保底计数。
 *  via：'lucky'|'daily'|'shop'（shop 已扣币，仅影响统计埋点）。 */
export function applyPackSelection(offer: CardOffer, chosenIdx: number, via: 'lucky' | 'daily' | 'shop'): void {
  const gs = useGlobalSettingsStore();
  const opt = offer.options[chosenIdx];
  if (!opt) return;
  const configId = offer.configId;
  upgradeOrAcquire(gs.settings, opt.card, opt.upgrade);
  if (isHighStar(opt.card.star)) {
    gs.settings.card_pity[configId] = 0;
    recordPityHit();
  }
  recordCardsObtained();
  if (via === 'daily') recordDailyReward();
}

/** 升级或新得一张卡（商店定向 / 开卡包共用）：已拥有 → level++（满级后随机折回其他未满级卡）
 *  + 修复到满；新卡 → 建持有条目。 */
function upgradeOrAcquire(s: GlobalSettings, card: Card, ownedBefore: boolean): void {
  const existing = s.card_collection[card.id];
  if (existing) {
    if (existing.level < CARD_MAX_LEVEL) {
      existing.level += 1;
    } else {
      // 满级后再重复：随机折回其他未满级卡（防溢出）
      const candidates = Object.values(s.card_collection).filter(o => o.level < CARD_MAX_LEVEL && o.card_id !== card.id);
      const target = candidates[Math.floor(Math.random() * candidates.length)];
      if (target) target.level += 1;
    }
    // 修复到满（内置与角色卡都可重复获得 → 可修）
    existing.durability = cardMaxDurability(card.type, card.star, existing.level);
    existing.max_durability = existing.durability;
    return;
  }
  const max = cardMaxDurability(card.type, card.star, 1);
  s.card_collection[card.id] = {
    card_id: card.id,
    level: 1,
    obtained_at: Date.now(),
    trigger_count: 0,
    durability: max,
    max_durability: max,
    source: card.source,
  };
  void ownedBefore;
}

// ── 卡组编辑（CardDeckEditor 用） ────────────────────────────────────────

/** 装备一张卡到某 config 卡组（同类 ≤1 + 等级预算校验）。返回 { ok, errors[] }。 */
export function equipCard(configId: string, cardId: string): { ok: boolean; errors: string[] } {
  const gs = useGlobalSettingsStore();
  const card = cardDefById(cardId);
  const owned = gs.settings.card_collection[cardId];
  if (!card || !owned) return { ok: false, errors: ['卡不存在或未拥有'] };
  if (isCardBroken(owned)) return { ok: false, errors: ['卡已损坏，请先修复'] };
  const deck = (gs.settings.card_decks[configId] ??= { config_id: configId, slots: [] });
  if (deck.slots.length >= 5) return { ok: false, errors: ['装备位已满（≤5）'] };
  if (deck.slots.some(s => s.type === card.type)) return { ok: false, errors: ['同类卡最多装备 1 张'] };
  if (deck.slots.some(s => s.card_id === cardId)) return { ok: false, errors: ['该卡已装备'] };
  // 等级预算校验（预演：加上本卡后须通过）
  const projected = deck.slots
    .map(s => cardDefById(s.card_id))
    .filter((c): c is Card => !!c)
    .concat(card);
  const budget = checkDeckBudget(projected);
  if (!budget.ok) return budget;
  deck.slots.push({ card_id: cardId, type: card.type });
  return { ok: true, errors: [] };
}

/** 卸下一张卡。 */
export function unequipCard(configId: string, cardId: string): void {
  const gs = useGlobalSettingsStore();
  const deck = gs.settings.card_decks[configId];
  if (!deck) return;
  deck.slots = deck.slots.filter(s => s.card_id !== cardId);
}

// ── 商店 / 分解 / 每日任务 ───────────────────────────────────────────────

/** 商店定向购买内置卡：扣行动币 → 升级/修耐久/新得。余额不足 → { ok:false, errors }。 */
export function buyCard(cardId: string): { ok: boolean; errors: string[] } {
  const gs = useGlobalSettingsStore();
  const card = cardDefById(cardId);
  if (!card) return { ok: false, errors: ['卡不存在'] };
  const price = CARD_PRICE[card.star];
  if (gs.settings.card_currency < price) return { ok: false, errors: [`行动币不足（需 ${price}）`] };
  gs.settings.card_currency -= price;
  recordCurrencySpent(price);
  upgradeOrAcquire(gs.settings, card, !!gs.settings.card_collection[cardId]);
  return { ok: true, errors: [] };
}

/** 购买卡包（商店）：恒定 CARD_PACK_PRICE，扣币后返回 offer 立即开。 */
export function buyPack(configId: string): { ok: boolean; errors: string[]; offer?: CardOffer } {
  const gs = useGlobalSettingsStore();
  if (gs.settings.card_currency < CARD_PACK_PRICE) {
    return { ok: false, errors: [`行动币不足（需 ${CARD_PACK_PRICE}）`] };
  }
  gs.settings.card_currency -= CARD_PACK_PRICE;
  recordCurrencySpent(CARD_PACK_PRICE);
  return { ok: true, errors: [], offer: samplePackOffer(configId) };
}

/** 分解重复高级卡（第 2 张及以上史诗/传说，保底留 1 = 降到 Lv.1 不再分解）：按
 *  CARD_DISMANTLE 得行动币。收藏按 card_id 单槽持有，「重复」体现在等级（level = 获得次数）——
 *  分解消耗 1 级（降到最低 1 级），卡保留、耐久上限按新等级重算。 */
export function dismantleCard(cardId: string): { ok: boolean; errors: string[]; gain?: number } {
  const gs = useGlobalSettingsStore();
  const owned = gs.settings.card_collection[cardId];
  const def = cardDefById(cardId);
  if (!owned || !def) return { ok: false, errors: ['卡不存在'] };
  const gain = CARD_DISMANTLE[def.star];
  if (!gain || gain <= 0) return { ok: false, errors: ['只有 3 星及以上可分解'] };
  if (owned.level < 2) return { ok: false, errors: ['需第 2 张及以上（保底留 1）'] };
  owned.level -= 1;
  // 分解后按新等级修复耐久上限（卡保留，不降当前可修）
  owned.max_durability = cardMaxDurability(def.type, def.star, owned.level);
  owned.durability = owned.max_durability;
  gs.settings.card_currency += gain;
  recordCurrencyEarned(gain);
  return { ok: true, errors: [], gain };
}

/** 领每日任务奖励（达成且未领）：标记已领并返回免费开卡包 offer。 */
export function claimDailyReward(taskKey: CardDailyKey): CardOffer | undefined {
  const gs = useGlobalSettingsStore();
  resetDailyIfStale();
  const daily = gs.settings.card_daily;
  const task = daily.tasks[taskKey];
  if (!task?.done || task.claimed) return undefined;
  task.claimed = true;
  return samplePackOffer(currentCardConfigId());
}

/** 每日任务进度钩子（复用既有生成/判定/选择路径埋点）：card_enabled 开才累计。
 *  generate 在 generator 成功、judge 在 recordDiceRoll、select 在 recordOptionSelected 路径调用。 */
export function bumpDailyTask(gs: ReturnType<typeof useGlobalSettingsStore>, key: CardDailyKey): void {
  if (!gs.settings.card_enabled) return;
  resetDailyIfStale(gs);
  const daily = gs.settings.card_daily;
  const task = (daily.tasks[key] ??= { count: 0, done: false, claimed: false });
  task.count += 1;
  if (!task.done && task.count >= CARD_DAILY_TARGETS[key]) task.done = true;
}

/** 每日任务按本地日期重置：date 与今天不符 → 清空重建。 */
export function resetDailyIfStale(gs?: ReturnType<typeof useGlobalSettingsStore>): void {
  const store = gs ?? useGlobalSettingsStore();
  const today = localDateKey();
  if (store.settings.card_daily.date !== today) {
    store.settings.card_daily = {
      date: today,
      tasks: Object.fromEntries(CARD_DAILY_KEYS.map(k => [k, { count: 0, done: false, claimed: false }])),
    };
  }
}

/** 本地时区 YYYY-MM-DD（与 stats dailyKey 同口径）。 */
export function localDateKey(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// ── 角色主题池懒生成（§6，见 cards-ai.ts） ───────────────────────────────

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
  recordPityHit,
  recordCurrencyEarned,
  recordCurrencySpent,
  recordCurrencyOutcome,
  recordDailyReward,
} from '@/core/stats';
