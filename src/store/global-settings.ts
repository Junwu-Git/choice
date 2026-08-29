import { chat_metadata, saveCharacterDebounced, saveSettingsDebounced, this_chid } from '@sillytavern/script';
import { extension_settings, saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import { eventSource, event_types } from '@sillytavern/scripts/events';
import { uuidv4 } from '@sillytavern/scripts/utils';
import {
  GlobalSettings,
  SCHEMA_VERSION,
  setting_field,
  DEFAULT_MODULES,
  SIMPLE_MODULE_CONTENTS,
  BAIBAI_MODULE_IDS,
  DEFAULT_ENRICH_PERSON_STYLE,
  DEFAULT_PERSON_STYLE,
  DEFAULT_OPTION_RULES,
  USER_INSTRUCTION_DEFAULT,
  type PromptConfig,
} from '@/type/settings';
// chat/character store 不反向依赖 global-settings，无循环导入；
// 不能依赖 unplugin-auto-import——它只覆盖 vue/pinia/@vueuse/zod 等预设，
// 本仓库自有模块漏导入时构建不报错（rollup 视为全局引用），直到运行时才 ReferenceError
import { useChatSettingsStore } from '@/store/chat-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { detectSTTheme, getSTInkFallback, watchSTTheme } from '@/core/theme-detector';
import { getStCharacter } from '@/core/st-character';

/** 构建 10 条默认条目，基于用户定义的选项类型 */
function buildDefaultEntries(): PoolEntry[] {
  return [
    {
      id: uuidv4(),
      type: '顺势而为',
      content: '不预设特定策略，让角色顺着当前情境做出最自然的反应，行动与情绪贴合角色既有性格',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '转场推进',
      content: '用一两句精炼的叙述完成时间跳跃或地点切换，快速进入下一段剧情',
      pinned: true,
      weight: 1,
      category: '',
      condition: '',
      rule: '此项固定生成，不参与随机抽取',
    },
    {
      id: uuidv4(),
      type: '意外走向',
      content: '利用当前场景中被忽略的细节或信息差，制造一个意料之外但情理之中的转折',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '暧昧触碰',
      content: '在不逾越角色关系边界的前提下，通过细微的肢体动作或含蓄的暗示拉近情感距离',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '他人视角',
      content: '暂时离开当前角色的视线，以在场另一位角色的眼睛观察同一时刻发生的事情',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '就地取材',
      content: '抓住当前环境中的具体物件或空间特征，做出有目的性的互动行为',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '大胆尝试',
      content: '当常规手段不足以推动局面时，采取一个带有明显风险但可能改变局势走向的行动',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '悄然旁观',
      content: '不主动介入对话，通过眼神、姿态或细微情绪变化传递态度，保持沉默但并非无动于衷',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '此项不涉及对白，纯粹依靠动作与内心活动',
    },
    {
      id: uuidv4(),
      type: '温暖靠近',
      content: '通过表达理解、分享类似经历或提供实际帮助，缩短与对方的心理距离',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '轻松调侃',
      content: '用一句俏皮话、一个自嘲的举动或反差感十足的小动作，冲淡空气中的紧张',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
  ];
}

import type {
  GlobalSettings as GlobalSettingsType,
  PoolConfig,
  PoolConfigEntry,
  PoolEntry,
  PromptModule as PromptModuleType,
  ChatFilterGroup,
  FilterGroup,
  RegexLibraryEntry,
  FilterGroupEntry,
} from '@/type/settings';
import { validateInplace } from '@/util/zod';

// 提示词模块化迁移：旧格式(schema_version=0) → 模块化格式(schema_version=1)
// schema_version=1 → 2：更新模块顺序（user_instruction 移到 system_prompt 之后）
// schema_version=2 → 3：添加预填充模块（assistant_ack / thinking_prompt / assistant_thinking）
// schema_version=3 → 4：聊天记录过滤由 chat_filter_regexes(string[]) 迁移为 chat_filter_rules(规则对象[])
const migratePromptModules = (validated: GlobalSettingsType, legacyRegexes: string[]) => {
  const version = validated.prompt_rules.schema_version ?? 0;

  if (version < 1) {
    const modules = klona(DEFAULT_MODULES);
    if (validated.prompt_rules.system_prompt) {
      const sp = modules.find(m => m.id === 'system_prompt');
      if (sp) sp.content = validated.prompt_rules.system_prompt;
    }
    if (validated.prompt_rules.core_rules) {
      const cr = modules.find(m => m.id === 'core_rules');
      if (cr) cr.content = validated.prompt_rules.core_rules;
    }
    validated.prompt_rules.modules = modules;
  }

  if (version < 2) {
    // 更新现有模块顺序，与 DEFAULT_MODULES 对齐
    resetOrderFromDefaults(validated);
  }

  if (version < 3) {
    // 添加预填充模块：assistant_ack、thinking_prompt、assistant_thinking
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    for (const d of defaults) {
      if (!existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 4) {
    // 旧字段 chat_filter_regexes(string[]) 已在 validateInplace 前被捕获，
    // 此处仅在新规则列表为空时填充，避免覆盖用户已经录入的新数据
    const legacy = legacyRegexes.filter(p => typeof p === 'string' && p);
    if (legacy.length && validated.prompt_rules.chat_filter_rules.length === 0) {
      validated.prompt_rules.chat_filter_rules = legacy.map(p => ({ type: 'regex', pattern: p, replace: '' }));
    }
  }

  if (version < 5) {
    // v5: 调整模块权限标志位
    // 4 个只读模块（world_info_before / persona_description / world_info_after / chat_history）
    // 保持 marker:true + system:true，仅允许移动和开关
    // 其余所有模块开放编辑、删除、复制
    const READONLY_IDS = new Set([
      'world_info_before',
      'persona_description',
      'world_info_after',
      'chat_history',
      'baibai_summary',
    ]);
    for (const m of validated.prompt_rules.modules) {
      if (READONLY_IDS.has(m.id)) {
        m.marker = true;
        m.system = true;
      } else {
        m.marker = false;
        m.system = false;
      }
    }
  }

  if (version < 6) {
    // v6: 旧 chat_filter_rules 平铺列表 → 分组结构
    const oldRules = validated.prompt_rules.chat_filter_rules ?? [];
    if (oldRules.length > 0 && validated.prompt_rules.chat_filter_groups.length === 0) {
      const group: ChatFilterGroup = {
        id: uuidv4(),
        name: '默认分组',
        enabled: true,
        rules: klona(oldRules),
        // 迁移自旧平铺列表，无绑定信息；留空否则运行时为 undefined，分区判定会把分组错当预设/角色卡绑定
        preset_name: null,
        character_id: null,
      };
      validated.prompt_rules.chat_filter_groups = [group];
    }
    validated.prompt_rules.chat_filter_rules = [];
  }

  if (version < 7) {
    // v7: 追加柏宝书记忆源模块（baibai_summary、baibai_state）
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    for (const d of defaults) {
      if (BAIBAI_MODULE_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    resetOrderFromDefaults(validated);

    // 旧字段 exclude_hidden_messages → context_mode 迁移
    const oldExclude = (validated.prompt_rules as any).exclude_hidden_messages;
    if (oldExclude !== undefined) {
      (validated.prompt_rules as any).context_mode = oldExclude ? 'visible_only' : 'rounds';
      delete (validated.prompt_rules as any).exclude_hidden_messages;
    }
  }

  if (version < 8) {
    // v8: 添加 XML 分段包装模块（reference_open/close、history_open/close）
    // chat_history 默认 order 从 7 调整为 11，使 reference 块连续
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    const WRAPPER_IDS = new Set(['reference_open', 'reference_close', 'history_open', 'history_close']);
    for (const d of defaults) {
      if (WRAPPER_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 9) {
    // v9: 润色提示词模块化（enrich_prompt 从固定卡片转为模块），user_instruction 标记 option_only
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));

    // 给 user_instruction 设置 option_only
    const ui = validated.prompt_rules.modules.find(m => m.id === 'user_instruction');
    if (ui) ui.option_only = true;

    // 创建 enrich_prompt 模块，内容取旧字段（为空则用默认值）
    if (!existingIds.has('enrich_prompt')) {
      const defaultEnrich = defaults.find(m => m.id === 'enrich_prompt');
      const enrichContent = validated.prompt_rules.enrich_prompt || defaultEnrich?.content || '';
      validated.prompt_rules.modules.push({
        id: 'enrich_prompt',
        name: '润色提示词',
        role: 'system',
        content: enrichContent,
        marker: false,
        system: false,
        enabled: true,
        order: 3,
        enrich_only: true,
        option_only: false,
      });
    }

    // 将 order >= 3 的现有模块（除 enrich_prompt 外）order +1
    for (const m of validated.prompt_rules.modules) {
      if (m.id !== 'enrich_prompt' && m.order >= 3) {
        m.order += 1;
      }
    }

    resetOrderFromDefaults(validated);
  }

  if (version < 10) {
    // v10: 更新 user_instruction 模板（去掉过时的"跳过场景"规则，改用 {{pinned_count}}）
    const ui = validated.prompt_rules.modules.find(m => m.id === 'user_instruction');
    if (ui && ui.content.includes('其中 1 个固定为"跳过场景"类型')) {
      ui.content = USER_INSTRUCTION_DEFAULT;
    }
  }

  if (version < 11) {
    // v11: 柏宝书模块默认启用，调整顺序
    const baibaiSummary = validated.prompt_rules.modules.find(m => m.id === 'baibai_summary');
    if (baibaiSummary) baibaiSummary.enabled = true;
    resetOrderFromDefaults(validated);
  }

  if (version < 12) {
    // v12: 新增角色卡上下文模块（描述/性格/场景），让行动选项生成时也能看到角色卡核心设定
    // 此前这些字段只在 generatePoolEntries 中注入，generateOptions 缺失
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    const CHAR_IDS = new Set(['char_description', 'char_personality', 'char_scenario']);
    for (const d of defaults) {
      if (CHAR_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    // 重置只读/系统标志位，确保新增模块也被正确标记
    const READONLY_IDS = new Set([
      'world_info_before',
      'persona_description',
      'char_description',
      'char_personality',
      'char_scenario',
      'world_info_after',
      'chat_history',
      'baibai_summary',
    ]);
    for (const m of validated.prompt_rules.modules) {
      if (READONLY_IDS.has(m.id)) {
        m.marker = true;
        m.system = true;
      }
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 14) {
    // v13: 新增输出规格模块（output_spec），强化格式约束；更新 thinking_prompt 格式检查项
    const defaults = klona(DEFAULT_MODULES);
    const spec = defaults.find(m => m.id === 'output_spec');
    if (spec && !validated.prompt_rules.modules.some(m => m.id === 'output_spec')) {
      validated.prompt_rules.modules.push(spec);
    }
    const newTP = defaults.find(m => m.id === 'thinking_prompt');
    const oldTP = validated.prompt_rules.modules.find(m => m.id === 'thinking_prompt');
    if (newTP && oldTP) {
      oldTP.content = newTP.content;
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 15) {
    // v15: 选项生成专用模块标记 option_only，避免润色模式发送冲突指令
    const OPTION_ONLY_IDS = new Set(['core_rules', 'output_spec', 'thinking_prompt', 'assistant_thinking']);
    for (const m of validated.prompt_rules.modules) {
      if (OPTION_ONLY_IDS.has(m.id)) {
        m.option_only = true;
      }
    }
  }

  if (version < 16) {
    // v16: 追加润色专用模块（规则/输出规格/自检/应答），与选项生成模块完全平行
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    const ENRICH_IDS = new Set(['enrich_core_rules', 'enrich_output_spec', 'enrich_thinking', 'enrich_assistant']);
    for (const d of defaults) {
      if (ENRICH_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    // v9 迁移 bug：enrich_prompt role 误写为 'system'，应为 'user'（与 DEFAULT_MODULES 一致）
    const ep = validated.prompt_rules.modules.find(m => m.id === 'enrich_prompt');
    if (ep && ep.role === 'system') {
      ep.role = 'user';
    }
  }

  if (version < 17) {
    validated.prompt_rules.option_min_chars ??= 30;
    validated.prompt_rules.option_max_chars ??= 80;
    validated.prompt_rules.enrich_min_chars ??= 30;
    validated.prompt_rules.enrich_max_chars ??= 80;
    validated.prompt_rules.enrich_person_style ??= DEFAULT_ENRICH_PERSON_STYLE;
    validated.prompt_rules.option_person ??= '第三人称';
    validated.prompt_rules.enrich_person ??= '第三人称';
  }

  validated.prompt_rules.schema_version = 17;
};

/** 将现有模块的 order 重置为 DEFAULT_MODULES 中的值 */
const resetOrderFromDefaults = (validated: GlobalSettingsType) => {
  const defaults = klona(DEFAULT_MODULES);
  const defaultMap = new Map(defaults.map(m => [m.id, m]));
  for (const m of validated.prompt_rules.modules) {
    const d = defaultMap.get(m.id);
    if (d) m.order = d.order;
  }
};

/** 老存档（schema < 19）迁移专用：创建「经典/简洁」双提示词配置并加载简洁到工作副本。
 *  经典 = 用户迁移前已有提示词的存档（可能是他们自己改过的内容），不是内置预设；
 *  简洁 = 出厂默认基准，is_default: true。
 *  前置条件：调用前 pr.modules 必须已填充完整（初始化顺序上 migratePromptModules 先于本函数），
 *  否则空模块会被原样快照进「经典」——全新档曾经的静默 bug。
 *  全新安装不走本函数（没有用户状态可存档），走 ensureDefaultPromptConfig。 */
const ensureBuiltinPromptConfigs = (validated: GlobalSettingsType) => {
  const pr = validated.prompt_rules;

  // 1. 创建"经典"配置（快照当前状态）
  const classicConfig: PromptConfig = {
    id: uuidv4(),
    name: '经典',
    is_default: false,
    modules: klona(pr.modules),
    person_style: pr.person_style ?? '',
    option_rules: pr.option_rules ?? '',
    option_person: pr.option_person ?? '第三人称',
    enrich_person: pr.enrich_person ?? '第三人称',
    enrich_person_style: pr.enrich_person_style ?? DEFAULT_ENRICH_PERSON_STYLE,
    option_min_chars: pr.option_min_chars ?? 30,
    option_max_chars: pr.option_max_chars ?? 80,
    enrich_min_chars: pr.enrich_min_chars ?? 30,
    enrich_max_chars: pr.enrich_max_chars ?? 80,
    context_rounds: pr.context_rounds ?? 10,
    context_mode: pr.context_mode ?? 'visible_only',
    prefill_enabled: pr.prefill_enabled ?? true,
    baibai_enabled: pr.baibai_enabled ?? false,
  };

  // 2. 创建"简洁"配置（简化版模块）
  //    简洁文本单一来源是 settings.ts 的 SIMPLE_MODULE_CONTENTS（派生自 DEFAULT_MODULES），
  //    避免迁移代码与 JSON 默认内容两处文本漂移
  const simplifiedModules = klona(pr.modules).map((m: PromptModuleType) => {
    const simple = SIMPLE_MODULE_CONTENTS[m.id];
    return simple !== undefined ? { ...m, content: simple } : m;
  });

  const simpleConfig: PromptConfig = {
    id: uuidv4(),
    name: '简洁',
    is_default: true,
    modules: simplifiedModules,
    person_style: '',
    option_rules: '',
    option_person: '第三人称',
    enrich_person: '第三人称',
    enrich_person_style: DEFAULT_ENRICH_PERSON_STYLE,
    option_min_chars: 30,
    option_max_chars: 80,
    enrich_min_chars: 30,
    enrich_max_chars: 80,
    context_rounds: 10,
    context_mode: 'visible_only',
    prefill_enabled: true,
    baibai_enabled: false,
  };

  validated.prompt_configs = [classicConfig, simpleConfig];

  // 3. 将"简洁"配置加载到 prompt_rules
  pr.modules = klona(simpleConfig.modules);
  pr.person_style = '';
  pr.option_rules = '';
  pr.option_person = '第三人称';
  pr.enrich_person = '第三人称';
  pr.enrich_person_style = DEFAULT_ENRICH_PERSON_STYLE;
  pr.option_min_chars = 30;
  pr.option_max_chars = 80;
  pr.enrich_min_chars = 30;
  pr.enrich_max_chars = 80;
  pr.context_rounds = 10;
  pr.context_mode = 'visible_only';
  pr.prefill_enabled = true;
  pr.baibai_enabled = false;

  // 4. 旧过滤分组（prompt_rules.chat_filter_groups）搬运到新家 filter_settings.groups。
  //    新 FilterGroup 用 entries（引用正则库或内联规则），旧分组是平铺 rules 数组——逐条包成
  //    library_entry_id=null 的内联条目。复制而非移动：旧字段留在原地，迁移逻辑有误时可发
  //    修复版重跑；filter_settings.groups 非空说明已搬过，跳过保证幂等。
  if (validated.filter_settings.groups.length === 0 && (pr.chat_filter_groups ?? []).length > 0) {
    validated.filter_settings.groups = (pr.chat_filter_groups ?? []).map(g => ({
      id: g.id,
      name: g.name,
      enabled: g.enabled,
      entries: g.rules.map(rule => ({ library_entry_id: null, inline_rule: klona(rule) })),
      preset_name: g.preset_name ?? null,
      character_id: g.character_id ?? null,
    }));
  }
};

/** 全新档/恢复出厂的默认提示词配置：仅一个「简洁」（is_default: true），不建经典。
 *  经典只作为老存档迁移时用户已有提示词的存档存在——全新环境没有"用户改动"可存档，
 *  不应把内置默认伪装成经典预设。pr.modules 此时必须已是简洁默认（JSON 即简洁基准）。
 *  幂等：prompt_configs 非空时跳过。 */
const ensureDefaultPromptConfig = (validated: GlobalSettingsType) => {
  if (validated.prompt_configs.length > 0) return;
  const pr = validated.prompt_rules;
  validated.prompt_configs = [
    {
      id: uuidv4(),
      name: '简洁',
      is_default: true,
      modules: klona(pr.modules),
      person_style: pr.person_style ?? '',
      option_rules: pr.option_rules ?? '',
      option_person: pr.option_person ?? '第三人称',
      enrich_person: pr.enrich_person ?? '第三人称',
      enrich_person_style: pr.enrich_person_style ?? DEFAULT_ENRICH_PERSON_STYLE,
      option_min_chars: pr.option_min_chars ?? 30,
      option_max_chars: pr.option_max_chars ?? 80,
      enrich_min_chars: pr.enrich_min_chars ?? 30,
      enrich_max_chars: pr.enrich_max_chars ?? 80,
      context_rounds: pr.context_rounds ?? 10,
      context_mode: pr.context_mode ?? 'visible_only',
      prefill_enabled: pr.prefill_enabled ?? true,
      baibai_enabled: pr.baibai_enabled ?? false,
    },
  ];
};

const applyDefaults = (validated: GlobalSettingsType) => {
  if ((validated.schema_version ?? 0) < 9) {
    // 旧三层池数据迁移：收集 → 去重 → 合并为 master_pool + 自动配置
    const oldGlobalPool: PoolEntry[] = (_.get(extension_settings, [setting_field, 'pool']) as PoolEntry[]) ?? [];
    const oldGlobalGen = _.get(extension_settings, [setting_field, 'generation']);
    let charName = '';
    let oldCharPool: PoolEntry[] = [];
    try {
      const ch = getStCharacter(this_chid);
      if (ch) {
        charName = ch.name || '';
        oldCharPool = (_.get(ch, ['data', 'extensions', setting_field, 'pool']) as PoolEntry[]) ?? [];
      }
    } catch {
      // 角色数据不可用时跳过
    }
    let oldChatPool: PoolEntry[] = [];
    try {
      const cMeta = chat_metadata?.[setting_field];
      if (cMeta) {
        oldChatPool = (cMeta.pool as PoolEntry[]) ?? [];
      }
    } catch {
      // 聊天元数据不可用时跳过
    }

    // 按 type 去重合并：相同 type 只保留第一条（优先级：聊天 > 角色 > 全局）
    const seen = new Map<string, PoolEntry>();
    for (const e of oldChatPool) {
      if (!seen.has(e.type)) seen.set(e.type, e);
    }
    for (const e of oldCharPool) {
      if (!seen.has(e.type)) seen.set(e.type, e);
    }
    for (const e of oldGlobalPool) {
      if (!seen.has(e.type)) seen.set(e.type, e);
    }
    validated.master_pool = [...seen.values()];

    const configs: PoolConfig[] = [];
    const makeEntries = (pool: PoolEntry[]): PoolConfigEntry[] =>
      pool.map(e => ({ entry_id: e.id, pinned: e.pinned, weight: e.weight, condition: e.condition }));

    if (oldGlobalPool.length > 0) {
      configs.push({
        id: uuidv4(),
        name: '全局默认',
        entries: makeEntries(oldGlobalPool),
        is_default: true,
        generation: (oldGlobalGen as any) ?? {
          count_mode: '4',
          categories_enabled: true,
          shuffle_final: true,
          pinned_overflow: 'send_all',
          cross_layer_fallback: false,
        },
      });
    }

    if (oldCharPool.length > 0) {
      const charConfigId = uuidv4();
      configs.push({
        id: charConfigId,
        name: charName ? `角色 ${charName}` : '角色默认',
        entries: makeEntries(oldCharPool),
        is_default: configs.length === 0,
        generation: {
          count_mode: '4',
          categories_enabled: true,
          shuffle_final: true,
          pinned_overflow: 'send_all',
          cross_layer_fallback: false,
        },
      });
      try {
        const ch = getStCharacter(this_chid);
        if (ch) {
          _.set(ch, ['data', 'extensions', setting_field, 'config_id'], charConfigId);
          // 旧 pool 字段被 config 体系取代，删除残留；extensions 可能在异常卡上缺失
          delete ch.data?.extensions?.[setting_field]?.pool;
          saveCharacterDebounced();
        }
      } catch {
        // 角色绑定失败时静默跳过
      }
    }

    if (oldChatPool.length > 0) {
      const chatConfigId = uuidv4();
      configs.push({
        id: chatConfigId,
        name: '聊天默认',
        entries: makeEntries(oldChatPool),
        is_default: configs.length === 0,
        generation: {
          count_mode: '4',
          categories_enabled: true,
          shuffle_final: true,
          pinned_overflow: 'send_all',
          cross_layer_fallback: false,
        },
      });
      try {
        const cMeta = chat_metadata?.[setting_field];
        if (cMeta) {
          cMeta.config_id = chatConfigId;
          delete cMeta.pool;
          saveMetadataDebounced();
        }
      } catch {
        // 聊天绑定失败时静默跳过
      }
    }

    // 如果没有任何配置，创建默认配置（含 4 条预设条目）
    if (configs.length === 0) {
      const defaultEntries = buildDefaultEntries();
      validated.master_pool = [...defaultEntries];
      configs.push({
        id: uuidv4(),
        name: '默认配置',
        entries: defaultEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          condition: e.condition,
        })),
        is_default: true,
        generation: {
          count_mode: '4',
          categories_enabled: true,
          shuffle_final: true,
          pinned_overflow: 'send_all',
          cross_layer_fallback: false,
        },
      });
    }

    validated.configs = configs;

    // 清理旧字段
    delete (validated as any).pool;
    delete (validated as any).generation;
  }

  if ((validated.schema_version ?? 0) < 8) {
    try {
      const chatWI = chat_metadata?.[setting_field]?.world_info;
      if (chatWI && chatWI.enabled !== undefined) {
        validated.world_info = {
          ...validated.world_info,
          enabled: chatWI.enabled ?? true,
        };
      }
    } catch {
      // chat_metadata 不可用时跳过迁移，使用默认值
    }
  }

  if ((validated.schema_version ?? 0) < 10) {
    // 移除 pinned_follows_condition（条件改为 AI 判断）
    for (const cfg of validated.configs) {
      delete (cfg.generation as any).pinned_follows_condition;
    }
    // 填充 group_order：从现有条目的 category 去重后按字母排序
    if (!validated.group_order || validated.group_order.length === 0) {
      const cats = new Set<string>();
      for (const e of validated.master_pool) {
        if (e.category.trim()) cats.add(e.category.trim());
      }
      validated.group_order = [...cats].sort();
    }
  }

  if ((validated.schema_version ?? 0) < 13) {
    // v13: 对已迁移但池为空的用户，补建默认条目和配置
    if (validated.master_pool.length === 0 && validated.configs.length === 0) {
      const defaultEntries = buildDefaultEntries();
      validated.master_pool = [...defaultEntries];
      validated.configs = [
        {
          id: uuidv4(),
          name: '默认配置',
          entries: defaultEntries.map(e => ({
            entry_id: e.id,
            pinned: e.pinned,
            weight: e.weight,
            condition: e.condition,
          })),
          is_default: true,
          generation: {
            count_mode: '4',
            categories_enabled: true,
            shuffle_final: true,
            pinned_overflow: 'send_all',
            cross_layer_fallback: false,
          },
        },
      ];
    }
  }

  // v18: 旧 theme 字段迁移到 theme_mode
  if ((validated.schema_version ?? 0) < 18) {
    const oldTheme = (validated.ui as any).theme;
    if (oldTheme && (validated.ui as any).theme_mode === undefined) {
      (validated.ui as any).theme_mode = oldTheme;
    }
  }

  // v19 的提示词配置创建已移出本函数：分流逻辑（老存档建经典+简洁 / 全新档仅简洁）
  // 依赖"是否存在旧存档"这一信息，只有 store 初始化流程知道，见 init 中 wasPreV19 分支

  validated.schema_version = SCHEMA_VERSION;
};

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  // 迁移逻辑处理的是未经 Zod 验证的旧存档，字段形态不可知，显式 any；
  // 且 extension_settings 的类型声明不含 choice 命名空间键，_.get 会推断成 undefined/never
  const existing = _.get(extension_settings, setting_field) as any;
  // 旧字段 chat_filter_regexes 已被新 schema 移除，Zod 解析会将其剥离，
  // 因此必须在 validateInplace 之前捕获，供迁移使用
  const legacyRegexes: string[] = _.get(existing, 'prompt_rules.chat_filter_regexes', []) ?? [];

  // 旧 entry_ids → entries 格式转换：必须在 Zod 验证之前执行，
  // 否则 Zod 会因 entries 为 undefined 而报错
  const rawConfigs: any[] = _.get(existing, 'configs', []) ?? [];
  const needsConversion = rawConfigs.some((c: any) => c.entry_ids !== undefined || c.entries === undefined);
  if (needsConversion && rawConfigs.length > 0) {
    const masterPool: PoolEntry[] = (_.get(existing, 'master_pool') as PoolEntry[]) ?? [];
    const masterMap = new Map(masterPool.map(e => [e.id, e]));
    for (const cfg of rawConfigs) {
      // 如果存在旧格式 entry_ids，转换为 entries
      if (Array.isArray(cfg.entry_ids)) {
        cfg.entries = cfg.entry_ids.map((id: string) => {
          const src = masterMap.get(id);
          return {
            entry_id: id,
            pinned: src?.pinned ?? false,
            weight: src?.weight ?? 1,
            condition: src?.condition ?? '',
          };
        });
        delete cfg.entry_ids;
      }
      // 兜底：确保 entries 始终是数组
      if (!Array.isArray(cfg.entries)) {
        cfg.entries = [];
      }
    }
    _.set(extension_settings, [setting_field, 'configs'], rawConfigs);
    saveSettingsDebounced();
  }

  // v14 迁移（必须在 Zod 验证前执行，因为 schema 已将 text 改为 type）
  const rawPool = _.get(existing, 'master_pool');
  if (Array.isArray(rawPool) && rawPool.length > 0 && rawPool[0].text !== undefined) {
    for (const e of rawPool) {
      e.type = e.text ?? '';
      e.content = '';
      e.rule = '';
      delete e.text;
    }
  }

  // enrich_count 从 number 转 string（预校验迁移，必须在 Zod 验证前执行）
  const rawUI = _.get(existing, 'ui');
  if (rawUI && typeof rawUI.enrich_count === 'number') {
    rawUI.enrich_count = String(rawUI.enrich_count);
  }

  // 注意：曾有一个 v14 迁移块把 chat_filter_groups.character_id 从字符串转 number，
  // 方向与现行 schema（z.preprocess(String) 归一化为字符串）相反，已删除——
  // schema 的 preprocess 已兼容旧数字/旧字符串存档，保留该块只会误导后人。

  const validated = validateInplace(GlobalSettings, existing);

  // v19 提示词配置创建的分流依据，必须在 applyDefaults 置 SCHEMA_VERSION 前捕获：
  // 有旧存档（existing 非空）→ 经典 = 用户已有提示词的存档 + 简洁默认；
  // 全新档 → 仅一个简洁默认配置，不造经典（内置默认不该伪装成用户存档）
  const wasPreV19 = (validated.schema_version ?? 0) < 19;
  const hadExistingSave = existing !== undefined && existing !== null;

  // 提示词模块化迁移与全局 schema_version 无关，每次初始化都检查。
  // 必须先于 applyDefaults 执行：v19 的经典/简洁配置快照依赖迁移后填充完整的 pr.modules，
  // 顺序颠倒时全新档会把空 modules 快照进两个配置（历史 bug）
  const promptNeedsMigration = (validated.prompt_rules.schema_version ?? 0) < 17;
  if (promptNeedsMigration) {
    migratePromptModules(validated, legacyRegexes);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  const needsMigration = (validated.schema_version ?? 0) < SCHEMA_VERSION;
  if (needsMigration) {
    applyDefaults(validated);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  if (wasPreV19) {
    if (hadExistingSave) {
      ensureBuiltinPromptConfigs(validated);
    } else {
      ensureDefaultPromptConfig(validated);
    }
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  // 显式标注：ref() 的 UnwrapRef 推断遇 zod4 输出类型（含 StandardSchema 符号键）会退化成 any，
  // 导致所有消费方 settings.configs/master_pool 等变 any[]，回调参数全变隐式 any
  const settings = ref<GlobalSettingsType>(validated);

  watch(
    settings,
    new_settings => {
      _.set(extension_settings, setting_field, klona(new_settings));
      saveSettingsDebounced();
    },
    { deep: true },
  );

  const currentPresetName = ref<string | null>(null);
  // this_chid 在酒馆 1.18 实测是字符串（如 "2"），旧版本可能是数字——统一归一化为字符串，
  // 与 FilterGroup.character_id 的 schema 归一化保持一致，否则 === 比较会因类型不一致失配
  const normChid = (v: string | number | null | undefined) => (v == null ? undefined : String(v));
  const currentCharacterId = ref<string | undefined>(normChid(this_chid));

  function syncPresetName() {
    try {
      const presetEl = $('#settings_preset_openai');
      if (presetEl.length) {
        currentPresetName.value = presetEl.find(':selected').text() || null;
      }
    } catch {
      /* DOM 不可用时跳过 */
    }
  }
  syncPresetName();

  try {
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => syncPresetName());
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
      currentCharacterId.value = normChid(this_chid);
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
      currentCharacterId.value = normChid(this_chid);
    });
  } catch {
    /* eventSource 不可用时静默跳过 */
  }

  const sortedEnabledModules = computed(() =>
    settings.value.prompt_rules.modules.filter(m => m.enabled).sort((a, b) => a.order - b.order),
  );

  const allModules = computed(() => [...settings.value.prompt_rules.modules].sort((a, b) => a.order - b.order));

  const sortedEnabledFilterRules = computed(() => {
    const preset = currentPresetName.value;
    const chid = currentCharacterId.value;
    const fs = settings.value.filter_settings;
    const library = fs.regex_library ?? [];
    const libMap = new Map(library.map(e => [e.id, e]));
    return (fs.groups ?? [])
      .filter(g => {
        if (!g.enabled) return false;
        if (g.preset_name !== null && g.preset_name !== preset) return false;
        if (g.character_id !== null && g.character_id !== chid) return false;
        return true;
      })
      .flatMap(g =>
        (g.entries ?? [])
          .map(e => {
            if (e.library_entry_id) {
              const libEntry = libMap.get(e.library_entry_id);
              if (!libEntry) return null;
              return {
                type: libEntry.type,
                pattern: libEntry.pattern,
                // ?? 兜底：老存档/裸 push 的条目可能没有 replace 字段
                replace: libEntry.replace ?? '',
                start: libEntry.start,
                end: libEntry.end,
              };
            }
            return e.inline_rule;
          })
          // filter(Boolean) 不收窄类型：下游（generator 的 tag/regex 判别）需要排除 null 后的联合
          .filter((r): r is NonNullable<typeof r> => r !== null),
      );
  });

  // _afterId 为预留参数：产品上支持"在指定模块后插入"，当前实现一律追加到末尾；
  // 保留参数位避免调用方（传 undefined 占位）与未来实现一起改动
  function addModule(_afterId?: string, enrichOnly = false, optionOnly = false) {
    const modules = settings.value.prompt_rules.modules;
    const maxOrder = modules.length ? Math.max(...modules.map(m => m.order)) : -1;
    const name = optionOnly ? '选项模块' : enrichOnly ? '润色模块' : '通用模块';
    const newModule: PromptModuleType = {
      id: uuidv4(),
      name,
      role: 'system',
      content: '',
      marker: false,
      system: false,
      enabled: true,
      order: maxOrder + 1,
      enrich_only: enrichOnly,
      option_only: optionOnly,
    };
    modules.push(newModule);
    return newModule;
  }

  function addFilterGroup(area: 'global' | 'preset' | 'character') {
    const fs = settings.value.filter_settings;
    const group: FilterGroup = {
      id: uuidv4(),
      name: '新分组',
      enabled: true,
      entries: [],
      preset_name: area === 'preset' ? currentPresetName.value : null,
      character_id: area === 'character' ? (currentCharacterId.value ?? null) : null,
    };
    fs.groups.push(group);
    return group;
  }

  function removeFilterGroup(id: string) {
    const fs = settings.value.filter_settings;
    const idx = fs.groups.findIndex(g => g.id === id);
    if (idx !== -1) fs.groups.splice(idx, 1);
  }

  function addFilterGroupEntry(groupId: string, entry: FilterGroupEntry) {
    const fs = settings.value.filter_settings;
    const group = fs.groups.find(g => g.id === groupId);
    if (group) group.entries.push(entry);
  }

  function removeFilterGroupEntry(groupId: string, entryIdx: number) {
    const fs = settings.value.filter_settings;
    const group = fs.groups.find(g => g.id === groupId);
    if (group) group.entries.splice(entryIdx, 1);
  }

  function addRegexLibraryEntry(category: string = ''): RegexLibraryEntry {
    const fs = settings.value.filter_settings;
    const entry: RegexLibraryEntry = {
      id: uuidv4(),
      name: '',
      type: 'tag',
      pattern: '',
      replace: '',
      start: '',
      end: '',
      category,
    };
    fs.regex_library.push(entry);
    return entry;
  }

  function removeRegexLibraryEntry(id: string) {
    const fs = settings.value.filter_settings;
    const idx = fs.regex_library.findIndex(e => e.id === id);
    if (idx !== -1) fs.regex_library.splice(idx, 1);
    for (const group of fs.groups) {
      group.entries = group.entries.filter(e => e.library_entry_id !== id);
    }
  }

  function updateRegexLibraryEntry(id: string, patch: Partial<RegexLibraryEntry>) {
    const fs = settings.value.filter_settings;
    const entry = fs.regex_library.find(e => e.id === id);
    if (entry) Object.assign(entry, patch);
  }

  function renameRegexLibraryGroup(oldCategory: string, newCategory: string) {
    const fs = settings.value.filter_settings;
    for (const entry of fs.regex_library) {
      if (entry.category === oldCategory) {
        entry.category = newCategory;
      }
    }
    const libGroups = fs.library_groups ?? [];
    const idx = libGroups.indexOf(oldCategory);
    if (idx !== -1) libGroups[idx] = newCategory;
  }

  function deleteRegexLibraryGroup(category: string) {
    const fs = settings.value.filter_settings;
    const ids = new Set(fs.regex_library.filter(e => e.category === category).map(e => e.id));
    fs.regex_library = fs.regex_library.filter(e => e.category !== category);
    const libGroups = fs.library_groups ?? [];
    const idx = libGroups.indexOf(category);
    if (idx !== -1) libGroups.splice(idx, 1);
    for (const group of fs.groups) {
      group.entries = group.entries.filter(e => !ids.has(e.library_entry_id ?? ''));
    }
  }

  function duplicateModule(id: string) {
    const READONLY_IDS = new Set([
      'world_info_before',
      'persona_description',
      'char_description',
      'char_personality',
      'char_scenario',
      'world_info_after',
      'chat_history',
      'baibai_summary',
    ]);
    if (READONLY_IDS.has(id)) return;
    const modules = settings.value.prompt_rules.modules;
    const src = modules.find(m => m.id === id);
    if (!src) return;
    const copy: PromptModuleType = {
      ...klona(src),
      id: uuidv4(),
      name: src.name + '-副本',
      system: false,
      order: Math.max(...modules.map(m => m.order)) + 1,
    };
    modules.push(copy);
  }

  function removeModule(id: string) {
    const modules = settings.value.prompt_rules.modules;
    const idx = modules.findIndex(m => m.id === id);
    if (idx === -1) return;
    const m = modules[idx];
    if (m.system) return;
    modules.splice(idx, 1);
  }

  function reorderModules(orderedIds: string[]) {
    const modules = settings.value.prompt_rules.modules;
    const map = new Map(modules.map(m => [m.id, m]));
    orderedIds.forEach((id, i) => {
      const m = map.get(id);
      if (m) m.order = i;
    });
  }

  function resetModuleOrder() {
    const modules = settings.value.prompt_rules.modules;
    const defaults = klona(DEFAULT_MODULES);
    const defaultMap = new Map(defaults.map(m => [m.id, m]));
    modules.forEach(m => {
      const d = defaultMap.get(m.id);
      if (d) m.order = d.order;
    });
  }

  function resetModuleContent(id: string) {
    const modules = settings.value.prompt_rules.modules;
    const mod = modules.find(m => m.id === id);
    if (!mod || mod.marker) return;
    const defaults = klona(DEFAULT_MODULES);
    const defaultMod = defaults.find(m => m.id === id);
    if (!defaultMod) return;
    mod.content = defaultMod.content;
    // core_rules 模块内容恢复时，同步重置新手字段，保持一致性
    if (id === 'core_rules') {
      settings.value.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
      settings.value.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
    }
  }

  function resetAllPromptContents() {
    const modules = settings.value.prompt_rules.modules;
    const defaults = klona(DEFAULT_MODULES);
    const defaultMap = new Map(defaults.map(m => [m.id, m]));
    for (const mod of modules) {
      if (mod.marker) continue;
      const d = defaultMap.get(mod.id);
      if (d) mod.content = d.content;
    }
    settings.value.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
    settings.value.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
  }

  function syncPromptRulesToConfig(config: PromptConfig) {
    const pr = settings.value.prompt_rules;
    config.modules = klona(pr.modules);
    config.person_style = pr.person_style;
    config.option_rules = pr.option_rules;
    config.option_person = pr.option_person;
    config.enrich_person = pr.enrich_person;
    config.enrich_person_style = pr.enrich_person_style;
    config.option_min_chars = pr.option_min_chars;
    config.option_max_chars = pr.option_max_chars;
    config.enrich_min_chars = pr.enrich_min_chars;
    config.enrich_max_chars = pr.enrich_max_chars;
    config.context_rounds = pr.context_rounds;
    config.context_mode = pr.context_mode;
    config.prefill_enabled = pr.prefill_enabled;
    config.baibai_enabled = pr.baibai_enabled;
  }

  /** 工作副本当前归属的配置 id（最近一次 loadPromptConfig 的加载目标），仅会话内有效。
   *  切换配置时的回写必须命中"正在编辑的配置"而非"生效配置"（聊天/角色绑定决定）：
   *  两者不一致时按生效配置回写，会把 A 配置的编辑内容静默串写进 B——导入落盘成果
   *  也会被随后的切换冲掉。跨会话无归属记录（boot 时 prompt_rules 即生效配置内容），
   *  归属为 null 时回退旧语义按生效配置回写，行为不变。 */
  let promptEditConfigId: string | null = null;

  function loadPromptConfig(config: PromptConfig) {
    const pr = settings.value.prompt_rules;
    pr.modules = klona(config.modules);
    pr.person_style = config.person_style;
    pr.option_rules = config.option_rules;
    pr.option_person = config.option_person;
    pr.enrich_person = config.enrich_person;
    pr.enrich_person_style = config.enrich_person_style;
    pr.option_min_chars = config.option_min_chars;
    pr.option_max_chars = config.option_max_chars;
    pr.enrich_min_chars = config.enrich_min_chars;
    pr.enrich_max_chars = config.enrich_max_chars;
    pr.context_rounds = config.context_rounds;
    pr.context_mode = config.context_mode;
    pr.prefill_enabled = config.prefill_enabled;
    pr.baibai_enabled = config.baibai_enabled;
    promptEditConfigId = config.id;
  }

  function switchPromptConfig(configId: string) {
    const configs = settings.value.prompt_configs;
    const owner = promptEditConfigId ? configs.find(c => c.id === promptEditConfigId) : null;
    const oldConfig =
      owner ??
      configs.find(c => {
        const chatId = useChatSettingsStore().settings.prompt_config_id;
        const charId = useCharacterSettingsStore().settings.prompt_config_id;
        if (chatId) return c.id === chatId;
        if (charId) return c.id === charId;
        return c.is_default;
      });
    if (oldConfig && oldConfig.id !== configId) {
      syncPromptRulesToConfig(oldConfig);
    }
    const newConfig = configs.find(c => c.id === configId);
    if (newConfig) {
      loadPromptConfig(newConfig);
    }
  }

  function createPromptConfig(name: string, isDefault: boolean) {
    const configs = settings.value.prompt_configs;
    const cfg: PromptConfig = {
      id: uuidv4(),
      name,
      is_default: isDefault || configs.length === 0,
      modules: klona(settings.value.prompt_rules.modules),
      person_style: settings.value.prompt_rules.person_style,
      option_rules: settings.value.prompt_rules.option_rules,
      option_person: settings.value.prompt_rules.option_person,
      enrich_person: settings.value.prompt_rules.enrich_person,
      enrich_person_style: settings.value.prompt_rules.enrich_person_style,
      option_min_chars: settings.value.prompt_rules.option_min_chars,
      option_max_chars: settings.value.prompt_rules.option_max_chars,
      enrich_min_chars: settings.value.prompt_rules.enrich_min_chars,
      enrich_max_chars: settings.value.prompt_rules.enrich_max_chars,
      context_rounds: settings.value.prompt_rules.context_rounds,
      context_mode: settings.value.prompt_rules.context_mode,
      prefill_enabled: settings.value.prompt_rules.prefill_enabled,
      baibai_enabled: settings.value.prompt_rules.baibai_enabled,
    };
    if (cfg.is_default) {
      for (const c of configs) c.is_default = false;
    }
    configs.push(cfg);
    return cfg;
  }

  function deletePromptConfig(id: string) {
    const configs = settings.value.prompt_configs;
    const cfg = configs.find(c => c.id === id);
    if (!cfg || cfg.is_default) return;
    const idx = configs.findIndex(c => c.id === id);
    if (idx === -1) return;
    const chatStore = useChatSettingsStore();
    const charStore = useCharacterSettingsStore();
    if (chatStore.settings.prompt_config_id === id) chatStore.settings.prompt_config_id = null;
    if (charStore.settings.prompt_config_id === id) charStore.settings.prompt_config_id = null;
    configs.splice(idx, 1);
  }

  function renamePromptConfig(id: string, name: string) {
    const cfg = settings.value.prompt_configs.find(c => c.id === id);
    if (cfg) cfg.name = name;
  }

  function setDefaultPromptConfig(id: string) {
    for (const cfg of settings.value.prompt_configs) {
      cfg.is_default = cfg.id === id;
    }
  }

  /** 导入提示词模块（合并或整体替换），并落盘到指定配置快照。
   *  合并语义：同 id 用导入模块整对象覆盖但保留本地 order（order 属当前配置的布局状态，
   *  导入文件的 order 会打乱现有排列），其余字段以导入为准；新 id 追加到末尾。
   *  落盘是硬要求而非优化：只写工作副本 prompt_rules 的话，下次 switchPromptConfig 会把
   *  工作副本同步回"生效配置"（聊天/角色绑定可能指向另一个配置），导入内容会被静默
   *  写错位置或丢失——故必须同步写入用户正在编辑的配置快照。configId 为 null（无配置）
   *  时仅写工作副本，维持旧行为。 */
  function importPromptModules(
    imported: PromptModuleType[],
    opts: { replaceAll: boolean; configId: string | null },
  ): { overwritten: number; added: number } {
    const pr = settings.value.prompt_rules;
    let overwritten = 0;
    let added = 0;

    if (opts.replaceAll) {
      overwritten = pr.modules.filter(m => imported.some(im => im.id === m.id)).length;
      added = imported.length - overwritten;
      pr.modules = klona(imported);
    } else {
      const byId = new Map(pr.modules.map(m => [m.id, m]));
      let nextOrder = pr.modules.reduce((max, m) => Math.max(max, m.order ?? 0), 0) + 1;
      for (const im of imported) {
        const existing = byId.get(im.id);
        if (existing) {
          const order = existing.order;
          pr.modules[pr.modules.indexOf(existing)] = { ...klona(im), order };
          overwritten++;
        } else {
          pr.modules.push({ ...klona(im), order: nextOrder++ });
          added++;
        }
      }
    }

    if (opts.configId) {
      const cfg = settings.value.prompt_configs.find(c => c.id === opts.configId);
      if (cfg) syncPromptRulesToConfig(cfg);
    }
    return { overwritten, added };
  }

  function factoryReset() {
    const fresh = validateInplace(GlobalSettings, {});
    fresh.schema_version = SCHEMA_VERSION;
    fresh.prompt_rules.schema_version = 16;
    fresh.prompt_rules.modules = klona(DEFAULT_MODULES);
    // 不能整体覆盖 filter_settings：validateInplace 产出的对象带 Zod 默认字段，
    // 若覆盖成缺 library_groups 的裸对象，之后 RegexLibraryDialog.createGroup 的 `?? []`
    // 兜底会拿到临时数组，新建分组写入静默丢失（直到刷新页面才恢复）
    fresh.filter_settings.regex_library = [];
    fresh.filter_settings.groups = [];
    fresh.filter_settings.library_groups = [];

    // 恢复出厂与全新首载终态一致：只有简洁默认配置（经典仅来自老存档迁移的用户存档），
    // 工作副本加载简洁。schema_version 已置为最新，applyDefaults 不会跑，必须显式调用。
    // 用户确认弹窗已明示"删除所有提示词配置"，此处不再把当前提示词存档为经典
    ensureDefaultPromptConfig(fresh);

    const defaultEntries = buildDefaultEntries();
    fresh.master_pool = [...defaultEntries];
    fresh.configs = [
      {
        id: uuidv4(),
        name: '默认配置',
        entries: defaultEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          condition: e.condition,
        })),
        is_default: true,
        generation: {
          count_mode: '4',
          categories_enabled: true,
          shuffle_final: true,
          pinned_overflow: 'send_all',
          cross_layer_fallback: false,
        },
      },
    ];

    settings.value = fresh;
  }

  function resetPromptToDefaults() {
    settings.value.prompt_rules.modules = klona(DEFAULT_MODULES);
    settings.value.prompt_rules.person_style = DEFAULT_PERSON_STYLE;
    settings.value.prompt_rules.option_rules = DEFAULT_OPTION_RULES;
  }

  // ST 主题自动检测：当 theme_mode 为 'auto' 时，监听 ST 主题变化
  let stopThemeWatcher: (() => void) | null = null;

  function resolveTheme(): 'st' | 'dark' | 'light' {
    const mode = settings.value.ui.theme_mode;
    if (mode === 'st' || mode === 'dark' || mode === 'light') return mode;
    return detectSTTheme();
  }

  function startThemeWatcher() {
    stopThemeWatcher?.();
    stopThemeWatcher = watchSTTheme(() => {
      // 触发响应式更新，让 watchEffect 重新执行
      settings.value = { ...settings.value };
    });
  }

  startThemeWatcher();

  watchEffect(() => {
    const ui = settings.value.ui;
    const theme = resolveTheme();
    document.documentElement.setAttribute('data-choice-theme', theme);

    // st 跟随模式的对比度守卫：ST 极端主题下用兜底墨色覆盖派生值；
    // 离开 st 或对比恢复时必须移除行内覆盖，否则残留上一次主题的墨色
    if (theme === 'st') {
      const fallback = getSTInkFallback();
      if (fallback) {
        document.documentElement.style.setProperty('--choice-text', fallback.text);
        document.documentElement.style.setProperty('--choice-text-secondary', fallback.secondary);
        document.documentElement.style.setProperty('--choice-text-muted', fallback.muted);
      } else {
        document.documentElement.style.removeProperty('--choice-text');
        document.documentElement.style.removeProperty('--choice-text-secondary');
        document.documentElement.style.removeProperty('--choice-text-muted');
      }
    } else {
      document.documentElement.style.removeProperty('--choice-text');
      document.documentElement.style.removeProperty('--choice-text-secondary');
      document.documentElement.style.removeProperty('--choice-text-muted');
    }

    const scaleMap = { small: 0.85, medium: 1, large: 1.2 };
    document.documentElement.style.setProperty('--choice-font-scale', String(scaleMap[ui.font_size]));
  });

  return {
    settings,
    sortedEnabledModules,
    allModules,
    sortedEnabledFilterRules,
    currentPresetName,
    currentCharacterId,
    syncPresetName,
    addModule,
    duplicateModule,
    removeModule,
    reorderModules,
    resetModuleOrder,
    resetModuleContent,
    resetAllPromptContents,
    resetPromptToDefaults,
    syncPromptRulesToConfig,
    loadPromptConfig,
    switchPromptConfig,
    createPromptConfig,
    deletePromptConfig,
    renamePromptConfig,
    setDefaultPromptConfig,
    importPromptModules,
    factoryReset,
    addFilterGroup,
    removeFilterGroup,
    addFilterGroupEntry,
    removeFilterGroupEntry,
    addRegexLibraryEntry,
    removeRegexLibraryEntry,
    updateRegexLibraryEntry,
    renameRegexLibraryGroup,
    deleteRegexLibraryGroup,
  };
});
