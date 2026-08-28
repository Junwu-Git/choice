export type TabId = 'pool' | 'generation' | 'prompt' | 'api' | 'worldinfo' | 'filter' | 'appearance' | 'debug';

export interface TabDefinition {
  id: TabId;
  label: string;
  icon: string;
}

export interface GuideContent {
  icon: string;
  title: string;
  html: string;
}

export const INLINE_TABS: TabDefinition[] = [
  { id: 'pool', label: '条目池', icon: 'fa-solid fa-layer-group' },
  { id: 'generation', label: '生成', icon: 'fa-solid fa-bolt' },
  { id: 'prompt', label: '提示词', icon: 'fa-solid fa-align-left' },
  { id: 'api', label: 'API', icon: 'fa-solid fa-plug' },
  { id: 'worldinfo', label: '世界书', icon: 'fa-solid fa-book' },
  { id: 'filter', label: '过滤', icon: 'fa-solid fa-filter' },
  { id: 'appearance', label: '外观', icon: 'fa-solid fa-palette' },
  { id: 'debug', label: '调试', icon: 'fa-solid fa-gear' },
];

export const FLOATING_TABS: TabDefinition[] = [
  { id: 'pool', label: '条目池', icon: 'fa-solid fa-layer-group' },
  { id: 'generation', label: '生成', icon: 'fa-solid fa-bolt' },
  { id: 'prompt', label: '提示词', icon: 'fa-solid fa-align-left' },
  { id: 'api', label: 'API', icon: 'fa-solid fa-plug' },
  { id: 'worldinfo', label: '世界书', icon: 'fa-solid fa-book' },
  { id: 'filter', label: '过滤', icon: 'fa-solid fa-filter' },
  { id: 'appearance', label: '外观', icon: 'fa-solid fa-palette' },
  { id: 'debug', label: '调试', icon: 'fa-solid fa-gear' },
];

export const GUIDE_CONTENTS: Record<TabId, GuideContent> = {
  pool: {
    icon: 'fa-solid fa-layer-group',
    title: '条目池怎么用',
    html: `<p><strong>核心概念</strong>：条目池 = 条目库（存所有条目） + 配置（从条目库勾选哪些条目参与生成）。</p>
<p><strong>配置</strong> 是一组条目的"快照"，可以绑定到角色或聊天。生成选项时，AI 从当前生效的配置中抽取条目作为素材。</p>
<p><strong>绑定优先级</strong>：聊天绑定 > 角色绑定 > 默认配置。高优先级的配置有绑定则使用它，否则逐级回退。</p>
<p><strong>操作流程</strong>：新建配置 → 添加条目 → 绑定到聊天/角色 → 生成选项时自动生效。</p>
<hr style="border-color:var(--choice-border);margin:8px 0">
<p style="color:var(--choice-primary);font-weight:bold">🚀 新手快速入门</p>
<ol style="margin:0;padding-left:18px;line-height:1.8">
<li><strong>打开条目库</strong>：点击下方"条目库"按钮，手动添加或 AI 生成一批行动选项条目</li>
<li><strong>新建配置</strong>：点击"新建"按钮，起个名字（如"战斗场景"、"日常对话"）</li>
<li><strong>勾选条目</strong>：在配置中点击"添加条目"，从条目库勾选你需要的条目</li>
<li><strong>绑定配置</strong>：点击 💬 绑定聊天或 👤 绑定角色，下次生成时自动生效</li>
</ol>
<p style="margin-top:8px;color:var(--choice-primary);font-size:11px">💡 小贴士：如果只在配置中选了 5 条战斗相关的条目，AI 就会从这 5 条中抽取生成选项，不会出现无关内容。</p>`,
  },
  generation: {
    icon: 'fa-solid fa-bolt',
    title: '生成行为',
    html: `<p><strong>自动生成</strong>：开启后，每次 AI 回复完成时自动触发选项生成，无需手动点击"生成"按钮。此设置为聊天级，仅对当前对话生效。</p>
<p><strong>行为模式</strong>：控制点击选项后的动作——发送（直接发送消息）、覆盖（填入输入框替换现有内容）、尾附（追加到输入框末尾）。</p>
<p><strong>提示</strong>：在选项面板的头部，也可以直接切换发送/覆盖/尾附模式，两处设置保持同步。</p>`,
  },
  prompt: {
    icon: 'fa-solid fa-align-left',
    title: '提示词编辑器',
    html: `<p><strong>模块化设计</strong>：提示词由多个模块组成，每个模块对应一个角色（system=系统指令、user=用户输入、assistant=AI 预设回复）。模块可拖拽排序、双击重命名、复制、编辑。</p>
<p><strong>上下文轮数</strong>：控制发送给 AI 的历史消息数量。"轮数模式"取最后 N 轮，"仅可见消息"排除隐藏消息。</p>
<p><strong>聊天记录过滤</strong>：在发送前自动移除思维链、小剧场标签等冗余内容，提升生成质量。支持标签匹配和正则表达式两种规则。</p>
<p><strong>新手快捷编辑</strong>：顶部的"叙述风格"和"选项规则"是 core_rules（规则）模块的快捷入口，无需打开模块编辑即可快速调整核心约束。</p>
<p><strong>不可编辑模块</strong>（🔒标记）是系统自动管理的，如世界书条目、角色描述等，无法修改或删除。</p>`,
  },
  api: {
    icon: 'fa-solid fa-plug',
    title: 'API 配置',
    html: `<p><strong>用途</strong>：配置生成行动选项所用的 AI 接口。支持多个 API 配置，通过下拉框切换。</p>
<p><strong>字段说明</strong>：API 地址填 OpenAI 兼容接口（如 <code>https://api.openai.com/v1/chat/completions</code>），密钥为 API Key，模型名称需与接口支持的模型名一致。</p>
<p><strong>拉取模型</strong>：填写 API 地址后点击"拉取"按钮，自动从接口获取可用模型列表，点击即可选中。</p>
<p style="color:#e07070"><strong>⚠️ 修改后必须点击保存按钮才会持久化</strong>，切换页面或关闭窗口不会自动保存。</p>`,
  },
  worldinfo: {
    icon: 'fa-solid fa-book',
    title: '世界书',
    html: `<p><strong>用途</strong>：控制世界书（World Info）条目是否注入到选项生成提示词中。启用后，AI 生成选项时能感知世界观设定。</p>
<p><strong>默认行为</strong>：自动包含角色世界书和全局世界书。取消勾选某本书，该书的所有条目都不参与生成；展开某本书后，可以单独排除特定条目。</p>
<p><strong>条目状态</strong>：🔵 蓝灯 = 常驻条目（始终注入），🟢 绿灯 = 关键词触发（匹配时注入），灰色/禁用 = 跳过。禁用条目会自动排除，无需手动操作。</p>
<p><strong>操作</strong>：点击书名可展开查看条目列表，取消勾选可排除书或条目。通过"刷新列表"可同步最新世界书变更。</p>`,
  },
  filter: {
    icon: 'fa-solid fa-filter',
    title: '聊天记录过滤',
    html: `<p><strong>三大区域</strong>：全局正则区（始终生效）、预设正则区（随ST预设切换）、角色卡正则区（随角色卡切换）。</p>
<p><strong>正则库</strong>：类似条目库，存放可复用的正则表达式。支持标签匹配和正则匹配两种类型。</p>
<p><strong>操作流程</strong>：在对应区域创建分组 → 点击「从正则库添加」选择正则 → 或直接添加内联规则 → 启用分组即可。</p>
<p><strong>调暗效果</strong>：预设区和角色卡区中，不属于当前预设/角色的分组会以半透明显示，不会对当前聊天生效。</p>`,
  },
  appearance: {
    icon: 'fa-solid fa-palette',
    title: '外观',
    html: `<p><strong>悬浮窗</strong>：在屏幕右下角显示一个快捷按钮，点击打开设置面板，拖动可改变位置。关闭后从设置面板入口进入。</p>
<p><strong>输入润色</strong>：在发送消息前，用 AI 将你的输入改写成多个润色版本供选择。右侧数字控制生成几个版本。</p>
<p><strong>主题</strong>：暗色/亮色切换，影响设置面板、选项面板等所有扩展 UI。</p>
<p><strong>透明度</strong>：调整面板背景透明度，数值越低越透明。</p>
<p><strong>字体大小</strong>：小/中/大三档，影响选项按钮和面板内的文字大小。</p>`,
  },
  debug: {
    icon: 'fa-solid fa-gear',
    title: '调试与维护',
    html: `<p><strong>版本信息</strong>：显示当前数据版本和模块、条目等统计信息。</p>
<p><strong>恢复出厂设置</strong>：删除所有设置并恢复为插件初始状态。⚠️ 此操作不可撤销，执行前请导出提示词备份。</p>`,
  },
};
