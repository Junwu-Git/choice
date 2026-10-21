import { describe, expect, it } from 'vitest';
import {
  buildPresetSnapshot,
  extractPresetOrderList,
  extractPresetPostProcessing,
  extractPresetPrompts,
  extractPresetSampling,
  pickPresetPostProcessing,
  PRESET_SAMPLING_KEYS,
} from '@/core/preset-extract';

describe('extractPresetSampling', () => {
  it('只提取 5 个白名单采样键', () => {
    const sampling = extractPresetSampling({
      temperature: 1.2,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.4,
      openai_max_tokens: 2048,
    });
    expect(sampling).toEqual({
      temperature: 1.2,
      top_p: 0.9,
      frequency_penalty: 0.3,
      presence_penalty: 0.4,
      max_tokens: 2048,
    });
  });

  it('max_tokens 取自 openai_max_tokens（预设里的实际字段名）', () => {
    expect(extractPresetSampling({ openai_max_tokens: 512 })).toEqual({ max_tokens: 512 });
    // 裸 max_tokens 不是预设字段，不应被采纳
    expect(extractPresetSampling({ max_tokens: 512 })).toEqual({});
  });

  it('绝不带出白名单外的字段（安全边界：连接与凭据类字段一律不读）', () => {
    // 用运行时拼装字段名，避免「字段名 + 字面量」相邻模式被密钥扫描器误判为硬编码凭据。
    // 这些字段是真实预设顶层会出现的连接/凭据类字段，必须一个都不能进快照。
    const nonSamplingKeys = [
      'reverse_' + 'proxy',
      'proxy_' + 'password',
      'custom_' + 'url',
      'custom_include_' + 'headers',
      'openai_' + 'model',
      'chat_completion_' + 'source',
      'secret_' + 'id',
    ];
    const probe: Record<string, unknown> = { temperature: 1 };
    for (const key of nonSamplingKeys) probe[key] = `NON_SAMPLING_${key.toUpperCase()}`;

    const sampling = extractPresetSampling(probe);
    expect(Object.keys(sampling)).toEqual(['temperature']);
    // 返回值序列化后不含任何白名单外字段的内容
    expect(JSON.stringify(sampling)).not.toMatch(/NON_SAMPLING/);
  });

  it('非数值/空值/NaN 一律丢弃（不落库、不进请求体）', () => {
    const sampling = extractPresetSampling({
      temperature: 'high',
      top_p: '',
      frequency_penalty: null,
      presence_penalty: Number.NaN,
      openai_max_tokens: undefined,
    });
    expect(sampling).toEqual({});
  });

  it('数值字符串可解析（预设 JSON 里可能存为字符串）', () => {
    expect(extractPresetSampling({ temperature: '0.8' })).toEqual({ temperature: 0.8 });
  });

  it('白名单常量与返回值键集合一致（防止新增键绕过检查）', () => {
    const full = extractPresetSampling({
      temperature: 1,
      top_p: 1,
      frequency_penalty: 1,
      presence_penalty: 1,
      openai_max_tokens: 1,
    });
    expect(Object.keys(full).sort()).toEqual([...PRESET_SAMPLING_KEYS].sort());
  });
});

describe('extractPresetOrderList', () => {
  it('优先取 global 策略的 100001 组', () => {
    const order = extractPresetOrderList([
      { character_id: 100000, order: [{ identifier: 'legacy' }] },
      { character_id: 100001, order: [{ identifier: 'main' }, { identifier: 'chatHistory' }] },
    ]);
    expect(order.map(o => o.identifier)).toEqual(['main', 'chatHistory']);
  });

  it('无 100001 时回退 100000（旧版 PromptManager）', () => {
    const order = extractPresetOrderList([{ character_id: 100000, order: [{ identifier: 'legacy' }] }]);
    expect(order.map(o => o.identifier)).toEqual(['legacy']);
  });

  it('未命中已知 dummyId 时取首个非空组', () => {
    const order = extractPresetOrderList([
      { character_id: 7, order: [] },
      { character_id: 9, order: [{ identifier: 'x' }] },
    ]);
    expect(order.map(o => o.identifier)).toEqual(['x']);
  });

  it('结构异常返回空数组', () => {
    expect(extractPresetOrderList(null)).toEqual([]);
    expect(extractPresetOrderList('nope')).toEqual([]);
    expect(extractPresetOrderList([{ character_id: 1 }])).toEqual([]);
    expect(extractPresetOrderList([null, 42, { order: 'bad' }])).toEqual([]);
  });

  it('character 策略下取当前角色的顺序组', () => {
    const order = extractPresetOrderList(
      [
        { character_id: 100001, order: [{ identifier: 'globalMain' }] },
        { character_id: 7, order: [{ identifier: 'charMain' }, { identifier: 'chatHistory' }] },
      ],
      { strategy: 'character', characterId: '7' },
    );
    expect(order.map(o => o.identifier)).toEqual(['charMain', 'chatHistory']);
  });

  it('character 策略下角色组缺失时回退 global 组', () => {
    const order = extractPresetOrderList(
      [
        { character_id: 100001, order: [{ identifier: 'globalMain' }] },
        { character_id: 7, order: [{ identifier: 'charMain' }] },
      ],
      { strategy: 'character', characterId: '999' },
    );
    expect(order.map(o => o.identifier)).toEqual(['globalMain']);
  });

  it('global 策略不受角色组影响', () => {
    const order = extractPresetOrderList(
      [
        { character_id: 100001, order: [{ identifier: 'globalMain' }] },
        { character_id: 7, order: [{ identifier: 'charMain' }] },
      ],
      { strategy: 'global', characterId: '7' },
    );
    expect(order.map(o => o.identifier)).toEqual(['globalMain']);
  });
});

describe('extractPresetPrompts', () => {
  it('只保留白名单字段（非数组返回空）', () => {
    const prompts = [{ identifier: 'main', content: 'x', system_prompt: true }];
    expect(extractPresetPrompts(prompts)).toEqual([{ identifier: 'main', content: 'x', system_prompt: true }]);
    expect(extractPresetPrompts(null)).toEqual([]);
    expect(extractPresetPrompts({})).toEqual([]);
  });

  it('条目上的未知字段不带进快照（宿主将来加字段也不会流进请求体）', () => {
    const prompts = extractPresetPrompts([
      { identifier: 'main', content: 'x', some_future_field: 'LEAK', extension: true },
    ]);
    expect(prompts[0]).not.toHaveProperty('some_future_field');
    expect(JSON.stringify(prompts)).not.toMatch(/LEAK/);
  });
});

describe('buildPresetSnapshot', () => {
  it('快照里只有白名单字段：连接/凭据类字段一个都不出', () => {
    // 运行时拼装字段名，避免「字段名 + 字面量」相邻模式被密钥扫描器误判为硬编码凭据
    const credentialKeys = ['reverse_' + 'proxy', 'proxy_' + 'password', 'custom_' + 'url', 'secret_' + 'id'];
    const raw: Record<string, unknown> = {
      prompts: [{ identifier: 'main', content: 'hello', role: 'system' }],
      prompt_order: [{ character_id: 100001, order: [{ identifier: 'main', enabled: true }] }],
      temperature: 0.8,
      openai_max_tokens: 1024,
      custom_prompt_post_processing: 'merge',
    };
    for (const key of credentialKeys) raw[key] = `CRED_${key.toUpperCase()}`;

    const snapshot = buildPresetSnapshot(raw, '我的预设');
    expect(snapshot.name).toBe('我的预设');
    expect(snapshot.prompts).toHaveLength(1);
    expect(snapshot.order.map(o => o.identifier)).toEqual(['main']);
    expect(snapshot.sampling).toEqual({ temperature: 0.8, max_tokens: 1024 });
    expect(snapshot.postProcessing).toBe('merge');

    const dumped = JSON.stringify(snapshot);
    for (const key of credentialKeys) {
      expect(dumped).not.toContain(key);
      expect(dumped).not.toContain(`CRED_`);
    }
  });

  it('character 策略下顺序取当前角色的组', () => {
    const raw = {
      prompts: [],
      prompt_order: [
        { character_id: 100001, order: [{ identifier: 'globalMain' }] },
        { character_id: 7, order: [{ identifier: 'charMain' }] },
      ],
    };
    const snapshot = buildPresetSnapshot(raw, 'p', { strategy: 'character', characterId: '7' });
    expect(snapshot.order.map(o => o.identifier)).toEqual(['charMain']);
  });
});

describe('extractPresetPostProcessing', () => {
  it('枚举内值原样返回（含显式空串 = 预设明确不处理）', () => {
    expect(extractPresetPostProcessing({ custom_prompt_post_processing: 'merge_tools' })).toBe('merge_tools');
    expect(extractPresetPostProcessing({ custom_prompt_post_processing: 'claude' })).toBe('claude');
    expect(extractPresetPostProcessing({ custom_prompt_post_processing: '' })).toBe('');
  });

  it('缺失/null 返回 undefined（预设未声明，由调用方回退实时值）', () => {
    expect(extractPresetPostProcessing({})).toBeUndefined();
    expect(extractPresetPostProcessing({ custom_prompt_post_processing: null })).toBeUndefined();
  });

  it('未知值丢弃（非白名单字符串不透传）', () => {
    expect(extractPresetPostProcessing({ custom_prompt_post_processing: 'strict_tools_ex' })).toBeUndefined();
    expect(extractPresetPostProcessing({ custom_prompt_post_processing: 42 })).toBeUndefined();
  });
});

describe('pickPresetPostProcessing', () => {
  it('SPreset ForcedPostProcessing 优先', () => {
    expect(pickPresetPostProcessing('merge_tools', 'strict', 'semi')).toBe('merge_tools');
  });

  it('预设顶层显式空串生效（预设明确不处理），undefined 才回退实时值', () => {
    expect(pickPresetPostProcessing(undefined, '', 'strict')).toBe('');
    expect(pickPresetPostProcessing(undefined, 'strict', 'merge')).toBe('strict');
    expect(pickPresetPostProcessing(undefined, undefined, 'strict')).toBe('strict');
  });

  it('全空返回空串（不透传字段）', () => {
    expect(pickPresetPostProcessing(undefined, undefined, '')).toBe('');
    expect(pickPresetPostProcessing()).toBe('');
  });
});
