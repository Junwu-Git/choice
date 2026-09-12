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
  const settings = ref(validateInplace(CharacterSettings, readCharacterSettings()));

  const reload = () => {
    reloading = true;
    settings.value = validateInplace(CharacterSettings, readCharacterSettings());
    nextTick(() => {
      reloading = false;
    });
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
