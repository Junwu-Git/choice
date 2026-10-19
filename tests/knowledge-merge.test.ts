import { describe, expect, it } from 'vitest';
import { parseOptions } from '@/core/option-parse';
import {
  adaptPromptForMerge,
  buildMergedKnowledgeTask,
  isModuleDroppedByMerge,
  KNOWLEDGE_SYSTEM_PROMPT,
  needsMergeAdaptation,
  parseMergedKnowledge,
  stripMergedKnowledge,
} from '@/core/knowledge-task';

const OPTIONS_BLOCK =
  '<options>[{"title":"推门|平衡|55","content":"你抬手推开木门，铰链发出一声干涩的响。"},{"title":"后退|保守|20","content":"你退后半步，把重心压回脚跟上。"}]</options>';

describe('parseMergedKnowledge', () => {
  it('从 knowledge_patch 块内解析补丁', () => {
    const raw = [
      '<thinking>判定完成。</thinking>',
      '<knowledge_patch>{"base_revision":3,"entries":[{"topic":"城北仓库的货","status":"known","source":"witnessed","basis":"第 5 楼亲眼所见","impact":"可以直接提"}]}</knowledge_patch>',
      OPTIONS_BLOCK,
    ].join('\n');
    const parsed = parseMergedKnowledge(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.baseRevision).toBe(3);
    expect(parsed!.patches).toHaveLength(1);
    expect(parsed!.patches[0].topic).toBe('城北仓库的货');
  });

  it('空 entries 是合法结果（本轮无变化）', () => {
    const raw = '<knowledge_patch>{"base_revision":2,"entries":[]}</knowledge_patch>\n' + OPTIONS_BLOCK;
    const parsed = parseMergedKnowledge(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.patches).toEqual([]);
  });

  it('没有 knowledge_patch 标签时返回 null，不把选项 JSON 当知识条目', () => {
    const raw = `<thinking>略</thinking>\n${OPTIONS_BLOCK}`;
    expect(parseMergedKnowledge(raw)).toBeNull();
  });

  it('块内 JSON 不可解析时返回 null', () => {
    const raw = '<knowledge_patch>这里不是 JSON</knowledge_patch>\n' + OPTIONS_BLOCK;
    expect(parseMergedKnowledge(raw)).toBeNull();
  });

  it('标签未闭合（输出被截断）时仍能解析补丁', () => {
    const raw = '<knowledge_patch>{"base_revision":1,"entries":[{"topic":"旧信","status":"unknown","source":"none","basis":"未交代","impact":"不得引用"}]}';
    const parsed = parseMergedKnowledge(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.patches).toHaveLength(1);
  });

  it('未闭合时截到 options 之前，不吞掉候选文本', () => {
    const raw = '<knowledge_patch>{"base_revision":1,"entries":[]}\n' + OPTIONS_BLOCK;
    const parsed = parseMergedKnowledge(raw);
    expect(parsed).not.toBeNull();
    expect(parsed!.patches).toEqual([]);
  });
});

describe('stripMergedKnowledge', () => {
  it('剥离后 parseOptions 仍能解析候选', () => {
    const raw = [
      '<thinking>略</thinking>',
      '<knowledge_patch>{"base_revision":0,"entries":[{"topic":"真名","status":"unknown","source":"none","basis":"未交代","impact":"不得叫出"}]}</knowledge_patch>',
      OPTIONS_BLOCK,
    ].join('\n');
    const options = parseOptions(stripMergedKnowledge(raw), 4);
    expect(options).toHaveLength(2);
    expect(options[0]).toContain('推门');
  });

  it('补丁里的 JSON 数组不会被括号回退当伪选项', () => {
    // 去掉 <options> 标签：解析器会退回整段文本，此时补丁里的 [] 是唯一的方括号来源
    const raw =
      '<knowledge_patch>{"base_revision":0,"entries":[{"topic":"真名","status":"unknown","source":"none","basis":"未交代","impact":"不得叫出"}]}</knowledge_patch>';
    expect(parseOptions(stripMergedKnowledge(raw), 4)).toEqual([]);
  });

  it('未闭合补丁一直清到 options 之前', () => {
    const raw = '<knowledge_patch>{"base_revision":1,"entries":[]}\n' + OPTIONS_BLOCK;
    const stripped = stripMergedKnowledge(raw);
    expect(stripped).not.toContain('knowledge_patch');
    expect(stripped).toContain('<options>');
  });

  it('没有补丁时原样返回', () => {
    expect(stripMergedKnowledge(OPTIONS_BLOCK)).toBe(OPTIONS_BLOCK);
  });
});

describe('adaptPromptForMerge — 改写「只许两个标签」的口径', () => {
  it('system_prompt 的「只输出两个标签」', () => {
    const src = '只输出 <thinking> 与 <options> 两个标签内的内容，<options> 之外一个字都不写；发现自己开始写正文或扮演角色时立即停下，回到这两个标签。';
    const out = adaptPromptForMerge(src);
    expect(out).not.toContain('两个标签');
    expect(out).toContain('<knowledge_patch>');
    expect(out).not.toContain('回到这两个标签');
    expect(out).toContain('回到这些标签');
  });

  it('core_rules 的「只许出现两个标签」', () => {
    const src = '只许出现 <thinking> 与 <options> 两个标签，不输出 {{xxx}} 占位符、不造额外标签。';
    const out = adaptPromptForMerge(src);
    expect(out).not.toContain('两个标签');
    expect(out).toContain('<knowledge_patch>');
    // 其余约束不动
    expect(out).toContain('不造额外标签');
  });

  it('thinking_prompt 的「核对无误即进入 options」', () => {
    const src = '核对：恰好 4 条，格式与字数按系统消息的格式规则。核对无误即进入 <options>。';
    const out = adaptPromptForMerge(src);
    expect(out).toContain('先输出 <knowledge_patch>');
    expect(out).toContain('<options>');
  });

  it('assistant_thinking 整条丢弃，而不是改写后留下', () => {
    expect(isModuleDroppedByMerge('assistant_thinking')).toBe(true);
    // 其它模块不丢
    for (const id of ['thinking_prompt', 'core_rules', 'system_prompt', 'option_task']) {
      expect(isModuleDroppedByMerge(id)).toBe(false);
    }
  });

  it('改写不再需要处理 assistant_thinking 那句（整条已丢）', () => {
    const src = '输出必须以 <thinking> 标签开头；分析与自检完成后再输出 <options>。';
    // 该句不再出现在改写表里，故原样返回；真正生效的是整条丢弃
    expect(adaptPromptForMerge(src)).toBe(src);
  });

  it('压掉润色分支（合并只用于选项生成）', () => {
    const src = '你只做一件事——根据当前场景生成一组可供挑选的下一拍候选，或者把 {{user}} 的原始输入改写成几个更顺口的版本。本轮是哪一种，由后续消息指明。';
    const out = adaptPromptForMerge(src);
    expect(out).not.toContain('润色');
    expect(out).not.toContain('更顺口');
    expect(out).toContain('下一拍候选');
    expect(out).toContain('本轮是哪一种');
  });

  it('已合规或无关文本原样返回', () => {
    const clean = '只许出现 <thinking>、<knowledge_patch> 与 <options> 三个标签。';
    expect(adaptPromptForMerge(clean)).toBe(clean);
    const unrelated = '候选必须落在当前场景的具体细节上。';
    expect(adaptPromptForMerge(unrelated)).toBe(unrelated);
  });

  it('改写后不再残留任何「两个标签」表述', () => {
    // 三处已知写法的合集，模拟整份提示词跑一遍
    const all = [
      '只输出 <thinking> 与 <options> 两个标签内的内容；回到这两个标签。',
      '只许出现 <thinking> 与 <options> 两个标签。',
      '核对无误即进入 <options>。',
    ].join('\n');
    expect(adaptPromptForMerge(all)).not.toMatch(/两个标签/);
  });

  it('needsMergeAdaptation 只对含 thinking + options 的文本为真', () => {
    expect(needsMergeAdaptation('只许出现 <thinking> 与 <options> 两个标签')).toBe(true);
    expect(needsMergeAdaptation('普通规则文本')).toBe(false);
  });
});

describe('buildMergedKnowledgeTask', () => {
  it('含已有表与修订号', () => {
    const task = buildMergedKnowledgeTask({
      existingTable: '当前修订号=7；活跃条目 1 条\n- [id=kb_a] [未知] 真名',
      revision: 7,
    });
    expect(task).toContain('【已有边界表】');
    expect(task).toContain('当前修订号=7');
    expect(task).toContain('<knowledge_patch>');
    expect(task).toContain('<options>');
    // 修订号写进标签契约，模型据此回传 base_revision
    expect(task).toContain('"base_revision": 7');
  });

  it('首次分析（无表）不出现已有表', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).not.toContain('【已有边界表】');
    expect(task).toContain('首次分析');
    expect(task).toContain('"base_revision": 0');
  });

  it('不再引用楼层编号（上下文里没有楼层号，模型无从编造）', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).not.toContain('<recent_floors>');
    expect(task).not.toContain('evidence_floors');
  });

  it('提示词不出现宿主术语（模型不知道角色卡/世界书是什么）', () => {
    // 这些是宿主软件的概念，模型读到只会当成剧情里的东西或直接忽略；
    // 必须改写成模型能理解的「背景设定资料 / 背景 / 剧情」。
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    for (const term of ['角色卡', '世界书', '酒馆', '楼层']) {
      expect(task).not.toContain(term);
    }
  });

  it('独立分析的系统提示同样不含宿主术语', () => {
    for (const term of ['角色卡', '世界书', '酒馆', '楼层']) {
      expect(KNOWLEDGE_SYSTEM_PROMPT).not.toContain(term);
    }
  });

  it('event_time 默认留空，不暗示必须填', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).toContain('正文写了具体时间才填');
    expect(task).toContain('否则空串');
    // 明确排除「某日上午/下午」这类只有时段没有日期的伪时间
    expect(task).toContain('某日上午');
    // 不能给出具体日期范例——那会诱导模型硬凑一个时间
    expect(task).not.toMatch(/\d{4}\s*年\s*\d{1,2}\s*月/);
  });

  it('subject 要求角色正名与统一写法', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).toContain('subject');
    expect(task).toContain('角色用正名');
    expect(task).toContain('世界设定');
  });

  it('不复述整套判定规则，只补三态与字段（避免与 knowledge_boundary 模块重复）', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    // 生成侧已有的「已知不等于熟练 / 去主角化 / 逐条核查」不再抄一遍
    expect(task).not.toContain('去主角化');
    expect(task).not.toContain('已知不等于熟练');
    // 生成侧没有的信息必须保留：三态、source、字段
    expect(task).toContain('known');
    expect(task).toContain('witnessed');
    expect(task).toContain('"impact"');
  });

  it('写成一整段任务而非「附加任务」三段拼接', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).not.toContain('【附加任务');
    expect(task).toContain('【本轮的完整任务】');
    expect(task).toContain('不是两份作业');
  });

  it('声明分析先行的顺序与标签隔离', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).toContain('先更新 {{user}} 的知识边界');
    expect(task.indexOf('<knowledge_patch>')).toBeLessThan(task.indexOf('<options>'));
    expect(task).toContain('不得互相混入');
  });

  it('摘要块只用于核对出处，不得当作新增依据', () => {
    const task = buildMergedKnowledgeTask({ existingTable: '', revision: 0 });
    expect(task).toContain('<memory_summary>');
    expect(task).toContain('只用于核对既有条目的出处');
  });
});
