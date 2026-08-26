import { callSecondaryApi } from './api-client';
import { buildMessages, resolveCustomApi, applyWIExcl, STRIP_REASONING_TAGS_RE } from './generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { pinia } from '@/pinia';
import { DEFAULT_MODULES } from '@/type/settings';

const DEFAULT_ENRICH_PROMPT = `请将用户输入润色扩展为 {{count}} 个更自然、更丰富的版本，保留原意和语气。

用户输入：
{{input}}

输出格式：每行一个版本，格式为 "1. 润色后的文本"`;

let enrichController: AbortController | null = null;

export function cancelEnrich() {
  enrichController?.abort();
  enrichController = null;
}

/** 润色结果解析：找最后一个 </thinking> 标签取其后内容 → 提取 <options> 块 → 按 "数字. 文本" 格式解析。
 *  与 parseOptions 共享 stripping 逻辑但解析格式不同（"数字. 文本" vs "标题: 内容"）。
 *  必须找最后一个 </thinking> 而非 strip 配对标签：enrich_assistant 预填充文本在 <thinking> 之前，
 *  配对 strip 会残留预填充文本，被误当作第一条结果。 */
function parseEnrichResult(text: string, count: number): string[] {
  // 1. 找最后一个思维链闭合标签，丢弃之前的所有内容（含预填充文本）
  const closeTagRe = /<\/(?:think(?:ing)?|reasoning|thought)>/gi;
  const closeMatches = [...text.matchAll(closeTagRe)];
  let c: string;
  if (closeMatches.length > 0) {
    const lastClose = closeMatches[closeMatches.length - 1];
    c = text.slice(lastClose.index! + lastClose[0].length).trim();
  } else {
    c = text.replace(STRIP_REASONING_TAGS_RE, '').trim();
  }

  // 2. 提取 <options> 块
  const m = c.match(/<options>([\s\S]*?)<\/options>/i);
  if (m) c = m[1].trim();

  // 3. 剥离代码块包裹
  c = c
    .replace(/^```[a-zA-Z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  // 4. 按行解析，去掉 "数字. " / "数字) " / "数字、" 前缀
  const result: string[] = [];
  const prefixRe = /^\s*\d+[.)、]\s*/;
  for (const raw of c.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || /^<\/?\w+>$/i.test(line)) continue;
    line = line.replace(prefixRe, '').trim();
    if (line) result.push(line);
    if (result.length >= count) break;
  }
  return result;
}

/** 润色时无需跳过的模块（所有通用模块均参与润色管线） */
const ENRICH_SKIP_IDS = new Set<string>();

/** 调用副 API 润色用户输入，返回解析后的选项文本数组。
 *  复用 buildMessages 模块管线，包含聊天历史、世界书、角色描述等上下文。
 *  用户输入通过 {{input}} 变量在 enrich_prompt 模块中占位，由 buildMessages 自动替换。 */
export async function enrichUserInput(input: string): Promise<string[]> {
  const gs = useGlobalSettingsStore(pinia);
  const cs = useChatSettingsStore(pinia);
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) {
    throw new Error('未配置生成 API');
  }

  const sourceModules = gs.sortedEnabledModules.length > 0 ? gs.sortedEnabledModules : DEFAULT_MODULES;
  let modules = sourceModules.filter(m => !ENRICH_SKIP_IDS.has(m.id));

  // 若 enrich_prompt 模块被禁用或不存在，用默认内容临时注入
  if (!modules.some(m => m.id === 'enrich_prompt')) {
    const defaultEnrich = DEFAULT_MODULES.find(m => m.id === 'enrich_prompt');
    if (defaultEnrich) {
      modules = [...modules, { ...defaultEnrich, content: DEFAULT_ENRICH_PROMPT }];
    }
  }

  const enrichCount = gs.settings.ui.enrich_count;
  const enrichCtx = { count: enrichCount, pinnedCount: 0, pinned: '', poolSelected: '', input };

  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;
  const restore = gwi.enabled ? applyWIExcl(cwi.excluded_books, cwi.enabled_books) : null;

  try {
    const messages = await buildMessages(modules, enrichCtx, gwi, gs.settings.prompt_rules.context_rounds, true);

    enrichController = new AbortController();
    const signal = enrichController.signal;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (api.timeout > 0) {
      timeoutId = setTimeout(() => enrichController?.abort(), api.timeout * 1000);
    }

    try {
      const raw = await callSecondaryApi(messages, api, signal);
      return parseEnrichResult(raw, enrichCount);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return [];
    console.error('[Choice] 润色失败', e);
    throw e;
  } finally {
    if (restore) restore.restore();
    enrichController = null;
  }
}
