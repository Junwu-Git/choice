<template>
  <ChoiceDialog
    :open="open"
    :title="isEdit ? t`编辑条目` : t`新增条目`"
    icon="fa-solid fa-pen"
    width="520px"
    @close="emit('close')"
  >
    <div class="choice-knowledge-form">
      <label class="choice-field">
        <span>{{ t`信息项` }}</span>
        <input v-model="topic" class="choice-input" maxlength="24" :placeholder="t`短标题，如「主角的真实身份」`" />
      </label>

      <label class="choice-field">
        <span>{{ t`关联对象` }}</span>
        <input
          v-model="subject"
          class="choice-input"
          maxlength="24"
          :placeholder="t`这条信息针对谁，如「富川立花」「城北仓库」；通用设定填「世界设定」`"
        />
      </label>

      <div class="choice-field">
        <span>{{ t`状态` }}</span>
        <div class="choice-seg">
          <button
            v-for="opt in STATUS_OPTIONS"
            :key="opt.value"
            type="button"
            class="choice-seg-btn"
            :class="{ active: status === opt.value }"
            @click="status = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <label class="choice-field">
        <span>{{ t`获取方式` }}</span>
        <select v-model="source" class="choice-select" :disabled="status === 'unknown'">
          <option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
        </select>
        <small v-if="status === 'unknown'" class="choice-field-hint">
          {{ t`状态为「未知」时没有获取过程，获取方式固定为未获取。` }}
        </small>
      </label>

      <div class="choice-field">
        <span>{{ t`重要性档位` }}</span>
        <div class="choice-seg">
          <button
            v-for="opt in IMPORTANCE_OPTIONS"
            :key="opt.value"
            type="button"
            class="choice-seg-btn"
            :class="{ active: importance === opt.value }"
            :title="opt.hint"
            @click="importance = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <small class="choice-field-hint">
          {{
            t`只决定注入预算紧张时先保谁：漏掉会写出越界或全知候选 → 高；影响分寸但不破底线 → 中；设定与场景已明写 → 低。`
          }}
        </small>
      </div>

      <label class="choice-field">
        <span>{{ t`别名` }}</span>
        <input v-model="aliases" class="choice-input" :placeholder="t`同义说法，用逗号分隔（每条不超过 24 字）`" />
      </label>

      <label class="choice-field">
        <span>{{ t`检索词` }}</span>
        <input
          v-model="keywords"
          class="choice-input"
          :placeholder="t`人名、地点、物品，用逗号分隔（每条不超过 24 字）`"
        />
      </label>

      <label class="choice-field">
        <span>{{ t`依据` }}</span>
        <textarea
          v-model="basis"
          class="choice-textarea"
          rows="2"
          maxlength="240"
          :placeholder="t`判定依据，如「在城北仓库被守卫当面告知」`"
        ></textarea>
      </label>

      <label class="choice-field">
        <span>{{ t`对选项的约束` }}</span>
        <textarea
          v-model="impact"
          class="choice-textarea"
          rows="2"
          maxlength="240"
          :placeholder="t`生成选项时该注意什么，如「不得直接叫出真名」`"
        ></textarea>
      </label>

      <label class="choice-field">
        <span>{{ t`剧情内时间` }}</span>
        <input v-model="eventTime" class="choice-input" maxlength="32" :placeholder="t`正文写了时间才填（可留空）`" />
      </label>

      <small v-if="duplicate" class="choice-field-hint choice-knowledge-form-warn">
        <i class="fa-solid fa-triangle-exclamation"></i>
        {{ t`已存在同名条目，请改名或直接编辑现有条目` }}
      </small>
    </div>

    <template #footer>
      <button class="menu_button" @click="emit('close')">{{ t`取消` }}</button>
      <button class="menu_button menu_button_default" :disabled="!canSave" @click="onSave">{{ t`保存` }}</button>
    </template>
  </ChoiceDialog>
</template>

<script setup lang="ts">
import ChoiceDialog from '@/components/shared/ChoiceDialog.vue';
import type { KnowledgeImportance, KnowledgeReportEntry, KnowledgeSource, KnowledgeStatus } from '@/type/settings';

const props = defineProps<{
  open: boolean;
  entry: KnowledgeReportEntry | null;
  /** 除当前条目外的既有 topic（重名校验用） */
  existingTopics: string[];
}>();

const emit = defineEmits<{
  close: [];
  save: [
    payload: {
      topic: string;
      subject: string;
      status: KnowledgeStatus;
      source: KnowledgeSource;
      importance: KnowledgeImportance;
      aliases: string[];
      keywords: string[];
      basis: string;
      impact: string;
      event_time: string;
    },
  ];
}>();

const STATUS_OPTIONS = computed<Array<{ value: KnowledgeStatus; label: string }>>(() => [
  { value: 'known', label: t`已知` },
  { value: 'uncertain', label: t`存疑` },
  { value: 'unknown', label: t`未知` },
]);

const SOURCE_OPTIONS = computed<Array<{ value: KnowledgeSource; label: string }>>(() => [
  { value: 'witnessed', label: t`目击` },
  { value: 'heard', label: t`听闻` },
  { value: 'read', label: t`阅读` },
  { value: 'inferred', label: t`推断` },
  { value: 'none', label: t`未获取` },
  { value: 'manual', label: t`手动` },
  { value: 'unspecified', label: t`未标注` },
]);

const IMPORTANCE_OPTIONS = computed<Array<{ value: KnowledgeImportance; label: string; hint: string }>>(() => [
  { value: 'high', label: t`高`, hint: t`漏了会写出越界或全知的候选` },
  { value: 'normal', label: t`中`, hint: t`影响分寸与措辞，但不破底线` },
  { value: 'low', label: t`低`, hint: t`背景常识、设定或场景已明写` },
]);

const isEdit = computed(() => props.entry !== null);

const topic = ref('');
const subject = ref('');
const status = ref<KnowledgeStatus>('known');
const source = ref<KnowledgeSource>('manual');
const importance = ref<KnowledgeImportance>('normal');
const aliases = ref('');
const keywords = ref('');
const basis = ref('');
const impact = ref('');
const eventTime = ref('');

const splitList = (s: string): string[] =>
  s
    .split(/[,，、;；\n]/)
    .map(x => x.trim())
    .filter(Boolean);

/** 打开/切换编辑对象时重置表单：弹窗常驻挂载（open 控制显隐），
 *  不重置会把上一条的内容带进下一次新增。 */
watch(
  () => [props.open, props.entry] as const,
  ([open, entry]) => {
    if (!open) return;
    topic.value = entry?.topic ?? '';
    subject.value = entry?.subject ?? '';
    status.value = entry?.status ?? 'known';
    source.value = entry?.source ?? 'manual';
    importance.value = entry?.importance ?? 'normal';
    aliases.value = entry?.aliases.join('、') ?? '';
    keywords.value = entry?.keywords.join('、') ?? '';
    basis.value = entry?.basis ?? '';
    impact.value = entry?.impact ?? '';
    eventTime.value = entry?.event_time ?? '';
  },
  { immediate: true },
);

const duplicate = computed(() => {
  const t0 = topic.value.trim();
  return t0.length > 0 && props.existingTopics.some(x => x.trim() === t0);
});

/** 「未知」必然没有获取过程（合并层也会强制纠正成 none）。
 *  与其让用户选一个会被悄悄改掉的选项，不如在界面上直接锁死并说明原因。 */
watch(status, s => {
  if (s === 'unknown') source.value = 'none';
});

const canSave = computed(() => topic.value.trim().length > 0 && !duplicate.value);

const onSave = () => {
  if (!canSave.value) return;
  emit('save', {
    topic: topic.value.trim(),
    subject: subject.value.trim(),
    status: status.value,
    source: status.value === 'unknown' ? 'none' : source.value,
    importance: importance.value,
    aliases: splitList(aliases.value),
    keywords: splitList(keywords.value),
    basis: basis.value.trim(),
    impact: impact.value.trim(),
    event_time: eventTime.value.trim(),
  });
};
</script>

<style scoped>
.choice-knowledge-form {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
}

.choice-knowledge-form-warn {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
  color: var(--choice-color-warning);
}
</style>
