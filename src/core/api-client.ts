import type { SecondaryApi } from '@/type/settings';

/** 与酒馆 generate 端点对接的消息格式：system/user/assistant 三态分离。
 *  不拼成单段字符串塞进单条消息，遵循"提示词组装走角色结构"的架构约束。 */
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

const GENERATE_URL = '/api/backends/chat-completions/generate';

/** 统一副 API 调用入口：行动选项生成与条目池生成共用。
 *  直接 fetch 酒馆 generate 端点，绕开 TavernHelper 预设注入，
 *  保证传入的 messages 即最终入参（exclude_params 在此删除指定字段）。 */
export async function callSecondaryApi(messages: ChatMsg[], api: SecondaryApi, signal?: AbortSignal): Promise<string> {
  const body: Record<string, unknown> = {
    chat_completion_source: 'openai',
    reverse_proxy: api.apiurl,
    proxy_password: api.key || '',
    model: api.model,
    messages,
    temperature: api.temperature,
    max_tokens: api.max_tokens,
    stream: api.stream,
  };

  if (api.exclude_params) {
    for (const key of api.exclude_params
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)) {
      delete body[key];
    }
  }

  const ctx = window.SillyTavern?.getContext?.();
  const resp = await fetch(GENERATE_URL, {
    method: 'POST',
    headers: ctx?.getRequestHeaders?.() ?? {},
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`API 请求失败 (${resp.status}): ${text.slice(0, 300)}`);
  }

  if (api.stream && resp.body) {
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content ?? '';
          full += delta;
        } catch {
          /* 忽略解析失败的行 */
        }
      }
    }
    return full;
  }

  const data = await resp.json();
  if (data?.error) throw new Error(data.error.message || 'API 返回错误');
  return data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
}
