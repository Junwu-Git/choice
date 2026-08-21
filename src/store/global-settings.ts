import { saveSettingsDebounced } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';
import { uuidv4 } from '@sillytavern/scripts/utils';
import {
  DEFAULT_AI_PERSONA,
  DEFAULT_PERSON,
  DEFAULT_PROMPT_EXTRA,
  DEFAULT_PROMPT_OUTPUT_FORMAT,
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

const OLD_V1_PERSON =
  '你是行动选项生成器。根据对话上下文和提供的行动方向,为当前场景生成多样化的行动选项。选项应贴合角色性格、关系和当前情境。';

const applyDefaults = (validated: GlobalSettingsType) => {
  if (validated.pool.length === 0) {
    validated.pool = createDefaultPool();
  }
  const rules = validated.prompt_rules;
  if (!rules.ai_persona) {
    rules.ai_persona = DEFAULT_AI_PERSONA;
  }
  if (!rules.person || rules.person === OLD_V1_PERSON) {
    rules.person = DEFAULT_PERSON;
  }
  if (!rules.output_format) {
    rules.output_format = DEFAULT_PROMPT_OUTPUT_FORMAT;
  }
  if (!rules.extra_requirements) {
    rules.extra_requirements = DEFAULT_PROMPT_EXTRA;
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
