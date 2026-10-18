import { chat_metadata } from '@sillytavern/script';
import { saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import toastr from 'toastr';
import { persistGateDeferOrRun } from '@/core/persist-gate';
import { migrateKnowledgeReport } from '@/core/knowledge-report';
import { ChatSettings, setting_field, type WorldInfoChatSettings } from '@/type/settings';
import { validateInplace } from '@/util/zod';

/** 世界书聊天级设置迁移（幂等）：
 *  1. excluded_books（聊天级排除书）→ book_entry_modes[name]='off'（三态 off 档吸收），清空；
 *  2. excluded_entries（显式条目排除，`书名::uid`）→ book_entry_overrides[书][uid]=false，清空。
 *  ChatSettings 无 schema_version 字段（走不了全局设置的版本迁移块），故在每次校验后执行；
 *  两数组迁移后为空即天然不再触发。 */
function migrateWorldInfo(wi: WorldInfoChatSettings) {
  if (wi.excluded_books.length > 0) {
    for (const name of wi.excluded_books) {
      wi.book_entry_modes[name] = 'off';
    }
    wi.excluded_books = [];
  }
  if (wi.excluded_entries.length > 0) {
    for (const key of wi.excluded_entries) {
      const sep = key.indexOf('::');
      if (sep === -1) continue;
      const book = key.slice(0, sep);
      const uid = key.slice(sep + 2);
      const overrides = wi.book_entry_overrides[book] ?? {};
      overrides[uid] = false;
      wi.book_entry_overrides[book] = overrides;
    }
    wi.excluded_entries = [];
  }
}

export const useChatSettingsStore = defineStore('chat-settings', () => {
  let reloading = false;
  if (!chat_metadata[setting_field]) {
    chat_metadata[setting_field] = {};
  }

  /** 解析失败（坏聊天元数据）回退默认值：保留上一聊天的旧 settings 会在 watch 恢复后
   *  把旧配置误写到新聊天上，默认值是最安全的落点；toastr 明示不静默 */
  function initSettings() {
    try {
      const parsed = validateInplace(ChatSettings, chat_metadata[setting_field]);
      migrateWorldInfo(parsed.world_info);
      // 知识边界报告就地迁移（幂等）：补齐稳定 ID/来源/别名等字段，同 topic 重复条目合并。
      // ChatSettings 无版本号，走每次校验后的幂等迁移（同 migrateWorldInfo 的约定）；
      // 不保留旧结论以外的行为变化——状态/依据/约束原样保留。
      const migrated = migrateKnowledgeReport(parsed.knowledge_report);
      if (JSON.stringify(migrated) !== JSON.stringify(parsed.knowledge_report)) {
        parsed.knowledge_report = migrated;
      }
      return parsed;
    } catch (e) {
      console.error('[Choice] 聊天设置解析失败，使用默认值', e);
      toastr.error(t`聊天设置数据损坏，已使用默认值`);
      return ChatSettings.parse({});
    }
  }

  const settings = ref(initSettings());

  const reload = () => {
    reloading = true;
    if (!chat_metadata[setting_field]) {
      chat_metadata[setting_field] = {};
    }
    try {
      settings.value = initSettings();
    } finally {
      // finally 复位不可省：解析路径抛错时 reloading 卡 true 会让 deep watch 永久静默
      nextTick(() => {
        reloading = false;
      });
    }
  };

  watch(
    settings,
    new_settings => {
      if (reloading) {
        return;
      }
      chat_metadata[setting_field] = klona(new_settings);
      // saveMetadataDebounced 触发时整体序列化 chat_metadata——WI 排他窗口内 world_info 键
      // 被临时置空，此刻排程会把空绑定落盘，推迟到 restore 后再排程（读到的即真实状态）
      persistGateDeferOrRun(saveMetadataDebounced);
    },
    { deep: true },
  );

  return {
    settings,
    reload,
  };
});
