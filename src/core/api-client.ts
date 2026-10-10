import toastr from 'toastr';
import type { SecondaryApi } from '@/type/settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

/** 按 active_api_id 解析启用的副 API（cards-ai 等仅需一次解析的模块经此取；generator 也用它）。
 *  放在 api-client（统一副 AI 请求装配入口）避免 cards-ai → generator → cards 的依赖环。 */
export const resolveCustomApi = (id: string, apis: SecondaryApi[]): SecondaryApi | undefined =>
  id ? apis.find(a => a.id === id) : undefined;

/** 与酒馆 generate 端点对接的消息格式：system/user/assistant 三态分离。
 *  不拼成单段字符串塞进单条消息，遵循"提示词组装走角色结构"的架构约束。 */
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

const GENERATE_URL = '/api/backends/chat-completions/generate';

/** 规范化 OpenAI 兼容 API 地址，交给酒馆后端作为 base，酒馆后端总会再拼一次 /chat/completions。
 *  规则（对既有配置向后兼容）：
 *  1) 去尾部斜杠；
 *  2) 剥尾部 /chat/completions（不区分大小写）——用户填完整端点时剥掉，防止酒馆二次拼接造成双拼；
 *  3) 已有路径段（scheme://host/xxx，含 /v2、/v1beta/openai、/api/paas/v4 等）则尊重所填、不补版本；
 *  4) 仅裸域名/host（无路径段，如 https://api.deepseek.com）补 OpenAI 默认 /v1。 */
export function normalizeApiUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return trimmed;
  let clean = trimmed.replace(/\/+$/, '');
  // 酒馆后端总会再拼一次 /chat/completions：用户填完整端点时剥掉，避免双拼
  clean = clean.replace(/\/chat\/completions$/i, '').replace(/\/+$/, '');
  // 已含路径段（scheme://host/xxx）则尊重之；仅裸域名/host 补 OpenAI 默认 /v1
  const hasPath = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.+)$/i.test(clean);
  return hasPath ? clean : `${clean}/v1`;
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
async function callSecondaryApi(messages: ChatMsg[], api: SecondaryApi, signal?: AbortSignal): Promise<string> {
  // 空 apiurl 会以 reverse_proxy:'' 静默落到酒馆主 OpenAI 配置（主 key/额度被副功能消耗、
  // 报错无指向）——入口拦截，与 ApiEditor 保存校验双保险
  if (!api.apiurl.trim()) throw new Error('副 API 地址为空，请先在 API 设置中填写 API 地址');
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
    // SSE 行消费：`data:` 兼容带空格与无空格两种前缀变体（部分代理不发空格）；
    // JSON.parse 失败的行静默忽略，json.error 作为 API 错误向上抛（走重试判定）
    const consumeLine = (line: string): void => {
      const m = line.match(/^data:\s?(.*)$/);
      if (!m) return;
      const data = m[1].trim();
      if (!data || data === '[DONE]') return;
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        return;
      }
      if (json?.error) throw new Error(json.error.message || 'API 流式返回错误');
      full += json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      buffer += chunk;
      const lines = buffer.split('\n');
      // 最后一行可能不完整（跨 chunk 边界），保留到下次再拼接
      buffer = lines.pop() || '';
      for (const line of lines) consumeLine(line);
    }
    // 残余 buffer：无尾换行的最后一行（部分代理不发送结束换行），不消费会丢最后一段正文
    if (buffer) consumeLine(buffer);
    return full;
  }

  let data: any;
  try {
    data = await resp.json();
  } catch {
    throw new Error('API 返回非 JSON 响应（请检查 API 地址是否指向 OpenAI 兼容接口）');
  }
  if (data?.error) throw new Error(data.error.message || 'API 返回错误');
  return data?.choices?.[0]?.message?.content ?? data?.choices?.[0]?.text ?? '';
}

/** 判断 API 调用错误是否可重试：网络错误（TypeError）、5xx 服务端错误与 429 限速可重试
 *  （429 是副 API 最典型的瞬态错误；Retry-After 语义由重试间隔近似承担）；
 *  其余 4xx 客户端错误、AbortError、API 级错误（data.error）不重试。
 *  注意：单次尝试的 api.timeout 超时同样经 attemptController.abort() 抛 AbortError，
 *  与用户取消共用同一信号无法区分——按既有设计，超时与用户取消均不重试，
 *  仅 TypeError/5xx 进入重试路径。 */
function isRetryableError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return false;
  if (e instanceof TypeError) return true;
  if (e instanceof Error) {
    const m = e.message.match(/^API 请求失败 \((\d{3})\)/);
    if (m) {
      const status = parseInt(m[1], 10);
      return status >= 500 || status === 429;
    }
  }
  return false;
}

/** 带重试的副 API 调用入口：根据 retryCount 自动重试可恢复错误。
 *  每次尝试独立 AbortController + 超时，外部取消信号联动所有尝试。
 *  重试间隔由 retryInterval（秒）控制，失败时通过 toastr 提示进度。
 *  quiet=true：重试进度不 toastr（供后台 fire-and-forget 任务使用——L1 归因/L2 理由
 *  是后台增强，重试提示会打扰用户，且其失败已由各自模块级状态留痕）。 */
export async function callSecondaryApiWithRetry(
  messages: ChatMsg[],
  api: SecondaryApi,
  retryCount: number,
  retryInterval: number,
  externalSignal?: AbortSignal,
  quiet = false,
): Promise<string> {
  const maxAttempts = retryCount + 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // 已 aborted 的信号再挂 abort 监听永不触发：入口快速失败，防首轮请求照发
    if (externalSignal?.aborted) throw new DOMException('已取消', 'AbortError');
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
        // 先查取消再提示/等待：sleep 期间用户点取消时，旧实现会空转一轮才抛出，
        // 且 toastr 已显示"正在重试"造成误导。这里提前拦截，取消立即生效。
        if (externalSignal?.aborted) throw e;
        const delaySec = Math.max(0, retryInterval);
        if (!quiet) toastr.info(`正在重试 (${attempt + 1}/${retryCount})，${delaySec}s 后重试...`);
        await new Promise(resolve => setTimeout(resolve, delaySec * 1000));
        // sleep 期间若被取消则直接终止，避免醒来后又发起一次注定被 abort 的请求
        if (externalSignal?.aborted) throw e;
      }
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError;
}
