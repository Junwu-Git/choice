// 从宿主预设对象中提取本扩展需要的字段——**白名单式提取，其余一律不读取**。
//
// 安全边界（勿放宽）：酒馆 CC 预设对象的顶层同时含提示词栈与连接/凭据类字段
// （reverse_proxy、proxy_password 等）。本扩展只需要「提示词条目 + 顺序表 + 5 个数值
// 采样键」，故提取逻辑集中在此文件并逐键白名单化：
//   1. 不读取任何连接/凭据字段，也不把它们带入快照对象（快照会被后续请求体与调试视图消费）；
//   2. 采样键只取数值，非数值一律丢弃（不落库、不进请求体）。
// 改这里前先看 tests/preset-extract.test.ts——白名单由单测锁定。
//
// 纯函数模块：宿主对象以参数注入，不 import @sillytavern/*，可被 vitest 直接单测。

/** 预设条目（酒馆 Prompt 类持久化形态的子集；字段名以预设 JSON 为准）。 */
export type StPresetPrompt = {
  identifier?: string;
  name?: string;
  role?: string;
  content?: string;
  system_prompt?: boolean;
  marker?: boolean;
  /** 0 = 相对位置（进主序列），1 = in-chat 深度注入。 */
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  injection_trigger?: string[];
  /** 由扩展注册的运行时注入条目（不落盘，防御性跳过）。 */
  extension?: boolean;
};

/** 预设顺序表条目（酒馆 prompt_order 组内元素）。 */
export type StPresetOrderEntry = { identifier?: string; enabled?: boolean };

/** 允许进入请求体的采样键（其余字段——尤其连接与凭据类——永不提取）。 */
export const PRESET_SAMPLING_KEYS = [
  'temperature',
  'top_p',
  'frequency_penalty',
  'presence_penalty',
  'max_tokens',
] as const;

/** 预设采样参数（键名已归一为副 API 可用形态；全部可选，未提供者不覆盖副 API 配置）。 */
export type StPresetSampling = Partial<Record<(typeof PRESET_SAMPLING_KEYS)[number], number>>;

/** global 策略的 dummyId（openai.js:689）；旧版 PromptManager 用 100000，一并兜底。 */
const GLOBAL_ORDER_IDS = ['100001', '100000'];

/** 预设里 max_tokens 的字段名是 openai_max_tokens（settingsToUpdate 映射表已核实）。 */
const SAMPLING_SOURCE_KEYS: Record<(typeof PRESET_SAMPLING_KEYS)[number], string[]> = {
  temperature: ['temperature'],
  top_p: ['top_p'],
  frequency_penalty: ['frequency_penalty'],
  presence_penalty: ['presence_penalty'],
  max_tokens: ['openai_max_tokens'],
};

const pickNum = (...values: unknown[]): number | undefined => {
  for (const v of values) {
    if (v === undefined || v === null || v === '') continue;
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
};

/**
 * 提取预设的采样参数。只遍历 SAMPLING_SOURCE_KEYS 白名单——预设对象里的
 * 连接/凭据类字段（reverse_proxy、proxy_password 等）永远不会进入返回值。
 */
export function extractPresetSampling(preset: Record<string, unknown>): StPresetSampling {
  const sampling: StPresetSampling = {};
  for (const key of PRESET_SAMPLING_KEYS) {
    const value = pickNum(...SAMPLING_SOURCE_KEYS[key].map(k => preset[k]));
    if (value !== undefined) sampling[key] = value;
  }
  return sampling;
}

/**
 * 取生效的 prompt_order 组：优先 global 策略的 dummyId（100001，旧版 100000），
 * 未命中已知 dummyId（用户改过策略或预设来自旧版本）时取首个非空组。
 * 结构异常一律返回空数组，由调用方决定降级。
 */
export function extractPresetOrderList(raw: unknown): StPresetOrderEntry[] {
  if (!Array.isArray(raw)) return [];
  const groups = raw.filter(
    (g): g is { character_id?: unknown; order: StPresetOrderEntry[] } =>
      Boolean(g) && Array.isArray((g as { order?: unknown }).order),
  );
  if (!groups.length) return [];
  for (const id of GLOBAL_ORDER_IDS) {
    const hit = groups.find(g => String(g.character_id) === id);
    if (hit) return hit.order;
  }
  return (groups.find(g => g.order.length) ?? groups[0]).order;
}

/** 提取提示词条目数组（仅结构归一，不筛选——筛选在 preset-messages 的展开阶段）。 */
export function extractPresetPrompts(raw: unknown): StPresetPrompt[] {
  return Array.isArray(raw) ? (raw as StPresetPrompt[]) : [];
}

/** 允许透传的提示词后处理模式（与酒馆 openai.js custom_prompt_post_processing_types 对齐，
 *  含已弃用的 claude——服务端自行按 merge 处理）。未知值一律丢弃不透传。 */
export const PRESET_POST_PROCESSING_MODES = [
  '',
  'claude',
  'merge',
  'merge_tools',
  'semi',
  'semi_tools',
  'strict',
  'strict_tools',
  'single',
] as const;

export type StPresetPostProcessing = (typeof PRESET_POST_PROCESSING_MODES)[number];

export const isPresetPostProcessingMode = (value: unknown): value is StPresetPostProcessing =>
  typeof value === 'string' && (PRESET_POST_PROCESSING_MODES as readonly string[]).includes(value);

/** 提取预设顶层 custom_prompt_post_processing。非凭据（行为开关字符串），但仍走显式白名单：
 *  只认枚举值；字段缺失返回 undefined（= 预设未声明，由调用方回退实时值），显式 '' 保留
 *  （= 预设明确声明不处理，跟随语义下同样不透传）。 */
export function extractPresetPostProcessing(preset: Record<string, unknown>): StPresetPostProcessing | undefined {
  const value = preset.custom_prompt_post_processing;
  if (value === undefined || value === null) return undefined;
  return isPresetPostProcessingMode(String(value)) ? (String(value) as StPresetPostProcessing) : undefined;
}

/** 后处理取值链（纯函数）：SPreset ForcedPostProcessing → 预设顶层字段（undefined = 未声明；
 *  显式空串 = 预设明确不处理）→ 酒馆实时设置。各来源的枚举有效性由读取器先行校验。 */
export function pickPresetPostProcessing(spresetMode?: string, presetValue?: string, liveValue?: string): string {
  if (spresetMode) return spresetMode;
  if (presetValue !== undefined) return presetValue;
  return liveValue && liveValue !== '' ? liveValue : '';
}

/** 预设快照（只含提示词栈与采样，绝不含连接/凭据字段）。 */
export type StPresetSnapshot = {
  name: string;
  prompts: StPresetPrompt[];
  order: StPresetOrderEntry[];
  sampling: StPresetSampling;
  /** 预设顶层 custom_prompt_post_processing（未声明为 undefined）。 */
  postProcessing?: StPresetPostProcessing;
};
