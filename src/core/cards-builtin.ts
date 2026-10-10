/**
 * 内置固定卡库（仿 API_PRESETS 先例）：一批覆盖 4 类型 × 5 星级 × 6 效果的卡。
 * 内置卡全球通用、可反复掉落（不可编辑，只可收集/装备）。id 稳定
 * （`builtin_<type>_<star>`），供商店定向货架与角色主题池混合抽卡引用。
 * 每张卡的效果与触发条件保持「同型自洽」：武器=骰值/重掷（触发 roll/outcome）、
 * 法术=需求/结局转化（触发 grade/demand/outcome）、祝福=彩蛋/叙事（触发
 * grade/outcome）、试炼=综合强卡（触发 grade/roll）。数值均已在约束硬限内
 * （见 cards-constraints.ts），入库时 validateCard 恒为合法。
 */

import type { Card, CardEffect, CardStar, CardType } from '@/type/settings';

type BuiltinSpec = {
  type: CardType;
  star: CardStar;
  name: string;
  /** trigger 字段（kind 语义见 CardTrigger 注释） */
  trigger: Card['trigger'];
  effects: CardEffect[];
  narrative?: string;
};

const builtin = (spec: BuiltinSpec): Card => ({
  id: `builtin_${spec.type}_${spec.star}`,
  name: spec.name,
  type: spec.type,
  star: spec.star,
  trigger: spec.trigger,
  effects: spec.effects,
  narrative: spec.narrative ?? '',
  source: 'builtin',
  character_id: '', // 内置卡无角色归属
  character_name: '',
});

const R = (kind: Card['trigger']['kind'], value: Partial<Card['trigger']> = {}): Card['trigger'] => ({
  kind,
  typeValue: '',
  grade: null,
  min: 0,
  max: 0,
  outcome: null,
  ...value,
});

/** 内置卡库（只读常量）。导出为只读数组，UI 不可编辑。 */
export const BUILTIN_CARDS: readonly Card[] = [
  // ── 武器（骰值/重掷） ──────────────────────────────────────────────
  builtin({
    type: 'weapon',
    star: '1',
    name: '粗粝护腕',
    trigger: R('roll', { min: 1, max: 60 }),
    effects: [{ kind: 'roll_bonus', amount: 5 }],
    narrative: '腕力绷紧，粗粝护腕的加持让这次出手多了一分分量。',
  }),
  builtin({
    type: 'weapon',
    star: '2',
    name: '失衡砝码',
    trigger: R('roll', { min: 1, max: 80 }),
    effects: [{ kind: 'roll_bonus', amount: 11 }],
    narrative: '砝码偏向一侧，撬动了原本悬而未决的力道。',
  }),
  builtin({
    type: 'weapon',
    star: '3',
    name: '命运转轮',
    trigger: R('outcome', { outcome: 'fail' }),
    effects: [{ kind: 'reroll', on: 'fail' }],
    narrative: '命运转轮咔嗒转过一格，给了你重来一次的机会。',
  }),
  builtin({
    type: 'weapon',
    star: '4',
    name: '天秤裁决',
    trigger: R('roll', { min: 20, max: 100 }),
    effects: [
      { kind: 'roll_bonus', amount: 16 },
      { kind: 'reroll', on: 'crit_fail' },
    ],
    narrative: '天秤的指针稳稳停在胜利一侧，剑锋落下无可阻挡。',
  }),

  // ── 法术（需求/结局转化） ──────────────────────────────────────────
  builtin({
    type: 'spell',
    star: '1',
    name: '振奋术',
    trigger: R('grade', { grade: 'balanced' }),
    effects: [{ kind: 'demand_mod', amount: -8 }],
    narrative: '一道振奋术注入心口，原本的难度被悄悄抹平了几分。',
  }),
  builtin({
    type: 'spell',
    star: '2',
    name: '破障咒',
    trigger: R('demand', { min: 50, max: 90 }),
    effects: [{ kind: 'demand_mod', amount: -20 }],
    narrative: '破障咒撕开了那道高不可攀的壁垒。',
  }),
  builtin({
    type: 'spell',
    star: '3',
    name: '逆转仪式',
    trigger: R('outcome', { outcome: 'fail' }),
    effects: [{ kind: 'outcome_convert', from: 'fail', to: 'success' }],
    narrative: '逆转仪式在最后一刻颠倒因果，失败被改写成了成功。',
  }),
  builtin({
    type: 'spell',
    star: '4',
    name: '奇迹干预',
    trigger: R('outcome', { outcome: 'fail' }),
    effects: [{ kind: 'outcome_convert', from: 'fail', to: 'crit_success' }],
    narrative: '神迹降临——这一击超越了凡俗的成败，化为不可思议的完胜。',
  }),

  // ── 祝福（彩蛋/叙事） ──────────────────────────────────────────────
  builtin({
    type: 'blessing',
    star: '1',
    name: '微光庇护',
    trigger: R('grade', { grade: 'balanced' }),
    effects: [{ kind: 'crit_window', success_delta: 1, fail_delta: 1 }],
    narrative: '微光绕身，连运气都悄悄偏向了你。',
  }),
  builtin({
    type: 'blessing',
    star: '2',
    name: '圣辉余烬',
    trigger: R('grade', { grade: 'bold' }),
    effects: [{ kind: 'crit_window', success_delta: 2, fail_delta: 2 }],
    narrative: '圣辉余烬在掌心绽放，奇迹的边缘被推远了一寸。',
  }),
  builtin({
    type: 'blessing',
    star: '3',
    name: '神谕低语',
    trigger: R('outcome', { outcome: 'success' }),
    effects: [{ kind: 'narrative', text: '神谕的低语在耳边回响，成功之外另有深意。' }],
    narrative: '神谕低语萦绕不去，这场成功藏着不为人知的回响。',
  }),
  builtin({
    type: 'blessing',
    star: '4',
    name: '天命加冕',
    trigger: R('grade', { grade: 'bold' }),
    effects: [
      { kind: 'crit_window', success_delta: 3, fail_delta: 3 },
      { kind: 'narrative', text: '天命的冠冕落顶，命运彻底倒向了你。' },
    ],
    narrative: '天命的冠冕加诸头顶，接下来的走向由你书写。',
  }),

  // ── 试炼（综合强卡） ────────────────────────────────────────────────
  builtin({
    type: 'trial',
    star: '1',
    name: '破釜沉舟',
    trigger: R('grade', { grade: 'bold' }),
    effects: [
      { kind: 'roll_bonus', amount: 7 },
      { kind: 'demand_mod', amount: -8 },
    ],
    narrative: '退路已断，破釜沉舟的一击带着不计后果的狠劲。',
  }),
  builtin({
    type: 'trial',
    star: '2',
    name: '深渊凝视',
    trigger: R('roll', { min: 1, max: 99 }),
    effects: [{ kind: 'reroll', on: 'crit_fail' }],
    narrative: '凝视深渊的代价早已付清，灾难被硬生生拽回正轨。',
  }),
  builtin({
    type: 'trial',
    star: '3',
    name: '时之砂',
    trigger: R('outcome', { outcome: 'fail' }),
    effects: [
      { kind: 'outcome_convert', from: 'fail', to: 'success' },
      { kind: 'narrative', text: '时之砂逆流，失败的尘埃被重塑为胜利。' },
    ],
    narrative: '时之砂在指间逆流，刹那之间结局已然改写。',
  }),
  builtin({
    type: 'trial',
    star: '4',
    name: '终局天平',
    trigger: R('grade', { grade: 'bold' }),
    effects: [
      { kind: 'roll_bonus', amount: 20 },
      { kind: 'crit_window', success_delta: 3, fail_delta: 3 },
      { kind: 'reroll', on: 'crit_fail' },
    ],
    narrative: '终局的天平轰然落定，凡人的努力被推至极限之巅。',
  }),

  // ── 5 星（各类型顶配，越界即被硬限钳制，效果贴近上限但保留取舍） ──────
  builtin({
    type: 'weapon',
    star: '5',
    name: '裁决王权',
    trigger: R('roll', { min: 40, max: 100 }),
    effects: [
      { kind: 'roll_bonus', amount: 25 },
      { kind: 'reroll', on: 'crit_fail' },
    ],
    narrative: '王权之刃应声落下，胜局已无可逆转。',
  }),
  builtin({
    type: 'spell',
    star: '5',
    name: '万象归元',
    trigger: R('outcome', { outcome: 'crit_fail' }),
    effects: [{ kind: 'outcome_convert', from: 'crit_fail', to: 'crit_success' }],
    narrative: '万象归于一元，败局在瞬间被重写为神迹。',
  }),
  builtin({
    type: 'blessing',
    star: '5',
    name: '永恒圣徽',
    trigger: R('grade', { grade: 'bold' }),
    effects: [
      { kind: 'crit_window', success_delta: 4, fail_delta: 4 },
      { kind: 'narrative', text: '圣徽永悬头顶，命运的权柄尽归你手。' },
    ],
    narrative: '永恒圣徽的光辉不灭，奇迹与灾厄的边界皆由你裁定。',
  }),
  builtin({
    type: 'trial',
    star: '5',
    name: '终焉裁决',
    trigger: R('grade', { grade: 'bold' }),
    effects: [
      { kind: 'roll_bonus', amount: 28 },
      { kind: 'crit_window', success_delta: 3, fail_delta: 3 },
      { kind: 'reroll', on: 'crit_fail' },
    ],
    narrative: '终焉之裁落定，万事万物的极限皆由你执掌。',
  }),
];
