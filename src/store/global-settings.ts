import {
  chat_metadata,
  characters,
  saveCharacterDebounced,
  saveSettingsDebounced,
  this_chid,
} from '@sillytavern/script';
import { extension_settings, saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { GlobalSettings, SCHEMA_VERSION, setting_field, DEFAULT_MODULES, BAIBAI_MODULE_IDS } from '@/type/settings';

/** 构建 10 条默认条目，基于用户定义的选项类型 */
function buildDefaultEntries(): PoolEntry[] {
  return [
    {
      id: uuidv4(),
      type: '普通发展',
      content: '根据当前处境，合理构思符合角色性格的自然反应，不预设特定策略倾向',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '跳过场景',
      content: '当剧情适合快速推进时，用一两句精炼的过渡性描述总结时间流逝或空间转移，并直接开启一个新场景',
      pinned: true,
      weight: 1,
      category: '',
      condition: '',
      rule: '此项固定生成，不参与随机抽取',
    },
    {
      id: uuidv4(),
      type: '欧亨利反转',
      content: '给出一个意料之外情理之中的剧情发展，巧妙地利用当前场景中不起眼的细节引出意外转折',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '罗曼蒂克',
      content: '根据当前环境和角色关系，给出一个浪漫或暧昧的举动，推进角色之间的情感进程',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '视角切换',
      content: '以另一个角色的视角接续下文，描述该角色在同时刻的所见所感或正在进行的行动',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '利用场景',
      content: '结合当前场景的物理特性或氛围，进行具体的环境互动、物品利用或隐蔽行为',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '破局行动',
      content: '构思一个打破常规思维的高风险行动，旨在突破当前僵局或探索隐藏的可能性',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '沉默观察',
      content: '刻意不表态，通过视线焦点、细微的肢体反应或内心的揣测来传达态度，全程不主动开口',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '此项不涉及对白，纯粹依靠动作与内心活动',
    },
    {
      id: uuidv4(),
      type: '共情靠近',
      content: '通过分享感受、复述对方处境或给予实际支持，尝试拉近与对方的距离',
      pinned: false,
      weight: 1,
      category: '',
      condition: '',
      rule: '',
    },
    {
      id: uuidv4(),
      type: '幽默化解',
      content: '用调侃、自嘲或反差感的言行打破紧张或尴尬的氛围，语气轻松但不失分寸',
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
      validated.prompt_rules.chat_filter_rules = legacy.map(p => ({ type: 'regex', pattern: p }));
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
      'baibai_state',
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
    // v11: 柏宝书模块默认启用，调整顺序（摘要→历史开始下，状态→历史结束下）
    const baibaiSummary = validated.prompt_rules.modules.find(m => m.id === 'baibai_summary');
    const baibaiState = validated.prompt_rules.modules.find(m => m.id === 'baibai_state');
    if (baibaiSummary) baibaiSummary.enabled = true;
    if (baibaiState) baibaiState.enabled = true;
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
      'baibai_state',
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

  validated.prompt_rules.schema_version = 16;
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

const applyDefaults = (validated: GlobalSettingsType) => {
  if ((validated.schema_version ?? 0) < 9) {
    // 旧三层池数据迁移：收集 → 去重 → 合并为 master_pool + 自动配置
    const oldGlobalPool: PoolEntry[] = (_.get(extension_settings, [setting_field, 'pool']) as PoolEntry[]) ?? [];
    const oldGlobalGen = _.get(extension_settings, [setting_field, 'generation']);
    let charName = '';
    let oldCharPool: PoolEntry[] = [];
    try {
      const chid = this_chid;
      if (chid !== undefined && characters?.[chid]) {
        charName = characters[chid].name || '';
        oldCharPool = (_.get(characters[chid], ['data', 'extensions', setting_field, 'pool']) as PoolEntry[]) ?? [];
      }
    } catch {
      // 角色数据不可用时跳过
    }
    let chatName = '';
    let oldChatPool: PoolEntry[] = [];
    try {
      const cMeta = chat_metadata?.[setting_field];
      if (cMeta) {
        oldChatPool = (cMeta.pool as PoolEntry[]) ?? [];
        chatName = '当前聊天';
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
        const chid = this_chid;
        if (chid !== undefined && characters?.[chid]) {
          _.set(characters[chid], ['data', 'extensions', setting_field, 'config_id'], charConfigId);
          delete characters[chid].data.extensions[setting_field].pool;
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

  validated.schema_version = SCHEMA_VERSION;
};

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  const existing = _.get(extension_settings, setting_field);
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

  const validated = validateInplace(GlobalSettings, existing);

  const needsMigration = (validated.schema_version ?? 0) < SCHEMA_VERSION;
  if (needsMigration) {
    applyDefaults(validated);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  // 提示词模块化迁移与全局 schema_version 无关，每次初始化都检查
  const promptNeedsMigration = (validated.prompt_rules.schema_version ?? 0) < 16;
  if (promptNeedsMigration) {
    migratePromptModules(validated, legacyRegexes);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  const settings = ref(validated);

  watch(
    settings,
    new_settings => {
      _.set(extension_settings, setting_field, klona(new_settings));
      saveSettingsDebounced();
    },
    { deep: true },
  );

  const sortedEnabledModules = computed(() =>
    settings.value.prompt_rules.modules.filter(m => m.enabled).sort((a, b) => a.order - b.order),
  );

  const allModules = computed(() => [...settings.value.prompt_rules.modules].sort((a, b) => a.order - b.order));

  const sortedEnabledFilterRules = computed(() =>
    (settings.value.prompt_rules.chat_filter_groups ?? []).filter(g => g.enabled).flatMap(g => g.rules),
  );

  function addModule(afterId?: string, enrichOnly = false) {
    const modules = settings.value.prompt_rules.modules;
    const maxOrder = modules.length ? Math.max(...modules.map(m => m.order)) : -1;
    const newModule: PromptModuleType = {
      id: uuidv4(),
      name: enrichOnly ? '润色模块' : '新模块',
      role: 'system',
      content: '',
      marker: false,
      system: false,
      enabled: true,
      order: maxOrder + 1,
      enrich_only: enrichOnly,
    };
    modules.push(newModule);
    return newModule;
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
      'baibai_state',
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

  function factoryReset() {
    const fresh = validateInplace(GlobalSettings, {});
    fresh.schema_version = SCHEMA_VERSION;
    fresh.prompt_rules.schema_version = 16;
    fresh.prompt_rules.modules = klona(DEFAULT_MODULES);

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

  watchEffect(() => {
    const ui = settings.value.ui;
    document.documentElement.setAttribute('data-choice-theme', ui.theme);
    document.documentElement.style.setProperty('--choice-opacity', String(ui.opacity));
    document.documentElement.style.setProperty('--choice-card-opacity', String(ui.opacity * 0.74));
    document.documentElement.style.setProperty('--choice-element-opacity', String(ui.opacity * 0.51));
    const scaleMap = { small: 0.85, medium: 1, large: 1.2 };
    document.documentElement.style.setProperty('--choice-font-scale', String(scaleMap[ui.font_size]));
  });

  return {
    settings,
    sortedEnabledModules,
    allModules,
    sortedEnabledFilterRules,
    addModule,
    duplicateModule,
    removeModule,
    reorderModules,
    resetModuleOrder,
    resetModuleContent,
    resetAllPromptContents,
    resetPromptToDefaults,
    factoryReset,
  };
});
