import { saveSettingsDebounced } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { uuidv4 } from '@sillytavern/scripts/utils';
import {
  GlobalSettings,
  SCHEMA_VERSION,
  setting_field,
} from '@/type/settings';
import type { GlobalSettings as GlobalSettingsType } from '@/type/settings';
import { validateInplace } from '@/util/zod';

const createDefaultPool = () => [
  { id: uuidv4(), text: '继续推进对话', pinned: false, weight: 1, category: '', condition: '' },
  { id: uuidv4(), text: '主动询问对方的想法', pinned: false, weight: 1, category: '', condition: '' },
  { id: uuidv4(), text: '采取一个出人意料的行动', pinned: false, weight: 1, category: '', condition: '' },
  { id: uuidv4(), text: '静观其变,暂不行动', pinned: false, weight: 1, category: '', condition: '' },
];

const applyDefaults = (validated: GlobalSettingsType) => {
  if (validated.pool.length === 0) {
    validated.pool = createDefaultPool();
  }
  validated.schema_version = SCHEMA_VERSION;
};

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  const existing = _.get(extension_settings, setting_field);
  const validated = validateInplace(GlobalSettings, existing);

  const needsMigration = (validated.schema_version ?? 0) < SCHEMA_VERSION;
  if (needsMigration) {
    applyDefaults(validated);
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

  return {
    settings,
  };
});
