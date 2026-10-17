// 读取 SillyTavern Chat Completion 预设（提示词栈 + 采样参数），供「提示词来源 = 酒馆预设」模式使用。
// @sillytavern 导入隔离于此文件（AGENTS.md：@sillytavern 导入只允许出现在 src/core/）。
//
// 本文件只负责「从宿主取到预设对象」这一件事；字段提取（白名单）在 preset-extract.ts——
// 预设对象顶层含连接/凭据类字段，提取逻辑必须集中且可单测，见该文件头注释。
//
// 为什么读预设而不是调酒馆生成入口：宿主 generateQuietPrompt/Generate 会占用全局
// abortController 与发送按钮（无独立取消通道、主生成中并发会互相干扰），且会 emit
// 生成事件。自读预设 + 自组装消息可保留本扩展的取消/重试/流式/成本控制，收益相同而
// 副作用全无。预设内容读取路径已核实：preset-manager.js getCompletionPresetByName。
import { getPresetManager } from '@sillytavern/scripts/preset-manager';
import {
  extractPresetOrderList,
  extractPresetPostProcessing,
  extractPresetPrompts,
  extractPresetSampling,
  isPresetPostProcessingMode,
  type StPresetSnapshot,
} from '@/core/preset-extract';

export type { StPresetPrompt, StPresetOrderEntry, StPresetSnapshot } from '@/core/preset-extract';

/** 酒馆 CC 预设管理器的 apiId；与 main_api 无关（preset-manager.js:83-96 按 apiId 查注册表）。 */
const OPENAI_PRESET_API_ID = 'openai';

/** 列出全部 CC 预设名（未注册预设管理器/异常 → []）。 */
export function listStPresetNames(): string[] {
  try {
    const pm = getPresetManager(OPENAI_PRESET_API_ID) as { getAllPresets?: () => unknown } | null;
    if (!pm || typeof pm.getAllPresets !== 'function') return [];
    const names = pm.getAllPresets();
    if (!Array.isArray(names)) return [];
    return names.map(n => String(n ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** 读取当前选中的 CC 预设名（未注册/无选中 → ''）。 */
export function getSelectedStPresetName(): string {
  try {
    const pm = getPresetManager(OPENAI_PRESET_API_ID) as { getSelectedPresetName?: () => unknown } | null;
    if (!pm || typeof pm.getSelectedPresetName !== 'function') return '';
    return String(pm.getSelectedPresetName() ?? '').trim();
  } catch {
    return '';
  }
}

/** 按名读取宿主原始预设对象（未做任何字段筛选）；找不到/结构异常 → null。
 *  消费方必须自行守白名单边界：提取进快照/请求体的字段走 preset-extract.ts；
 *  extensions 等元数据只允许读计数/名字/布尔（见 st-preset-scripts.ts），绝不读正文。 */
export function readRawStPresetByName(name: string): Record<string, unknown> | null {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return null;
  try {
    // 先校验存在性：getCompletionPresetByName 找不到时会 console.error（preset-manager.js:767），
    // 空档/改名场景下会刷屏——用列表预检把噪声挡在门外
    if (!listStPresetNames().includes(trimmed)) return null;
    const pm = getPresetManager(OPENAI_PRESET_API_ID) as {
      getCompletionPresetByName?: (n: string) => unknown;
    } | null;
    if (!pm || typeof pm.getCompletionPresetByName !== 'function') return null;
    const preset = pm.getCompletionPresetByName(trimmed) as Record<string, unknown> | undefined;
    if (!preset || typeof preset !== 'object') return null;
    return preset;
  } catch {
    return null;
  }
}

/** 按名读取预设快照；找不到/结构异常 → null（调用方给降级提示，不抛错）。
 *  快照只含提示词栈与采样参数——连接/凭据类字段在 extract* 阶段即被白名单挡掉。 */
export function readStPresetByName(name: string): StPresetSnapshot | null {
  const preset = readRawStPresetByName(name);
  if (!preset) return null;
  const trimmed = String(name ?? '').trim();
  return {
    name: trimmed,
    prompts: extractPresetPrompts(preset.prompts),
    order: extractPresetOrderList(preset.prompt_order),
    sampling: extractPresetSampling(preset),
    postProcessing: extractPresetPostProcessing(preset),
  };
}

/** 读取酒馆实时生效的提示词后处理模式（AI 回复配置面板的下拉值；未安装/异常/非法值 → ''）。
 *  「跟随酒馆当前预设」语义下用它——用户在酒馆改过但未保存进预设文件时也准确。 */
export function readLivePostProcessingType(): string {
  try {
    const settings = window.SillyTavern?.getContext?.()?.chatCompletionSettings as
      { custom_prompt_post_processing?: unknown } | undefined;
    const value = settings?.custom_prompt_post_processing;
    return isPresetPostProcessingMode(value) ? value : '';
  } catch {
    return '';
  }
}

/** 解析实际生效的预设名：配置了具体名就用它，否则跟随酒馆当前选中。 */
export function resolveStPresetName(configured: string): string {
  const explicit = String(configured ?? '').trim();
  return explicit || getSelectedStPresetName();
}

/** 读取生效预设快照（configured 为空 = 跟随当前选中）。 */
export function readActiveStPreset(configured = ''): StPresetSnapshot | null {
  const name = resolveStPresetName(configured);
  return name ? readStPresetByName(name) : null;
}
