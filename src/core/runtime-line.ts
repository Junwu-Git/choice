/**
 * 运行时追加行（骰式标注行、COC 教学行、合并知识任务）的落点规则（纯函数，可单测）。
 *
 *  为什么要单独抽：这条规则决定「模型最后读到的是什么」，一旦被改错，
 *  合并模式的输出契约（thinking → knowledge_patch → options）就会被后面的模块冲淡，
 *  而这种次序问题在生成结果里表现为「模型不听补丁」，很难从现象反推原因。
 *
 *  两条硬约束：
 *  1. 追加行必须排在提示词末尾——它是模型读到的最后一条指令；
 *  2. 绝不改写聊天历史里的 user 消息——option_task 被禁用/重排时，末条 user 可能是
 *     历史发言，追加进去等于把指令插进对话中间。
 */

import type { ChatMsg } from '@/core/api-client';

/**
 * 追加一行运行时指令。
 *
 * @param messages 消息数组（原地修改）
 * @param line 追加内容
 * @param taskUser 任务 user 消息锚点（option_task / 预设任务 user）；没有则视为「无任务」
 */
export function appendRuntimeLineTo(messages: ChatMsg[], line: string, taskUser: ChatMsg | null): void {
  if (messages.length === 0) return;
  const lastMsg = messages[messages.length - 1];
  // 末条正好是任务 user 消息 → 直接追加进去（任务排在最后的情形，如合并模式）
  if (lastMsg.role === 'user' && taskUser && lastMsg === taskUser) {
    lastMsg.content += `\n\n${line}`;
    return;
  }
  // 其余一律作为末尾 system 追加：默认模块末尾是 assistant_thinking（system），
  // 追加行因此仍是模型读到的最后一条指令
  messages.push({ role: 'system', content: line });
}
