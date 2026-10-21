import { describe, expect, it } from 'vitest';
import {
  applyInChatInjections,
  buildPresetMessages,
  type PresetChatMsg,
  type PresetSlotContents,
} from '@/core/preset-messages';
import type { StPresetPrompt } from '@/core/st-preset-source';

const slots = (overrides: Partial<PresetSlotContents> = {}): PresetSlotContents => ({
  worldInfoBefore: '',
  worldInfoAfter: '',
  charDescription: '',
  charPersonality: '',
  scenario: '',
  personaDescription: '',
  dialogueExamples: '',
  chatHistory: [],
  ...overrides,
});

const history = (...texts: string[]): PresetChatMsg[] =>
  texts.map((text, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: text }));

const mkPrompt = (identifier: string, patch: Partial<StPresetPrompt> = {}): StPresetPrompt => ({
  identifier,
  role: 'system',
  content: '',
  ...patch,
});

describe('buildPresetMessages', () => {
  it('按 order 顺序展开普通提示词，跳过 enabled:false 与未在 order 中的条目', () => {
    const preset = {
      prompts: [
        mkPrompt('a', { content: 'AAA' }),
        mkPrompt('b', { content: 'BBB' }),
        mkPrompt('orphan', { content: 'ORPHAN' }),
      ],
      order: [
        { identifier: 'a', enabled: true },
        { identifier: 'b', enabled: false },
      ],
    };
    const out = buildPresetMessages(preset, slots());
    expect(out.map(m => m.content)).toEqual(['AAA']);
  });

  it('原生槽位由 slots 填充，chatHistory 展开为多条消息并保留角色', () => {
    const preset = {
      prompts: [mkPrompt('worldInfoBefore'), mkPrompt('chatHistory'), mkPrompt('charDescription')],
      order: [
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'charDescription', enabled: true },
      ],
    };
    const out = buildPresetMessages(
      preset,
      slots({
        worldInfoBefore: 'WI',
        charDescription: 'DESC',
        chatHistory: history('u1', 'a1'),
      }),
    );
    expect(out).toEqual([
      { role: 'system', content: 'WI' },
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'system', content: 'DESC' },
    ]);
  });

  it('空槽位不产生消息（不注入空 system）', () => {
    const preset = {
      prompts: [mkPrompt('worldInfoBefore'), mkPrompt('main', { content: 'MAIN' })],
      order: [
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'main', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots());
    expect(out).toEqual([{ role: 'system', content: 'MAIN' }]);
  });

  it('跳过 extension 条目与未命中 injection_trigger 的条目', () => {
    const preset = {
      prompts: [
        mkPrompt('ext', { content: 'EXT', extension: true }),
        mkPrompt('onlySwipe', { content: 'SWIPE', injection_trigger: ['swipe'] }),
        mkPrompt('keep', { content: 'KEEP', injection_trigger: ['normal'] }),
        mkPrompt('noTrigger', { content: 'ANY' }),
      ],
      order: [
        { identifier: 'ext', enabled: true },
        { identifier: 'onlySwipe', enabled: true },
        { identifier: 'keep', enabled: true },
        { identifier: 'noTrigger', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots(), { generationType: 'normal' });
    expect(out.map(m => m.content)).toEqual(['KEEP', 'ANY']);
  });

  it('经 substitute 处理内容；role 非法值归一为 system', () => {
    const preset = {
      prompts: [mkPrompt('x', { content: 'hi {{char}}', role: 'weird' })],
      order: [{ identifier: 'x', enabled: true }],
    };
    const out = buildPresetMessages(preset, slots(), { substitute: t => t.replace('{{char}}', 'Alice') });
    expect(out).toEqual([{ role: 'system', content: 'hi Alice' }]);
  });

  it('injection_position=1 的条目从主序列移出、插进历史内', () => {
    const preset = {
      prompts: [
        mkPrompt('chatHistory'),
        mkPrompt('deep', { content: 'DEEP', injection_position: 1, injection_depth: 0 }),
        mkPrompt('tail', { content: 'TAIL' }),
      ],
      order: [
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'deep', enabled: true },
        { identifier: 'tail', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots({ chatHistory: history('u1', 'a1') }));
    expect(out.map(m => m.content)).toEqual(['u1', 'a1', 'DEEP', 'TAIL']);
  });

  it('in-chat 注入作用于历史数组内部（depth 1 落在倒数第一条之前）', () => {
    const preset = {
      prompts: [
        mkPrompt('chatHistory'),
        mkPrompt('deep', { content: 'DEEP', injection_position: 1, injection_depth: 1 }),
      ],
      order: [
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'deep', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots({ chatHistory: history('u1', 'a1', 'u2', 'a2') }));
    expect(out.map(m => m.content)).toEqual(['u1', 'a1', 'u2', 'DEEP', 'a2']);
  });

  it('extraInjections（世界书深度条目）随预设的 in-chat 注入一同落位', () => {
    const preset = {
      prompts: [
        mkPrompt('chatHistory'),
        mkPrompt('deep', { content: 'PRESET', injection_position: 1, injection_depth: 0 }),
      ],
      order: [
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'deep', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots({ chatHistory: history('u1', 'a1') }), {
      extraInjections: [{ depth: 1, order: 100, role: 'system', content: 'WI_DEPTH' }],
    });
    expect(out.map(m => m.content)).toEqual(['u1', 'WI_DEPTH', 'a1', 'PRESET']);
  });

  it('预设无 chatHistory 槽位时 extraInjections 追加到末尾（不再静默丢弃）', () => {
    // 极简预设/新聊天下没有历史块可挂：深度注入（世界书 D0-D2、记忆摘要）整段丢弃
    // 会让这些内容凭空消失，故改为追加到主序列末尾
    const preset = { prompts: [mkPrompt('main', { content: 'MAIN' })], order: [{ identifier: 'main', enabled: true }] };
    const out = buildPresetMessages(preset, slots(), {
      extraInjections: [{ depth: 0, order: 100, role: 'system', content: 'WI_DEPTH' }],
    });
    expect(out.map(m => m.content)).toEqual(['MAIN', 'WI_DEPTH']);
  });

  it('历史块为空时深度注入平铺到槽位处（不再整段丢弃）', () => {
    const preset = {
      prompts: [mkPrompt('chatHistory')],
      order: [{ identifier: 'chatHistory', enabled: true }],
    };
    const out = buildPresetMessages(preset, slots({ chatHistory: [] }), {
      extraInjections: [{ depth: 0, order: 100, role: 'system', content: 'WI_DEPTH' }],
    });
    expect(out.map(m => m.content)).toEqual(['WI_DEPTH']);
  });
});

describe('applyInChatInjections', () => {
  const inj = (
    depth: number,
    content: string,
    patch: Partial<{ order: number; role: PresetChatMsg['role'] }> = {},
  ) => ({
    depth,
    order: patch.order ?? 100,
    role: patch.role ?? ('system' as const),
    content,
  });

  it('depth 0 插在历史块末尾（贴近生成点）', () => {
    const messages = history('u1', 'a1', 'u2', 'a2');
    applyInChatInjections(messages, [inj(0, 'D0')]);
    expect(messages.map(m => m.content)).toEqual(['u1', 'a1', 'u2', 'a2', 'D0']);
  });

  it('depth 1 插在倒数第一条之前', () => {
    const messages = history('u1', 'a1', 'u2', 'a2');
    applyInChatInjections(messages, [inj(1, 'D1')]);
    expect(messages.map(m => m.content)).toEqual(['u1', 'a1', 'u2', 'D1', 'a2']);
  });

  it('多深度并存时位置互不漂移', () => {
    const messages = history('u1', 'a1', 'u2', 'a2');
    applyInChatInjections(messages, [inj(0, 'D0'), inj(1, 'D1'), inj(2, 'D2')]);
    expect(messages.map(m => m.content)).toEqual(['u1', 'a1', 'D2', 'u2', 'D1', 'a2', 'D0']);
  });

  it('depth ≥ 历史长度时落在历史块最前，越深越靠前', () => {
    const messages = history('u1', 'a1');
    applyInChatInjections(messages, [inj(5, 'DEEP'), inj(2, 'MID')]);
    expect(messages.map(m => m.content)).toEqual(['DEEP', 'MID', 'u1', 'a1']);
  });

  it('同 depth 不同 order 为两条消息，order 大者在前', () => {
    const messages = history('u1', 'a1');
    applyInChatInjections(messages, [inj(0, 'LOW', { order: 50 }), inj(0, 'HIGH', { order: 200 })]);
    expect(messages.map(m => m.content)).toEqual(['u1', 'a1', 'HIGH', 'LOW']);
  });

  it('同 depth 同 order 同 role 以换行合并成一条', () => {
    const messages = history('u1', 'a1');
    applyInChatInjections(messages, [inj(0, 'A'), inj(0, 'B')]);
    expect(messages.map(m => m.content)).toEqual(['u1', 'a1', 'A\nB']);
  });

  it('同 depth 内按 system→user→assistant 排角色', () => {
    const messages = history('u1', 'a1');
    applyInChatInjections(messages, [inj(0, 'A', { role: 'assistant' }), inj(0, 'S'), inj(0, 'U', { role: 'user' })]);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'system', 'user', 'assistant']);
  });

  it('空历史或空注入时不改动', () => {
    const empty: PresetChatMsg[] = [];
    applyInChatInjections(empty, [inj(0, 'D0')]);
    expect(empty).toEqual([]);

    const messages = history('u1');
    applyInChatInjections(messages, []);
    expect(messages.map(m => m.content)).toEqual(['u1']);
  });
});

describe('buildPresetMessages — 插件侧条目覆盖层（不改酒馆预设文件）', () => {
  it('disabled 条目整条跳过', () => {
    const preset = {
      prompts: [mkPrompt('a', { content: 'AAA' }), mkPrompt('b', { content: 'BBB' })],
      order: [
        { identifier: 'a', enabled: true },
        { identifier: 'b', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots(), {
      overrides: { b: { disabled: true } },
    });
    expect(out.map(m => m.content)).toEqual(['AAA']);
  });

  it('enabled 覆盖可强制开启酒馆已停用的条目（只影响本扩展）', () => {
    const preset = {
      prompts: [mkPrompt('a', { content: 'AAA' }), mkPrompt('b', { content: 'BBB' })],
      order: [
        { identifier: 'a', enabled: true },
        { identifier: 'b', enabled: false },
      ],
    };
    // 无覆盖：酒馆停用的 b 不参与
    expect(buildPresetMessages(preset, slots()).map(m => m.content)).toEqual(['AAA']);
    // 强制开启：b 参与
    const forced = buildPresetMessages(preset, slots(), { overrides: { b: { enabled: true } } });
    expect(forced.map(m => m.content)).toEqual(['AAA', 'BBB']);
  });

  it('disabled 优先于 enabled（同一覆盖内互斥时以禁用为准）', () => {
    const preset = {
      prompts: [mkPrompt('a', { content: 'AAA' })],
      order: [{ identifier: 'a', enabled: true }],
    };
    const out = buildPresetMessages(preset, slots(), { overrides: { a: { disabled: true, enabled: true } } });
    expect(out).toEqual([]);
  });

  it('in-chat 注入条目同样支持强制开启', () => {
    const prompt = mkPrompt('injectA', { content: '注入内容', injection_position: 1, injection_depth: 1 });
    const preset = {
      prompts: [prompt, mkPrompt('chatHistory')],
      order: [
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'injectA', enabled: false },
      ],
    };
    const out = buildPresetMessages(preset, slots({ chatHistory: history('u1', 'a1') }), {
      overrides: { injectA: { enabled: true } },
    });
    expect(out.map(m => m.content)).toContain('注入内容');
  });

  it('content 覆盖替换条目原文（先替换后宏替换）', () => {
    const preset = {
      prompts: [mkPrompt('a', { content: '原文 {{char}} 行为' })],
      order: [{ identifier: 'a', enabled: true }],
    };
    const out = buildPresetMessages(preset, slots(), {
      overrides: { a: { content: '覆盖 {{char}} 版本' } },
      substitute: t => t.replaceAll('{{char}}', '角色名'),
    });
    expect(out.map(m => m.content)).toEqual(['覆盖 角色名 版本']);
  });

  it('空串覆盖 = 明确清空该条目（区别于无覆盖记录）', () => {
    const preset = {
      prompts: [mkPrompt('a', { content: 'AAA' })],
      order: [{ identifier: 'a', enabled: true }],
    };
    const out = buildPresetMessages(preset, slots(), { overrides: { a: { content: '' } } });
    expect(out).toEqual([]);
  });

  it('marker 槽位不受覆盖层影响（运行时填充，禁用/替换均无效）', () => {
    const preset = {
      prompts: [mkPrompt('chatHistory'), mkPrompt('worldInfoBefore')],
      order: [
        { identifier: 'worldInfoBefore', enabled: true },
        { identifier: 'chatHistory', enabled: true },
      ],
    };
    const out = buildPresetMessages(preset, slots({ worldInfoBefore: 'WI', chatHistory: history('u1') }), {
      overrides: { worldInfoBefore: { disabled: true }, chatHistory: { content: '不应出现' } },
    });
    expect(out.map(m => m.content)).toEqual(['WI', 'u1']);
  });

  it('in-chat 深度注入条目同样支持禁用与内容覆盖', () => {
    const prompt = mkPrompt('injectA', { content: '原始注入', injection_position: 1, injection_depth: 1 });
    const preset = {
      prompts: [prompt, mkPrompt('chatHistory')],
      order: [
        { identifier: 'chatHistory', enabled: true },
        { identifier: 'injectA', enabled: true },
      ],
    };
    const disabled = buildPresetMessages(preset, slots({ chatHistory: history('u1', 'a1') }), {
      overrides: { injectA: { disabled: true } },
    });
    expect(disabled.map(m => m.content)).toEqual(['u1', 'a1']);

    const replaced = buildPresetMessages(preset, slots({ chatHistory: history('u1', 'a1') }), {
      overrides: { injectA: { content: '替换后的注入' } },
    });
    expect(replaced.map(m => m.content)).toEqual(['u1', '替换后的注入', 'a1']);
  });

  it('disabled 与 content 并存时禁用优先', () => {
    const preset = {
      prompts: [mkPrompt('a', { content: 'AAA' })],
      order: [{ identifier: 'a', enabled: true }],
    };
    const out = buildPresetMessages(preset, slots(), {
      overrides: { a: { disabled: true, content: '覆盖' } },
    });
    expect(out).toEqual([]);
  });
});
