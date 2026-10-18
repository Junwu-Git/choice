import toastr from 'toastr';
import { uuidv4 } from '@sillytavern/scripts/utils';
import type { SecondaryApi } from '@/type/settings';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { emitPresetPromptReady, isTavernHelperInstalled } from '@/core/st-preset-scripts';

/** 按 active_api_id 解析启用的副 API（generator 等仅需一次解析的模块经此取）。 */
export const resolveCustomApi = (id: string, apis: SecondaryApi[]): SecondaryApi | undefined =>
  id ? apis.find(a => a.id === id) : undefined;

/** 与酒馆 generate 端点对接的消息格式：system/user/assistant 三态分离。
 *  不拼成单段字符串塞进单条消息，遵循"提示词组装走角色结构"的架构约束。 */
export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string };

/** 采样参数覆盖（提示词来源 = 酒馆预设时，按需用预设值覆盖副 API 配置）。
 *  只含已定义键才生效；连接层（地址/密钥/模型/stream/超时）始终由副 API 配置决定。 */
export type SamplingOverride = {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  max_tokens?: number;
};

/** 预设脚本层档位：off = 不触发脚本事件；prompt_ready = 仅广播 PROMPT_READY（直连通路上）；
 *  tavern_helper = 经酒馆助手 generateRaw 管线发送（载荷级脚本生效）。仅预设模式传入。 */
export type PresetScriptLayer = 'off' | 'prompt_ready' | 'tavern_helper';

/** 本扩展经酒馆助手管线发起的生成 id 前缀：GENERATION_STOPPED 事件按此前缀过滤，
 *  防止取消副请求时误清在飞主生成的骰子回合槽（见 index.ts 订阅处）。 */
export const TAVERN_HELPER_GENERATION_ID_PREFIX = 'choice-';

/** 酒馆助手缺失降级提示的会话级去重标记。 */
let tavernHelperUnavailableWarned = false;

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
 *  例外：scriptLayer='prompt_ready'（预设模式脚本层，用户显式开启）时发送前广播
 *  PROMPT_READY，「最终入参」以（可能被脚本改写过的）广播结果为准——见 emitPresetPromptReady。
 *
 *  但事件层绕不开 fetch 层：外部预设脚本（如防截断类）会从 iframe patch
 *  主窗口 window.fetch，拦截一切 backends generate 端点请求并改写请求体（注入
 *  工具调用指令）。tool_choice:"none" 是这类脚本 callerControlsTools 的设计内绕过
 *  信号（"tools-disabled-by-caller" → bypass 原样转发），语义上也正确——本扩展只要
 *  纯文本不要工具调用。ST 后端仅在 tools 非空数组时才转发 tool_choice
 *  （chat-completions.js:1481 等），本请求无 tools，该字段到不了上游，对未启用此类
 *  脚本的场景完全惰性。是否附带由全局开关 api_tool_choice_none 控制（默认开）。
 *  复查锚点：若脚本改掉该契约（fetch wrapper 标记 __keminiAntiTruncation__、函数
 *  callerControlsTools），从这段注释重新核实。 */
async function callSecondaryApiDirect(
  messages: ChatMsg[],
  api: SecondaryApi,
  signal?: AbortSignal,
  sampling?: SamplingOverride,
  postProcessing?: string,
  scriptLayer: PresetScriptLayer = 'off',
): Promise<string> {
  // 空 apiurl 会以 reverse_proxy:'' 静默落到酒馆主 OpenAI 配置（主 key/额度被副功能消耗、
  // 报错无指向）——入口拦截，与 ApiEditor 保存校验双保险
  if (!api.apiurl.trim()) throw new Error('副 API 地址为空，请先在 API 设置中填写 API 地址');
  // prompt_ready 脚本层：深拷贝广播后以（可能被脚本改写过的）克隆发送
  const outgoing = scriptLayer === 'prompt_ready' ? ((await emitPresetPromptReady(messages)) as ChatMsg[]) : messages;
  const body: Record<string, unknown> = {
    chat_completion_source: 'openai',
    reverse_proxy: normalizeApiUrl(api.apiurl),
    proxy_password: api.key || '',
    model: api.model,
    messages: outgoing,
    temperature: api.temperature,
    max_tokens: api.max_tokens,
    stream: api.stream,
  };

  // 提示词后处理透传（预设模式开关开启且取值链非空时）：酒馆后端 /generate 入口统一执行
  // （chat-completions.js:2161）。char_name/user_name 供 single 模式与示例消息的名字前缀
  // （getPromptNames 读请求体，不传则 single 压平后丢失说话人归属）。置于 exclude_params
  // 之前，用户仍可用 exclude_params 强制移除。
  if (postProcessing) {
    body.custom_prompt_post_processing = postProcessing;
    const ctx = window.SillyTavern?.getContext?.() as { name1?: unknown; name2?: unknown } | undefined;
    if (ctx?.name1) body.user_name = String(ctx.name1);
    if (ctx?.name2) body.char_name = String(ctx.name2);
  }

  // 预设采样覆盖：只覆盖已定义键，连接层字段（地址/密钥/模型/stream）不受影响
  if (sampling) {
    for (const [key, value] of Object.entries(sampling)) {
      if (value !== undefined) body[key] = value;
    }
  }

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
    try {
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
    } catch (err) {
      // API 级错误（json.error）/读流异常时主动释放响应体：不 cancel 会让 SSE 连接挂到
      // GC 才关闭，长会话下累积占用。用户取消路径 fetch 信号已拆连接，cancel 空转无害。
      reader.cancel().catch(() => {});
      throw err;
    }
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

/** 酒馆助手 generateRaw 通路的错误归一化：错误消息对齐直连通路约定——
 *  「API 请求失败 (xxx)」供 isRetryableError 识别 5xx/429；中止归一为 AbortError（取消
 *  语义，不重试；TH 中止以自定义 reason 拒绝，非标准 AbortError）；TokenBudgetExceededError
 *  归一为不可重试的预算提示（B 通路按酒馆面板的 openai_max_context 做硬预算，超限直接拒绝）。 */
function normalizeTavernHelperError(e: unknown): unknown {
  if (e instanceof DOMException && e.name === 'AbortError') return e;
  const message = typeof e === 'string' ? e : e instanceof Error ? e.message : String(e ?? '');
  if (/已停止|aborted|abort/i.test(message)) {
    return new DOMException('已取消', 'AbortError');
  }
  if (e instanceof Error && e.name === 'TokenBudgetExceededError') {
    return new Error('预设脚本管线：提示词超出酒馆「上下文长度」预算，请在酒馆 API 页调大上下文长度（不可重试）');
  }
  const httpMatch = message.match(/^HTTP (\d{3}):?/);
  if (httpMatch) {
    return new Error(message.replace(/^HTTP (\d{3}):?/, `API 请求失败 (${httpMatch[1]}):`));
  }
  return e instanceof Error ? e : new Error(message);
}

/** 从外部脚本执行器返回值提取正文：字符串直返；详情对象取 content。tool_calls 形态（模型把正文
 *  塞进工具参数，如预设框架的 ToolBindings——B 通路下其注册层不武装，理论到不了这里）
 *  防御性解析 arguments.content。 */
function extractTavernHelperText(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const detail = raw as { content?: unknown; tool_calls?: Array<{ function?: { arguments?: unknown } }> };
    if (typeof detail.content === 'string' && detail.content) return detail.content;
    const first = detail.tool_calls?.[0]?.function?.arguments;
    if (typeof first === 'string' && first) {
      try {
        const parsed = JSON.parse(first) as { content?: unknown };
        if (typeof parsed.content === 'string') return parsed.content;
      } catch {
        /* 非法 arguments 按空正文处理 */
      }
    }
  }
  return '';
}

/** B 通路：经外部脚本执行器 generateRaw 管线发送。与直连的差异（AGENTS.md 双轨段落有完整记录）：
 *  - GENERATE_AFTER_DATA/SETTINGS_READY/PROMPT_READY 会触发 → 载荷级脚本生效；
 *  - GENERATION_STARTED 不触发（执行器只发自有 js_generation_* 事件）→ 入口条件/
 *    工具注册/输出侧钩子不武装；
 *  - custom_prompt_post_processing 不可显式指定（执行器按 oai_settings 发送，预设框架再于
 *    SETTINGS_READY 强制覆盖）——跟随酒馆当前选中预设，与预设框架自身口径一致；
 *  - exclude_params 不生效（执行器仅在 source='custom' 时透传 exclude_body，而副 API 走 openai 源）。 */
async function callSecondaryApiViaTavernHelper(
  messages: ChatMsg[],
  api: SecondaryApi,
  signal?: AbortSignal,
  sampling?: SamplingOverride,
): Promise<string> {
  if (!api.apiurl.trim()) throw new Error('副 API 地址为空，请先在 API 设置中填写 API 地址');
  const helper = (window as unknown as { TavernHelper?: any }).TavernHelper;
  if (!helper || typeof helper.generateRaw !== 'function' || typeof helper.stopGenerationById !== 'function') {
    throw new Error('tavern-helper-unavailable');
  }
  const generationId = TAVERN_HELPER_GENERATION_ID_PREFIX + uuidv4();
  const customApi: Record<string, unknown> = {
    // TH 的 normalizeBaseURL 只 trim——/chat/completions 剥离与裸域名补 /v1 必须在插件侧完成
    //（复用直连的 normalizeApiUrl），否则用户填完整端点时后端会双拼 404
    apiurl: normalizeApiUrl(api.apiurl),
    key: api.key || '',
    model: api.model,
    temperature: sampling?.temperature ?? api.temperature,
    max_tokens: sampling?.max_tokens ?? api.max_tokens,
  };
  if (sampling?.top_p !== undefined) customApi.top_p = sampling.top_p;
  if (sampling?.frequency_penalty !== undefined) customApi.frequency_penalty = sampling.frequency_penalty;
  if (sampling?.presence_penalty !== undefined) customApi.presence_penalty = sampling.presence_penalty;

  // 取消映射：外部信号（用户取消/超时）→ TH 按 generation_id 中止 → generateRaw 以中止拒绝
  const onExternalAbort = (): void => {
    try {
      helper.stopGenerationById(generationId);
    } catch {
      /* 中止失败时让请求自然结束 */
    }
  };
  signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    // 纯 RolePrompt 形态：handleCustomPath 原样组装、不做宏替换（插件已 substituteParams）
    const raw = await helper.generateRaw({
      generation_id: generationId,
      ordered_prompts: messages,
      custom_api: customApi,
      should_silence: true, // 不绑酒馆停止按钮，不占用全局生成状态
      should_stream: !!api.stream,
      should_return_reasoning: false,
    });
    return extractTavernHelperText(raw);
  } catch (e) {
    throw normalizeTavernHelperError(e);
  } finally {
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** 判断 API 调用错误是否可重试：网络错误（TypeError）、5xx 服务端错误与 429 限速可重试
 *  （429 是副 API 最典型的瞬态错误；Retry-After 语义由重试间隔近似承担）；
 *  其余 4xx 客户端错误、AbortError、API 级错误（data.error）不重试。
 *  注意：单次尝试的 api.timeout 超时同样经 attemptController.abort() 抛 AbortError，
 *  与用户取消共用同一信号无法区分——按既有设计，超时与用户取消均不重试，
 *  仅 TypeError/5xx 进入重试路径。 */
function isRetryableError(e: unknown): boolean {
  if (e instanceof DOMException && e.name === 'AbortError') return false;
  // 仅网络型 TypeError（fetch 资源加载失败）可重试：TypeError 同样是编程错误（属性访问
  // 出错等）的常态类型，无差别放行会把真实异常掩盖成「重试耗尽」。message 形态覆盖
  // Chrome「Failed to fetch」/Firefox「NetworkError…」/Safari「Load failed」/Node「fetch failed」
  if (e instanceof TypeError && /failed to fetch|networkerror|load failed|fetch failed/i.test(e.message)) {
    return true;
  }
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
 *  quiet=true：重试进度不 toastr（供不想被打扰的调用方使用；失败反馈方式由调用方决定）。
 *  postProcessing/scriptLayer 仅预设模式传入（见 generator/enrich）：前者透传后处理字段，
 *  后者选择脚本层档位与发送通路。 */
export async function callSecondaryApiWithRetry(
  messages: ChatMsg[],
  api: SecondaryApi,
  retryCount: number,
  retryInterval: number,
  externalSignal?: AbortSignal,
  quiet = false,
  sampling?: SamplingOverride,
  postProcessing?: string,
  scriptLayer: PresetScriptLayer = 'off',
): Promise<string> {
  const maxAttempts = retryCount + 1;
  let lastError: unknown;

  // 通路选择：tavern_helper 档在酒馆助手缺失/无 generateRaw API 时一次性降级直连
  // （后处理透传仍生效，仅脚本层降级）——会话内只提示一次，防 auto_generate 轰炸
  let viaTavernHelper = scriptLayer === 'tavern_helper';
  if (viaTavernHelper && !isTavernHelperInstalled()) {
    viaTavernHelper = false;
    if (!tavernHelperUnavailableWarned) {
      tavernHelperUnavailableWarned = true;
      toastr.warning(t`未检测到酒馆助手，预设脚本层已降级为直连发送（提示词后处理仍生效）`);
    }
  }

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
      const result = viaTavernHelper
        ? await callSecondaryApiViaTavernHelper(messages, api, attemptController.signal, sampling)
        : await callSecondaryApiDirect(messages, api, attemptController.signal, sampling, postProcessing, scriptLayer);
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
        if (!quiet) toastr.info(t`正在重试 (${attempt + 1}/${retryCount})，${delaySec}s 后重试...`);
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
