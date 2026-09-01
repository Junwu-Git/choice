import toastr from 'toastr';
import type { SecondaryApi } from '@/type/settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

/** 与酒馆 generate 端点对接的消息格式：system/user/assistant 三态分离。
 *  不拼成单段字符串塞进单条消息，遵循"提示词组装走角色结构"的架构约束。 */
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

const GENERATE_URL = '/api/backends/chat-completions/generate';

/** 规范化 OpenAI 兼容 API 地址：缺少 /v1 后缀时自动补全。
 *  已有版本路径（/v1, /v2...）或端点路径（/chat/completions...）时跳过。 */
export function normalizeApiUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  const clean = trimmed.replace(/\/+$/, '');
  if (/\/v\d+$/i.test(clean) || /\/chat\/completions$/i.test(clean)) {
    return clean;
  }
  return clean + '/v1';
}

/** 统一副 API 调用入口：行动选项生成与条目池生成共用。
 *  直接 fetch 酒馆 generate 端点，绕开 TavernHelper 事件层的预设注入
 *  （预设脚本经 CHAT_COMPLETION_PROMPT_READY 改写提示词的路径），
 *  保证传入的 messages 即最终入参（exclude_params 在此删除指定字段）。
 *
 *  但事件层绕不开 fetch 层：酒馆助手预设脚本（如 Aether 防截断）会从 iframe patch
 *  主窗口 window.fetch，拦截一切 backends generate 端点请求并改写请求体（注入
 *  工具调用指令）。tool_choice:"none" 是这类脚本 callerControlsTools 的设计内绕过
 *  信号（"tools-disabled-by-caller" → bypass 原样转发），语义上也正确——本扩展只要
 *  纯文本不要工具调用。ST 后端仅在 tools 非空数组时才转发 tool_choice
 *  （chat-completions.js:1481 等），本请求无 tools，该字段到不了上游，对未启用此类
 *  脚本的场景完全惰性。是否附带由全局开关 api_tool_choice_none 控制（默认开）。
 *  复查锚点：若脚本改掉该契约（fetch wrapper 标记 __keminiAntiTruncation__、函数
 *  callerControlsTools），从这段注释重新核实。 */
export async function callSecondaryApi(messages: ChatMsg[], api: SecondaryApi, signal?: AbortSignal): Promise<string> {
  const body: Record<string, unknown> = {
    chat_completion_source: 'openai',
    reverse_proxy: normalizeApiUrl(api.apiurl),
    proxy_password: api.key || '',
    model: api.model,
    messages,
    temperature: api.temperature,
    max_tokens: api.max_tokens,
    stream: api.stream,
  };

  // 防 fetch 层预设脚本改写：tool_choice:"none" 触发其 bypass 契约，机制见函数头注释。
  // 放在 exclude_params 之前，用户仍可用 exclude_params 强制移除该字段。
  if (useGlobalSettingsStore().settings.api_tool_choice_none) {
    body.tool_choice = 'none';
  }

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
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      // 最后一行可能不完整（跨 chunk 边界），保留到下次再拼接
      buffer = lines.pop() || '';
      for (const line of lines) {
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

/** 判断 API 调用错误是否可重试：网络错误（TypeError）和 5xx 服务端错误可重试；
 *  4xx 客户端错误、AbortError、API 级错误（data.error）不重试。 */
export function isRetryableError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return false;
  if (e instanceof TypeError) return true;
  if (e instanceof Error) {
    const m = e.message.match(/^API 请求失败 \((\d{3})\)/);
    if (m) {
      const status = parseInt(m[1], 10);
      return status >= 500;
    }
  }
  return false;
}

/** 带重试的副 API 调用入口：根据 retryCount 自动重试可恢复错误。
 *  每次尝试独立 AbortController + 超时，外部取消信号联动所有尝试。
 *  重试间隔固定 1 秒，失败时通过 toastr 提示进度。 */
export async function callSecondaryApiWithRetry(
  messages: ChatMsg[],
  api: SecondaryApi,
  retryCount: number,
  externalSignal?: AbortSignal,
): Promise<string> {
  const maxAttempts = retryCount + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const attemptController = new AbortController();

    const onExternalAbort = () => attemptController.abort();
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (api.timeout > 0) {
      timeoutId = setTimeout(() => attemptController.abort(), api.timeout * 1000);
    }

    try {
      const result = await callSecondaryApi(messages, api, attemptController.signal);
      return result;
    } catch (e) {
      lastError = e;

      if (externalSignal?.aborted) throw e;
      if (!isRetryableError(e)) throw e;

      if (attempt < maxAttempts - 1) {
        toastr.info(`正在重试 (${attempt + 1}/${retryCount})...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError;
}
