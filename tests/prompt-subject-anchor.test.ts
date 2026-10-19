import { describe, expect, it } from 'vitest';
import DEFAULT_JSON from '../choice-prompts-optimized.json';

type Mod = { id: string; content: string };
const mods = (DEFAULT_JSON as { modules: Mod[] }).modules;
const contentOf = (id: string) => mods.find(m => m.id === id)!.content;

/**
 * v82 主体锚点 + v84 首次指代收紧：v74~v81 的默认文案把 {{user}} 系统性换成中性词
 * 「主体」，却没说明「主体默认指谁」，模型于是自行用「他/她」开头指代 {{user}}。
 * v82 补回锚点后，模型又把「不要用他/她开头」理解成只看句首——先写物件/环境分句、
 * 再用「他/她」指代。v84 把规则改成「第一次指向 {{user}} 的主语/宾语必须写名字」，
 * 这里锁定三个关键模块的不变式。
 */
describe('主体锚点与首次指代', () => {
  it('knowledge_boundary 定义主体默认是 {{user}}', () => {
    const c = contentOf('knowledge_boundary');
    expect(c).toContain('主体默认是 {{user}}');
    expect(c).toContain('只有本轮素材明确指向其他角色');
  });

  it('core_rules 要求第一次出现指代时写名字，但不强制每条都以名字开头', () => {
    const c = contentOf('core_rules');
    expect(c).toContain('第一次出现主语/宾语指代');
    expect(c).toContain('第三人称写 {{user}} 的名字');
    expect(c).toContain('能省略主语就省略');
    expect(c).toContain('不要先用物件/环境分句起头');
    expect(c).toContain('这不是要求每条都以名字开头');
    // 错误示范必须保留，模型才能识别「物件分句 + 他」这种绕过写法
    expect(c).toContain('手机被按熄收回裤兜，他站在原地没动');
  });

  it('thinking_prompt 自检同时检查「代词指代」与「整批都用名字开头」', () => {
    const c = contentOf('thinking_prompt');
    expect(c).toContain('第一次出现主语/宾语指代');
    expect(c).toContain('先用物件/环境分句起头');
    expect(c).toContain('整批都用名字开头');
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
