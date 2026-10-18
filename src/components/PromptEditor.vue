<template>
  <div class="choice-prompt-editor">
    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-layer-group"></i>{{ t`提示词来源` }}</h4>
      <div class="choice-seg" data-tour="prompt-source">
        <button
          class="choice-seg-btn"
          :class="{ active: globalStore.settings.prompt_source === 'extension' }"
          @click="globalStore.settings.prompt_source = 'extension'"
        >
          {{ t`本扩展提示词` }}
        </button>
        <button
          class="choice-seg-btn"
          :class="{ active: globalStore.settings.prompt_source === 'st_preset' }"
          @click="globalStore.settings.prompt_source = 'st_preset'"
        >
          {{ t`酒馆预设` }}
        </button>
      </div>
      <span class="choice-field-hint">{{
        globalStore.settings.prompt_source === 'st_preset'
          ? t`完全使用酒馆当前 Chat Completion 预设生成：预设里的世界观、文风、自定义条目全部生效；本扩展的提示词配置与模块列表在本模式下隐藏、不参与组装（切回「本扩展提示词」后照常可用），下方上下文设置仍然生效；生成的模型与渠道仍用本扩展配置的 API`
          : t`使用下方模块列表组装提示词（默认）。适合完全自定义选项生成的上下文与规则`
      }}</span>

      <template v-if="globalStore.settings.prompt_source === 'st_preset'">
        <label class="choice-field">
          <span>{{ t`使用预设` }}</span>
          <select v-model="globalStore.settings.st_preset_name" class="choice-select">
            <option value="">{{ t`跟随酒馆当前预设` }}</option>
            <option v-for="name in presetNames" :key="name" :value="name">{{ name }}</option>
          </select>
        </label>
        <span v-if="presetNames.length === 0" class="choice-field-hint" style="color: var(--choice-color-warning)">{{
          t`未读取到酒馆的对话补全预设，请先在酒馆中配置预设，或改回本扩展提示词`
        }}</span>
        <label class="choice-check">
          <input v-model="globalStore.settings.st_preset_sampling" type="checkbox" />
          {{ t`采样参数跟随预设` }}
        </label>
        <span class="choice-field-hint">{{
          t`开启后温度、top_p、惩罚项与输出上限取自预设（预设的输出上限偏小时可能截断选项，可关闭此项用 API 页的参数）；连接地址与模型始终用本扩展的 API 配置`
        }}</span>
        <label class="choice-check">
          <input v-model="globalStore.settings.st_preset_post_processing" type="checkbox" />
          {{ t`提示词后处理跟随预设` }}
        </label>
        <span class="choice-field-hint">{{
          t`把预设声明的提示词后处理（合并同角色、严格交替等）透传给请求，由酒馆后端统一执行；取值顺序：SPreset 强制后处理 → 预设内保存的后处理 → 酒馆当前设置`
        }}</span>
        <div class="choice-field">
          <span>{{ t`预设脚本层` }}</span>
        </div>
        <div class="choice-seg" data-tour="preset-script-layer">
          <button
            class="choice-seg-btn"
            :class="{ active: globalStore.settings.st_preset_script_processing === 'off' }"
            @click="globalStore.settings.st_preset_script_processing = 'off'"
          >
            {{ t`关闭` }}
          </button>
          <button
            class="choice-seg-btn"
            :class="{ active: globalStore.settings.st_preset_script_processing === 'prompt_ready' }"
            @click="globalStore.settings.st_preset_script_processing = 'prompt_ready'"
          >
            {{ t`仅广播` }}
          </button>
          <button
            class="choice-seg-btn"
            :class="{ active: globalStore.settings.st_preset_script_processing === 'tavern_helper' }"
            @click="globalStore.settings.st_preset_script_processing = 'tavern_helper'"
          >
            {{ t`酒馆助手` }}
          </button>
        </div>
        <span
          class="choice-field-hint"
          :title="
            t`仅广播只对监听提示词就绪事件的改写脚本生效（变量/自动执行类不感知）；酒馆助手档的条件合并与强制后处理生效，入口条件与输出侧任何档位都不执行，后处理跟随酒馆当前选中的预设`
          "
          >{{
            t`预设自带的脚本默认不参与选项生成。关闭＝不带；仅广播＝改写提示词的脚本生效；酒馆助手＝交给酒馆助手插件执行（需安装）`
          }}</span
        >
        <div v-if="companionHint" class="choice-preset-companion" :title="companionHintTitle">
          <i class="fa-solid fa-paperclip" aria-hidden="true"></i>
          <span>{{ companionHint }}</span>
        </div>
      </template>
    </div>

    <!-- 预设条目覆盖层：仅预设模式显示。不改酒馆预设文件，在插件侧禁用/替换预设条目 -->
    <div v-if="globalStore.settings.prompt_source === 'st_preset'" class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-sliders"></i>{{ t`预设条目` }}</h4>
      <span class="choice-field-hint">{{
        t`列出当前生效预设的全部条目：可禁用、用插件内容替换条目原文，也可开启酒馆里已停用的条目——这些改动只影响选项生成，酒馆预设文件本身不被修改，恢复后即回到预设原样。标记为「运行时填充」的条目由本扩展按当前场景实时填入，不可禁用或覆盖`
      }}</span>
      <div v-if="presetEntries.length === 0" class="choice-field-hint">{{ t`未读取到预设条目` }}</div>
      <div v-else class="choice-preset-entry-list">
        <div
          v-for="(entry, idx) in presetEntries"
          :key="entry.identifier"
          class="choice-preset-entry"
          :class="{
            'choice-preset-entry--disabled': entry.pluginDisabled || (entry.stDisabled && !entry.forceEnabled),
          }"
        >
          <div class="choice-preset-entry-row">
            <span class="choice-preset-entry-idx">{{ idx + 1 }}</span>
            <span class="choice-preset-entry-role" :class="'choice-preset-entry-role--' + entry.role">{{
              entry.role
            }}</span>
            <span class="choice-preset-entry-name" :title="entry.identifier">{{
              entry.title || entry.identifier
            }}</span>
            <span v-if="entry.isMarker" class="choice-preset-entry-badge">{{ t`运行时填充` }}</span>
            <span v-else-if="entry.pluginDisabled" class="choice-preset-entry-badge choice-preset-entry-badge--off">{{
              t`已禁用`
            }}</span>
            <span
              v-else-if="entry.stDisabled && entry.forceEnabled"
              class="choice-preset-entry-badge choice-preset-entry-badge--on"
              >{{ t`已启用` }}</span
            >
            <span v-else-if="entry.stDisabled" class="choice-preset-entry-badge">{{ t`酒馆已停用` }}</span>
            <span v-else-if="entry.overridden" class="choice-preset-entry-badge choice-preset-entry-badge--on">{{
              t`已覆盖`
            }}</span>
            <span class="choice-preset-entry-actions">
              <template v-if="!entry.isMarker">
                <button
                  v-if="entry.stDisabled"
                  class="choice-btn-sm"
                  :class="{ active: entry.forceEnabled }"
                  :title="
                    entry.forceEnabled
                      ? t`取消强制启用，回到酒馆的停用状态`
                      : t`在插件内强制启用（不改酒馆预设，仅选项生成生效）`
                  "
                  @click="togglePresetEntryForce(entry.identifier)"
                >
                  <i :class="entry.forceEnabled ? 'fa-solid fa-toggle-on' : 'fa-solid fa-toggle-off'"></i>
                </button>
                <button
                  class="choice-btn-sm"
                  :title="entry.pluginDisabled ? t`恢复该条目参与组装` : t`禁用该条目（本扩展侧，不改酒馆预设）`"
                  @click="togglePresetEntry(entry.identifier)"
                >
                  <i :class="entry.pluginDisabled ? 'fa-solid fa-rotate-left' : 'fa-solid fa-ban'"></i>
                </button>
                <button
                  class="choice-btn-sm"
                  :title="entry.expanded ? t`收起内容编辑` : t`用插件内容替换条目原文`"
                  @click="togglePresetEntryExpand(idx)"
                >
                  <i class="fa-solid fa-pen-to-square"></i>
                </button>
              </template>
            </span>
          </div>
          <div v-if="entry.expanded && !entry.isMarker" class="choice-preset-entry-editor">
            <textarea
              class="choice-textarea"
              rows="4"
              :placeholder="t`留空并失焦 = 恢复预设原文；填写 = 用此内容替换条目原文`"
              :value="overrideContentOf(entry.identifier) ?? entry.originalContent"
              @change="onPresetEntryContentInput(entry.identifier, $event)"
            ></textarea>
            <button
              v-if="overrideContentOf(entry.identifier) !== undefined"
              class="choice-btn-sm"
              :title="t`清除内容覆盖，恢复预设原文`"
              @click="clearPresetEntryContent(entry.identifier)"
            >
              {{ t`恢复原文` }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-sliders"></i>{{ t`上下文设置` }}</h4>
      <div class="choice-page-toolbar" data-tour="prompt-toolbar">
        <label
          class="choice-context-rounds"
          :title="
            t`轮数模式：取最后 N 轮未隐藏消息；仅可见消息：不限轮数。两种模式均排除隐藏楼层，历史内容与酒馆主生成一致——酒馆正则的提示词侧处理（按深度截断/隐藏旧楼层等）同样生效`
          "
        >
          <select v-model="rules.context_mode" class="choice-select">
            <option value="rounds">{{ t`轮数模式` }}</option>
            <option value="visible_only">{{ t`仅可见消息` }}</option>
          </select>
          <input
            v-if="rules.context_mode === 'rounds'"
            v-model.number="rules.context_rounds"
            class="choice-input choice-input-w-sm"
            type="number"
            min="1"
            :title="t`每次生成携带的最近消息轮数；0/负数会被兜底为 1（0 并非「不限」）`"
            @change="rules.context_rounds = Math.max(1, Math.round(Number(rules.context_rounds)) || 1)"
          />
        </label>
        <!-- 记忆摘要：扩展模式走摘要模块；预设模式由组装器附加同源摘要消息——
             两模式语义对齐（都把外部记忆摘要作为记忆上下文），不再因模式切换静默缺席 -->
        <label
          class="choice-context-rounds"
          :title="t`开启后把柏宝书的剧情摘要作为记忆上下文注入（扩展模式走模块管线，预设模式由组装器附加同源摘要）`"
        >
          <input v-model="rules.baibai_enabled" type="checkbox" />
          {{ t`柏宝书` }}
        </label>
        <label
          class="choice-context-rounds"
          :title="
            t`开启后 SP·数据库 的注入目标世界书参与选项/润色生成；关闭则该书不参与。目标为角色卡主世界书时关闭不生效，请用世界书页三态/排除控制`
          "
        >
          <input v-model="rules.shujuku_enabled" type="checkbox" />
          {{ t`数据库` }}
        </label>
      </div>
    </div>

    <!-- 提示词配置栏与模块列表同属模块管线：预设模式下不参与组装，整块隐藏
         （配置不丢——切回「本扩展提示词」后原样可用） -->
    <div v-if="globalStore.settings.prompt_source !== 'st_preset'" class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-diagram-project"></i>{{ t`提示词配置` }}</h4>
      <div class="choice-config-bar">
        <div class="choice-config-row">
          <label class="choice-config-label">{{ t`提示词配置` }}</label>
          <select v-model="selectedPromptConfigId" class="choice-config-select">
            <option v-for="cfg in promptConfigs" :key="cfg.id" :value="cfg.id">{{ cfg.name }}</option>
          </select>
          <button
            class="choice-btn-sm"
            :disabled="!selectedPromptConfig"
            :title="t`重命名`"
            @click="startRenamePromptConfig"
          >
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
          <div class="choice-config-actions">
            <button
              class="choice-btn-sm"
              :disabled="selectedPromptConfig?.is_default"
              :title="t`设为默认`"
              @click="setPromptDefault"
            >
              <i class="fa-solid fa-star"></i>
            </button>
            <button
              class="choice-btn-sm"
              :class="{ active: selectedPromptConfigId === chatStore.settings.prompt_config_id }"
              :title="
                selectedPromptConfigId === chatStore.settings.prompt_config_id
                  ? t`当前聊天已绑定（点击取消）`
                  : t`绑定到当前聊天`
              "
              @click="bindPromptChat"
            >
              <i class="fa-solid fa-comment"></i>
            </button>
            <button
              class="choice-btn-sm"
              :class="{ active: selectedPromptConfigId === characterStore.settings.prompt_config_id }"
              :disabled="!currentCharAvailable"
              :title="
                !currentCharAvailable
                  ? t`请先在酒馆中选择一个角色卡`
                  : selectedPromptConfigId === characterStore.settings.prompt_config_id
                    ? t`当前角色已绑定（点击取消）`
                    : t`绑定到当前角色`
              "
              @click="bindPromptCharacter"
            >
              <i class="fa-solid fa-user"></i>
            </button>
            <button
              class="choice-btn-sm choice-btn-del"
              :disabled="selectedPromptConfig?.is_default"
              :title="t`删除`"
              @click="removePromptConfig"
            >
              <i class="fa-solid fa-trash-can"></i>
            </button>
            <button class="choice-btn-sm choice-btn-new" :title="t`新建`" @click="showCreatePromptConfig = true">
              <i class="fa-solid fa-plus"></i> {{ t`新建` }}
            </button>
          </div>
        </div>
        <div class="choice-config-status">
          <span class="choice-config-status-label">{{ t`当前生效` }}:</span>
          <span class="choice-config-status-name">{{ effectiveConfigName }}</span>
          <span v-if="chatStore.settings.prompt_config_id" class="choice-bound-badge">{{ t`聊天` }}</span>
          <span v-if="characterStore.settings.prompt_config_id" class="choice-bound-badge choice-bound-char">{{
            t`角色`
          }}</span>
        </div>

        <!-- 已绑定当前提示词配置的角色卡徽章（反向视角：角色卡→配置 的绑定关系列表，同过滤页角色卡区） -->
        <ConfigBindings :config-id="selectedPromptConfigId" kind="prompt" />
      </div>
    </div>

    <div v-if="globalStore.settings.prompt_source !== 'st_preset'" class="choice-section">
      <h4 class="choice-section-title"><i class="fa-solid fa-list-ul"></i>{{ t`模块列表` }}</h4>
      <div class="choice-module-toolbar">
        <div class="choice-module-toolbar-left">
          <div v-if="globalStore.settings.ui.enrich_enabled" class="choice-mode-switch">
            <button
              class="choice-mode-btn"
              :class="{ 'choice-mode-btn--active': promptMode === 'all' }"
              @click="promptMode = 'all'"
            >
              {{ t`全部` }} ({{ totalCount }})
            </button>
            <button
              class="choice-mode-btn"
              :class="{ 'choice-mode-btn--active': promptMode === 'option' }"
              @click="promptMode = 'option'"
            >
              {{ t`选项生成` }} ({{ optionCount }})
            </button>
            <button
              class="choice-mode-btn"
              :class="{ 'choice-mode-btn--active': promptMode === 'enrich' }"
              @click="promptMode = 'enrich'"
            >
              {{ t`润色` }} ({{ enrichCount }})
            </button>
          </div>
        </div>
        <div class="choice-module-toolbar-right">
          <div class="choice-export-wrap">
            <button
              class="menu_button choice-export-btn"
              :title="t`添加新的提示词模块`"
              @click.stop="showAddMenu = !showAddMenu"
            >
              <span>{{ t`新增模块` }}</span>
              <i
                class="fa-solid fa-chevron-down choice-export-caret"
                :class="{ 'choice-export-caret--open': showAddMenu }"
              ></i>
            </button>
            <div v-if="showAddMenu" class="choice-export-dropdown">
              <button
                @click="
                  addModule(false, false);
                  showAddMenu = false;
                "
              >
                {{ t`通用模块` }}
              </button>
              <button
                @click="
                  addModule(false, true);
                  showAddMenu = false;
                "
              >
                {{ t`选项模块` }}
              </button>
              <button
                v-if="globalStore.settings.ui.enrich_enabled"
                @click="
                  addModule(true, false);
                  showAddMenu = false;
                "
              >
                {{ t`润色模块` }}
              </button>
            </div>
          </div>
          <div class="choice-export-wrap">
            <button
              class="menu_button choice-export-btn"
              :title="t`选择要导出的模块范围`"
              @click.stop="showExportMenu = !showExportMenu"
            >
              <span>{{ t`导出` }}</span>
              <i
                class="fa-solid fa-chevron-down choice-export-caret"
                :class="{ 'choice-export-caret--open': showExportMenu }"
              ></i>
            </button>
            <div v-if="showExportMenu" class="choice-export-dropdown">
              <button
                @click="
                  exportPrompts('all');
                  showExportMenu = false;
                "
              >
                {{ t`导出全部` }}
              </button>
              <button
                @click="
                  exportPrompts('option');
                  showExportMenu = false;
                "
              >
                {{ t`导出选项模块` }}
              </button>
              <button
                v-if="globalStore.settings.ui.enrich_enabled"
                @click="
                  exportPrompts('enrich');
                  showExportMenu = false;
                "
              >
                {{ t`导出润色模块` }}
              </button>
            </div>
          </div>
          <button class="menu_button" :title="t`从 JSON 文件导入提示词模块`" @click="importPrompts">
            {{ t`导入` }}
          </button>
          <button
            class="menu_button"
            :title="t`将所有提示词模块完全恢复为默认值（包括顺序、启用状态、内容）`"
            @click="resetPromptToDefaults"
          >
            {{ t`恢复默认` }}
          </button>
        </div>
      </div>

      <div class="choice-module-list" @dragover.prevent="onListDragOver" @drop.prevent="onListDrop">
        <template v-for="(mod, idx) in allModules" :key="mod.id">
          <div
            class="choice-module-card"
            :class="{
              'choice-module-card-marker': mod.marker,
              'choice-module-card-dragging': dragIndex === idx,
              'choice-module-card-drag-over': dragOverIndex === idx && dragIndex !== idx,
            }"
            @dragover.prevent="onDragOver($event, idx)"
            @dragleave="onDragLeave(idx)"
            @drop.prevent="onDrop(idx)"
          >
            <!-- draggable 只挂在 ☰ 把手上：整卡 draggable 时手机长按卡片文本会触发系统级
               文本选择/原生拖拽抢事件，桌面也容易误从正文发起拖拽。dragend 必须同挂在把手上——
               它只派发到拖拽源元素（span），挂在卡片上收不到，dragIndex 会永远清不掉 -->
            <span
              class="choice-module-drag"
              :draggable="true"
              :title="t`拖动排序`"
              @dragstart="onDragStart($event, idx)"
              @dragend="onDragEnd"
              >☰</span
            >

            <div class="choice-module-body">
              <div class="choice-module-header">
                <span v-if="renamingId !== mod.id" class="choice-module-name" @dblclick="startRename(mod)">{{
                  mod.name
                }}</span>
                <input
                  v-else
                  v-model="renameText"
                  class="choice-input choice-rename-input"
                  @blur="finishRename(mod)"
                  @keydown.enter="finishRename(mod)"
                  @keydown.escape.stop="cancelRename"
                />
                <span class="choice-module-role" :class="`choice-role-${mod.role}`">{{ mod.role }}</span>
                <span v-if="mod.enrich_only" class="choice-enrich-badge-sm">{{ t`润色` }}</span>
                <span v-if="mod.option_only" class="choice-option-badge-sm">{{ t`选项` }}</span>
                <span v-if="mod.marker" class="choice-module-lock" :title="t`不可编辑模块`">🔒</span>
              </div>
              <div class="choice-module-preview">
                {{ previewContent(mod) }}
              </div>
            </div>

            <div class="choice-module-actions">
              <label class="choice-check" :title="mod.enabled ? t`启用` : t`禁用`">
                <input type="checkbox" :checked="mod.enabled" @change="toggleEnabled(mod)" />
              </label>
              <button
                v-if="!mod.marker"
                class="menu_button choice-module-btn"
                :title="t`恢复默认`"
                @click="restoreTarget = mod.id"
              >
                🔄
              </button>
              <button
                v-if="!READONLY_MODULE_IDS.has(mod.id)"
                class="menu_button choice-module-btn"
                :title="t`复制`"
                @click="copyModule(mod.id)"
              >
                📋
              </button>
              <button
                v-if="!mod.marker"
                class="menu_button choice-module-btn"
                :title="t`编辑`"
                @click="toggleEdit(mod.id)"
              >
                {{ editingId === mod.id ? '✕' : '🖉' }}
              </button>
              <button
                v-if="!mod.system"
                class="menu_button choice-module-btn choice-delete-btn"
                :title="t`删除`"
                @click="deleteTarget = mod.id"
              >
                <i class="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>

          <div v-if="editingId === mod.id" class="choice-module-edit">
            <div class="choice-module-edit-head">
              <span>{{ t`编辑模块` }}: {{ editingModule?.name }}</span>
              <select v-if="editingModule" v-model="editingModule.role" class="choice-select">
                <option value="system">system</option>
                <option value="user">user</option>
                <option value="assistant">assistant</option>
              </select>
            </div>
            <textarea v-if="editingModule" v-model="editingModule.content" class="choice-textarea" rows="8"></textarea>
          </div>
        </template>
      </div>
    </div>

    <ConfirmDialog
      :open="deleteTarget !== null"
      :title="t`删除模块`"
      :message="t`确定要删除该模块吗？此操作不可撤销。`"
      :confirm-text="t`删除`"
      :cancel-text="t`取消`"
      @confirm="onDeleteConfirm"
      @cancel="deleteTarget = null"
    />

    <ConfirmDialog
      :open="restoreTarget !== null"
      :title="t`恢复默认`"
      :message="t`确定要将该模块恢复为默认内容吗？当前修改将丢失。`"
      :confirm-text="t`恢复`"
      :cancel-text="t`取消`"
      @confirm="onRestoreConfirm"
      @cancel="restoreTarget = null"
    />

    <CreateConfigDialog
      :open="showCreatePromptConfig"
      :existing-names="promptConfigs.map(c => c.name)"
      @close="showCreatePromptConfig = false"
      @create="onCreatePromptConfig"
    />

    <PromptImportDialog
      :open="showImportDialog"
      :summary="importSummary"
      :existing-names="promptConfigs.map(c => c.name)"
      @close="showImportDialog = false"
      @confirm="onImportConfirm"
    />
  </div>
</template>

<script setup lang="ts">
import toastr from 'toastr';
import { this_chid } from '@/core/st-world-info';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { useChatSettingsStore } from '@/store/chat-settings';
import { usePromptConfigSelectorStore } from '@/store/prompt-config-selector';
import { getStCharacter } from '@/core/st-character';
import ConfirmDialog from '@/components/ConfirmDialog.vue';
import CreateConfigDialog from '@/components/CreateConfigDialog.vue';
import PromptImportDialog from '@/components/PromptImportDialog.vue';
import ConfigBindings from '@/components/shared/ConfigBindings.vue';
import type { PromptModule } from '@/type/settings';
import { BAIBAI_MODULE_IDS, PromptModule as PromptModuleSchema } from '@/type/settings';
import { isoTimestamp } from '@/util/time';
import { toggleChatBinding, toggleCharacterBinding } from '@/core/bindings';
import { listStPresetNames, readActiveStPreset, type StPresetSnapshot } from '@/core/st-preset-source';
import { readPresetCompanionScripts, type PresetCompanionScripts } from '@/core/st-preset-scripts';
import { NATIVE_MARKER_SLOTS } from '@/core/preset-messages';
import { z } from 'zod';

const globalStore = useGlobalSettingsStore();
const characterStore = useCharacterSettingsStore();
const chatStore = useChatSettingsStore();
const promptConfigSelector = usePromptConfigSelectorStore();
const rules = globalStore.settings.prompt_rules;

/** 酒馆 CC 预设名列表（预设模式的下拉选项）。预设由酒馆在设置加载时读入，本扩展只读；
 *  列表在进入预设模式时刷新一次即可——酒馆内新增/改名预设后重新进入本页会取到新列表。 */
const presetNames = ref<string[]>([]);

// ── 预设条目覆盖层（仅预设模式显示）────────────────────────────
// 快照在进入预设模式 / 切换预设名时刷新一次；条目内容可能很大，避免每帧重读宿主对象。
const presetSnapshot = ref<StPresetSnapshot | null>(null);
const expandedEntries = ref(new Set<number>());

// ── 预设配套脚本可见化（只读计数/启用态，不读脚本正文）──────────────────
// 预设包常内嵌正则与外部脚本：正则的提示词侧已随本扩展生效；外部脚本仅在
// 酒馆主生成流程执行，选项生成的预设模式不经过它们。把差异摆到明面上，防「选项质量
// 为什么与主生成不一样」的静默困惑。随预设名/来源切换刷新一次；脚本启停无事件可订阅，
// 提示为快照性质（重进本页即刷新）。
const companionScripts = ref<PresetCompanionScripts | null>(null);

watch(
  () => [globalStore.settings.prompt_source, globalStore.settings.st_preset_name] as const,
  ([source]) => {
    if (source !== 'st_preset') return;
    presetNames.value = listStPresetNames();
    presetSnapshot.value = readActiveStPreset(globalStore.settings.st_preset_name);
    companionScripts.value = readPresetCompanionScripts(globalStore.settings.st_preset_name);
    expandedEntries.value = new Set();
  },
  { immediate: true },
);

const companionHint = computed(() => {
  const info = companionScripts.value;
  if (!info) return '';
  const parts: string[] = [];
  if (info.regexCount > 0) parts.push(t`预设正则 ×${info.regexCount}`);
  if (info.helperTotal > 0) {
    const helperActive = info.helperInstalled && info.helperScopeEnabled && info.helperEnabled > 0;
    if (helperActive) parts.push(t`酒馆助手脚本 ×${info.helperEnabled}（仅主对话执行）`);
    else if (info.helperEnabled > 0) parts.push(t`酒馆助手脚本 ×${info.helperEnabled}（酒馆助手未启用）`);
    else parts.push(t`酒馆助手脚本 ×${info.helperTotal}（均已停用）`);
  }
  if (info.spresetPresent) {
    parts.push(
      info.spresetModules.length
        ? t`SPreset 框架（${info.spresetModules.join('、')}）`
        : t`SPreset 框架（未启用处理模块）`,
    );
  }
  return parts.length ? t`该预设自带：${parts.join('；')}` : '';
});

const companionHintTitle = computed(() => {
  const info = companionScripts.value;
  if (!info) return '';
  const lines = [
    t`预设绑定正则由酒馆正则扩展自动加载，其中作用于提示词的规则已随选项生成的历史消息生效；正则跟随酒馆当前选中的预设。`,
    t`酒馆助手预设脚本仅在酒馆主生成流程中执行，选项生成的预设模式不经过它们——选项生成的行为因此可能与主生成不同。`,
    t`SPreset 框架的强制后处理模式已由「提示词后处理跟随预设」自动采用；其余载荷级处理（条件合并等）仅在脚本层「酒馆助手」档生效，入口条件与输出侧处理在任何档位都不执行。`,
  ];
  if (info.differsFromSelected) {
    lines.push(t`注意：当前固定使用的预设与酒馆选中的预设不同——提示词取固定预设，而预设正则仍跟随酒馆选中的预设。`);
  }
  return lines.join('\n');
});

/** 覆盖层的响应式入口：模板与操作函数都经它读写，deep watch 统一落盘。 */
const overridesRef = computed(() => globalStore.settings.st_preset_overrides);

type PresetEntryRow = {
  identifier: string;
  title: string;
  role: string;
  isMarker: boolean;
  /** 酒馆侧 prompt_order.enabled === false（酒馆自己停用的条目，默认不参与组装）。 */
  stDisabled: boolean;
  /** 覆盖层 enabled=true：插件内强制开启酒馆已停用的条目。 */
  forceEnabled: boolean;
  originalContent: string;
  expanded: boolean;
  pluginDisabled: boolean;
  overridden: boolean;
};

/** rows：按酒馆 prompt_order 顺序列出当前预设条目（含覆盖状态）。 */
const presetEntries = computed<PresetEntryRow[]>(() => {
  const snap = presetSnapshot.value;
  const overrides = overridesRef.value;
  if (!snap) return [];
  const byId = new Map(snap.prompts.map(p => [String(p?.identifier ?? '').trim(), p]));
  const rows: PresetEntryRow[] = [];
  const seen = new Set<string>();
  for (const entry of snap.order) {
    const id = String(entry?.identifier ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const prompt = byId.get(id);
    if (!prompt) continue;
    const ov = overrides?.[id];
    rows.push({
      identifier: id,
      title: String(prompt.name ?? '').trim(),
      role: String(prompt.role ?? 'system').toLowerCase(),
      isMarker: prompt.marker === true || (NATIVE_MARKER_SLOTS as readonly string[]).includes(id),
      stDisabled: entry?.enabled === false,
      forceEnabled: ov?.enabled === true,
      originalContent: String(prompt.content ?? ''),
      expanded: expandedEntries.value.has(rows.length),
      pluginDisabled: ov?.disabled === true,
      overridden: ov?.content !== undefined,
    });
  }
  return rows;
});

/** 禁用/恢复条目（本扩展侧覆盖层，酒馆预设不动）。已有内容/强制启用覆盖时只翻 disabled 位，
 *  其余覆盖保留——「恢复原样」由清除覆盖负责。 */
const togglePresetEntry = (id: string): void => {
  const ov = globalStore.settings.st_preset_overrides;
  const cur = ov[id];
  if (cur?.disabled) {
    const { disabled: _disabled, ...rest } = cur;
    if (Object.keys(rest).length) ov[id] = rest;
    else delete ov[id];
  } else {
    ov[id] = { ...(cur ?? {}), disabled: true };
  }
};

/** 强制启用/取消（仅对酒馆已停用的条目显示）：插件侧开启不改酒馆预设，只影响选项生成。 */
const togglePresetEntryForce = (id: string): void => {
  const ov = globalStore.settings.st_preset_overrides;
  const cur = ov[id];
  if (cur?.enabled) {
    const { enabled: _enabled, ...rest } = cur;
    if (Object.keys(rest).length) ov[id] = rest;
    else delete ov[id];
  } else {
    ov[id] = { ...(cur ?? {}), enabled: true };
  }
};

const overrideContentOf = (id: string): string | undefined => globalStore.settings.st_preset_overrides[id]?.content;

/** 写入内容覆盖。空值 = 清除覆盖（恢复预设原文）——条目级「清空」想表达的是不参与，
 *  用禁用表达更明确，且防误触空 textarea 把条目静默清空。 */
const onPresetEntryContentInput = (id: string, e: Event): void => {
  setPresetEntryContent(id, String((e.target as HTMLTextAreaElement)?.value ?? ''));
};

const setPresetEntryContent = (id: string, value: string): void => {
  const ov = globalStore.settings.st_preset_overrides;
  if (!value.trim()) {
    clearPresetEntryContent(id);
    return;
  }
  ov[id] = { ...(ov[id] ?? {}), content: value };
};

const clearPresetEntryContent = (id: string): void => {
  const ov = globalStore.settings.st_preset_overrides;
  const cur = ov[id];
  if (!cur) return;
  const { content: _content, ...rest } = cur;
  if (Object.keys(rest).length) ov[id] = rest;
  else delete ov[id];
};

const togglePresetEntryExpand = (idx: number): void => {
  const next = new Set(expandedEntries.value);
  if (next.has(idx)) next.delete(idx);
  else next.add(idx);
  expandedEntries.value = next;
};

/** 只读模块：仅允许移动和开关，不可编辑/删除/复制 */
const READONLY_MODULE_IDS = new Set([
  'world_info_before',
  'persona_description',
  'char_description',
  'char_personality',
  'char_scenario',
  'world_info_after',
  'chat_history',
  'baibai_summary',
  'wi_depth_before',
  'wi_depth_after',
]);
const DEPRECATED_MODULE_IDS = new Set(['baibai_state']);

const allModules = computed(() => {
  let modules = globalStore.allModules.filter(m => !DEPRECATED_MODULE_IDS.has(m.id));
  if (!rules.baibai_enabled) {
    modules = modules.filter(m => !BAIBAI_MODULE_IDS.has(m.id));
  }
  // 润色关闭时强制隐藏所有 enrich_only 模块，忽略 promptMode
  if (!globalStore.settings.ui.enrich_enabled) {
    modules = modules.filter(m => !m.enrich_only);
  } else if (promptMode.value === 'option') {
    modules = modules.filter(m => !m.enrich_only);
  } else if (promptMode.value === 'enrich') {
    modules = modules.filter(m => !m.option_only);
  }
  return modules;
});

type PromptMode = 'all' | 'option' | 'enrich';
const promptMode = ref<PromptMode>('all');
const showExportMenu = ref(false);
const showAddMenu = ref(false);

const baibaiFilteredModules = computed(() => {
  let modules = globalStore.allModules.filter(m => !DEPRECATED_MODULE_IDS.has(m.id));
  if (!rules.baibai_enabled) {
    modules = modules.filter(m => !BAIBAI_MODULE_IDS.has(m.id));
  }
  return modules;
});

const totalCount = computed(() => baibaiFilteredModules.value.length);
const optionCount = computed(() => baibaiFilteredModules.value.filter(m => !m.enrich_only).length);
const enrichCount = computed(() => baibaiFilteredModules.value.filter(m => !m.option_only).length);

watch(
  () => globalStore.settings.ui.enrich_enabled,
  enabled => {
    if (!enabled) promptMode.value = 'all';
  },
);

const editingId = ref<string | null>(null);
const renamingId = ref<string | null>(null);
const renameText = ref('');
const deleteTarget = ref<string | null>(null);
const restoreTarget = ref<string | null>(null);

// 提示词配置栏
const promptConfigs = computed(() => globalStore.settings.prompt_configs);
const effectiveConfig = computed(() => promptConfigSelector.effectiveConfig);
const effectiveConfigName = computed(() => effectiveConfig.value?.name ?? '—');
const selectedPromptConfigId = ref<string | null>(null);
const showCreatePromptConfig = ref(false);

watch(
  [promptConfigs, effectiveConfig],
  () => {
    if (promptConfigs.value.length === 0) {
      selectedPromptConfigId.value = null;
      return;
    }
    if (!selectedPromptConfigId.value || !promptConfigs.value.find(c => c.id === selectedPromptConfigId.value)) {
      selectedPromptConfigId.value = effectiveConfig.value?.id ?? promptConfigs.value[0].id;
    }
  },
  { immediate: true },
);

const selectedPromptConfig = computed(
  () => promptConfigs.value.find(c => c.id === selectedPromptConfigId.value) ?? null,
);

watch(selectedPromptConfigId, newId => {
  if (newId) {
    try {
      globalStore.switchPromptConfig(newId);
    } catch (e) {
      console.warn('[Choice] switchPromptConfig failed', e);
    }
  }
});

function startRenamePromptConfig() {
  const cfg = selectedPromptConfig.value;
  if (!cfg) return;
  const name = prompt(t`请输入新名称`, cfg.name);
  const trimmed = name?.trim();
  if (!trimmed || trimmed === cfg.name) return;
  // 重名检测：与其他提示词配置同名会让下拉歧义，提醒后放弃修改
  if (promptConfigs.value.some(c => c.id !== cfg.id && c.name === trimmed)) {
    toastr.warning(t`配置名「${trimmed}」已存在`);
    return;
  }
  globalStore.renamePromptConfig(cfg.id, trimmed);
}

function setPromptDefault() {
  if (!selectedPromptConfigId.value) return;
  globalStore.setDefaultPromptConfig(selectedPromptConfigId.value);
}

function bindPromptChat() {
  toggleChatBinding('prompt', selectedPromptConfigId.value);
}

// 无当前角色时绑定无意义（store watch 对 this_chid 为空会静默跳过写卡，造成「绑定无效」），
// 按钮禁用 + toggleCharacterBinding 内再 guard 双保险。
// 依赖 store 的响应式 currentCharacterId 而非模块变量 this_chid：this_chid 非响应式，
// computed 不会在切角色后自动重算（曾有实证：切到角色聊天后按钮仍停留 disabled 态）
const currentCharAvailable = computed(() => globalStore.currentCharacterId != null);

function bindPromptCharacter() {
  toggleCharacterBinding('prompt', selectedPromptConfigId.value);
}

function removePromptConfig() {
  const cfg = selectedPromptConfig.value;
  if (!cfg || cfg.is_default) return;
  if (!confirm(t`确定要删除配置「${cfg.name}」吗？此操作不可撤销。`)) return;
  globalStore.deletePromptConfig(cfg.id);
  if (promptConfigs.value.length > 0) {
    selectedPromptConfigId.value = effectiveConfig.value?.id ?? promptConfigs.value[0].id;
  }
}

function onCreatePromptConfig(payload: { name: string; isDefault: boolean; bindChat: boolean; bindChar: boolean }) {
  const cfg = globalStore.createPromptConfig(payload.name, payload.isDefault);
  selectedPromptConfigId.value = cfg.id;
  if (payload.bindChat) chatStore.settings.prompt_config_id = cfg.id;
  if (payload.bindChar) {
    // 编辑归属走角色卡扩展写入，无当前角色时绑定必失效（与 bindPromptCharacter 同一根因），防御提示
    if (getStCharacter(this_chid)) {
      characterStore.setBinding('prompt', cfg.id);
    } else {
      toastr.warning(t`未选择角色卡，「绑定角色」未生效`);
    }
  }
  showCreatePromptConfig.value = false;
}

const editingModule = computed(() => {
  if (!editingId.value) return null;
  return rules.modules.find(m => m.id === editingId.value) ?? null;
});

const dragIndex = ref<number | null>(null);
const dragOverIndex = ref<number | null>(null);

const addModule = (enrichOnly = false, optionOnly = false) => {
  globalStore.addModule(undefined, enrichOnly, optionOnly);
};

const resetPromptToDefaults = () => {
  if (!confirm(t`确定要将所有提示词模块完全恢复为默认值吗？\n\n这将重置模块顺序、启用状态和内容。此操作不可撤销。`))
    return;
  globalStore.resetPromptToDefaults();
  toastr.success(t`提示词已恢复为默认值`);
};

function exportPrompts(mode: 'all' | 'option' | 'enrich' = 'all') {
  const pr = globalStore.settings.prompt_rules;
  let modules = pr.modules;
  if (mode === 'option') {
    modules = modules.filter(m => !m.enrich_only);
  } else if (mode === 'enrich') {
    modules = modules.filter(m => !m.option_only);
  }
  // v3：携带配置级字段，使「作为新建配置导入」能得到完整配置；v2 导入方只读 modules，向前兼容
  const json = JSON.stringify(
    {
      version: 3,
      mode,
      exportedAt: isoTimestamp(),
      modules,
      config: {
        option_person: pr.option_person,
        enrich_person: pr.enrich_person,
        enrich_person_style: pr.enrich_person_style,
        option_min_chars: pr.option_min_chars,
        option_max_chars: pr.option_max_chars,
        enrich_min_chars: pr.enrich_min_chars,
        enrich_max_chars: pr.enrich_max_chars,
        context_rounds: pr.context_rounds,
        context_mode: pr.context_mode,
        baibai_enabled: pr.baibai_enabled,
        shujuku_enabled: pr.shujuku_enabled,
      },
    },
    null,
    2,
  );
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const suffix = mode !== 'all' ? `-${mode}` : '';
  a.download = `choice-prompts${suffix}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

type ImportFileMode = 'all' | 'option' | 'enrich';

const showImportDialog = ref(false);
const importSummary = ref<{
  fileName: string;
  mode: ImportFileMode;
  scoped: PromptModule[];
  totalCount: number;
  /** v3 文件携带的配置级字段（白名单校验后）；v2 文件为空对象，导入新配置时逐字段回退当前值 */
  fileConfig: Record<string, string | number | boolean>;
  overwriteCount: number;
  addCount: number;
  keptCount: number;
} | null>(null);

function importPrompts() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.onchange = async e => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.modules || !Array.isArray(data.modules)) {
        throw new Error('JSON 文件格式不正确：缺少 modules 数组');
      }
      const importedModules = z.array(PromptModuleSchema).parse(data.modules);
      const ids = importedModules.map(m => m.id);
      if (new Set(ids).size !== ids.length) {
        throw new Error('导入的模块中存在重复 ID');
      }
      const mode: ImportFileMode = data.mode || 'all';
      if (mode !== 'all' && mode !== 'option' && mode !== 'enrich') {
        throw new Error(`未知的导入模式：${mode}`);
      }
      const existingModules = globalStore.settings.prompt_rules.modules;
      // 按文件模式圈定导入范围：option/enrich 导出文件只覆盖对应类模块，对立类现有模块不动
      const scoped =
        mode === 'all'
          ? importedModules
          : mode === 'option'
            ? importedModules.filter(m => !m.enrich_only)
            : importedModules.filter(m => !m.option_only);
      // 计数为合并模式的预览值：id 命中 → 覆盖，未命中 → 新增，现有中未被导入覆盖的 → 保留
      const existingIds = new Set(existingModules.map(m => m.id));
      const overwriteCount = scoped.filter(m => existingIds.has(m.id)).length;
      // v3 文件携带配置级字段：白名单 + 类型校验逐字段提取，非法/缺失忽略（新建配置时回退当前值）
      const rawConfig = data.config && typeof data.config === 'object' ? (data.config as Record<string, unknown>) : {};
      const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
      const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
      const b = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
      const fileConfig: Record<string, string | number | boolean> = {};
      const cfgEntries: Array<[string, string | number | boolean | undefined]> = [
        ['option_person', s(rawConfig.option_person)],
        ['enrich_person', s(rawConfig.enrich_person)],
        ['enrich_person_style', s(rawConfig.enrich_person_style)],
        ['option_min_chars', n(rawConfig.option_min_chars)],
        ['option_max_chars', n(rawConfig.option_max_chars)],
        ['enrich_min_chars', n(rawConfig.enrich_min_chars)],
        ['enrich_max_chars', n(rawConfig.enrich_max_chars)],
        ['context_rounds', n(rawConfig.context_rounds)],
        [
          'context_mode',
          rawConfig.context_mode === 'rounds' || rawConfig.context_mode === 'visible_only'
            ? rawConfig.context_mode
            : undefined,
        ],
        ['baibai_enabled', b(rawConfig.baibai_enabled)],
        ['shujuku_enabled', b(rawConfig.shujuku_enabled)],
      ];
      for (const [k, v] of cfgEntries) {
        if (v !== undefined) fileConfig[k] = v;
      }
      importSummary.value = {
        fileName: file.name,
        mode,
        scoped,
        totalCount: scoped.length,
        fileConfig,
        overwriteCount,
        addCount: scoped.length - overwriteCount,
        keptCount: existingModules.length - overwriteCount,
      };
      showImportDialog.value = true;
    } catch (err) {
      toastr.error(t`导入失败：${err instanceof Error ? err.message : '无效的 JSON 文件'}`);
    }
  };
  input.click();
}

const onImportConfirm = (payload: { mode: 'merge' | 'replace' | 'new'; newName?: string }) => {
  const summary = importSummary.value;
  if (!summary) return;
  if (payload.mode === 'new') {
    // 兜底重名检测（对话框内已有行内拦截）
    const trimmed = payload.newName?.trim() || t`导入配置`;
    if (promptConfigs.value.some(c => c.name === trimmed)) {
      toastr.warning(t`配置名「${trimmed}」已存在`);
      return;
    }
    // 作为新建配置导入：不动当前配置与工作副本；切换 selectedPromptConfigId 由 watch
    // 触发 switchPromptConfig——导入路径未触碰工作副本，旧配置回写无损
    const cfg = globalStore.importPromptModulesAsNewConfig(summary.scoped, {
      name: trimmed,
      config: summary.fileConfig,
    });
    showImportDialog.value = false;
    importSummary.value = null;
    selectedPromptConfigId.value = cfg.id;
    toastr.success(
      t`已导入为新配置「${cfg.name}」：导入 ${summary.scoped.length} 个模块，补齐 ${summary.keptCount} 个`,
    );
    return;
  }
  const { overwritten, added } = globalStore.importPromptModules(summary.scoped, {
    replaceAll: payload.mode === 'replace',
    // 落盘到正在编辑（下拉选中）的配置快照；无配置时为 null，仅写工作副本
    configId: selectedPromptConfigId.value,
  });
  showImportDialog.value = false;
  importSummary.value = null;
  toastr.success(t`已导入：覆盖 ${overwritten} 个模块，新增 ${added} 个模块`);
};

const toggleEnabled = (mod: PromptModule) => {
  mod.enabled = !mod.enabled;
};

const copyModule = (id: string) => {
  globalStore.duplicateModule(id);
};

const onDeleteConfirm = () => {
  if (deleteTarget.value) {
    globalStore.removeModule(deleteTarget.value);
    deleteTarget.value = null;
  }
};

const onRestoreConfirm = () => {
  if (restoreTarget.value) {
    globalStore.resetModuleContent(restoreTarget.value);
    restoreTarget.value = null;
  }
};

const toggleEdit = (id: string) => {
  editingId.value = editingId.value === id ? null : id;
};

const startRename = (mod: PromptModule) => {
  renamingId.value = mod.id;
  renameText.value = mod.name;
};

const finishRename = (mod: PromptModule) => {
  const t = renameText.value.trim();
  if (t) mod.name = t;
  renamingId.value = null;
};

const cancelRename = () => {
  renamingId.value = null;
};

const previewContent = (mod: PromptModule): string => {
  if (mod.marker) {
    const m: Record<string, string> = {
      world_info_before: '[世界书条目 - 角色定义前]',
      world_info_after: '[世界书条目 - 角色定义后]',
      persona_description: '[Persona 描述]',
      chat_history: '[聊天历史]',
      thinking_prompt: '[思考检查清单]',
      assistant_thinking: '[思维链起手]',
    };
    return m[mod.id] ?? '[动态内容]';
  }
  const content = mod.content.replace(/\{\{[^}]+\}\}/g, '...').slice(0, 80);
  return content || '(空)';
};

const onDragStart = (e: DragEvent, idx: number) => {
  dragIndex.value = idx;
  if (e.dataTransfer) {
    e.dataTransfer.effectAllowed = 'move';
    // 拖拽源是 ☰ 把手本身，默认拖影只有一个小图标；用整张卡片做拖影保持视觉反馈
    const card = (e.currentTarget as HTMLElement).closest('.choice-module-card');
    if (card) e.dataTransfer.setDragImage(card, 0, 0);
  }
};

const onDragOver = (_e: DragEvent, idx: number) => {
  if (dragIndex.value === null) return;
  dragOverIndex.value = idx;
};

const onDragLeave = (idx: number) => {
  if (dragOverIndex.value === idx) dragOverIndex.value = null;
};

const onListDragOver = (_e: DragEvent) => {
  // 允许 drop
};

const onListDrop = (_e: DragEvent) => {
  dragIndex.value = null;
  dragOverIndex.value = null;
};

const onDrop = (idx: number) => {
  if (dragIndex.value === null || dragIndex.value === idx) {
    dragIndex.value = null;
    dragOverIndex.value = null;
    return;
  }
  const all = [...allModules.value];
  const [moved] = all.splice(dragIndex.value, 1);
  all.splice(idx, 0, moved);
  globalStore.reorderModules(all.map(m => m.id));
  dragIndex.value = null;
  dragOverIndex.value = null;
};

const onDragEnd = () => {
  dragIndex.value = null;
  dragOverIndex.value = null;
};

function onDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest('.choice-export-wrap')) {
    showExportMenu.value = false;
    showAddMenu.value = false;
  }
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick);
});
onUnmounted(() => {
  document.removeEventListener('click', onDocumentClick);
});
</script>

<style scoped>
.choice-prompt-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

/* 预设条目覆盖层：紧凑行列表，窄屏可换行 */
.choice-preset-entry-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  max-height: 320px;
  overflow-y: auto;
}

/* 预设配套脚本可见化：单行附件式提示，机制口径进 hover（不上主文案） */
.choice-preset-companion {
  display: flex;
  align-items: baseline;
  gap: var(--choice-space-1);
  flex-wrap: wrap;
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  line-height: var(--choice-line-height);
  cursor: help;
}

.choice-preset-entry {
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm, 6px);
  padding: var(--choice-space-1) var(--choice-space-2);
}

.choice-preset-entry--disabled {
  opacity: 0.55;
}

.choice-preset-entry-row {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  flex-wrap: wrap;
  min-width: 0;
}

.choice-preset-entry-idx {
  min-width: 1.6em;
  text-align: right;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-xs);
}

.choice-preset-entry-role {
  font-size: var(--choice-text-xs);
  padding: 0 0.4em;
  border-radius: 4px;
  background: var(--choice-bg-element);
  color: var(--choice-text-muted);
}

.choice-preset-entry-role--user {
  color: var(--choice-color-info, #4a90d9);
}

.choice-preset-entry-role--assistant {
  color: var(--choice-color-warning, #d98a2b);
}

.choice-preset-entry-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--choice-text-sm);
}

.choice-preset-entry-badge {
  font-size: var(--choice-text-xs);
  padding: 0 0.4em;
  border-radius: 4px;
  background: var(--choice-bg-element);
  color: var(--choice-text-muted);
  white-space: nowrap;
}

.choice-preset-entry-badge--on {
  color: var(--choice-color-success, #3d9970);
}

.choice-preset-entry-badge--off {
  color: var(--choice-color-danger, #d94a4a);
}

.choice-preset-entry-actions {
  display: flex;
  gap: var(--choice-space-1);
}

.choice-preset-entry-editor {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  margin-top: var(--choice-space-1);
}

.choice-preset-entry-editor .choice-textarea {
  width: 100%;
  resize: vertical;
}

.choice-page-toolbar {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-module-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--choice-space-2);
  flex-wrap: wrap;
}

.choice-module-toolbar-left,
.choice-module-toolbar-right {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-context-rounds {
  display: flex;
  align-items: center;
  gap: var(--choice-space-1);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-module-list {
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-1);
  min-height: 40px;
}

.choice-module-card {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
  /* 纵向略紧于横向：模块多时列表纵向密度优先（52→约 48px/张） */
  padding: 6px var(--choice-space-2);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  cursor: default;
  transition:
    border-color var(--choice-transition),
    box-shadow var(--choice-transition),
    transform var(--choice-transition);
  user-select: none;
}

.choice-module-card:hover {
  border-color: var(--choice-border-strong);
}

.choice-module-card-marker {
  border-style: dashed;
  background: rgba(128, 128, 128, 0.03);
}

.choice-module-card-dragging {
  opacity: 0.4;
  box-shadow: var(--choice-shadow-lg);
  transform: scale(1.02);
}

.choice-module-card-drag-over {
  border-top: 2px solid var(--choice-primary);
  box-shadow: inset 0 2px 8px var(--choice-primary-glow);
}

.choice-module-drag {
  cursor: grab;
  color: var(--choice-text-muted);
  font-size: var(--choice-text-base);
  padding: 0 2px;
  flex-shrink: 0;
}

.choice-module-drag:active {
  cursor: grabbing;
}

.choice-module-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.choice-module-header {
  display: flex;
  align-items: center;
  gap: var(--choice-space-2);
}

.choice-module-name {
  font-size: var(--choice-text-sm);
  font-weight: 600;
  color: var(--choice-text-secondary);
  cursor: text;
  white-space: nowrap;
}

.choice-module-role {
  font-size: var(--choice-text-xs);
  padding: 2px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  font-weight: 500;
  text-transform: uppercase;
  flex-shrink: 0;
}

.choice-role-system {
  background: var(--choice-primary-light);
  color: var(--choice-color-info);
}

.choice-role-user {
  background: rgba(100, 180, 100, 0.2);
  color: var(--choice-color-success);
}

.choice-role-assistant {
  background: rgba(180, 140, 80, 0.2);
  color: var(--choice-color-warning);
}

.choice-module-lock {
  font-size: var(--choice-text-xs);
  flex-shrink: 0;
}

.choice-module-preview {
  font-size: var(--choice-text-xs);
  color: var(--choice-text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.choice-module-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.choice-module-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--choice-text-sm);
}

/* 小号重命名输入框：仅覆盖宽度，底色/边框/聚焦态由 global.css 的 .choice-input 提供 */
.choice-rename-input {
  width: 120px;
}

.choice-module-edit {
  margin-top: var(--choice-space-1);
  padding: var(--choice-space-2);
  border: 1px solid var(--choice-border-strong);
  border-radius: var(--choice-radius-sm);
  background: var(--choice-bg-card);
  display: flex;
  flex-direction: column;
  gap: var(--choice-space-2);
}

.choice-module-edit-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: var(--choice-text-sm);
  color: var(--choice-text-secondary);
}

.choice-enrich-badge-sm {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: var(--choice-primary-light);
  color: var(--choice-primary);
  font-weight: 500;
  flex-shrink: 0;
}

.choice-option-badge-sm {
  font-size: var(--choice-text-xs);
  padding: 1px var(--choice-space-2);
  border-radius: var(--choice-radius-full);
  background: var(--choice-color-warning-bg);
  color: var(--choice-color-warning);
  font-weight: 500;
  flex-shrink: 0;
}

.choice-mode-switch {
  display: flex;
  gap: 0;
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  overflow: hidden;
}

.choice-mode-btn {
  padding: var(--choice-space-1) var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text-muted);
  background: transparent;
  border: none;
  cursor: pointer;
  transition:
    background var(--choice-transition),
    color var(--choice-transition);
}

.choice-mode-btn:not(:last-child) {
  border-right: 1px solid var(--choice-border);
}

.choice-mode-btn:hover {
  background: var(--choice-bg-hover);
  color: var(--choice-text-secondary);
}

.choice-mode-btn--active {
  background: var(--choice-primary);
  color: var(--choice-text-on-primary);
}

.choice-mode-btn--active:hover {
  background: var(--choice-primary-hover);
  color: var(--choice-text-on-primary);
}

.choice-export-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.choice-export-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--choice-space-1);
}

/* 箭头是按钮内部装饰而非独立按键，随菜单开合旋转 */
.choice-export-caret {
  font-size: var(--choice-text-xs);
  transition: transform var(--choice-transition);
}

.choice-export-caret--open {
  transform: rotate(180deg);
}

.choice-export-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: var(--choice-z-dropdown);
  min-width: 140px;
  margin-top: 2px;
  background: var(--choice-bg-panel);
  border: 1px solid var(--choice-border);
  border-radius: var(--choice-radius-sm);
  box-shadow: var(--choice-shadow-md);
  overflow: hidden;
}

.choice-export-dropdown button {
  display: block;
  width: 100%;
  padding: var(--choice-space-2) var(--choice-space-3);
  font-size: var(--choice-text-sm);
  color: var(--choice-text);
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
  transition: background var(--choice-transition);
}

.choice-export-dropdown button:hover {
  background: var(--choice-bg-hover);
}
</style>
