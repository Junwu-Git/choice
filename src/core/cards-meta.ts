/**
 * 卡牌展示元数据（v62）：星级/类型/触发的文案与语义色映射，供卡库/卡组/商店/开包弹窗复用，
 * 避免各组件各写一份造成文案与配色漂移（类似 constants 的单一事实源哲学）。
 * 纯展示层，不参与判定逻辑（判定在 cards.ts/matchedTrigger）。
 */

import type { Card, CardStar, CardTrigger, CardType, CardEffect } from '@/type/settings';

/** 星级 → 中文名 + 语义色 class（scoped 样式按此上色，见 global.css .choice-card-star--*） */
export const CARD_STAR_LABEL: Readonly<Record<CardStar, string>> = {
  '1': '1星',
  '2': '2星',
  '3': '3星',
  '4': '4星',
  '5': '5星',
};

export const CARD_STAR_ORDER: CardStar[] = ['1', '2', '3', '4', '5'];

/** 星级 → 专用色板 chip（1★灰 / 2★绿 / 3★蓝 / 4★紫 / 5★金，见 theme.css --choice-star-*）。
 *  星级语义固定识别，不随主题主色漂移；亮极性主题由 theme.css 按对比度覆盖。 */
export const CARD_STAR_COLOR: Readonly<Record<CardStar, string>> = {
  '1': 'var(--choice-star-1)',
  '2': 'var(--choice-star-2)',
  '3': 'var(--choice-star-3)',
  '4': 'var(--choice-star-4)',
  '5': 'var(--choice-star-5)',
};

/** 类型 → 中文名（与功能基础耐久定位一致：武器最短/法术中/祝福最长/试炼最短而强） */
export const CARD_TYPE_LABEL: Readonly<Record<CardType, string>> = {
  weapon: '武器',
  spell: '法术',
  blessing: '祝福',
  trial: '试炼',
};

/** 类型 → FontAwesome 图标（CardFace 装饰插画区水印用）。只允许选用酒馆捆绑 FontAwesome
 *  （public/css/fontawesome.min.css）中已核实存在的类，否则空字形（fa-sword 等不存在）。
 *  已核实存在：fa-khanda / fa-wand-magic-sparkles / fa-heart / fa-bolt。 */
export const CARD_TYPE_ICON: Readonly<Record<CardType, string>> = {
  weapon: 'fa-solid fa-khanda',
  spell: 'fa-solid fa-wand-magic-sparkles',
  blessing: 'fa-solid fa-heart',
  trial: 'fa-solid fa-bolt',
};

/** 套装/系列注册表（世界观背景卡组）。resonance = 集齐该套装 + 装备 ≥2 张时判定触发的特殊叙事。
 *  新增套装只需在此补一条 + 往 cards-builtin 加对应 set 卡，逻辑零改动。 */
export const CARD_SETS: Readonly<Array<{ id: string; name: string; theme: string; resonance: string }>> = [
  {
    id: 'xiyou',
    name: '西游记',
    theme: '取经路上五圣的奇遇，一念之间斗转星移。',
    resonance: '西游师徒同心，经文佛光护体，气运悄然向善。',
  },
  {
    id: 'sanguo',
    name: '三国演义',
    theme: '烽火乱世，桃园一诺，谋略与武勇并立。',
    resonance: '三国英杰齐聚，干戈玉帛之间，胜算悄然翻转。',
  },
];

/** 按 id 取套装定义（无则 undefined）。 */
export const cardSetById = (id: string): (typeof CARD_SETS)[number] | undefined => CARD_SETS.find(s => s.id === id);

/** 判定结局 → 中文（卡面触发/效果标签共用；带兜底，未知值原样回退） */
export const CARD_OUTCOME_LABEL: Readonly<Record<string, string>> = {
  success: '成功',
  fail: '失败',
  crit_success: '大成功',
  crit_fail: '大失败',
};

/** 触发条件人类可读文案（供卡预览/卡组摘要） */
export function triggerLabel(tr: CardTrigger): string {
  switch (tr.kind) {
    case 'type':
      return t`类型·${tr.typeValue}`;
    case 'grade': {
      const g = tr.grade === 'conservative' ? t`保守` : tr.grade === 'balanced' ? t`平衡` : t`大胆`;
      return t`档位·${g}`;
    }
    case 'demand':
      return t`需求 ${tr.min}–${tr.max}`;
    case 'roll':
      return t`骰值 ${tr.min}–${tr.max}`;
    case 'outcome':
      return t`结局·${CARD_OUTCOME_LABEL[tr.outcome ?? ''] ?? tr.outcome}`;
  }
}

/** 效果集人类可读摘要（多个效果顿号连接） */
export function effectsLabel(effects: CardEffect[]): string {
  return (effects ?? []).map(effectSummary).join('、');
}

/** 单个效果人类可读摘要（单一事实源：判定 chip 的 title 与卡面「效果」行共用此实现，
 *  勿在别处再写一份导致措辞漂移） */
export function effectSummary(e: CardEffect): string {
  switch (e.kind) {
    case 'roll_bonus':
      return t`骰值${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'demand_mod':
      return t`需求${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'crit_window':
      return t`彩蛋 ±${e.success_delta}/${e.fail_delta}`;
    case 'outcome_convert':
      return t`${CARD_OUTCOME_LABEL[e.from] ?? e.from}→${CARD_OUTCOME_LABEL[e.to] ?? e.to}`;
    case 'reroll':
      return t`${CARD_OUTCOME_LABEL[e.on] ?? e.on}重掷`;
    case 'narrative':
      return t`叙事注入`;
  }
}

/** 卡通用摘要：触发 + 效果（卡库/卡组/弹窗卡片共用） */
export function cardLine(card: Card): string {
  return `${triggerLabel(card.trigger)} · ${effectsLabel(card.effects)}`;
}
