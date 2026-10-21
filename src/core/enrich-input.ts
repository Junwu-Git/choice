import { callSecondaryApiWithRetry, type PresetScriptLayer, type SamplingOverride } from './api-client';
import {
  buildMessages,
  buildPresetModeMessages,
  buildWICached,
  resolveCustomApi,
  parseOptions,
  resolveCount,
} from './generator';
import { ensureEnrichModules } from './enrich-modules';
import { applySamplingFloor } from './sampling';
import type { Ctx, PromptModule } from './generator';
import { readActiveStPreset } from './st-preset-source';
import { resolvePresetPostProcessing } from './st-preset-scripts';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { pinia } from '@/pinia';
import { DEFAULT_MODULES } from '@/type/settings';

let enrichController: AbortController | null = null;

export function cancelEnrich() {
  enrichController?.abort();
  enrichController = null;
}

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

  const enrichCount = resolveCount(gs.settings.ui.enrich_count);
  const pr = gs.settings.prompt_rules;

  // 提示词来源与选项生成同口径：'st_preset' 时只用酒馆预设 + 内置润色任务指令
  // （完全不读本扩展模块）；未找到预设时抛错由调用方提示，不静默降级
  const presetMode = gs.settings.prompt_source === 'st_preset';
  const presetSnapshot = presetMode ? readActiveStPreset(gs.settings.st_preset_name) : null;
  if (presetMode && (!presetSnapshot || !presetSnapshot.prompts.length)) {
    throw new Error('未找到可用的酒馆预设，请检查酒馆的 Chat Completion 预设，或改回本扩展提示词');
  }

  // 模块只在扩展模式参与（预设模式走内置任务指令）
  let modules: PromptModule[] = [];
  if (!presetSnapshot) {
    const sourceModules = gs.sortedEnabledModules.length > 0 ? gs.sortedEnabledModules : DEFAULT_MODULES;
    // 补齐被删掉的润色规则模块（被停用的不动，见 ensureEnrichModules 注释）：
    // 不再用代码常量覆盖 content——JSON 是模块内容的单一事实源
    // （choice-prompts-optimized.json），代码常量会让此路径回退到早已演进的旧文案
    modules = ensureEnrichModules(sourceModules, gs.allModules, DEFAULT_MODULES);
  }

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
    prevOptions: '',
  };

  const gwi = gs.settings.world_info;
  const cwi = cs.settings.world_info;

  // controller 随入口创建：WI 窗口构建消息可达秒级，此间取消也要能 abort——此前在
  // API 调用前才创建，构建期取消无对象可 abort，照发请求白耗 token（同 generateOptions）
  enrichController = new AbortController();
  const signal = enrichController.signal;

  try {
    // 世界书构建（缓存 + 排他窗口，见 buildWICached）：与选项生成/知识分析共用同一份
    // 缓存，同一轮不再重复扫描世界书、重复执行 EJS
    // 扩展模式没启用任何世界书模块时跳过；预设模式始终需要（槽位 + 深度注入都取自它）
    const needsWI = presetSnapshot
      ? true
      : modules.some(
          m =>
            m.enabled && ['world_info_before', 'world_info_after', 'wi_depth_before', 'wi_depth_after'].includes(m.id),
        );
    const wiBuckets = needsWI ? await buildWICached(gwi, cwi) : null;
    const { messages } = presetSnapshot
      ? await buildPresetModeMessages(
          enrichCtx,
          gs.settings.prompt_rules.context_rounds,
          presetSnapshot,
          true,
          false,
          wiBuckets,
        )
      : await buildMessages(modules, enrichCtx, gs.settings.prompt_rules.context_rounds, true, false, wiBuckets);

    // 采样：预设模式跟随酒馆预设，但 max_tokens 另套输出下限——
    // 预设为正文续写设计，值往往只有几百，润色多个版本会被截在半截
    const sampling: SamplingOverride | undefined = applySamplingFloor(
      presetSnapshot && gs.settings.st_preset_sampling ? presetSnapshot.sampling : undefined,
      enrichCount,
      pr.enrich_max_chars,
    );
    // 后处理透传与脚本层档位（仅预设模式；扩展模式恒不生效），与 generateOptions 同口径
    const postProcessing =
      presetSnapshot && gs.settings.st_preset_post_processing
        ? resolvePresetPostProcessing(gs.settings.st_preset_name, presetSnapshot.postProcessing)
        : undefined;
    const scriptLayer: PresetScriptLayer = presetSnapshot ? gs.settings.st_preset_script_processing : 'off';
    const raw = await callSecondaryApiWithRetry(
      messages,
      api,
      gs.settings.retry_count,
      gs.settings.retry_interval,
      signal,
      false,
      sampling,
      postProcessing,
      scriptLayer,
    );
    return parseOptions(raw, enrichCount);
  } catch (e) {
    // 取消（AbortError）原样上抛、不 console.error：正常路径由调用方 triggerEnrich 的
    // AbortError 分支静默处理；此前吞掉返回 [] 会让调用方把空代落库污染润色翻页
    if ((e as Error)?.name !== 'AbortError') {
      console.error('[Choice] 润色失败', e);
    }
    throw e;
  } finally {
    enrichController = null;
  }
}
