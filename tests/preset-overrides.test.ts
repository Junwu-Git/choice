import { describe, expect, it } from 'vitest';
import type { PresetOverrideMap } from '@/core/preset-overrides';
import {
  clearPresetContentOverride,
  getPresetOverride,
  hasLegacyPresetOverride,
  presetOverrideKey,
  togglePresetOverrideFlag,
  writePresetContentOverride,
  writePresetOverride,
} from '@/core/preset-overrides';

describe('预设覆盖层按预设名隔离', () => {
  it('键形如「预设名::条目标识符」', () => {
    expect(presetOverrideKey('夜间病院', 'main')).toBe('夜间病院::main');
  });

  it('同名条目在不同预设下互不影响', () => {
    const overrides = writePresetOverride({}, 'A', 'main', { disabled: true });
    writePresetOverride(overrides, 'B', 'main', { content: 'B 的正文' });
    expect(getPresetOverride(overrides, 'A', 'main')).toEqual({ disabled: true });
    expect(getPresetOverride(overrides, 'B', 'main')).toEqual({ content: 'B 的正文' });
  });

  it('旧版全局键仍作回退（老配置不失效）', () => {
    const overrides: PresetOverrideMap = { main: { disabled: true } };
    expect(getPresetOverride(overrides, '任意预设', 'main')).toEqual({ disabled: true });
  });

  it('带预设名的键优先于旧版全局键', () => {
    const overrides = { main: { disabled: true }, 'A::main': { content: 'A 的正文' } };
    expect(getPresetOverride(overrides, 'A', 'main')).toEqual({ content: 'A 的正文' });
    expect(getPresetOverride(overrides, 'B', 'main')).toEqual({ disabled: true });
  });

  it('空的 scoped 记录不算覆盖（否则会遮住旧全局键）', () => {
    const overrides = { main: { disabled: true }, 'A::main': {} };
    expect(getPresetOverride(overrides, 'A', 'main')).toEqual({ disabled: true });
  });

  it('写入用带预设名的键，不动旧键', () => {
    const overrides = writePresetOverride({ main: { disabled: true } }, 'A', 'main', { content: 'x' });
    expect(overrides.main).toEqual({ disabled: true });
    expect(overrides['A::main']).toEqual({ content: 'x' });
  });

  it('写空值时删除该键', () => {
    const overrides = writePresetOverride({ 'A::main': { content: 'x' } }, 'A', 'main', undefined);
    expect(overrides['A::main']).toBeUndefined();
  });

  it('旧版全局键的存在可单独查询（UI 徽标用）', () => {
    expect(hasLegacyPresetOverride({ main: { disabled: true } }, 'main')).toBe(true);
    expect(hasLegacyPresetOverride({ 'A::main': { content: 'x' } }, 'main')).toBe(false);
  });
});

describe('覆盖层的写入语义', () => {
  it('翻开关只写 scoped 键，旧全局键不动（它对其它预设仍然生效）', () => {
    const overrides: PresetOverrideMap = { main: { content: '全局正文' } };
    togglePresetOverrideFlag(overrides, 'A', 'main', 'disabled');
    expect(overrides['A::main']).toEqual({ content: '全局正文', disabled: true });
    // 旧全局键必须还在：清掉会让其它预设的覆盖静默失效
    expect(overrides.main).toEqual({ content: '全局正文' });
  });

  it('关掉开关时若没有别的覆盖，scoped 键被删除', () => {
    const overrides: PresetOverrideMap = { 'A::main': { disabled: true } };
    togglePresetOverrideFlag(overrides, 'A', 'main', 'disabled');
    expect(overrides['A::main']).toBeUndefined();
  });

  it('写内容覆盖落在 scoped 键', () => {
    const overrides: PresetOverrideMap = { main: { disabled: true } };
    writePresetContentOverride(overrides, 'A', 'main', 'A 的正文');
    expect(overrides['A::main']).toEqual({ disabled: true, content: 'A 的正文' });
    expect(overrides.main).toEqual({ disabled: true });
  });

  it('恢复原样：scoped 内容与旧全局键一起清', () => {
    const overrides: PresetOverrideMap = {
      main: { content: '全局正文' },
      'A::main': { content: 'A 的正文', disabled: true },
    };
    clearPresetContentOverride(overrides, 'A', 'main');
    expect(overrides.main).toBeUndefined();
    // scoped 键保留与内容无关的字段（禁用状态是用户另一次操作的结果）
    expect(overrides['A::main']).toEqual({ disabled: true });
  });

  it('恢复原样时不会把旧全局键的其它字段物化进 scoped 键', () => {
    const overrides: PresetOverrideMap = { main: { content: '全局正文', disabled: true } };
    clearPresetContentOverride(overrides, 'A', 'main');
    expect(overrides.main).toBeUndefined();
    expect(overrides['A::main']).toBeUndefined();
  });
});
