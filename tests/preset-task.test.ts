import { describe, expect, it } from 'vitest';
import { renderBaiBaiSummaryContent, renderPresetTask, type PresetTaskCtx } from '@/core/preset-task';

const ctx: PresetTaskCtx = {
  count: 4,
  pinned: '固定条目A',
  poolSelected: '候选条目B',
  input: '用户原始输入',
  minChars: 10,
  maxChars: 40,
  optionPerson: '第三人称',
  enrichPerson: '第一人称',
};

describe('renderPresetTask — option', () => {
  const task = renderPresetTask('option', ctx);

  it('返回 system + user 两条', () => {
    expect(Object.keys(task).sort()).toEqual(['system', 'user']);
    expect(task.system.trim()).toBeTruthy();
    expect(task.user.trim()).toBeTruthy();
  });

  it('输出契约自包含：<options> JSON 格式与 thinking 标签都在 system 里', () => {
    expect(task.system).toContain('<options>');
    expect(task.system).toContain('JSON');
    expect(task.system).toContain('<thinking>');
    expect(task.system).toContain('"title"');
    expect(task.system).toContain('"content"');
  });

  it('占位符被替换（count/素材/字数/人称）', () => {
    expect(task.user).toContain('恰好 4 条');
    expect(task.user).toContain('固定条目A');
    expect(task.user).toContain('候选条目B');
    expect(task.system).not.toContain('{{count}}');
    expect(task.system).toContain('第三人称');
    expect(task.user).toContain('10-40 字');
  });

  it('防全知与难度标注内置于指令（不依赖用户模块）', () => {
    expect(task.system).toContain('因怀疑/听说而行动');
    expect(task.system).toContain('档位');
    expect(task.system).toContain('需求值');
  });

  it('声明不续写正文（压制预设定位冲突）', () => {
    expect(task.system).toContain('不续写正文');
  });

  it('user 不含润色专属内容', () => {
    expect(task.user).not.toContain('润色');
    expect(task.user).not.toContain('{{input}}');
  });
});

describe('renderPresetTask — enrich', () => {
  const task = renderPresetTask('enrich', ctx);

  it('润色任务包含用户输入与 "[标题]内容" 格式', () => {
    expect(task.user).toContain('用户原始输入');
    expect(task.system).toContain('[标题]内容');
    expect(task.system).toContain('<options>');
  });

  it('占位符按润色口径替换（人称/字数/数量）', () => {
    expect(task.system).toContain('第一人称');
    expect(task.system).not.toContain('{{enrich_person}}');
    expect(task.system).toContain('10-40 个中文字符');
    expect(task.user).toContain('4 个版本');
  });

  it('不包含条目池素材（润色无素材）', () => {
    expect(task.user).not.toContain('固定条目A');
    expect(task.user).not.toContain('候选条目B');
  });
});

describe('renderPresetTask — 解耦不变量', () => {
  it('指令内容为固定模板：相同 ctx 渲染结果幂等（无随机/时间因子）', () => {
    expect(renderPresetTask('option', ctx)).toEqual(renderPresetTask('option', ctx));
  });

  it('不含任何对用户模块系统的引用（彻底解耦的证据）', () => {
    const both = JSON.stringify([renderPresetTask('option', ctx), renderPresetTask('enrich', ctx)]);
    expect(both).not.toContain('模块');
    expect(both).not.toContain('{{pool_selected}}');
    expect(both).not.toContain('{{pinned}}');
  });

  it('空素材以空串填充而非占位符残留（{{user}} 除外——那是酒馆宏，运行时由 substituteParams 展开）', () => {
    const empty = renderPresetTask('option', { ...ctx, pinned: '', poolSelected: '' });
    // 剥掉酒馆宏占位后不应再有任何插件占位符残留
    const withoutStMacros = empty.user.replaceAll('{{user}}', '').replaceAll('{{char}}', '');
    expect(withoutStMacros).not.toContain('{{');
  });
});

describe('renderBaiBaiSummaryContent — 柏宝书包装（扩展/预设模式共用）', () => {
  it('包装出 <baibai_summary> 标签并原样携带摘要文本', () => {
    const out = renderBaiBaiSummaryContent('第一层剧情摘要。\n第二层。');
    expect(out).toContain('<baibai_summary>');
    expect(out).toContain('</baibai_summary>');
    expect(out).toContain('第一层剧情摘要。\n第二层。');
  });

  it('包装文案为纯背景说明：不含任务占位符（不经 fill 渲染）', () => {
    expect(renderBaiBaiSummaryContent('x')).not.toContain('{{count}}');
  });
});
