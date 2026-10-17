import { describe, expect, it } from 'vitest';
import { escapeStrayQuotes, repairOptionArrayJson, stripTrailingCloseTagFragment } from '@/core/option-json-repair';

describe('stripTrailingCloseTagFragment', () => {
  it('剥离完整的 </options> 闭合标签', () => {
    expect(stripTrailingCloseTagFragment('[{"a":1}]</options>')).toBe('[{"a":1}]');
    expect(stripTrailingCloseTagFragment('[{"a":1}]</options >  ')).toBe('[{"a":1}]');
  });

  it('剥离残缺闭合标签（少 > 号，实测样本形态）', () => {
    expect(stripTrailingCloseTagFragment('[{"a":1}]</options')).toBe('[{"a":1}]');
    expect(stripTrailingCloseTagFragment('[{"a":1}]</optio')).toBe('[{"a":1}]');
    expect(stripTrailingCloseTagFragment('[{"a":1}]</')).toBe('[{"a":1}]');
  });

  it('正文里的普通 < 不被误伤（残片不匹配标签前缀）', () => {
    expect(stripTrailingCloseTagFragment('[{"a":"a<b"}]')).toBe('[{"a":"a<b"}]');
    expect(stripTrailingCloseTagFragment('[{"a":"1<2"}]')).toBe('[{"a":"1<2"}]');
  });

  it('已闭合的标签残片不剥离（含 > 视为正文）', () => {
    const s = '[{"a":"</x>"}]';
    expect(stripTrailingCloseTagFragment(s)).toBe(s);
  });

  it('无标签文本原样返回', () => {
    expect(stripTrailingCloseTagFragment('[{"a":1}]')).toBe('[{"a":1}]');
  });
});

describe('escapeStrayQuotes', () => {
  it('转义正文里的裸引号（实测样本形态）', () => {
    const input = '[{"content":"他听见那句"数到三"，没有回头"}]';
    const out = escapeStrayQuotes(input);
    expect(JSON.parse(out)).toEqual([{ content: '他听见那句"数到三"，没有回头' }]);
  });

  it('结构位置的引号保持闭合语义', () => {
    const input = '{"title":"标题","content":"正文"}';
    expect(escapeStrayQuotes(input)).toBe(input);
    expect(JSON.parse(escapeStrayQuotes(input))).toEqual({ title: '标题', content: '正文' });
  });

  it('已转义的引号与转义反斜杠不重复处理', () => {
    const input = '{"content":"已转义\\"引号\\"与反斜杠\\\\"}';
    expect(escapeStrayQuotes(input)).toBe(input);
    expect(JSON.parse(escapeStrayQuotes(input))).toEqual({ content: '已转义"引号"与反斜杠\\' });
  });

  it('数组元素与右方括号前的引号按闭合处理', () => {
    const input = '["a","b"]';
    expect(escapeStrayQuotes(input)).toBe(input);
    expect(JSON.parse(escapeStrayQuotes(input))).toEqual(['a', 'b']);
  });

  it('正文引号紧贴 } 收尾时按正文处理（实测样本的末条形态）', () => {
    const input = '[{"content":"他听见那句"数到三"}]';
    expect(JSON.parse(escapeStrayQuotes(input))).toEqual([{ content: '他听见那句"数到三' }]);
  });
});

describe('repairOptionArrayJson', () => {
  it('成因一：正文裸引号 → 可解析', () => {
    const broken = '[{"title":"甲|保守|25","content":"他说"数到三"就停"}]';
    expect(() => JSON.parse(broken)).toThrow();
    const repaired = repairOptionArrayJson(broken);
    expect(JSON.parse(repaired)).toEqual([{ title: '甲|保守|25', content: '他说"数到三"就停' }]);
  });

  it('成因二：残缺闭合标签 → 可解析', () => {
    const broken = '[{"title":"甲|保守|25","content":"正文"}]</options';
    expect(() => JSON.parse(broken)).toThrow();
    const repaired = repairOptionArrayJson(broken);
    expect(JSON.parse(repaired)).toEqual([{ title: '甲|保守|25', content: '正文' }]);
  });

  it('两个成因叠加 → 可解析', () => {
    const broken = '[{"title":"甲","content":"他说"停"就停"}]</optio';
    const repaired = repairOptionArrayJson(broken);
    expect(JSON.parse(repaired)).toEqual([{ title: '甲', content: '他说"停"就停' }]);
  });

  it('正常 JSON 修复后保持等价（不破坏合法输入）', () => {
    const ok = '[{"title":"甲|平衡|55","content":"正文『引号』"}]\n';
    const repaired = repairOptionArrayJson(ok);
    expect(JSON.parse(repaired)).toEqual(JSON.parse(ok));
  });

  it('无可修复项时返回原文（调用方据此跳过重试）', () => {
    const s = '[{"title":"甲","content":"正文"}]';
    expect(repairOptionArrayJson(s)).toBe(s);
  });
});
