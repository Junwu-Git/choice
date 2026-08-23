import { chat_metadata, characters, saveCharacterDebounced, saveSettingsDebounced, this_chid } from '@sillytavern/script';
import { extension_settings, saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import { uuidv4 } from '@sillytavern/scripts/utils';
import { GlobalSettings, SCHEMA_VERSION, setting_field, DEFAULT_MODULES, GenerationSettings } from '@/type/settings';
import type { GlobalSettings as GlobalSettingsType, PoolConfig, PoolConfigEntry, PoolEntry, PromptModule as PromptModuleType, ChatFilterGroup } from '@/type/settings';
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
    const READONLY_IDS = new Set(['world_info_before', 'persona_description', 'world_info_after', 'chat_history']);
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

  validated.prompt_rules.schema_version = 6;
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

    // 按 text 去重合并：相同 text 只保留第一条（优先级：聊天 > 角色 > 全局）
    const seen = new Map<string, PoolEntry>();
    for (const e of oldChatPool) {
      if (!seen.has(e.text)) seen.set(e.text, e);
    }
    for (const e of oldCharPool) {
      if (!seen.has(e.text)) seen.set(e.text, e);
    }
    for (const e of oldGlobalPool) {
      if (!seen.has(e.text)) seen.set(e.text, e);
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
        generation: (oldGlobalGen as any) ?? GenerationSettings.prefault({}),
      });
    }

    if (oldCharPool.length > 0) {
      const charConfigId = uuidv4();
      configs.push({
        id: charConfigId,
        name: charName ? `角色 ${charName}` : '角色默认',
        entries: makeEntries(oldCharPool),
        is_default: configs.length === 0,
        generation: GenerationSettings.prefault({}),
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
        generation: GenerationSettings.prefault({}),
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
      const defaultEntries: PoolEntry[] = [
        { id: uuidv4(), text: '继续推进对话', pinned: false, weight: 1, category: '', condition: '' },
        { id: uuidv4(), text: '主动询问对方的想法', pinned: false, weight: 1, category: '', condition: '' },
        { id: uuidv4(), text: '采取一个出人意料的行动', pinned: false, weight: 1, category: '', condition: '' },
        { id: uuidv4(), text: '静观其变,暂不行动', pinned: false, weight: 1, category: '', condition: '' },
      ];
      validated.master_pool = [...defaultEntries];
      configs.push({
        id: uuidv4(),
        name: '默认配置',
        entries: defaultEntries.map(e => ({ entry_id: e.id, pinned: e.pinned, weight: e.weight, condition: e.condition })),
        is_default: true,
        generation: GenerationSettings.prefault({}),
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

  const validated = validateInplace(GlobalSettings, existing);

  const needsMigration = (validated.schema_version ?? 0) < SCHEMA_VERSION;
  if (needsMigration) {
    applyDefaults(validated);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  // 提示词模块化迁移与全局 schema_version 无关，每次初始化都检查
  const promptNeedsMigration = (validated.prompt_rules.schema_version ?? 0) < 6;
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
    settings.value.prompt_rules.modules
      .filter(m => m.enabled)
      .sort((a, b) => a.order - b.order),
  );

  const allModules = computed(() =>
    [...settings.value.prompt_rules.modules].sort((a, b) => a.order - b.order),
  );

  const sortedEnabledFilterRules = computed(() =>
    (settings.value.prompt_rules.chat_filter_groups ?? [])
      .filter(g => g.enabled)
      .flatMap(g => g.rules),
  );

  function addModule(afterId?: string) {
    const modules = settings.value.prompt_rules.modules;
    const maxOrder = modules.length ? Math.max(...modules.map(m => m.order)) : -1;
    const newModule: PromptModuleType = {
      id: uuidv4(),
      name: '新模块',
      role: 'system',
      content: '',
      marker: false,
      system: false,
      enabled: true,
      order: maxOrder + 1,
    };
    modules.push(newModule);
    return newModule;
  }

  function duplicateModule(id: string) {
    const READONLY_IDS = new Set(['world_info_before', 'persona_description', 'world_info_after', 'chat_history']);
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
  };
});
