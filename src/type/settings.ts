export const setting_field = 'choice';

export const PoolEntry = z
  .object({
    id: z.string(),
    text: z.string(),
    pinned: z.boolean().default(false),
    weight: z.number().min(0).default(1),
    category: z.string().default(''),
    condition: z.string().default(''),
  })
  .prefault({});
export type PoolEntry = z.infer<typeof PoolEntry>;

export const GenerationSettings = z
  .object({
    count_mode: z.enum(['fixed4', 'fixed6', 'random4to8']).default('fixed4'),
    categories_enabled: z.boolean().default(true),
    shuffle_final: z.boolean().default(true),
    pinned_follows_condition: z.boolean().default(true),
    pinned_overflow: z.enum(['send_all', 'trim']).default('send_all'),
    cross_layer_fallback: z.boolean().default(false),
  })
  .prefault({});
export type GenerationSettings = z.infer<typeof GenerationSettings>;

export const DEFAULT_AI_PERSONA =
  '你是「行动选项生成器」，一个专注于为角色扮演对话生成行动选项的 AI 助手。\n' +
  '你的职责是：\n' +
  '1. 根据对话上下文和角色设定，理解当前场景与角色关系\n' +
  '2. 结合提供的行动方向（固定行动与候选行动），生成贴合情境的多样化行动选项\n' +
  '3. 确保选项之间有差异性，涵盖对话、探索、行动、情感等不同方向\n' +
  '4. 选项语言简练，以动词开头，贴合角色语气\n' +
  '5. 不得原样重复提供的行动方向，需在其基础上修改或发挥';

export const DEFAULT_PERSON = '以第二人称叙述，描述角色当前可以采取的行动。';

export const DEFAULT_PROMPT_OUTPUT_FORMAT =
  '每条选项以动词开头，描述一个具体行动，语言简练，贴合角色语气。';

export const DEFAULT_PROMPT_EXTRA =
  '选项应涵盖不同方向(对话、探索、行动、情感等)，避免重复。\n' +
  '如提供了固定行动({{pinned}})或候选行动({{pool_selected}})，需在此基础上修改或发挥，不要原样重复。';

export const PromptRules = z
  .object({
    ai_persona: z.string().default(DEFAULT_AI_PERSONA),
    person: z.string().default(DEFAULT_PERSON),
    output_format: z.string().default(DEFAULT_PROMPT_OUTPUT_FORMAT),
    option_length: z.number().min(0).default(30),
    extra_requirements: z.string().default(DEFAULT_PROMPT_EXTRA),
    context_rounds: z.number().min(0).default(10),
  })
  .prefault({});
export type PromptRules = z.infer<typeof PromptRules>;

export const SecondaryApi = z
  .object({
    id: z.string(),
    name: z.string(),
    apiurl: z.string(),
    key: z.string(),
    model: z.string(),
    source: z.string().default('openai'),
  })
  .prefault({});
export type SecondaryApi = z.infer<typeof SecondaryApi>;

export const SCHEMA_VERSION = 5;

export const GlobalSettings = z
  .object({
    schema_version: z.number().default(0),
    generation: GenerationSettings.prefault({}),
    prompt_rules: PromptRules.prefault({}),
    apis: z.array(SecondaryApi).prefault([]),
    pool: z.array(PoolEntry).prefault([]),
  })
  .prefault({});
export type GlobalSettings = z.infer<typeof GlobalSettings>;

export const CharacterSettings = z
  .object({
    pool: z.array(PoolEntry).prefault([]),
  })
  .prefault({});
export type CharacterSettings = z.infer<typeof CharacterSettings>;

export const WorldInfoSettings = z
  .object({
    enabled: z.boolean().default(true),
    redlight_mode: z.boolean().default(true),
    ejs_compat: z.boolean().default(false),
    excluded_books: z.array(z.string()).prefault([]),
    excluded_entries: z.array(z.string()).prefault([]),
  })
  .prefault({});
export type WorldInfoSettings = z.infer<typeof WorldInfoSettings>;

export const ChatSettings = z
  .object({
    pool: z.array(PoolEntry).prefault([]),
    active_api_id: z.string().nullable().default(null),
    auto_generate: z.boolean().default(true),
    behavior: z.enum(['send', 'fill']).default('send'),
    world_info: WorldInfoSettings.prefault({}),
  })
  .prefault({});
export type ChatSettings = z.infer<typeof ChatSettings>;
