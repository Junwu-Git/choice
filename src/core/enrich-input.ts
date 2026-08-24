import { callSecondaryApi } from './api-client';
import { buildMessages, parseOptions, resolveCustomApi, applyWIExcl } from './generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { pinia } from '@/pinia';
import { DEFAULT_MODULES } from '@/type/settings';

const DEFAULT_ENRICH_PROMPT = `请将以下用户输入润色扩展为多个更自然、更丰富的版本，保留原意和语气。
输出格式：每行一个版本，格式为 "1. 润色后的文本"`;

let enrichController: AbortController | null = null;

export function cancelEnrich() {
  enrichController?.abort();
  enrichController = null;
}

/** 行动选项专用模块 ID：润色流程应过滤掉 */
const ENRICH_SKIP_IDS = new Set(['assistant_ack', 'assistant_thinking', 'thinking_prompt', 'core_rules']);

/** 调用副 API 润色用户输入，返回解析后的选项文本数组。
 *  复用 buildMessages 模块管线，包含聊天历史、世界书、角色描述等上下文。 */
export async function enrichUserInput(input: string): Promise<string[]> {
  const gs = useGlobalSettingsStore(pinia);
  const cs = useChatSettingsStore(pinia);
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) {
    throw new Error('未配置生成 API');
  }

  const enrichPrompt = gs.settings.prompt_rules.enrich_prompt || DEFAULT_ENRICH_PROMPT;

  // 获取用户启用的模块，过滤掉行动选项专用模块，替换 user_instruction 为润色指令
  const sourceModules = gs.sortedEnabledModules.length > 0 ? gs.sortedEnabledModules : DEFAULT_MODULES;
  let modules = sourceModules
    .filter(m => !ENRICH_SKIP_IDS.has(m.id))
    .map(m =>
      m.id === 'user_instruction'
        ? { ...m, content: `${enrichPrompt}\n\n<!-- 用户最新输入 -->\n<user_input>\n${input}\n</user_input>` }
        : { ...m },
    );

  const enrichCtx = { count: 10, pinned: '', poolSelected: '', input };

  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;
  const restore = gwi.enabled ? applyWIExcl(cwi.excluded_books, cwi.enabled_books) : null;

  try {
    const messages = await buildMessages(modules, enrichCtx, gwi, gs.settings.prompt_rules.context_rounds);

    enrichController = new AbortController();
    const signal = enrichController.signal;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (api.timeout > 0) {
      timeoutId = setTimeout(() => enrichController?.abort(), api.timeout * 1000);
    }

    try {
      const raw = await callSecondaryApi(messages, api, signal);
      return parseOptions(raw, 10);
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