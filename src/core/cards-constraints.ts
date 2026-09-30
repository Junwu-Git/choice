/**
 * 卡牌系统约束与常量（单一事实来源，防逆天 / 防 AI 瞎写）。
 *
 * 约束：
 *  ① 每项效果硬设上下限（骰值修正 / 需求修正 / 彩蛋窗口 / 叙事字数）；
 *  ② AI 角色卡生成超限或字段非法 → validateCard 拒绝（调用方提示修改/重生成）；
 * ③ 每个 config 卡组星级预算（高星卡限装：3星≤2 / 4星≤1 / 5星≤1），checkDeckBudget 校验装备位。
 *
 * 货币「行动币」：结局收支 + 重复卡折算 + 卡包定价全部收敛在这张表，量级与
 * 「每次只给几个」匹配——攒几次判定才够开一包。卡为永久收藏（无耐久/等级），
 * 重复获得折算 CARD_DUPLICATE_VALUE 行动币。
 */

import type { Card, CardEffect, CardStar, CardType } from '@/type/settings';
import type { DiceOutcome } from '@/core/dice';

// ── 效果硬限 ─────────────────────────────────────────────────────────────

/** 掷骰前修正上限（±，roll_bonus） */
export const CARD_ROLL_BONUS_LIMIT = 30;
/** 需求修正上限（±DC，demand_mod） */
export const CARD_DEMAND_MOD_LIMIT = 40;
/** 彩蛋窗口修正上限（±，crit_window 的大成功/大失败各 ± 至多本值） */
export const CARD_CRIT_WINDOW_LIMIT = 5;
/** 叙事注入字数上限（narrative 正文，占位符不计入） */
export const CARD_NARRATIVE_CHARS_LIMIT = 40;
/** 强制重掷 / 结局转化次数恒为 1（效果集里单次语义，不做可累加次数） */
export const CARD_EFFECT_COUNT_LIMIT = 1;

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

// ── 耐久公式（v66 已删除） ─────────────────────────────────────────────
// 卡为永久收藏：无耐久/等级机制。保留本节注释锚点说明语义变更，防误回填。

// ── 行动币收支表（量级稀有，每次只给几个） ───────────────────────────────

/** 骰子结局收支：点选项判定（card_enabled 开）按结局增减；余额 ≥0 不扣穿（0 时失败不再减） */
export const CARD_OUTCOME_CURRENCY: Readonly<Record<DiceOutcome, number>> = {
  crit_success: 5,
  success: 2,
  fail: -1,
  crit_fail: -3,
};

/** 重复获得折算行动币（开卡包 3 选 1 选到已拥有卡时发放；低于原分解价防刷） */
export const CARD_DUPLICATE_VALUE: Readonly<Record<CardStar, number>> = {
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 5,
  '5': 8,
};

/** 卡包恒定 5 行动币 */
export const CARD_PACK_PRICE = 5;

/** 幸运数（固定彩蛋，非玩家参数）：判定 D100 恰中本数 → 触发「开卡包」3 选 1。
 *  取 100 = 普通大成功更难，不需要配置入口，卡池不允许用户自定义。 */
export const CARD_LUCKY_NUMBER = 100;

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

/** 是否保底/分解口径的「高级卡」（3 星及以上）。pity 强制注入、分解、出卡重置保底均用此判定。 */
export const isHighStar = (star: CardStar): boolean => Number(star) >= 3;

// ── 收藏成就（趣味彩蛋，零操作） ─────────────────────────────────────────

/** 单类型集齐 1–5 星（一套内置卡）即成一枚「全收集」成就；键 = `set_<type>`。 */
export const CARD_TYPE_FULL_STARS: CardStar[] = ['1', '2', '3', '4', '5'];
/** 收藏总数里程碑：累计拥有达到该数即一性触发庆祝（键 = `collect_<n>`）。 */
export const CARD_TROPHY_COLLECT_MILESTONES: readonly number[] = [10, 20];

// ── 效果 clamp（数值先经这里再进判定，防越权） ───────────────────────────

const clamp = (v: number, lim: number): number => Math.min(lim, Math.max(-lim, Math.round(Number.isFinite(v) ? v : 0)));

/** 对单个效果做硬限钳制（就地返回新对象，不改入参）。narrative 超长则截断。 */
export function clampEffect(e: CardEffect): CardEffect {
  switch (e.kind) {
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
      return e; // 枚举限定，无数值可超限
    case 'reroll':
      return e; // 次数恒 1
    case 'narrative':
      return { kind: 'narrative', text: e.text.slice(0, CARD_NARRATIVE_CHARS_LIMIT) };
  }
}

/** 校验一张卡（AI 角色卡入库前）：数值超限 / 字段非法 / 叙事超长 → 拒绝并给错误。
 *  返回 { ok, errors[] }。内置卡直接视为合法（构建时已符合约束）。 */
export function validateCard(card: Card): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!card.id) errors.push('缺少 id');
  if (!card.name) errors.push('缺少名称');
  if (!card.trigger) errors.push('缺少触发条件');
  if (!Array.isArray(card.effects) || card.effects.length === 0) errors.push('缺少效果');
  const hasNarrative = card.narrative?.length > CARD_NARRATIVE_CHARS_LIMIT;
  if (hasNarrative) errors.push(`叙事超过 ${CARD_NARRATIVE_CHARS_LIMIT} 字`);
  for (const e of card.effects ?? []) {
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
      case 'narrative':
        if (e.text.length > CARD_NARRATIVE_CHARS_LIMIT) errors.push(`叙事超过 ${CARD_NARRATIVE_CHARS_LIMIT} 字`);
        break;
      default:
        break;
    }
  }
  return { ok: errors.length === 0, errors };
}

/** 装备位等级预算校验：按 CARD_STAR_BUDGET 限制各高星卡数量。返回 { ok, errors[] }。 */
export function checkDeckBudget(cards: Array<{ star: CardStar }>): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [star, max] of Object.entries(CARD_STAR_BUDGET)) {
    const n = cards.filter(c => c.star === star).length;
    if (n > max) errors.push(`${star}星卡最多 ${max} 张`);
  }
  return { ok: errors.length === 0, errors };
}
