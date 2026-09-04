/**
 * 引导内容单一来源：章节化向导步骤 + 各功能页/弹窗的 ❓ 页内指引。
 *
 * 此前步骤文案、tab 指引（tab-definitions 的 GUIDE_CONTENTS）与弹窗内嵌
 * guideHtml 三处平行维护，已经出现说法漂移（外观页新旧两版主题描述并存、
 * 「自动生成仅对当前聊天生效」这类与实现相反的描述）。归并到本模块后，
 * 向导章节与页内指引共用同一份数据——改文案只改这里，不会再漂。
 *
 * 结构上只依赖 onboarding.ts 的 OnboardingStep 类型（type-only import，
 * 不构成运行时循环）；onboarding.ts 反向 import 本模块的章节数据。
 */

import type { OnboardingStep } from '@/core/onboarding';
import { resolveCustomApi, lastOptionsGeneratedAt } from '@/core/generator';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { pinia } from '@/pinia';

/** 功能课堂章节：原 22 步全流程向导按功能域拆分归档，quick-start 是唯一默认路径 */
export interface GuideChapter {
  id: 'quick-start' | 'pool' | 'generation' | 'prompt' | 'worldinfo' | 'filter' | 'appearance';
  icon: string;
  title: string;
  /** 章节菜单里的一行简介 */
  brief: string;
  steps: OnboardingStep[];
}

const isApiReady = (): boolean => {
  const gs = useGlobalSettingsStore(pinia);
  return !!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
};

export const GUIDE_CHAPTERS: GuideChapter[] = [
  {
    id: 'quick-start',
    icon: 'fa-solid fa-rocket',
    title: '快速上手',
    brief: '配置 API 并生成第一组选项，三分钟跑通核心链路',
    steps: [
      {
        id: 'welcome',
        icon: 'fa-solid fa-chess',
        title: '欢迎使用行动选项',
        html: `<p><strong>行动选项</strong>会在主线对话之外，单独调用一次 API，根据当前剧情异步生成一组行动选项；点选其中一条，按所选方式进入输入框（直接发送 / 覆盖输入框 / 尾附在末尾 / 插到光标处），不占用楼层、不打断对话节奏。</p>
<p>上手只需三步：<strong>配置 API → 生成选项 → 点选发送</strong>。条目池等其余功能均开箱即用，之后可从 tab 栏的 <i class="fa-solid fa-graduation-cap"></i> 功能课堂按需深入。跟着做即可，随时可以退出。</p>`,
        target: '[data-tour="settings-header"]',
      },
      {
        id: 'api-fill',
        icon: 'fa-solid fa-plug',
        title: '第一步：配置 API（填写）',
        html: `<p>生成选项使用<strong>独立的 API 配置</strong>，与酒馆主对话的 API 互不影响。<strong>框住的就是需要填写的区域</strong>：</p>
<p>依次填<strong>配置名称</strong>（随便起，用于区分多套配置）、<strong>API 地址</strong>（OpenAI 兼容接口）、<strong>密钥</strong>、<strong>模型名称</strong>。填好地址后点右侧「拉取」可自动获取可用模型列表，点击即选中；温度 / Token 等保持默认即可。</p>`,
        tab: 'api',
        target: '[data-tour="api-form"]',
      },
      {
        id: 'api-save',
        icon: 'fa-solid fa-floppy-disk',
        title: '第一步：配置 API（保存）',
        html: `<p>信息填完后，点<strong>这个「保存」按钮</strong>。⚠️ 不点保存不会生效，切换页面也不会自动保存。</p>
<p>保存成功后这里会亮起 ✓，并自动进入下一步。</p>`,
        target: '[data-tour="api-save"]',
        done: isApiReady,
      },
      {
        id: 'pool-ready',
        icon: 'fa-solid fa-layer-group',
        title: '第二步：确认条目就绪',
        html: `<p>生成的素材来自<strong>条目池</strong>（条目库 + 抽取配置）。全新安装已内置一组示例条目和默认配置，<strong>开箱即用，无需任何操作</strong>。</p>
<p>想自定义条目（手动编写或 AI 批量生成）时，随时从功能课堂的「条目池」章节学习，这里不展开。</p>`,
        tab: 'pool',
        target: '[data-tour="pool-library"]',
      },
      {
        id: 'run-generate',
        icon: 'fa-solid fa-wand-magic-sparkles',
        title: '最后一步：生成你的第一组选项',
        html: `<p>配置完成！点面板右上角 <strong>×</strong> 关闭设置。生成入口在<strong>聊天流内的选项面板</strong>上：点面板头部的「生成」按钮，或者什么都不做——AI 每次回复完成后会<strong>自动生成</strong>一组选项（默认开启）。</p>
<p>注意：选项面板只出现在与 AI 的对话中，当前聊天里还没有 AI 回复时先发一条消息。生成成功后会自动进入最后一步。</p>`,
        done: () => lastOptionsGeneratedAt.value > 0,
      },
      {
        id: 'done',
        icon: 'fa-solid fa-flag-checkered',
        title: '完成！',
        html: `<p>核心链路到此打通：API 已就绪，你已经能收到（或马上会收到）第一组行动选项了。</p>
<p>想深入了解某个功能：tab 栏的 <i class="fa-solid fa-circle-question"></i> 查看当前页要点；<i class="fa-solid fa-graduation-cap"></i> 打开功能课堂，按章节学习条目池、提示词、世界书等进阶玩法。</p>
<p><strong>祝游玩愉快！</strong></p>`,
      },
    ],
  },
  {
    id: 'pool',
    icon: 'fa-solid fa-layer-group',
    title: '条目池',
    brief: '条目库与配置的两层结构、往配置里勾选条目',
    steps: [
      {
        id: 'pool-concept',
        icon: 'fa-solid fa-layer-group',
        title: '条目池：两层结构',
        html: `<p>条目池分两层：<strong>条目库</strong>存放所有条目——每条 = 一个行动方向的写作指引；<strong>配置</strong>决定本次生成从哪些条目里抽取，并可绑定到角色或聊天（优先级：聊天 &gt; 角色 &gt; 默认配置）。</p>
<p>全新安装已内置一组示例条目和默认配置，<strong>开箱即用</strong>。下面带你逛一圈条目库。</p>`,
        tab: 'pool',
        target: '[data-tour="pool-library"]',
      },
      {
        id: 'pool-open',
        icon: 'fa-solid fa-database',
        title: '条目库布局与功能',
        html: `<p>我已经帮你打开了条目库。<strong>顶部一排按钮</strong>：全部展开、新建分组、导入 / 导出文件，以及<strong>魔杖「AI 生成」</strong>——按当前角色批量生成一批条目，是扩充条目库的主力。</p>
<p><strong>下方按分组存放条目</strong>：分组头可重命名、加条目、整组复制 / 删除；点条目展开可编辑<strong>类型、内容、规则</strong>，勾选框用于批量选中。</p>
<p>看完点右上角 × 关闭，回到条目池页。</p>`,
        action: 'pool-library',
        target: '[data-tour="entrypool-toolbar"]',
      },
      {
        id: 'pool-add',
        icon: 'fa-solid fa-list-check',
        title: '往配置里加条目',
        html: `<p>条目库是仓库，<strong>配置</strong>才决定"这次生成用哪些"。现在<strong>点这个「添加条目」按钮</strong>——它会弹出选择条目界面，下一步我会聚焦给你看。</p>
<p>想移出某条：在配置的已选列表里点条目右侧的 <i class="fa-solid fa-xmark"></i>；想整批调整，重新打开这个按钮取消勾选即可。</p>`,
        target: '[data-tour="pool-add"]',
        action: 'close-all',
      },
      {
        id: 'pool-select',
        icon: 'fa-solid fa-square-check',
        title: '勾选条目并确认',
        html: `<p>这就是<strong>「选择条目」</strong>界面：点分组名展开，勾选要参与生成的条目（分组头的复选框可整组全选），点底部<strong>「确认」</strong>写入当前配置。</p>
<p>底部实时显示已选数量；确认后回到条目池页就能看到它们。之后想增减，随时点「添加条目」回来改。</p>`,
        action: 'pool-select-entries',
        target: '[data-tour="select-entries-list"]',
      },
    ],
  },
  {
    id: 'generation',
    icon: 'fa-solid fa-bolt',
    title: '生成与点击行为',
    brief: '自动生成、点击行为三模式、数量与字数',
    steps: [
      {
        id: 'gen-auto',
        icon: 'fa-solid fa-bolt',
        title: '自动生成与输入润色',
        html: `<p><strong>「自动生成」开关</strong>是全局设置：打开后每次 AI 回复完成都会自动出一组选项，不用手动点。</p>
<p><strong>「启用输入润色」开关</strong>：发送你的消息前，AI 先把你的输入改写成多个润色版本供挑选，选中的才真正发出。</p>
<p>两个都建议保持开启。</p>`,
        tab: 'generation',
        target: '[data-tour="gen-auto"]',
      },
      {
        id: 'gen-behavior',
        icon: 'fa-solid fa-paper-plane',
        title: '点击行为',
        html: `<p><strong>点击行为</strong>决定你点一条选项后发生什么：</p>
<p><strong>发送</strong>——直接把这条选项作为消息发出；<strong>覆盖</strong>——填入输入框并替换已有内容，你可以先改再发；<strong>尾附</strong>——追加到输入框末尾，保留你自己写的内容；<strong>插入</strong>——插到输入框光标所在位置，保留光标前后的文字。</p>
<p>这里的设置与选项面板头部的切换按钮保持同步，聊天中随时可改。</p>`,
        target: '[data-tour="gen-behavior"]',
      },
      {
        id: 'gen-count',
        icon: 'fa-solid fa-sliders',
        title: '数量、字数与人称',
        html: `<p><strong>生成数量</strong>：填数字 = 每次固定条数，填区间 = 每次随机（如 <code>3-6</code>）；<strong>润色版本数</strong>同理。</p>
<p>往下还有<strong>每条字数</strong>（选项 / 润色的字数区间，中文字符）和<strong>人称视角</strong>（默认第三人称，可改成第一人称 / 第二人称）。</p>
<p>这些都有默认值，按喜好微调即可。</p>`,
        target: '[data-tour="gen-count"]',
      },
    ],
  },
  {
    id: 'prompt',
    icon: 'fa-solid fa-align-left',
    title: '提示词',
    brief: '模块化提示词的排序、启停与编辑',
    steps: [
      {
        id: 'prompt-intro',
        icon: 'fa-solid fa-align-left',
        title: '提示词：生成指令怎么组装',
        html: `<p>选项内容由这里的<strong>提示词模块</strong>驱动：<strong>顶部工具栏</strong>可切换上下文轮数模式、开关预填充；下方是模块列表，可拖拽排序、编辑内容。</p>
<p>默认配置开箱即用，新手无需改动；想调整时点 <i class="fa-solid fa-circle-question"></i> 查看本页说明。</p>`,
        tab: 'prompt',
        target: '[data-tour="prompt-toolbar"]',
      },
    ],
  },
  {
    id: 'worldinfo',
    icon: 'fa-solid fa-book',
    title: '世界书',
    brief: '注入开关、全局排除与逐书三态选择',
    steps: [
      {
        id: 'wi-enable',
        icon: 'fa-solid fa-book',
        title: '世界书：启用开关',
        html: `<p><strong>「启用世界书」</strong>是总开关：开着，生成选项时就会注入当前角色 / 聊天挂载的世界书设定，选项更贴合世界观。</p>
<p>「刷新列表」按钮用于同步酒馆侧的世界书变更（新建 / 删除书之后点一下）。</p>
<p>下面两步分别讲<strong>如何排除世界书</strong>和<strong>如何选择世界书</strong>。</p>`,
        tab: 'worldinfo',
        target: '[data-tour="wi-checks"]',
      },
      {
        id: 'wi-exclude',
        icon: 'fa-solid fa-ban',
        title: '世界书：如何排除',
        html: `<p>不想让某本书影响生成的选项？用<strong>「全局排除」</strong>：点标题展开，在搜索框输入书名，点右侧<strong>「添加」</strong>——被排除的书在<strong>所有聊天中</strong>永久不被选项生成参考。</p>
<p>反悔了就点书名右侧的<strong>「移除」</strong>撤销排除。</p>`,
        target: '[data-tour="wi-excl"]',
      },
      {
        id: 'wi-books',
        icon: 'fa-solid fa-list',
        title: '世界书：如何选择',
        html: `<p><strong>已启用的世界书</strong>列表里，每本书左侧是灯色（🔵 常驻条目 / 🟢 关键词触发），右侧徽章标明来源（全局 / 角色）。</p>
<p>书名右侧的<strong>三态框</strong>点击循环：<strong>关</strong>（本书完全不参与）→ <strong>跟随</strong>（按酒馆的条目启用状态）→ <strong>强制</strong>（本书全部条目参与）→ <strong>自定义</strong>（展开后逐条勾选）。展开书名还能看到每个条目的状态并单独勾选。</p>
<p>「未启用的世界书」区里的书点<strong>「启用」</strong>即可加入。若当前没有启用的世界书，本步无可聚焦的列表，先了解即可。</p>`,
        target: '[data-tour="wi-books"]',
      },
    ],
  },
  {
    id: 'filter',
    icon: 'fa-solid fa-filter',
    title: '过滤',
    brief: '标签提取一键提取标签内容；三个分区与正则库进阶清洗',
    steps: [
      {
        id: 'filter-zones',
        icon: 'fa-solid fa-filter',
        title: '过滤：标签提取与三个分区',
        html: `<p><strong>过滤是干什么的</strong>：发送生成请求前，插件先按你定的规则清洗聊天记录——删掉思维链、小剧场等不该让"出选项的 AI"看到的内容。</p>
<p><strong>新手推荐「标签提取」</strong>：在过滤页顶部<strong>只填标签名</strong>，插件自动按 <code>&lt;名字&gt;…&lt;/名字&gt;</code> 配对。例如卡里的剧情包在 <code>&lt;正文&gt;…&lt;/正文&gt;</code> 里，就填「正文」——发送时<strong>只保留 AI 输出里 &lt;正文&gt;…&lt;/正文&gt; 段落（含标签本身）</strong>，其余 AI 输出丢弃；用户输入原样保留。提取规则独立存放、独立启停，<strong>不会混入下方任何正则分区</strong>。</p>
<p>进阶规则按三个分区管理：<strong>① 全局正则区</strong>（始终生效）&emsp;<strong>② 预设正则区</strong>（随酒馆预设切换）&emsp;<strong>③ 角色卡正则区</strong>（随角色卡切换）；不属于当前预设 / 角色的分组会<strong>半透明显示</strong>且不生效。执行顺序恒定：<strong>先提取、后过滤</strong>——标签匹配 / 正则在提取结果上继续删除不要的部分，二者配合不打架。</p>`,
        tab: 'filter',
        target: '[data-tour="filter-extract-quick"]',
        action: 'close-all',
      },
      {
        id: 'filter-library-open',
        icon: 'fa-solid fa-code',
        title: '过滤：正则库与规则长什么样',
        html: `<p>我已帮你打开正则库——所有过滤规则集中存放在这里，按分组整理。<strong>顶部一排按钮</strong>：全部展开、新建分组、导入 / 导出文件，以及<strong>云下载「从酒馆导入」</strong>（下一步细讲）。</p>
<p>分组头的 <i class="fa-solid fa-plus"></i> 新增一条规则。一条规则 = <strong>匹配模式</strong>（正则表达式或标签名）+ <strong>替换文本</strong>（留空 = 命中即整段删除，填了 = 替换成该文本）。</p>`,
        action: 'filter-library',
        target: '[data-tour="regexlib-toolbar"]',
      },
      {
        id: 'filter-st-import',
        icon: 'fa-solid fa-cloud-arrow-down',
        title: '过滤：从酒馆导入正则',
        html: `<p>点<strong>这个云下载按钮</strong>：可以从酒馆的<strong>全局正则 / 当前预设 / 当前角色卡</strong>三个区域勾选已有正则，批量导入到插件正则库，导入时选择存放的分组。</p>
<p>你没有要导入的内容也没关系，直接点「下一步」。</p>`,
        target: '[data-tour="regexlib-st-import"]',
      },
      {
        id: 'filter-reference',
        icon: 'fa-solid fa-book-open',
        title: '过滤：在分区中引用',
        html: `<p>库里的正则不会直接生效，要<strong>被分区中的分组引用</strong>才参与过滤：</p>
<p>① 点分区右侧<strong>「新增分组」</strong>；② 点分组上的<strong>「从正则库添加」</strong>（下面聚焦的是第一个分组的该按钮）；③ 勾选要用的正则并确认，保持分组勾选启用即可。</p>
<p>也可以点分组上的 <i class="fa-solid fa-plus"></i> 跳过正则库直接写内联规则。没有分组时先建一个，我再聚焦给你看。</p>`,
        action: 'close-all',
        target: '[data-tour="filter-group-addlib"]',
      },
    ],
  },
  {
    id: 'appearance',
    icon: 'fa-solid fa-palette',
    title: '外观',
    brief: '悬浮球、面板停靠位置、主题与字体',
    steps: [
      {
        id: 'appearance-panel',
        icon: 'fa-solid fa-window-maximize',
        title: '外观：面板与悬浮球',
        html: `<p><strong>「悬浮窗」开关</strong>控制屏幕右下角的悬浮球——它是打开设置的快捷入口，建议保持开启（关闭后只能从扩展菜单进入设置）。</p>
<p>下方是<strong>选项面板停靠位置</strong>：<strong>聊天内</strong>（跟随最新楼层下方，随聊天滚动）或<strong>输入框上方</strong>（固定不滚，选项再多也不占满屏）。</p>`,
        tab: 'appearance',
        target: '[data-tour="appearance-floating"]',
      },
      {
        id: 'appearance-theme',
        icon: 'fa-solid fa-palette',
        title: '外观：主题与字体',
        html: `<p><strong>主题</strong>五种模式：<strong>自动</strong>（检测酒馆亮暗）、<strong>跟随</strong>（完全用酒馆配色）、强制<strong>暗色 / 亮色</strong>，以及<strong>独立预设主题</strong>（黄昏 / 樱花 / 青瓷 / 蜜糖，与插件面板头部的循环切换按钮互通）。</p>
<p><strong>字体大小</strong>默认跟随设备（手机小号、桌面中号），点具体档位即固定；想改回去点「自动」。</p>
<p>另外：<strong>输入润色</strong>的开关与版本数在「生成」页，发送消息前可用 AI 把你的输入改写成多个润色版本。</p>`,
        target: '[data-tour="appearance-theme"]',
      },
    ],
  },
];

/** ❓ 页内指引：一句话说明 + 要点列表，替代此前的 HTML 长文（结构化渲染，无 v-html） */
export interface PageHint {
  icon: string;
  title: string;
  /** 一句话说明本页是干什么的 */
  brief: string;
  /** 要点列表 */
  points: string[];
}

export const PAGE_HINTS: Record<string, PageHint> = {
  pool: {
    icon: 'fa-solid fa-layer-group',
    title: '条目池',
    brief: '条目池 = 条目库（存所有条目）+ 配置（决定本次生成从哪些条目抽取）。',
    points: [
      '配置从条目库中勾选条目，生成时 AI 从当前生效的配置里抽取条目作为写作素材。',
      '配置可绑定到聊天或角色，优先级：聊天绑定 > 角色绑定 > 默认配置，命中即用、不合并。',
      '操作流程：新建配置 → 「添加条目」勾选 → 绑定聊天/角色，下次生成自动生效。',
      '全新安装已内置一组示例条目与默认配置，开箱即用；条目库的魔杖按钮可让 AI 批量生成条目。',
    ],
  },
  generation: {
    icon: 'fa-solid fa-bolt',
    title: '生成',
    brief: '控制选项怎么生成、点选一条之后发生什么。',
    points: [
      '自动生成（全局设置，对所有聊天生效）：每次 AI 回复完成后自动出一组选项，无需手动点。',
      '输入润色：发送前把你的输入改写成多个润色版本供挑选，选中的才真正发出。',
      '点击行为：发送 = 直接发出；覆盖 = 替换输入框内容（可先改再发）；尾附 = 追加到输入框末尾；插入 = 插到光标处（保留已有内容）。',
      '点击行为与选项面板头部的切换按钮保持同步，聊天中随时可改。',
      '数量支持固定值或区间（如 3-6 = 每次随机）；往下还有每条字数与人称视角。',
    ],
  },
  prompt: {
    icon: 'fa-solid fa-align-left',
    title: '提示词',
    brief: '选项内容由模块化提示词驱动，默认配置开箱即用。',
    points: [
      '模块按角色分段：system = 系统指令，user = 素材与上下文，assistant = 预填充起手式；可拖拽排序、启停、编辑。',
      '上下文轮数决定带多少历史消息给生成选项的 AI。',
      '顶部「叙述风格」「选项规则」是核心规则模块的快捷编辑入口，无需打开模块编辑器。',
      '🔒 标记的不可编辑模块由系统自动管理（世界书条目、角色描述等注入项）。',
    ],
  },
  api: {
    icon: 'fa-solid fa-plug',
    title: 'API',
    brief: '配置生成选项所用的独立 AI 接口，与酒馆主对话的 API 互不影响。',
    points: [
      '必填四项：配置名称、API 地址（OpenAI 兼容接口）、密钥、模型名称。',
      '填完地址点「拉取」可自动获取可用模型列表，点击即选中。',
      '⚠️ 修改后必须点「保存」才会生效，切换页面或关闭窗口不会自动保存。',
      '未配置 API 时无法生成选项（悬浮球会变暗提示）。',
    ],
  },
  worldinfo: {
    icon: 'fa-solid fa-book',
    title: '世界书',
    brief: '控制哪些世界书条目注入选项生成的提示词，让选项贴合世界观。',
    points: [
      '「启用世界书」是总开关，关闭则完全不注入。',
      '每本书三态循环：关（完全不参与）→ 跟随（按酒馆条目启用状态）→ 强制（全部参与）；展开书名可进入自定义逐条勾选。',
      '「全局排除」的书在所有聊天中永久不被参考，可随时移除撤销。',
      '🔵 蓝灯 = 常驻条目（始终注入），🟢 绿灯 = 关键词触发（匹配时注入）。',
      '新建/删除世界书后点「刷新列表」同步酒馆侧变更。',
    ],
  },
  filter: {
    icon: 'fa-solid fa-filter',
    title: '过滤',
    brief: '生成前按规则清洗聊天记录。新手用顶部「标签提取」，进阶规则按三个分区管理。',
    points: [
      '「标签提取」（页顶）只填标签名：填「正文」即保留 <正文>…</正文> 段落发给 AI，其余丢弃；多条提取取并集。',
      '提取功能只在页顶快速区，独立存放、独立启停——三个正则分区与正则库只做「过滤」（删除/替换），不出现提取规则。',
      '执行顺序恒定：先提取、后过滤——分区规则在提取结果上继续删除不要的部分，二者配合不打架。',
      '三个分区：全局正则区（始终生效）、预设正则区（随酒馆预设切换）、角色卡正则区（随角色卡切换）。',
      '不属于当前预设/角色的分组会半透明显示且不生效，顶部状态栏显示当前实际生效的分组数。',
      '规则集中存放在正则库，需被分区中的分组引用后才生效；分组上也可直接添加内联规则（标签匹配/正则）。',
      '「从酒馆导入」可从酒馆的全局/预设/角色卡三区批量导入已有正则。',
    ],
  },
  appearance: {
    icon: 'fa-solid fa-palette',
    title: '外观',
    brief: '悬浮球开关、面板停靠位置、主题与字体大小。',
    points: [
      '「悬浮窗」开关控制屏幕右下角的悬浮球（打开设置的快捷入口）；关闭后只能从扩展菜单进设置。',
      '停靠位置：聊天内（跟随最新楼层、随聊天滚动）或输入框上方（固定不滚）。',
      '主题五种模式：自动（检测酒馆亮暗）、跟随酒馆配色、强制暗色/亮色，另有 4 个独立预设主题（黄昏/樱花/青瓷/蜜糖）。',
      '字体默认跟随设备（手机小号、桌面中号），点具体档位固定，点「自动」还原。',
    ],
  },
  debug: {
    icon: 'fa-solid fa-gear',
    title: '调试',
    brief: '版本与统计信息、恢复出厂设置。',
    points: [
      '显示当前数据版本和模块、条目等统计信息。',
      '恢复出厂会删除所有设置并回到插件初始状态，⚠️ 不可撤销，执行前请先导出提示词备份。',
    ],
  },
  status_settings: {
    icon: 'fa-solid fa-sliders',
    title: '状态设置',
    brief: '控制被动状态追踪的总开关、自动更新频率与注入正文方式。',
    points: [
      '总开关：关闭后状态栏消失、API 停止调用，已存楼层快照不受影响。',
      '自动更新：开启后每次 AI 回复自动调用 API 提取状态；关闭后仅保留手动编辑。',
      '注入正文：将当前状态以扩展提示词形式注入正文生成，让 AI 在写作时参考。',
      '注入深度：控制提示词插入聊天历史的深度（0=紧接末尾）。',
      '状态条数上限：AI 每次输出最多记录 N 条状态，超过截断。',
    ],
  },
  status_prompt: {
    icon: 'fa-solid fa-align-left',
    title: '状态提示词',
    brief: '状态更新的 AI 指令与规则模块，决定追踪器看什么、输出什么。',
    points: [
      '「状态规则」是只读系统模块：定义标签体系、推断边界、状态生命周期规则。',
      '「状态指令」是用户任务模块：给 AI 的具体操作指令，可自定义。',
      '状态链路走完整管线（世界书/角色卡/聊天历史），提示词模块在此切换。',
    ],
  },
};

/** 弹窗级 ❓ 指引（EntryPoolDialog / PoolGenDialog / RegexLibraryDialog 各自引用） */
export const DIALOG_HINTS: { entryPool: PageHint; poolGen: PageHint; regexLibrary: PageHint } = {
  entryPool: {
    icon: 'fa-solid fa-database',
    title: '条目库',
    brief: '所有行动选项条目的总仓库，按分组管理；配置中的条目都是从这里勾选引用的。',
    points: [
      '点分组名展开/折叠，分组名旁 + 加条目，📋 复制整组；空分组在关闭弹窗时自动清理。',
      '支持跨分组拖拽条目、拖拽 ☰ 调整顺序。',
      '勾选复选框后点「导出文件」只导出勾选的条目（不勾选则全量导出）。',
      '顶部魔杖按钮按当前角色让 AI 批量生成条目；修改条目库会同步影响所有引用该条目的配置。',
    ],
  },
  poolGen: {
    icon: 'fa-solid fa-wand-magic-sparkles',
    title: 'AI 生成条目',
    brief: '让 AI 根据你的要求自动生成一批条目（含类型标签与补充规则）。',
    points: [
      '条目种类：选项指导（写给生成选项的 AI 看的指导）/ 行动方向（简洁的具体行动）/ 由 AI 判断 / 自定义种类。',
      '参数：条目数控制数量；生成要求描述主题、字数、风格；目标分组决定存放位置；目标类型可统一四字标签。',
      '勾选「结合近期对话」会参考最近的聊天内容，生成更贴合当前剧情的条目。',
      '生成后勾选需要的条目点「注入」加入条目库，类型/内容/规则可在结果行直接改；未勾选的会被丢弃。',
    ],
  },
  regexLibrary: {
    icon: 'fa-solid fa-code',
    title: '正则库',
    brief: '所有过滤正则的集中存放处，按分组管理，供过滤分区引用。',
    points: [
      '点分组名展开/折叠，拖拽左侧把手排序分组或把条目拖入其他分组；分组名旁 + 添加规则。',
      '规则两种类型：标签匹配（剥掉标签对）、正则表达式（支持替换）；「提取」不在库/分区里，只在过滤页顶部。',
      '顶部工具栏：全部展开/收起、新建分组、文件导入/导出、「从酒馆导入」。',
      '「从酒馆导入」可从酒馆全局/预设/角色卡三区勾选已有正则批量导入。',
      '库里的正则不会直接生效，需在「过滤」页被分区中的分组引用后参与过滤。',
    ],
  },
};
