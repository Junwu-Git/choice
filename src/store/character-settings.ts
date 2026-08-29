import { saveCharacterDebounced, this_chid } from '@sillytavern/script';
import { CharacterSettings, setting_field } from '@/type/settings';
import { validateInplace } from '@/util/zod';
import { getStCharacter } from '@/core/st-character';

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
      saveCharacterDebounced();
    },
    { deep: true },
  );

  return {
    settings,
    reload,
  };
});
