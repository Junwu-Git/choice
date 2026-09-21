<template>
  <div class="choice-generation-editor">
    <div class="choice-section">
      <label class="choice-toggle" data-tour="gen-auto">
        <input v-model="gs.settings.auto_generate" type="checkbox" :title="t`开启后 AI 回复完自动生成选项`" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`自动生成` }}</strong>
          <small>{{ t`AI 回复完成后自动触发选项生成` }}</small>
        </span>
      </label>
      <!-- 输入润色开关从外观页迁入：它控制的是"生成"行为（润色版本数/字数/人称
           本就集中在本页），与外观无关；ui 在下方 script 已定义，与 enrich_count 同款写法 -->
      <label class="choice-toggle">
        <input v-model="ui.enrich_enabled" type="checkbox" :title="t`在发送消息前用 AI 改写为多个润色版本`" />
        <span class="choice-toggle-custom"></span>
        <span class="choice-toggle-label">
          <strong>{{ t`启用输入润色` }}</strong>
          <small>{{ t`发送消息前用 AI 改写为多个润色版本` }}</small>
        </span>
      </label>
    </div>

    <div class="choice-section" data-tour="gen-behavior">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`点击行为` }}</label>
        </div>
        <small class="choice-field-hint">{{ t`点击选项按钮后的动作，与选项面板头部同步` }}</small>
      </div>
      <div class="choice-seg">
        <button
          class="choice-seg-btn"
          :class="{ active: gs.settings.behavior === 'send' }"
          :title="t`点击选项后直接发送消息`"
          @click="gs.settings.behavior = 'send'"
        >
          <i class="fa-solid fa-paper-plane"></i>
          {{ t`发送` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: gs.settings.behavior === 'fill' }"
          :title="t`点击选项后填入输入框（替换现有内容）`"
          @click="gs.settings.behavior = 'fill'"
        >
          <i class="fa-solid fa-file-pen"></i>
          {{ t`覆盖` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: gs.settings.behavior === 'append' }"
          :title="t`点击选项后追加到输入框末尾`"
          @click="gs.settings.behavior = 'append'"
        >
          <i class="fa-solid fa-plus"></i>
          {{ t`尾附` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: gs.settings.behavior === 'insert' }"
          :title="t`点击选项后插入到输入框光标处`"
          @click="gs.settings.behavior = 'insert'"
        >
          <i class="fa-solid fa-i-cursor"></i>
          {{ t`插入` }}
        </button>
      </div>
    </div>

    <!-- 骰子判定（v55）：成功率标注/档位兜底 + D100 随机判定。开关默认关，
         关闭时选项行为与旧版完全一致；成功率徽标与判定 chip 均随本开关显隐。
         披露器收纳：总开关常显在标题行右侧（extra slot），阈值/模板/长说明收起为展开区 -->
    <ChoiceDisclosure title="骰子判定" data-tour="gen-dice" icon="fa-solid fa-dice">
      <template #extra>
        <label class="choice-check" :title="t`开启后选项行显示成功率徽标，点击掷骰并播报结果`">
          <input v-model="gs.settings.dice.enabled" type="checkbox" />
          <span>{{ t`启用骰子判定` }}</span>
        </label>
      </template>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`大成功阈值` }}</span>
          <input
            v-model.number="gs.settings.dice.crit_success_max"
            class="choice-input choice-input-w-md"
            type="number"
            min="1"
            max="99"
            :title="t`掷出 ≤ 此值判为大成功（默认 5）`"
          />
        </label>
        <label class="choice-count-item">
          <span>{{ t`大失败阈值` }}</span>
          <input
            v-model.number="gs.settings.dice.crit_fail_min"
            class="choice-input choice-input-w-md"
            type="number"
            min="2"
            max="100"
            :title="t`掷出 ≥ 此值判为大失败（默认 95）`"
          />
        </label>
      </div>
      <div class="choice-dice-template-list">
        <div class="choice-dice-template-row">
          <strong>{{ t`失败` }}</strong>
          <label class="choice-count-item">
            <span>{{ t`隐形演绎指令` }}</span>
            <input
              v-model="gs.settings.dice.fail_send_template"
              class="choice-input"
              :placeholder="t`给 AI 的演绎指令，支持 {rate} {roll}`"
            />
          </label>
          <label class="choice-count-item">
            <span>{{ t`回退文案` }}</span>
            <input
              v-model="gs.settings.dice.fail_template"
              class="choice-input"
              :placeholder="t`演绎指令留空时使用，如：【判定失败】`"
            />
          </label>
        </div>
        <div class="choice-dice-template-row">
          <strong>{{ t`大成功` }}</strong>
          <label class="choice-count-item">
            <span>{{ t`隐形演绎指令` }}</span>
            <input
              v-model="gs.settings.dice.crit_success_send_template"
              class="choice-input"
              :placeholder="t`给 AI 的演绎指令，支持 {rate} {roll}`"
            />
          </label>
          <label class="choice-count-item">
            <span>{{ t`回退文案` }}</span>
            <input
              v-model="gs.settings.dice.crit_success_template"
              class="choice-input"
              :placeholder="t`演绎指令留空时使用，如：【大成功】`"
            />
          </label>
        </div>
        <div class="choice-dice-template-row">
          <strong>{{ t`大失败` }}</strong>
          <label class="choice-count-item">
            <span>{{ t`隐形演绎指令` }}</span>
            <input
              v-model="gs.settings.dice.crit_fail_send_template"
              class="choice-input"
              :placeholder="t`给 AI 的演绎指令，支持 {rate} {roll}`"
            />
          </label>
          <label class="choice-count-item">
            <span>{{ t`回退文案` }}</span>
            <input
              v-model="gs.settings.dice.crit_fail_template"
              class="choice-input"
              :placeholder="t`演绎指令留空时使用，如：【大失败】`"
            />
          </label>
        </div>
      </div>
      <small class="choice-field-hint">{{
        t`开启后点击选项时掷 D100：AI 标注成功率优先，未标注时按风险档位兜底（保守 85% / 平衡 60% / 大胆 35%）。判定结果以 HTML 注释随消息发送/填入（AI 可见、聊天界面不可见；填入时输入框可见注释，可编辑删除）；成功不加注释。润色视图与无成功率选项不参与判定`
      }}</small>
    </ChoiceDisclosure>

    <div class="choice-section" data-tour="gen-count">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`生成数量` }}</label>
        </div>
        <small class="choice-field-hint">{{ t`数字=固定数量，区间=每次随机（如 3-6）` }}</small>
      </div>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`选项数量` }}</span>
          <input
            v-model="gs.settings.global_count_mode"
            class="choice-input choice-input-w-md"
            :placeholder="t`如 4 或 3-6`"
          />
        </label>
        <label class="choice-count-item">
          <span>{{ t`润色版本数` }}</span>
          <input v-model="ui.enrich_count" class="choice-input choice-input-w-md" :placeholder="t`如 4 或 3-6`" />
        </label>
      </div>
    </div>

    <ChoiceDisclosure title="候选冗余">
      <small class="choice-field-hint">{{
        t`发送给 AI 的候选条目比选项数多出的比例，AI 从中挑选贴合当前场景的方向生成选项；0 表示候选数与选项数一致`
      }}</small>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`冗余比例` }}</span>
          <input
            v-model.number="oversamplePct"
            class="choice-input choice-input-w-md"
            type="number"
            min="0"
            max="300"
            :title="t`百分比，默认 50；0 = 候选数与选项数一致`"
          />
          <span>%</span>
        </label>
      </div>
    </ChoiceDisclosure>

    <ChoiceDisclosure title="防重复">
      <template #extra>
        <label class="choice-check" :title="t`生成后自动去重，不足时自动补齐`">
          <input v-model="gs.settings.generation.dedup_enabled" type="checkbox" />
          <span>{{ t`启用` }}</span>
        </label>
      </template>
      <small class="choice-field-hint">{{
        t`提示词不再注入上一轮选项（防污染）；生成后自动剔除与上一 AI 楼层/当前楼既有版本重复的选项——同标题需内容也相似才剔除，不同标题按正文相似度（≥阈值）判定。不足时自动补齐（最多 2 轮）。阈值 0-1，越小越严格，0.75 默认。`
      }}</small>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`阈值` }}</span>
          <input
            v-model.number="gs.settings.generation.dedup_threshold"
            class="choice-input choice-input-w-md"
            type="number"
            step="0.05"
            :title="t`0-1 的 bigram Jaccard 阈值；NaN 兜底 0.75；不 clamp 用户输入`"
          />
        </label>
      </div>
    </ChoiceDisclosure>

    <div class="choice-section">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`每条字数` }}</label>
        </div>
        <small class="choice-field-hint">{{ t`控制每条选项/润色版本的字数区间（中文字符）` }}</small>
      </div>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`选项` }}</span>
          <input
            v-model.number="rules.option_min_chars"
            class="choice-input choice-input-w-sm"
            type="number"
            min="10"
            max="500"
            @change="clampOptionChars"
          />
          <span>-</span>
          <input
            v-model.number="rules.option_max_chars"
            class="choice-input choice-input-w-sm"
            type="number"
            min="10"
            max="500"
            @change="clampOptionChars"
          />
        </label>
        <label class="choice-count-item">
          <span>{{ t`润色` }}</span>
          <input
            v-model.number="rules.enrich_min_chars"
            class="choice-input choice-input-w-sm"
            type="number"
            min="10"
            max="500"
            @change="clampEnrichChars"
          />
          <span>-</span>
          <input
            v-model.number="rules.enrich_max_chars"
            class="choice-input choice-input-w-sm"
            type="number"
            min="10"
            max="500"
            @change="clampEnrichChars"
          />
        </label>
      </div>
    </div>

    <ChoiceDisclosure title="人称视角">
      <small class="choice-field-hint">{{ t`选项和润色输出的人称，如"第三人称"或"第一人称"` }}</small>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`选项人称` }}</span>
          <input v-model="rules.option_person" class="choice-input choice-input-w-lg" :placeholder="t`如：第三人称`" />
        </label>
        <label class="choice-count-item">
          <span>{{ t`润色人称` }}</span>
          <input v-model="rules.enrich_person" class="choice-input choice-input-w-lg" :placeholder="t`如：第三人称`" />
        </label>
      </div>
    </ChoiceDisclosure>
  </div>
</template>

<script setup lang="ts">
import ChoiceDisclosure from '@/components/shared/ChoiceDisclosure.vue';
import { useGlobalSettingsStore } from '@/store/global-settings';
import {
  clampCharsValue,
  OPTION_MIN_CHARS_DEFAULT,
  OPTION_MAX_CHARS_DEFAULT,
  ENRICH_MIN_CHARS_DEFAULT,
  ENRICH_MAX_CHARS_DEFAULT,
} from '@/type/settings';

const gs = useGlobalSettingsStore();
const ui = gs.settings.ui;
const rules = gs.settings.prompt_rules;

// 冗余比例是全局抽取参数（settings.generation，v35 起从 per-pool-config 收归全局）——
// 条目池配置只管条目引用，切换池配置严禁带动任何生成参数。历史耦合：本页曾读生效池配置
// 的 oversample_pct，切池配置冗余比例即跳变（用户实测踩雷）。set 侧 clamp 到 schema 允许
// 区间（0-300）防越界值入库
const oversamplePct = computed({
  get: () => gs.settings.generation.oversample_pct,
  set: v => {
    const n = Math.round(Number(v));
    gs.settings.generation.oversample_pct = Number.isFinite(n) ? Math.min(300, Math.max(0, n)) : 0;
  },
});

// 字数输入失焦钳制：用户键入 <10/>500 或非法值时自动钳到合法边界
// （min 输 1→10、max 输 10000000000→500），并保证 min<=max。
// 用 @change（失焦/回车）而非 @input：实时钳会破坏多位数输入（输 "100" 时 "1" 被钳成 10 跳变）。
// 落盘还有 global-settings watcher 的 sanitizePromptRulesChars 兜底，双保险。
const clampOptionChars = () => {
  const lo = clampCharsValue(rules.option_min_chars, OPTION_MIN_CHARS_DEFAULT);
  const hi = clampCharsValue(rules.option_max_chars, OPTION_MAX_CHARS_DEFAULT);
  rules.option_min_chars = lo;
  rules.option_max_chars = lo > hi ? lo : hi;
};
const clampEnrichChars = () => {
  const lo = clampCharsValue(rules.enrich_min_chars, ENRICH_MIN_CHARS_DEFAULT);
  const hi = clampCharsValue(rules.enrich_max_chars, ENRICH_MAX_CHARS_DEFAULT);
  rules.enrich_min_chars = lo;
  rules.enrich_max_chars = lo > hi ? lo : hi;
};
</script>

<style scoped>
.choice-generation-editor {
  display: flex;
  flex-direction: column;
  /* 页级分区间距统一 space-4（与外观/统计页一致，滚动节奏统一） */
  gap: var(--choice-space-4);
}

.choice-generation-status {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  padding: var(--choice-space-2) var(--choice-space-3);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  font-size: var(--choice-text-xs);
}

.choice-config-status-label {
  font-weight: 600;
  color: var(--choice-primary);
  white-space: nowrap;
}

.choice-count-row {
  display: flex;
  gap: var(--choice-space-4);
}

.choice-count-item {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

/* 骰子结局模板列表：每档一行（结局名 + 隐形演绎输入 + 回退输入），
   窄屏下输入列 flex 收窄、标签不换行，避免 380px 横向溢出 */
.choice-dice-template-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-dice-template-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-3);
  flex-wrap: wrap;
  padding: var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-md);
  background: var(--choice-bg-element);
}

.choice-dice-template-row > strong {
  flex: 0 0 auto;
  min-width: 56px;
  font-size: var(--choice-text-sm);
}

.choice-dice-template-row .choice-count-item {
  flex: 1 1 200px;
  min-width: 160px;
}

.choice-dice-template-row .choice-count-item span {
  flex: 0 0 auto;
  white-space: nowrap;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-dice-template-row .choice-input {
  flex: 1;
  min-width: 120px;
}
</style>
