import { describe, expect, it } from 'vitest';
import {
  gradeFallbackRate,
  parseOptionContent,
  parseOptionDice,
  parseOptionRate,
  parseOptionStyle,
  parseOptionType,
} from '@/util/option-format';

describe('parseOptionType', () => {
  it('括号壳提取标题（半角/全角括号、容忍引号）', () => {
    expect(parseOptionType('[探索遗迹|大胆|70]正文')).toBe('探索遗迹');
    expect(parseOptionType('【标题】内容')).toBe('标题');
    expect(parseOptionType('["标题"]内容')).toBe('标题');
  });

  it('冒号分隔提取前缀（半角/全角、容忍零空格）', () => {
    expect(parseOptionType('动手：关掉警报')).toBe('动手');
    expect(parseOptionType('动手:关掉警报')).toBe('动手');
  });

  it('无标记文本原样返回', () => {
    expect(parseOptionType('直接行动')).toBe('直接行动');
  });

  it('零空格冒号对「12:30」这类串按分隔符切（两端一致的既定口径）', () => {
    expect(parseOptionType('时间12:30推进')).toBe('时间12');
  });

  it('词表外竖线段整体回退：标题保留原文（含竖线）', () => {
    expect(parseOptionType('[自定义|abc]内容')).toBe('自定义|abc');
  });

  it('双重档位标注视为未识别，整体回退', () => {
    expect(parseOptionType('[标题|大胆|保守]内容')).toBe('标题|大胆|保守');
  });
});

describe('parseOptionStyle', () => {
  it('受控档位词 → 枚举', () => {
    expect(parseOptionStyle('[潜入|大胆]')).toBe('bold');
    expect(parseOptionStyle('[稳一手|保守]')).toBe('conservative');
    expect(parseOptionStyle('[观察|平衡]')).toBe('balanced');
  });

  it('冒号形态/无标注/词表外 → null', () => {
    expect(parseOptionStyle('动手：内容')).toBeNull();
    expect(parseOptionStyle('[无标注]')).toBeNull();
    expect(parseOptionStyle('[自定义|abc]')).toBeNull();
  });
});

describe('parseOptionRate', () => {
  it('需求值段解析（裸数字/带 %/带「成功率」前缀）', () => {
    expect(parseOptionRate('[标题|70]')).toBe(70);
    expect(parseOptionRate('[标题|70%]')).toBe(70);
    expect(parseOptionRate('[标题|成功率70%]')).toBe(70);
  });

  it('数值 clamp [0,100]：150% → 100', () => {
    expect(parseOptionRate('[标题|150%]')).toBe(100);
  });

  it('非括号形态 → null', () => {
    expect(parseOptionRate('标题：70')).toBeNull();
  });
});

describe('parseOptionDice（v61 骰式标注）', () => {
  it('骰式 + 显式需求值', () => {
    expect(parseOptionDice('[攻击|2d6+3|70]')).toEqual({ formula: '2d6+3', rate: 70 });
  });

  it('骰式 + 档位兜底（模式感知：high 85 / low 15）', () => {
    expect(parseOptionDice('[攻击|2d6+3|大胆]')).toEqual({ formula: '2d6+3', rate: 85 });
    expect(parseOptionDice('[攻击|2d6+3|大胆]', true)).toEqual({ formula: '2d6+3', rate: 15 });
  });

  it('无骰式段 / 有骰式无难度代理 → null（回退既有解析）', () => {
    expect(parseOptionDice('[攻击|大胆]')).toBeNull();
    expect(parseOptionDice('[攻击|2d6+3]')).toBeNull();
  });
});

describe('parseOptionContent', () => {
  it('括号壳后全部为正文；冒号形态取分隔符后；无标记原样', () => {
    expect(parseOptionContent('[探索|大胆]轻轻推开门')).toBe('轻轻推开门');
    expect(parseOptionContent('动手：  关掉警报')).toBe('关掉警报');
    expect(parseOptionContent('直接行动')).toBe('直接行动');
  });
});

describe('gradeFallbackRate（档位兜底，模式感知对偶）', () => {
  it('high：35/60/85；low：65/40/15（两模式成功率一致）', () => {
    expect(gradeFallbackRate('conservative', false)).toBe(35);
    expect(gradeFallbackRate('balanced', false)).toBe(60);
    expect(gradeFallbackRate('bold', false)).toBe(85);
    expect(gradeFallbackRate('conservative', true)).toBe(65);
    expect(gradeFallbackRate('balanced', true)).toBe(40);
    expect(gradeFallbackRate('bold', true)).toBe(15);
  });
});
