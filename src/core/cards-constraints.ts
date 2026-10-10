/**
 * 卡牌系统约束与常量（单一事实来源，防逆天 / 防 AI 瞎写）。
 *
 * 约束：
 *  ① 每项效果硬设上下限（骰值修正 / 需求修正 / 彩蛋窗口 / 叙事字数）；
 *  ② AI 角色卡生成超限或字段非法 → validateCard 拒绝（调用方提示修改/重生成）；
 * ③ 每个 config 卡组星级预算（高星卡限装：3星≤2 / 4星≤1 / 5星≤1），checkDeckBudget 校验装备位。
 *
 * 货币「行动币」：结局收支 + 重复卡折算 + 修复支出 + 卡包定价全部收敛在这张表，量级与
 * 「每次只给几个」匹配——攒几次判定才够开一包。卡为永久收藏；
 * v70 起恢复触发磨损（耐久归零破损、行动币修复回满），重复获得折算 CARD_DUPLICATE_VALUE 行动币。
 */

import { CARD_STARS, CARD_TYPES, type Card, type CardEffect, type CardStar, type CardType } from '@/type/settings';
import type { DiceOutcome } from '@/core/dice';

// ── 效果硬限 ─────────────────────────────────────────────────────────────

/** 掷骰前修正上限（±，roll_bonus） */
export const CARD_ROLL_BONUS_LIMIT = 30;
/** 需求修正上限（±DC，demand_mod） */
export const CARD_DEMAND_MOD_LIMIT = 40;
/** 彩蛋窗口修正上限（±，crit_window 的大成功/大失败各 ± 至多本值） */
export const CARD_CRIT_WINDOW_LIMIT = 5;
/** 卡面叙事字数上限（narrative 展示文本） */
export const CARD_NARRATIVE_CHARS_LIMIT = 40;

// ── 角色主题池分批生成节奏（每次触发生成多少、何时停） ────────────────────

/** 首批张数（池空初始化）：保证首次开包后池子有像样的可掉落主题卡 */
export const CARD_POOL_FIRST_BATCH = 4;
/** 补充批张数（池非空时每次彩蛋触发补充） */
export const CARD_POOL_BATCH_SIZE = 2;
/** 池上限：满池后停止自动补充（防池无限膨胀稀释内置掉落 + 防请求浪费）；
 *  批次生成让每批吃到触发时刻的剧情上下文，池随剧情阶段逐步变宽，上限给够 4 批补充余量 */
export const CARD_POOL_MAX_CARDS = 12;

// ── 等级预算（装备格内强卡上限，防叠爆） ────────────────────────────────

/** 各星级在卡组内的数量上限（仅高星卡受限；1/2 星不限，受 5 格 + 同类 ≤1 约束） */
export const CARD_STAR_BUDGET: Readonly<Partial<Record<CardStar, number>>> = {
  '3': 2,
  '4': 1,
  '5': 1,
};

/** 卡组固定类型槽位顺序（唯一权威来源，组件不得另写顺序）：每槽绑定一种类型、只可装该类型 1 张。
 *  CardDeck.slots 恒定按此顺序规整为 4 条（card_id='' 表示空槽）。 */
export const CARD_SLOT_TYPES: readonly CardType[] = ['weapon', 'spell', 'blessing', 'trial'];

// ── 耐久与修复（v70 恢复触发磨损 + 破损修复） ────────────────────────────
// v66 曾删除耐久/等级（卡为永久收藏）；v70 应明确要求恢复「触发磨损」——卡每次触发
// 判定扣 1 耐久，归零破损（broken=true）自动卸下禁装，消耗行动币修复回满。
// 耐久按「星级 × 功能」差异化（老需求：耐久不能全相同，应根据稀有度/功能有所不同）：
// 高星稀有卡更耐操，祝福（辅助）最耐用、试炼（高风险）最易损，武器/法术居中。

/** 耐久基础值（按星级）：1★ 15 次 / 5★ 35 次触发才磨损到底，量级与「攒几次判定开一包」匹配 */
export const CARD_DURABILITY_BASE: Readonly<Record<CardStar, number>> = {
  '1': 15,
  '2': 20,
  '3': 25,
  '4': 30,
  '5': 35,
};

/** 功能（卡类型）修正：武器 0（基准）/ 法术 −2 / 祝福 +5（辅助耐用）/ 试炼 −5（高风险易损）。
 *  与效果定位一致：祝福是稳定辅助、试炼是高收益高风险，耐久响应其「出场频次期望」。 */
export const CARD_DURABILITY_TYPE_ADJ: Readonly<Record<CardType, number>> = {
  weapon: 0,
  spell: -2,
  blessing: 5,
  trial: -5,
};

/** 耐久终值钳制区间（防修正后过小让易损卡一碰就碎、或过大让复杂卡几乎不损） */
export const CARD_DURABILITY_MIN = 10;
export const CARD_DURABILITY_MAX = 40;

/** 修复成本（行动币，与卡包 5 币同量级）：按星级递增——高星卡强度高、修起来也贵 */
export const CARD_REPAIR_COST: Readonly<Record<CardStar, number>> = {
  '1': 2,
  '2': 3,
  '3': 5,
  '4': 6,
  '5': 8,
};

/** 修复成本功能修正：试炼 −1（易损卡修得便宜）、祝福 +1（耐用卡修得贵），钳制 ≥1。
 *  形成「强而脆的试炼卡坏了修得起、耐用的祝福坏了修不起」的取舍张力。 */
export const CARD_REPAIR_TYPE_ADJ: Readonly<Record<CardType, number>> = {
  weapon: 0,
  spell: 0,
  blessing: 1,
  trial: -1,
};

/** 卡满耐久（获取时计算并写入 CardOwned.max_durability；纯函数，star/type 决定）。 */
export function cardMaxDurability(card: { star: CardStar; type: CardType }): number {
  const base = CARD_DURABILITY_BASE[card.star] ?? 0;
  const adj = CARD_DURABILITY_TYPE_ADJ[card.type] ?? 0;
  return Math.min(CARD_DURABILITY_MAX, Math.max(CARD_DURABILITY_MIN, base + adj));
}

/** 卡修复成本（行动币；纯函数，star/type 决定；低于 1 钳到 1）。 */
export function cardRepairCost(card: { star: CardStar; type: CardType }): number {
  const base = CARD_REPAIR_COST[card.star] ?? 1;
  const adj = CARD_REPAIR_TYPE_ADJ[card.type] ?? 0;
  return Math.max(1, base + adj);
}

/** 是否破损（0 耐久 = 破损：不能装备/触发；broken 字段与 durability===0 双保险判定）。 */
export function isCardBroken(owned: { broken?: boolean; durability?: number }): boolean {
  return !!owned?.broken || (owned?.durability ?? 0) <= 0;
}

// ── 行动币收支表（量级稀有，每次只给几个） ───────────────────────────────

/** 骰子结局收支：点选项判定（card_enabled 开）按结局增减；余额 ≥0 不扣穿（0 时失败不再减） */
export const CARD_OUTCOME_CURRENCY: Readonly<Record<DiceOutcome, number>> = {
  crit_success: 5,
  success: 2,
  fail: -1,
  crit_fail: -3,
};

/** 重复获得折算行动币（开卡包 3 选 1 选到已拥有卡时发放；低于对应星级价值防刷包） */
export const CARD_DUPLICATE_VALUE: Readonly<Record<CardStar, number>> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 5,
  '5': 8,
};

/** 卡包恒定 5 行动币 */
export const CARD_PACK_PRICE = 5;

/** 幸运数（固定彩蛋，非玩家参数）：判定 D100 的**原骰**（卡牌加成前）恰中本数 → 触发
 *  「开卡包」3 选 1。high 模式取 100（比普通大成功更难）、low 模式取对偶极值 1（COC
 *  反向的掷得极好）——roll_bonus 等卡牌加成不影响命中口径，卡不推高开包率。
 *  卡池不允许用户自定义，无配置入口。 */
export const CARD_LUCKY_NUMBER = 100;
/** low（COC 反向）模式的幸运数：与 high 的 100 对偶的「掷得极好」点数。 */
export const CARD_LUCKY_NUMBER_LOW = 1;

/** 每次开卡包固定展示张数（3 选 1）。卡池不允许用户自定义，无需配置入口。 */
export const CARD_PACK_OFFER = 3;

/** 抽卡星级权重（低星多 / 高星少，掉率递减） */
export const CARD_DROP_WEIGHT: Readonly<Record<CardStar, number>> = {
  '1': 50,
  '2': 30,
  '3': 15,
  '4': 8,
  '5': 4,
};

/** 是否「稀有卡」（3 星及以上）：开包弹窗稀有提示与卡面高亮用此判定（v66 起保底/分解已裁撤）。 */
export const isHighStar = (star: CardStar): boolean => Number(star) >= 3;

// ── 效果 clamp（数值先经这里再进判定，防越权） ───────────────────────────

const clamp = (v: number, lim: number): number => Math.min(lim, Math.max(-lim, Math.round(Number.isFinite(v) ? v : 0)));

/** 卡行文本并入判定 HTML 注释（option-action mergeCardNarratives/wrapCardNarratives）前的安全化：
 *  连续连字符（如 AI 写出的卡名含 `--`）会提前闭合注释、使后续判定正文泄漏为聊天可见文本——
 *  统一替换为全角破折号（替换后长度不增，先替换再截断不会复活连续连字符）。 */
export const sanitizeNarrative = (text: string): string => text.replace(/-{2,}/g, '－');

/** 对单个效果做硬限钳制（就地返回新对象，不改入参）。narrative 超长则截断；
 *  kind 不在六类枚举（AI 瞎写/旧脏数据）返回 null——调用方必须过滤，
 *  防 undefined 效果对象流入 validateCard/判定管线炸整批。 */
export function clampEffect(e: CardEffect): CardEffect | null {
  switch (e?.kind) {
    case 'roll_bonus':
      return { kind: 'roll_bonus', amount: clamp(e.amount, CARD_ROLL_BONUS_LIMIT) };
    case 'demand_mod':
      return { kind: 'demand_mod', amount: clamp(e.amount, CARD_DEMAND_MOD_LIMIT) };
    case 'crit_window':
      return {
        kind: 'crit_window',
        success_delta: clamp(e.success_delta, CARD_CRIT_WINDOW_LIMIT),
        fail_delta: clamp(e.fail_delta, CARD_CRIT_WINDOW_LIMIT),
      };
    case 'outcome_convert':
      return e; // 枚举限定，无数值可超限（from/to 枚举由 validateCard 把关）
    case 'reroll':
      return e; // 次数恒 1
    case 'narrative':
      return { kind: 'narrative', text: (e.text ?? '').slice(0, CARD_NARRATIVE_CHARS_LIMIT) };
    default:
      return null;
  }
}

/** 效果集是否全为「正向数值效果」（roll_bonus/demand_mod/crit_window 且数值 > 0）：
 *  宽触发区间 + 纯利好高星卡的拒绝判据。reroll/outcome_convert/narrative 属保命/展示
 *  效果不算纯正向，出现即放行（内置卡深渊凝视 roll 1-99 仅 reroll 即此形态）。 */
const isAllPositiveNumeric = (effects: CardEffect[]): boolean =>
  effects.length > 0 &&
  effects.every(
    e =>
      (e.kind === 'roll_bonus' && e.amount > 0) ||
      (e.kind === 'demand_mod' && e.amount > 0) ||
      (e.kind === 'crit_window' && (e.success_delta > 0 || e.fail_delta > 0)),
  );

/** 校验一张卡（AI 角色卡入库前）：字段缺失 / 枚举越界 / 数值超限 / 效果数超 3 /
 *  恒等转化 / 宽触发区间纯利好高星 → 拒绝并给错误。
 *  返回 { ok, errors[] }。内置卡直接视为合法（构建时已符合约束）。
 *  star/type/trigger/effect 枚举必须在此把关：这些卡会写进 card_definitions 持久化，
 *  枚举外的值会让下次加载的 GlobalSettings Zod 解析整体失败（扩展 init 崩）。 */
export function validateCard(card: Card): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!card.id) errors.push('缺少 id');
  if (!card.name) errors.push('缺少名称');
  if (!CARD_TYPES.includes(card.type)) errors.push(`类型非法：${String(card.type)}`);
  if (!CARD_STARS.includes(card.star)) errors.push(`星级非法：${String(card.star)}`);
  const trigger = card.trigger;
  if (!trigger || !TRIGGER_KINDS.includes(trigger.kind)) {
    errors.push('触发条件缺失或 kind 非法');
  } else {
    switch (trigger.kind) {
      case 'type':
        if (!trigger.typeValue || !trigger.typeValue.trim()) errors.push('类型触发缺少 typeValue');
        break;
      case 'grade':
        if (!['conservative', 'balanced', 'bold'].includes(trigger.grade as string))
          errors.push(`档位触发 grade 非法：${String(trigger.grade)}`);
        break;
      case 'demand':
      case 'roll':
        // max≥1：[0,0] 退化区间永不命中（rate/roll 恒 ≥1）——AI 漏填 min/max 时
        // schema 补默认 0/0，不拒会产出死卡占池
        if (!isRateRange(trigger.min) || !isRateRange(trigger.max) || trigger.min > trigger.max || trigger.max < 1)
          errors.push(`${trigger.kind === 'demand' ? '需求' : '骰值'}区间非法（需 0-100、min≤max 且 max≥1）`);
        break;
      case 'outcome':
        if (!['success', 'fail', 'crit_success', 'crit_fail'].includes(trigger.outcome as string))
          errors.push(`结局触发 outcome 非法：${String(trigger.outcome)}`);
        break;
    }
  }
  if (!Array.isArray(card.effects) || card.effects.length === 0) errors.push('缺少效果');
  else if (card.effects.length > 3) errors.push('效果数量超过 3 个');
  const hasNarrative = card.narrative?.length > CARD_NARRATIVE_CHARS_LIMIT;
  if (hasNarrative) errors.push(`叙事超过 ${CARD_NARRATIVE_CHARS_LIMIT} 字`);
  for (const e of card.effects ?? []) {
    if (!e || !EFFECT_KINDS.includes(e.kind)) {
      errors.push('存在非法效果项');
      continue;
    }
    switch (e.kind) {
      case 'roll_bonus':
        if (Math.abs(e.amount) > CARD_ROLL_BONUS_LIMIT) errors.push(`骰值修正超过 ±${CARD_ROLL_BONUS_LIMIT}`);
        break;
      case 'demand_mod':
        if (Math.abs(e.amount) > CARD_DEMAND_MOD_LIMIT) errors.push(`需求修正超过 ±${CARD_DEMAND_MOD_LIMIT}`);
        break;
      case 'crit_window':
        if (Math.abs(e.success_delta) > CARD_CRIT_WINDOW_LIMIT || Math.abs(e.fail_delta) > CARD_CRIT_WINDOW_LIMIT)
          errors.push(`彩蛋窗口修正超过 ±${CARD_CRIT_WINDOW_LIMIT}`);
        break;
      case 'outcome_convert':
        if (!CONVERT_FROM.includes(e.from) || !CONVERT_TO.includes(e.to)) errors.push('结局转化方向非法');
        else if (e.from === e.to) errors.push('结局转化方向无意义（from 与 to 相同）');
        break;
      case 'reroll':
        if (!['fail', 'crit_fail'].includes(e.on)) errors.push('重掷触发结局非法');
        break;
      case 'narrative':
        if (e.text.length > CARD_NARRATIVE_CHARS_LIMIT) errors.push(`叙事超过 ${CARD_NARRATIVE_CHARS_LIMIT} 字`);
        break;
    }
  }
  // 宽触发区间 + 纯正向数值效果的高星卡：与生成端「需求值标进触发区间」的教学行叠加
  // 会变成近乎常驻的免费增益，系统性拉低判定难度。低星小利可接受（失衡砝码 2★ 跨 79），
  // 只拦高星；带任何代价/保命效果即放行
  if (
    trigger &&
    (trigger.kind === 'demand' || trigger.kind === 'roll') &&
    Number(card.star) >= 3 &&
    trigger.max - trigger.min >= 80 &&
    isAllPositiveNumeric(card.effects ?? [])
  ) {
    errors.push('宽触发区间的高星卡必须带代价或负向效果');
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

const TRIGGER_KINDS = ['type', 'grade', 'demand', 'roll', 'outcome'] as const;
const EFFECT_KINDS = ['roll_bonus', 'demand_mod', 'crit_window', 'outcome_convert', 'reroll', 'narrative'] as const;
const CONVERT_FROM = ['fail', 'crit_fail', 'crit_success'] as const;
const CONVERT_TO = ['success', 'crit_success'] as const;
const isRateRange = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100;

/** 装备位等级预算校验：按 CARD_STAR_BUDGET 限制各高星卡数量。返回 { ok, errors[] }。 */
export function checkDeckBudget(cards: Array<{ star: CardStar }>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [star, max] of Object.entries(CARD_STAR_BUDGET)) {
    const n = cards.filter(c => c.star === star).length;
    if (n > max) errors.push(`${star}星卡最多 ${max} 张`);
  }
  return { ok: errors.length === 0, errors };
}
