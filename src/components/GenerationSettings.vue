<template>
  <div class="choice-generation-editor">
    <div class="choice-generation-section">
      <label class="choice-check" data-tour="gen-auto">
        <input v-model="gs.settings.auto_generate" type="checkbox" :title="t`开启后 AI 回复完自动生成选项`" />
        <span class="choice-check-custom"></span>
        <span class="choice-check-label">
          <strong>{{ t`自动生成` }}</strong>
          <small>{{ t`AI 回复完成后自动触发选项生成` }}</small>
        </span>
      </label>
      <!-- 输入润色开关从外观页迁入：它控制的是"生成"行为（润色版本数/字数/人称
           本就集中在本页），与外观无关；ui 在下方 script 已定义，与 enrich_count 同款写法 -->
      <label class="choice-check">
        <input v-model="ui.enrich_enabled" type="checkbox" :title="t`在发送消息前用 AI 改写为多个润色版本`" />
        <span class="choice-check-custom"></span>
        <span class="choice-check-label">
          <strong>{{ t`启用输入润色` }}</strong>
          <small>{{ t`发送消息前用 AI 改写为多个润色版本` }}</small>
        </span>
      </label>
    </div>

    <div class="choice-generation-section" data-tour="gen-behavior">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`点击行为` }}</label>
        </div>
        <small class="choice-field-hint">{{ t`点击选项按钮后的动作，与选项面板头部同步` }}</small>
      </div>
      <div class="choice-behavior-bar">
        <button
          class="choice-behavior-btn"
          :class="{ active: gs.settings.behavior === 'send' }"
          @click="gs.settings.behavior = 'send'"
          :title="t`点击选项后直接发送消息`"
        >
          <i class="fa-solid fa-paper-plane"></i>
          {{ t`发送` }}
        </button>
        <button
          class="choice-behavior-btn"
          :class="{ active: gs.settings.behavior === 'fill' }"
          @click="gs.settings.behavior = 'fill'"
          :title="t`点击选项后填入输入框（替换现有内容）`"
        >
          <i class="fa-solid fa-file-pen"></i>
          {{ t`覆盖` }}
        </button>
        <button
          class="choice-behavior-btn"
          :class="{ active: gs.settings.behavior === 'append' }"
          @click="gs.settings.behavior = 'append'"
          :title="t`点击选项后追加到输入框末尾`"
        >
          <i class="fa-solid fa-plus"></i>
          {{ t`尾附` }}
        </button>
      </div>
    </div>

    <div class="choice-generation-section" data-tour="gen-count">
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
            class="text_pole"
            style="width: 80px"
            :placeholder="t`如 4 或 3-6`"
          />
        </label>
        <label class="choice-count-item">
          <span>{{ t`润色版本数` }}</span>
          <input v-model="ui.enrich_count" class="text_pole" style="width: 80px" :placeholder="t`如 4 或 3-6`" />
        </label>
      </div>
    </div>

    <div class="choice-generation-section">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`候选冗余` }}</label>
        </div>
        <small class="choice-field-hint">{{
          t`发送给 AI 的候选条目比选项数多出的比例，AI 从中挑选贴合当前场景的方向生成选项；0 表示候选数与选项数一致`
        }}</small>
      </div>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`冗余比例` }}</span>
          <input
            v-model.number="oversamplePct"
            class="text_pole"
            style="width: 70px"
            type="number"
            min="0"
            max="300"
            :title="t`百分比，默认 50；0 = 候选数与选项数一致`"
          />
          <span>%</span>
        </label>
      </div>
    </div>

    <div class="choice-generation-section">
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
            class="text_pole"
            style="width: 60px"
            type="number"
            min="10"
            max="500"
          />
          <span>-</span>
          <input
            v-model.number="rules.option_max_chars"
            class="text_pole"
            style="width: 60px"
            type="number"
            min="10"
            max="500"
          />
        </label>
        <label class="choice-count-item">
          <span>{{ t`润色` }}</span>
          <input
            v-model.number="rules.enrich_min_chars"
            class="text_pole"
            style="width: 60px"
            type="number"
            min="10"
            max="500"
          />
          <span>-</span>
          <input
            v-model.number="rules.enrich_max_chars"
            class="text_pole"
            style="width: 60px"
            type="number"
            min="10"
            max="500"
          />
        </label>
      </div>
    </div>

    <div class="choice-generation-section">
      <div class="choice-field">
        <div class="choice-field-label">
          <label>{{ t`人称视角` }}</label>
        </div>
        <small class="choice-field-hint">{{ t`选项和润色输出的人称，如"第三人称"或"第一人称"` }}</small>
      </div>
      <div class="choice-count-row">
        <label class="choice-count-item">
          <span>{{ t`选项人称` }}</span>
          <input v-model="rules.option_person" class="text_pole" style="width: 100px" :placeholder="t`如：第三人称`" />
        </label>
        <label class="choice-count-item">
          <span>{{ t`润色人称` }}</span>
          <input v-model="rules.enrich_person" class="text_pole" style="width: 100px" :placeholder="t`如：第三人称`" />
        </label>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useGlobalSettingsStore } from '@/store/global-settings';

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
</script>

<style scoped>
.choice-generation-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-3);
}

.choice-generation-section {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
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

.choice-check {
  display: flex;
  align-items: flex-start;
  gap: var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
  background: var(--choice-bg-card);
  border-radius: var(--choice-radius-md);
  padding: var(--choice-space-3);
  cursor: pointer;
  transition: background var(--choice-transition);
}

.choice-check:hover {
  background: var(--choice-bg-hover);
}

.choice-check input[type='checkbox'] {
  display: none;
}

.choice-check-custom {
  width: 16px;
  height: 16px;
  border: 1px solid var(--choice-border-strong);
  border-radius: 3px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  margin-top: 1px;
  transition:
    background var(--choice-transition),
    border-color var(--choice-transition);
  position: relative;
}

.choice-check input[type='checkbox']:checked + .choice-check-custom {
  background: var(--choice-primary);
  border-color: var(--choice-primary);
}

.choice-check input[type='checkbox']:checked + .choice-check-custom::after {
  content: '✓';
  color: var(--choice-text-on-primary);
  font-size: var(--choice-text-xs);
  font-weight: bold;
  position: absolute;
  line-height: 1;
}

.choice-check-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: var(--choice-text-secondary);
}

.choice-check-label strong {
  color: var(--choice-text);
}

.choice-check-label small {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
}

.choice-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-field-label {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-field-label label {
  font-weight: 600;
}

.choice-field-hint {
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
  line-height: 1.4;
}

.choice-behavior-bar {
  display: flex;
  gap: 2px;
  background: var(--choice-bg-element);
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-1);
  width: fit-content;
}

.choice-behavior-btn {
  background: transparent;
  color: var(--choice-text-muted);
  border: none;
  border-radius: var(--choice-radius-full);
  padding: var(--choice-space-2) var(--choice-space-4);
  font-size: var(--choice-text-sm);
  cursor: pointer;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-2);
  transition:
    background var(--choice-transition),
    color var(--choice-transition),
    box-shadow var(--choice-transition);
}

.choice-behavior-btn:hover {
  color: var(--choice-text-secondary);
}

.choice-behavior-btn.active {
  background: var(--choice-primary);
  color: var(--choice-text-on-primary);
  box-shadow: 0 0 8px var(--choice-primary-glow);
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
</style>
