import { describe, expect, it } from 'vitest';
import DEFAULT_JSON from '../choice-prompts-optimized.json';

type Mod = { id: string; content: string };
const mods = (DEFAULT_JSON as { modules: Mod[] }).modules;
const contentOf = (id: string) => mods.find(m => m.id === id)!.content;

/**
 * v82 主体锚点：v74~v81 的默认文案把 {{user}} 系统性换成中性词「主体」，却没说明
 * 「主体默认指谁」，模型于是自行用「他/她」开头指代 {{user}}。这里锁定修复后的不变式——
 * 三个关键模块必须重新出现 {{user}} 锚点，且新增的约束不能被后续改动悄悄删掉。
 */
describe('v82 主体锚点', () => {
  it('knowledge_boundary 定义主体默认是 {{user}}', () => {
    const c = contentOf('knowledge_boundary');
    expect(c).toContain('主体默认是 {{user}}');
    expect(c).toContain('只有本轮素材明确指向其他角色');
  });

  it('core_rules 要求首次指代写名字、不用代词开头', () => {
    const c = contentOf('core_rules');
    expect(c).toContain('不要用「他/她」开头');
    expect(c).toContain('首次指代用 {{user}} 的名字或省略主语的动词句');
  });

  it('thinking_prompt 自检含指代检查', () => {
    expect(contentOf('thinking_prompt')).toContain('有没有用「他/她」开头');
  });

  it('三个模块都保留 {{user}} 锚点', () => {
    for (const id of ['knowledge_boundary', 'core_rules', 'thinking_prompt']) {
      expect(contentOf(id)).toMatch(/\{\{user\}\}/);
    }
  });

  it('主体定义不改变既有判定口径（信息分层/禁止越界/去主角化仍在）', () => {
    const c = contentOf('knowledge_boundary');
    for (const key of ['信息分层', '禁止越界', '已知不等于熟练', '去主角化', '逐条核查']) {
      expect(c).toContain(key);
    }
  });
});
