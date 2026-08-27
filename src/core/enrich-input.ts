import { callSecondaryApiWithRetry } from './api-client';
import { buildMessages, resolveCustomApi, applyWIExcl, parseOptions, resolveCount } from './generator';
import type { Ctx } from './generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { pinia } from '@/pinia';
import { DEFAULT_MODULES } from '@/type/settings';

const DEFAULT_ENRICH_PROMPT = `请将用户输入润色扩展为 {{count}} 个版本，保留原意和语气，版本间在描写方式、措辞风格上有明显差异。

用户输入：
{{input}}

输出格式：每行一个版本，格式为 "【标题】内容"。严禁在版本内容中使用【】符号。`;

let enrichController: AbortController | null = null;

export function cancelEnrich() {
  enrichController?.abort();
  enrichController = null;
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

  const enrichCount = resolveCount(gs.settings.ui.enrich_count);
  const pr = gs.settings.prompt_rules;
  const enrichCtx: Ctx = {
    count: enrichCount,
    pinnedCount: 0,
    pinned: '',
    poolSelected: '',
    input,
    minChars: pr.enrich_min_chars,
    maxChars: pr.enrich_max_chars,
    enrichPersonStyle:
      pr.enrich_person_style || (pr.enrich_person ? `统一使用${pr.enrich_person} {{user}} 为主语` : ''),
    optionPerson: pr.option_person || '第三人称',
    enrichPerson: pr.enrich_person || '第三人称',
  };

  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;
  const restore = gwi.enabled ? applyWIExcl(cwi.excluded_books, cwi.enabled_books) : null;

  try {
    const messages = await buildMessages(modules, enrichCtx, gwi, gs.settings.prompt_rules.context_rounds, true);

    enrichController = new AbortController();
    const signal = enrichController.signal;

    const raw = await callSecondaryApiWithRetry(messages, api, gs.settings.retry_count, signal);
    return parseOptions(raw, enrichCount);
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return [];
    console.error('[Choice] 润色失败', e);
    throw e;
  } finally {
    if (restore) restore.restore();
    enrichController = null;
  }
}
