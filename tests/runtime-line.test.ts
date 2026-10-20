import { describe, expect, it } from 'vitest';
import { appendRuntimeLineTo } from '@/core/runtime-line';
import type { ChatMsg } from '@/core/api-client';

describe('运行时追加行的落点', () => {
  it('默认形态：追加行排在提示词末尾（不被后置模块盖过）', () => {
    // 默认模块末尾是 assistant_thinking（system），追加行必须排在它之后：
    // 合并任务声明的输出契约是模型读到的最后一条指令
    const task: ChatMsg = { role: 'user', content: '【任务】生成候选' };
    const msgs: ChatMsg[] = [
      { role: 'system', content: '核心规则' },
      task,
      { role: 'system', content: '输出必须以 <thinking> 开头' },
    ];
    appendRuntimeLineTo(msgs, '【合并任务】先更新边界再生成', task);
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'system', 'system']);
    expect(msgs[3].content).toBe('【合并任务】先更新边界再生成');
    // 任务消息本身没被塞进指令
    expect(task.content).toBe('【任务】生成候选');
  });

  it('任务排在最后时追加进任务消息（合并模式：assistant_thinking 被丢弃）', () => {
    const task: ChatMsg = { role: 'user', content: '【任务】生成候选' };
    const msgs: ChatMsg[] = [{ role: 'system', content: '核心规则' }, task];
    appendRuntimeLineTo(msgs, '【合并任务】', task);
    expect(msgs).toHaveLength(2);
    expect(task.content).toBe('【任务】生成候选\n\n【合并任务】');
  });

  it('没有任务锚点时绝不改写聊天历史里的 user 消息', () => {
    // option_task 被禁用时末条 user 是历史发言，追加进去等于把指令插进对话中间
    const historyUser: ChatMsg = { role: 'user', content: '玩家说的话' };
    const msgs: ChatMsg[] = [historyUser, { role: 'assistant', content: '回复' }];
    appendRuntimeLineTo(msgs, '【骰式标注行】', null);
    expect(historyUser.content).toBe('玩家说的话');
    expect(msgs[msgs.length - 1].content).toBe('【骰式标注行】');
  });

  it('空消息数组不崩', () => {
    const msgs: ChatMsg[] = [];
    expect(() => appendRuntimeLineTo(msgs, 'x', null)).not.toThrow();
    expect(msgs).toHaveLength(0);
  });
});
