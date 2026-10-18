// 读取生效预设的「配套脚本」元数据（预设绑定正则 + 外部脚本执行器预设脚本 + 预设框架配置），
// 并承载预设模式的两个宿主桥：PROMPT_READY 脚本层广播与提示词后处理取值链。
//
// 边界（与 preset-extract 白名单同源的安全自觉）：只读 preset.extensions 里的数组长度、
// 脚本名与 enabled 布尔——脚本正文可达数百 KB 且非提示词栈，绝不读进快照或请求体；
// 本模块返回值只被 UI 展示与请求体枚举字段消费，不进 StPresetSnapshot。
//
// 闸门口径（实现前已核实）：
//  - 外部脚本执行器的预设脚本生效条件 = extension_settings.tavern_helper.script.enabled.presets
//    含该预设名；未安装该执行器（window.TavernHelper 不存在）时预设内嵌脚本整体惰性。
//  - 预设绑定正则由酒馆正则扩展自动并入运行时（regex/engine.js:126 readPresetExtensionField），
//    其中 promptOnly 部分已随本扩展 buildChatHistory 的 getRegexedString 生效；但它读的是
//    「酒馆当前选中」的预设——固定了别的预设名时正则仍随选中预设走，返回值用
//    differsFromSelected 把这个错位暴露给提示层。
//  - 预设框架（配置内嵌 extensions.SPreset、运行时为预设脚本注入的远程脚本）在载荷层
//    处理：挂 GENERATE_AFTER_DATA + SETTINGS_READY + GENERATION_STARTED，不挂 PROMPT_READY。
//    ForcedPostProcessing.mode 是声明式后处理意图，无需执行脚本即可读取。
import { eventSource, event_types } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { isPresetPostProcessingMode, pickPresetPostProcessing } from '@/core/preset-extract';
import {
  getSelectedStPresetName,
  readLivePostProcessingType,
  readRawStPresetByName,
  resolveStPresetName,
} from '@/core/st-preset-source';

export type PresetCompanionScripts = {
  /** 生效预设名（resolveStPresetName 解析结果）。 */
  presetName: string;
  /** 预设绑定正则数量（extensions.regex_scripts）。 */
  regexCount: number;
  /** 外部脚本执行器的预设脚本总数（extensions.tavern_helper.scripts）。 */
  helperTotal: number;
  /** 其中单脚本开关为启用的数量。 */
  helperEnabled: number;
  /** 外部脚本执行器是否已安装并激活（window.TavernHelper 探测）。 */
  helperInstalled: boolean;
  /** 外部脚本执行器的「预设脚本」作用域对该预设是否开启。 */
  helperScopeEnabled: boolean;
  /** 生效预设 ≠ 酒馆当前选中预设（预设正则与部分宿主行为仍跟随选中预设）。 */
  differsFromSelected: boolean;
  /** 预设框架配置是否存在（extensions.SPreset 键名由预设包定义，属运行时契约）。 */
  spresetPresent: boolean;
  /** 预设框架启用中的处理模块（中文名，有界；供提示条展示）。 */
  spresetModules: string[];
  /** 预设框架 ForcedPostProcessing 声明的后处理模式（enabled 且模式合法时给出）。 */
  spresetForcedPostProcessing?: string;
};

const countArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** 外部脚本执行器 settings 里「该预设的脚本作用域是否启用」。 */
const isHelperScopeEnabled = (presetName: string): boolean => {
  try {
    const th = (extension_settings as Record<string, unknown> | undefined)?.tavern_helper as
      { script?: { enabled?: { presets?: unknown } } } | undefined;
    const list = th?.script?.enabled?.presets;
    return Array.isArray(list) && list.map(String).includes(presetName);
  } catch {
    return false;
  }
};

/** 外部脚本执行器是否激活：window.TavernHelper 由其入口挂载。 */
export const isTavernHelperInstalled = (): boolean => {
  try {
    return typeof window !== 'undefined' && (window as { TavernHelper?: unknown }).TavernHelper != null;
  } catch {
    return false;
  }
};

/** 预设框架 ForcedPostProcessing 声明的后处理模式（enabled 且模式合法 → 模式；否则 undefined）。 */
export function readSpresetForcedPostProcessing(presetName: string): string | undefined {
  const preset = readRawStPresetByName(presetName);
  if (!preset) return undefined;
  try {
    const spreset = ((preset.extensions ?? null) as Record<string, unknown> | null)?.SPreset as
      { ForcedPostProcessing?: { enabled?: unknown; mode?: unknown } } | undefined;
    const forced = spreset?.ForcedPostProcessing;
    if (forced?.enabled !== true) return undefined;
    return isPresetPostProcessingMode(forced.mode) && forced.mode !== '' ? forced.mode : undefined;
  } catch {
    return undefined;
  }
}

/** 读取生效预设的配套脚本元数据；预设不可读 → null（调用方按无信息处理，不报错）。
 *  预设无任何配套内容时返回全 0 对象，由 UI 决定不展示。 */
export function readPresetCompanionScripts(configured: string): PresetCompanionScripts | null {
  const presetName = resolveStPresetName(configured);
  if (!presetName) return null;
  const preset = readRawStPresetByName(presetName);
  if (!preset) return null;
  try {
    const extensions = (preset.extensions ?? null) as Record<string, unknown> | null;
    const regexScripts = countArray(extensions?.regex_scripts);
    const helperRaw = (extensions?.tavern_helper ?? null) as { scripts?: unknown } | null;
    const helperScripts = countArray(helperRaw?.scripts);
    let helperEnabled = 0;
    for (const script of helperScripts) {
      if ((script as { enabled?: unknown } | null)?.enabled === true) helperEnabled += 1;
    }

    // 预设框架模块启用态（只读布尔/计数，模块键名有界）
    const spreset = (extensions?.SPreset ?? null) as Record<string, any> | null;
    const spresetModules: string[] = [];
    if (spreset) {
      if (spreset.ChatSquash?.enabled === true) spresetModules.push('条件合并');
      if (spreset.ForcedPostProcessing?.enabled === true) spresetModules.push('强制后处理');
      const bindingCount = countArray(spreset.RegexBinding?.regexes).length;
      if (bindingCount > 0) spresetModules.push(`动态正则 ×${bindingCount}`);
      if (spreset.OutputPreprocessing?.enabled === true) spresetModules.push('输出预处理');
      const toolBindings =
        spreset.ToolBindings && typeof spreset.ToolBindings === 'object' ? Object.values(spreset.ToolBindings) : [];
      if (toolBindings.some((t: any) => t?.enabled === true)) spresetModules.push('工具绑定');
    }

    const selected = getSelectedStPresetName();
    const spresetForced = spreset ? readSpresetForcedPostProcessing(presetName) : undefined;
    return {
      presetName,
      regexCount: regexScripts.length,
      helperTotal: helperScripts.length,
      helperEnabled,
      helperInstalled: isTavernHelperInstalled(),
      helperScopeEnabled: isHelperScopeEnabled(presetName),
      differsFromSelected: Boolean(selected) && selected !== presetName,
      spresetPresent: Boolean(spreset),
      spresetModules,
      spresetForcedPostProcessing: spresetForced,
    };
  } catch {
    return null;
  }
}

/** 与 api-client ChatMsg 同构的宽松结构（不反向 import，防 api-client ↔ 本模块循环依赖；
 *  脚本改写后消息对象可能携带 name 等额外字段，透传给请求体即可）。 */
export type CompanionChatMsg = { role: string; content: string };

/** 预设脚本层（prompt_ready 档）：把最终消息深拷贝后广播 CHAT_COMPLETION_PROMPT_READY，
 *  返回（可能被脚本改写过的）消息数组。与酒馆主管线同一钩子点、同一载荷形态
 *  ({ chat, dryRun:false })；只发这一个事件——MVU/QR 等生命周期类脚本（挂
 *  SETTINGS_READY / GENERATION_AFTER_COMMANDS / MESSAGE_*）不会感知。
 *  广播失败按未处理消息继续（桥接式容错：脚本层是增强，不是依赖）。 */
export async function emitPresetPromptReady(messages: readonly CompanionChatMsg[]): Promise<CompanionChatMsg[]> {
  const clone = structuredClone(messages) as CompanionChatMsg[];
  try {
    const payload = { chat: clone, dryRun: false };
    await eventSource.emit(event_types.CHAT_COMPLETION_PROMPT_READY, payload);
    // 防脚本整体替换 data.chat 的写法：替换后以载荷内最新数组为准
    return Array.isArray(payload.chat) ? (payload.chat as CompanionChatMsg[]) : clone;
  } catch (err) {
    console.warn('[Choice] 预设脚本层广播未完成，按未处理消息继续:', err);
    return clone;
  }
}

/** 提示词后处理取值链（仅预设模式、开关开启时调用）：预设框架 ForcedPostProcessing →
 *  预设顶层字段（undefined = 未声明；显式空串 = 预设明确不处理）→ 酒馆实时设置。
 *  返回 '' 表示不透传该字段。 */
export function resolvePresetPostProcessing(configured: string, snapshotPostProcessing?: string): string {
  const presetName = resolveStPresetName(configured);
  const spresetMode = presetName ? readSpresetForcedPostProcessing(presetName) : undefined;
  return pickPresetPostProcessing(spresetMode, snapshotPostProcessing, readLivePostProcessingType());
}
