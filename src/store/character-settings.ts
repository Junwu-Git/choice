import { characters, saveCharacterDebounced, this_chid } from '@sillytavern/script';
import { CharacterSettings, setting_field } from '@/type/settings';
import { validateInplace } from '@/util/zod';

const readCharacterSettings = () => {
  const chid = this_chid;
  if (chid === undefined || !characters[chid]) {
    return undefined;
  }
  return _.get(characters[chid], ['data', 'extensions', setting_field]);
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
      const chid = this_chid;
      if (chid === undefined || !characters[chid]) {
        return;
      }
      _.set(characters[chid], ['data', 'extensions', setting_field], klona(new_settings));
      saveCharacterDebounced();
    },
    { deep: true },
  );

  return {
    settings,
    reload,
  };
});
