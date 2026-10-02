import { this_chid } from '@sillytavern/script';
import toastr from 'toastr';
import { CharacterSettings, setting_field } from '@/type/settings';
import { validateInplace } from '@/util/zod';
import { getStCharacter } from '@/core/st-character';
import { scheduleCharacterPersist } from '@/util/character-bindings';

type CharacterBindingKind = 'pool' | 'prompt';
const BINDING_FIELD = {
  pool: 'config_id',
  prompt: 'prompt_config_id',
} as const;

const readCharacterSettings = () => {
  const ch = getStCharacter(this_chid);
  if (!ch) {
    return undefined;
  }
  return _.get(ch, ['data', 'extensions', setting_field]);
};

export const useCharacterSettingsStore = defineStore('character-settings', () => {
  let reloading = false;

  /** 解析失败（坏角色卡，extensions 被外部工具写坏）回退默认值：保留上一角色的旧 settings
   *  会在 watch 恢复后把旧配置误写到新角色卡上，默认值是最安全的落点；toastr 明示不静默 */
  const parseSettingsOrDefault = () => {
    try {
      return validateInplace(CharacterSettings, readCharacterSettings());
    } catch (e) {
      console.error('[Choice] 角色设置解析失败，使用默认值', e);
      toastr.error(t`角色设置数据损坏，已使用默认值`);
      return CharacterSettings.parse({});
    }
  };

  const settings = ref(parseSettingsOrDefault());

  const reload = () => {
    reloading = true;
    try {
      settings.value = parseSettingsOrDefault();
    } finally {
      // finally 复位不可省：若解析路径抛错（理论已被 parseSettingsOrDefault 兜住），
      // reloading 卡 true 会让 deep watch 永久静默、绑定改动不再落盘
      nextTick(() => {
        reloading = false;
      });
    }
  };

  const setBinding = (kind: CharacterBindingKind, value: string | null) => {
    const field = BINDING_FIELD[kind];
    settings.value = { ...settings.value, [field]: value };
  };

  watch(
    settings,
    new_settings => {
      if (reloading) {
        return;
      }
      const ch = getStCharacter(this_chid);
      if (!ch) {
        return;
      }
      _.set(ch, ['data', 'extensions', setting_field], klona(new_settings));
      // 落盘用 persistCharacter（直接 /api/characters/edit，json_data=最新 data）：
      // saveCharacterDebounced 走表单旧 json_data 快照，会把刚写的扩展字段覆盖掉
      // （「绑定无效」根因），不能再用。异步执行；这是角色绑定数据的唯一落盘通道
      // （入口不再显式 persist，见 PoolEditor/PromptEditor 绑定函数），失败需提示
      scheduleCharacterPersist(ch, ok => {
        if (!ok) toastr.warning(t`角色绑定保存失败，请重试`);
      });
    },
    { deep: true, flush: 'post' },
  );

  return {
    settings,
    reload,
    setBinding,
  };
});
