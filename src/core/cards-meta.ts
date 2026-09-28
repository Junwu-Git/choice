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

/** 星级 → 语义色 chip（低→高：绿/蓝/信息/警告/危险） */
export const CARD_STAR_COLOR: Readonly<Record<CardStar, string>> = {
  '1': 'var(--choice-rate-low)',
  '2': 'var(--choice-primary)',
  '3': 'var(--choice-color-info)',
  '4': 'var(--choice-warning)',
  '5': 'var(--choice-color-error)',
};

/** 类型 → 中文名（与功能基础耐久定位一致：武器最短/法术中/祝福最长/试炼最短而强） */
export const CARD_TYPE_LABEL: Readonly<Record<CardType, string>> = {
  weapon: '武器',
  spell: '法术',
  blessing: '祝福',
  trial: '试炼',
};

/** 触发条件人类可读文案（供卡预览/卡组摘要） */
export function triggerLabel(t: CardTrigger): string {
  switch (t.kind) {
    case 'type':
      return `类型·${t.typeValue}`;
    case 'grade': {
      const g = t.grade === 'conservative' ? '保守' : t.grade === 'balanced' ? '平衡' : '大胆';
      return `档位·${g}`;
    }
    case 'demand':
      return `需求 ${t.min}–${t.max}`;
    case 'roll':
      return `骰值 ${t.min}–${t.max}`;
    case 'outcome': {
      const map: Record<string, string> = {
        success: '成功',
        fail: '失败',
        crit_success: '大成功',
        crit_fail: '大失败',
      };
      return `结局·${map[t.outcome ?? ''] ?? t.outcome}`;
    }
  }
}

/** 效果集人类可读摘要（多个效果顿号连接） */
export function effectsLabel(effects: CardEffect[]): string {
  return (effects ?? []).map(effectLabel).join('、');
}

function effectLabel(e: CardEffect): string {
  switch (e.kind) {
    case 'roll_bonus':
      return `骰值${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'demand_mod':
      return `需求${e.amount >= 0 ? '+' : ''}${e.amount}`;
    case 'crit_window':
      return `彩蛋±${e.success_delta}/${e.fail_delta}`;
    case 'outcome_convert': {
      const to = e.to === 'success' ? '成功' : e.to === 'crit_success' ? '大成功' : e.to;
      return `${e.from}→${to}`;
    }
    case 'reroll':
      return `${e.on}时重掷`;
    case 'narrative':
      return '叙事';
  }
}

/** 卡通用摘要：触发 + 效果（卡库/卡组/弹窗卡片共用） */
export function cardLine(card: Card): string {
  return `${triggerLabel(card.trigger)} · ${effectsLabel(card.effects)}`;
}
