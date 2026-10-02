<template>
  <div class="choice-generation-editor">
    <!-- 基础行为：自动生成 + 输入润色。恒定展开的固定分组卡片 -->
    <div class="choice-section">
      <h4 class="choice-section-title">{{ t`基础行为` }}</h4>
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

    <!-- 点击行为 -->
    <ChoiceSectionCard title="点击行为" icon="fa-solid fa-mouse-pointer" data-tour="gen-behavior">
      <small class="choice-field-hint">{{ t`点击选项按钮后的动作，与选项面板头部同步` }}</small>
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
    </ChoiceSectionCard>

    <!-- 生成数量 -->
    <ChoiceSectionCard title="生成数量" icon="fa-solid fa-hashtag" data-tour="gen-count">
      <small class="choice-field-hint">{{ t`数字=固定数量，区间=每次随机（如 3-6）` }}</small>
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
    </ChoiceSectionCard>

    <!-- 骰子判定（v56 难度制）：需求值标注/档位兜底 + D100 随机判定。开关默认关，
         关闭时选项行为与旧版完全一致；需求值徽标与判定 chip 均随本开关显隐。
         分组收纳：总开关常显在标题行右侧（extra slot），阈值/模板/长说明收起为展开区 -->
    <ChoiceSectionCard title="骰子判定" data-tour="gen-dice" icon="fa-solid fa-dice">
      <template #extra>
        <label class="choice-check" :title="t`开启后选项行显示需求值徽标，点击掷骰并在行内显示判定结果`">
          <input v-model="gs.settings.dice.enabled" type="checkbox" />
          <span>{{ t`启用骰子判定` }}</span>
        </label>
      </template>
      <!-- v61 DND / COC 判定模式：分段切换。dice.low_roll=false=DND(高点数成功)，true=COC(低点数成功) -->
      <div class="choice-seg" data-tour="gen-dice-mode">
        <button
          class="choice-seg-btn"
          :class="{ active: !gs.settings.dice.low_roll }"
          :title="t`点数越大越好：掷出 ≥ 需求值即为成功（默认）`"
          @click="gs.settings.dice.low_roll = false"
        >
          <i class="fa-solid fa-dice-d20"></i>
          {{ t`DND` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: gs.settings.dice.low_roll }"
          :title="t`点数越小越好：掷出 ≤ 需求值即为成功（COC 百分位）`"
          @click="gs.settings.dice.low_roll = true"
        >
          <i class="fa-solid fa-dice"></i>
          {{ t`COC` }}
        </button>
      </div>
      <small class="choice-field-hint">{{
        gs.settings.dice.low_roll
          ? t`COC：点数 ≤ 需求值=成功，点数越小越好（大成功看点数最小、大失败看点数最大）。需求值按「能力值」标注：越有把握标得越高；无标注时档位兜底为 保守 65 / 平衡 40 / 大胆 15`
          : t`DND：点数 ≥ 需求值=成功，点数越大越好（大成功看点数最大、大失败看点数最小）。无标注时档位兜底为 保守 35 / 平衡 60 / 大胆 85`
      }}</small>
      <!-- 彩蛋阈值：随判定模式切换字段组（DND 用高值大成功/低值大失败，COC 反之） -->
      <div class="choice-count-row">
        <label v-if="!gs.settings.dice.low_roll" class="choice-count-item">
          <span>{{ t`大成功阈值` }}</span>
          <input
            v-model.number="gs.settings.dice.crit_success_min"
            class="choice-input choice-input-w-md"
            type="number"
            min="2"
            max="100"
            :title="t`DND：掷出 ≥ 此值判为大成功（默认 96）`"
            @change="gs.settings.dice.crit_success_min = clampDiceThreshold($event, 2, 100)"
          />
        </label>
        <label v-if="!gs.settings.dice.low_roll" class="choice-count-item">
          <span>{{ t`大失败阈值` }}</span>
          <input
            v-model.number="gs.settings.dice.crit_fail_max"
            class="choice-input choice-input-w-md"
            type="number"
            min="1"
            max="99"
            :title="t`DND：掷出 ≤ 此值判为大失败（默认 5）`"
            @change="gs.settings.dice.crit_fail_max = clampDiceThreshold($event, 1, 99)"
          />
        </label>
        <label v-if="gs.settings.dice.low_roll" class="choice-count-item">
          <span>{{ t`大成功阈值` }}</span>
          <input
            v-model.number="gs.settings.dice.low_roll_crit_success_max"
            class="choice-input choice-input-w-md"
            type="number"
            min="1"
            max="99"
            :title="t`COC：掷出 ≤ 此值判为大成功（默认 5）`"
            @change="gs.settings.dice.low_roll_crit_success_max = clampDiceThreshold($event, 1, 99)"
          />
        </label>
        <label v-if="gs.settings.dice.low_roll" class="choice-count-item">
          <span>{{ t`大失败阈值` }}</span>
          <input
            v-model.number="gs.settings.dice.low_roll_crit_fail_min"
            class="choice-input choice-input-w-md"
            type="number"
            min="2"
            max="100"
            :title="t`COC：掷出 ≥ 此值判为大失败（默认 96）`"
            @change="gs.settings.dice.low_roll_crit_fail_min = clampDiceThreshold($event, 2, 100)"
          />
        </label>
      </div>
      <!-- 彩蛋失效警示：两阈值 clamp 后重叠时 judgeOutcome 会双双关彩蛋，提前说明防困惑 -->
      <small v-if="critOverlapWarning" class="choice-field-hint choice-dice-crit-warn">
        <i class="fa-solid fa-triangle-exclamation"></i>{{ critOverlapWarning }}
      </small>
      <!-- 附加玩法：卡片式开关行（标题 + 一行说明，替代无说明裸复选框） -->
      <div class="choice-dice-toggle-list">
        <label class="choice-toggle" :title="t`点选项先掷骰出示 ↻，重掷满意后再次点击才应用发送`">
          <input v-model="gs.settings.dice.reroll_enabled" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`就地重掷（↻）` }}</strong>
            <small>{{ t`点选项先掷骰出示 ↻，重掷满意后再次点击才应用发送` }}</small>
          </span>
        </label>
        <label class="choice-toggle" :title="t`允许 AI 标注真实骰式（如 [标题|2d6+3|70]），改掷表达式而非固定 D100`">
          <input v-model="gs.settings.dice.allow_formula" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`骰式表达式` }}</strong>
            <small>{{
              t`AI 在标题标注真实骰式才生效，格式 [标题|骰式|需求值]（如 [攻击|2d6+3|70]）；开启后生成时会提示 AI 输出骰式`
            }}</small>
          </span>
        </label>
        <label
          class="choice-toggle"
          :title="t`选项无显式需求值时，从当前角色卡解析属性值做需求值（识别不到回退档位兜底）`"
        >
          <input v-model="gs.settings.dice.attr_dc_enabled" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`属性驱动 DC` }}</strong>
            <small>{{ t`选项无显式需求值时，从当前角色卡解析属性做需求值` }}</small>
          </span>
        </label>
        <label
          class="choice-toggle"
          :title="t`向正文生成请求常驻注入一段系统说明，解释消息开头的判定注释并要求遵守；关闭则仅靠注释自解释`"
        >
          <input v-model="gs.settings.dice.main_ai_awareness" type="checkbox" />
          <span class="choice-toggle-custom"></span>
          <span class="choice-toggle-label">
            <strong>{{ t`正文 AI 感知判定注释` }}</strong>
            <small>{{
              t`向正文生成请求常驻注入一段系统说明，让正文 AI 理解并遵守消息开头的判定注释；关闭则仅靠注释自解释`
            }}</small>
          </span>
        </label>
      </div>
      <!-- 演绎文案模板：收进可折叠「高级」区，减轻主体卡片负担 -->
      <ChoiceSectionCard title="演绎文案模板（高级）" icon="fa-solid fa-comment">
        <small class="choice-field-hint">{{
          t`成功/失败按点数与需求值的差距（margin）分档，每档独立演绎指令；大成功/大失败为单条。指令以 HTML 注释随玩家消息隐形注入（AI 可见、聊天界面与输入框均不可见，用户全程看不到）。插件会自动在注释开头拼结构化结论（结局/裁定对象/点数/需求/差值/程度）、结尾拼纪律尾注，模板只需写演绎要求；仍支持 {rate} {roll} {margin} {degree}；某档留空回退该结局回退文案、两者皆空则不注入`
        }}</small>
        <div class="choice-dice-template-list">
          <div class="choice-dice-template-row">
            <strong>{{ t`成功` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`勉强得手` }}</span>
              <input
                v-model="gs.settings.dice.success_send_low_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin 0–19，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`成功` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`险胜` }}</span>
              <input
                v-model="gs.settings.dice.success_send_mid_low_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin 20–39，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`成功` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`顺利达成` }}</span>
              <input
                v-model="gs.settings.dice.success_send_mid_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin 40–59，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`成功` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`漂亮完胜` }}</span>
              <input
                v-model="gs.settings.dice.success_send_mid_high_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin 60–79，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`成功` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`势如破竹` }}</span>
              <input
                v-model="gs.settings.dice.success_send_high_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin ≥80，给 AI 的演绎指令`"
              />
            </label>
            <label class="choice-count-item">
              <span>{{ t`回退文案` }}</span>
              <input
                v-model="gs.settings.dice.success_template"
                class="choice-input"
                :placeholder="t`演绎指令留空时使用，如：【判定成功】`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`失败` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`差点成功` }}</span>
              <input
                v-model="gs.settings.dice.fail_send_low_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin −1–−19，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`失败` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`功亏一篑` }}</span>
              <input
                v-model="gs.settings.dice.fail_send_mid_low_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin −20–−39，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`失败` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`事与愿违` }}</span>
              <input
                v-model="gs.settings.dice.fail_send_mid_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin −40–−59，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`失败` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`溃败` }}</span>
              <input
                v-model="gs.settings.dice.fail_send_mid_high_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin −60–−79，给 AI 的演绎指令`"
              />
            </label>
          </div>
          <div class="choice-dice-template-row">
            <strong>{{ t`失败` }}</strong>
            <label class="choice-count-item">
              <span>{{ t`彻底落败` }}</span>
              <input
                v-model="gs.settings.dice.fail_send_high_template"
                class="choice-input"
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`margin ≤−80，给 AI 的演绎指令`"
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
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`给 AI 的演绎指令，支持 {rate} {roll} {margin} {degree}`"
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
                :title="t`模板内勿输入 --（会截断 HTML 注释）`"
                :placeholder="t`给 AI 的演绎指令，支持 {rate} {roll} {margin} {degree}`"
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
      </ChoiceSectionCard>
      <small class="choice-field-hint">{{
        t`开启后点击选项时掷骰判定：AI 标注需求值优先，未标注按风险档位兜底（DND：保守 35 / 平衡 60 / 大胆 85；COC：保守 65 / 平衡 40 / 大胆 15）。润色视图与无需求值选项不参与判定；判定方向见上方 DND / COC 模式。`
      }}</small>
    </ChoiceSectionCard>

    <!-- 候选冗余 -->
    <ChoiceSectionCard title="候选冗余" icon="fa-solid fa-layer-group">
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
    </ChoiceSectionCard>

    <!-- 防重复 -->
    <ChoiceSectionCard title="防重复" icon="fa-solid fa-clone">
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
            v-model.number="dedupThreshold"
            class="choice-input choice-input-w-md"
            type="number"
            step="0.05"
            :title="t`0-1 的 bigram Jaccard 阈值；越界/非法输入自动钳回 0-1，空值兜底 0.75`"
          />
        </label>
      </div>
    </ChoiceSectionCard>

    <!-- 每条字数 -->
    <ChoiceSectionCard title="每条字数" icon="fa-solid fa-text-width">
      <small class="choice-field-hint">{{ t`控制每条选项/润色版本的字数区间（中文字符）` }}</small>
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
    </ChoiceSectionCard>

    <!-- 人称视角 -->
    <ChoiceSectionCard title="人称视角" icon="fa-solid fa-user">
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
    </ChoiceSectionCard>
  </div>
</template>

<script setup lang="ts">
import ChoiceSectionCard from '@/components/shared/ChoiceSectionCard.vue';
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

// 去重阈值：v-model.number 直绑时清空输入框得 ''（threshold-0.35=-0.35 → titleGate=0 且
// score>=0 恒真）会让去重「全杀」并空转两轮补齐请求——钳到 0-1、非法值兜底 0.75
const dedupThreshold = computed({
  get: () => gs.settings.generation.dedup_threshold,
  set: v => {
    const n = Number(v);
    gs.settings.generation.dedup_threshold = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.75;
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

// 彩蛋阈值失焦钳制（与字数输入同 idiom，@change 防「输 100 时 1 被钳成 10」跳变）：
// HTML min/max 挡不住手输越界（150/负数/清空）。运行时判定层另有 clamp 防御，但越界值
// 会让彩蛋窗口重叠静默失效（见 critOverlapWarning），故输入层就夹回 schema 界限。
const clampDiceThreshold = (e: Event, lo: number, hi: number): number => {
  const v = Math.round(Number((e.target as HTMLInputElement).value));
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
};

// 彩蛋窗口有效性警示：两阈值经 judgeOutcome 的 clamp 后重叠（DND：大失败上限≥大成功下限；
// COC：大成功上限≥大失败下限）→ 大成功/大失败双双失效退化为纯成败判定。提前警示，
// 避免「设了极端阈值/装了扩窗卡却再无彩蛋」的无感知困惑。
const critOverlapWarning = computed(() => {
  const d = gs.settings.dice;
  const critS = d.low_roll
    ? Math.min(99, Math.max(1, Math.round(Number(d.low_roll_crit_success_max))))
    : Math.min(100, Math.max(2, Math.round(Number(d.crit_success_min))));
  const critF = d.low_roll
    ? Math.min(100, Math.max(2, Math.round(Number(d.low_roll_crit_fail_min))))
    : Math.min(99, Math.max(1, Math.round(Number(d.crit_fail_max))));
  const critsActive = d.low_roll ? critS < critF : critF < critS;
  return d.enabled && !critsActive
    ? t`大成功与大失败阈值区间重叠，彩蛋判定已失效（按纯成败处理）——请把两阈值拉开`
    : '';
});
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

/* 彩蛋失效警示行：阈值重叠时显示在阈值行下方 */
.choice-dice-crit-warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--choice-color-warning, var(--choice-color-error));
}

/* 骰子结局模板列表：每档一行（结局名 + 隐形演绎输入 + 回退输入），
   窄屏下输入列 flex 收窄、标签不换行，避免 380px 横向溢出 */
.choice-dice-template-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

/* v61 附加玩法开关行：卡片式开关行纵向堆叠（标题 + 说明），上下留白与主体卡内其他分区一致 */
.choice-dice-toggle-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
  margin-top: var(--choice-space-1);
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
