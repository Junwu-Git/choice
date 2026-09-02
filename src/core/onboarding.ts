import { ref } from 'vue';
import type { TabId } from '@/components/shared/tab-definitions';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { pinia } from '@/pinia';
import { resolveCustomApi, lastOptionsGeneratedAt } from '@/core/generator';

/** 向导弹窗可见性。向导是全局单实例（挂在 FloatingRoot），不挂在行内/悬浮面板内——
 *  行内面板常驻挂载而悬浮面板内容 v-if，若各挂一份实例，共享同一 ref 会让
 *  Teleport 到 body 的弹窗/遮罩渲染两份（遮罩叠深、DOM 翻倍） */
export const onboardingVisible = ref(false);

/** 向导「切换 tab」的待处理信号。向导是全局单实例，不知道当前面板的 activeTab，
 *  由打开中的面板 watch 消费后置回 null */
export const onboardingPendingTab = ref<TabId | null>(null);

/**
 * 向导「弹窗状态」信号。条目库、选择条目、正则库弹窗的开关状态分散在
 * PoolEditor / FilterEditor 的本地 ref 里，向导无法直接置位——按归属分发给
 * 持有状态的组件消费（见各组件的 watch）。
 *
 * 语义是"本步应有的完整弹窗状态"而非"开某个弹窗"的增量动作：close-all 表示
 * 全部归零。这样点「上一步」时界面能完整回到上一步该有的样子——若只发增量
 * （如 pool-library 只管开条目库），从"选择条目"回退到"条目库"时选择条目
 * 弹窗还开着叠在上面，用户看到的就是"没回到上一步的界面"
 */
export type OnboardingAction = 'close-all' | 'pool-library' | 'pool-select-entries' | 'filter-library';
export const onboardingPendingAction = ref<OnboardingAction | null>(null);

/** 当前步骤下标。翻页只改这里，组件 watch 它驱动「切 tab → 开弹窗 → 等渲染 → 聚焦」链路 */
export const onboardingStepIndex = ref(0);

export interface OnboardingStep {
  id:
    | 'welcome'
    | 'api-fill'
    | 'api-save'
    | 'pool-concept'
    | 'pool-open'
    | 'pool-add'
    | 'pool-select'
    | 'gen-auto'
    | 'gen-behavior'
    | 'gen-count'
    | 'prompt-intro'
    | 'wi-enable'
    | 'wi-exclude'
    | 'wi-books'
    | 'filter-zones'
    | 'filter-library-open'
    | 'filter-st-import'
    | 'filter-reference'
    | 'appearance-panel'
    | 'appearance-theme'
    | 'run-generate'
    | 'done';
  icon: string;
  title: string;
  html: string;
  /** 进入本步时自动切到的 tab（经 onboardingPendingTab 间接下发） */
  tab?: TabId;
  /** 进入本步时下发的弹窗状态信号（经 onboardingPendingAction 间接下发） */
  action?: OnboardingAction;
  /** 聚光灯目标：data-tour 属性选择器。目标元素找不到（tab 未渲染/弹窗未开/
   *  被滚出视口）时向导自动退化为「整体调暗 + 卡片居中」，目标恢复后自动重新聚焦 */
  target?: string;
  /**
   * 完成信号（返回 null = 本步无信号，手动翻页）。组件在进入本步时快照基线，
   * 仅当基线为 false 且运行中变为 true（"本步内从无到有"）才自动前进——
   * 全新档默认配置已含条目、老用户重放时 API 已配置，若不区分基线会秒跳
   */
  done?: () => boolean;
}

const isApiReady = (): boolean => {
  const gs = useGlobalSettingsStore(pinia);
  return !!resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
};

/**
 * 零基础全流程 22 步。target 用的 data-tour 属性分散在 FloatingSettings/ApiEditor/
 * PoolEditor/FilterEditor/FilterGroupPanel/RegexLibraryDialog/EntryPoolDialog/
 * SelectEntriesDialog/GenerationSettings/PromptEditor/WorldInfoEditor/
 * AppearanceSettings 模板里，增删步骤时两处要同步。
 * 弹窗步骤的 action 语义 = "本步应有的完整弹窗状态"（含 close-all 归零），
 * 保证上一步/下一步来回走时界面完整还原；条目选择界面教用户自己点按钮打开，
 * 而不是替他弹——新手要知道因果。
 * done 信号只有两处硬检测（API 保存成功 / 首次生成成功），其余均为体验步骤手动翻页；
 * 文案一律"跟我做"口吻，每步开头一句动作指令
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    icon: 'fa-solid fa-chess',
    title: '欢迎使用行动选项',
    html: `<p><strong>行动选项</strong>会在主线对话之外，单独调用一次 API，根据当前剧情异步生成一组行动选项；点选其中一条，按所选方式进入输入框（直接发送 / 覆盖输入框 / 尾附在末尾），不占用楼层、不打断对话节奏。</p>
<p>接下来我会带你一步步完成初步配置：<strong>配置 API → 准备条目 → 认识各功能页 → 生成第一组选项</strong>。跟着做即可，任何一步都可以随时退出。</p>`,
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
    id: 'pool-concept',
    icon: 'fa-solid fa-layer-group',
    title: '第二步：认识条目池',
    html: `<p>条目池分两层：<strong>条目库</strong>存放所有条目——每条 = 一个行动方向的写作指引；<strong>配置</strong>决定本次生成从哪些条目里抽取，并可绑定到角色或聊天（优先级：聊天 &gt; 角色 &gt; 默认配置）。</p>
<p>全新安装已内置一组示例条目和默认配置，<strong>开箱即用</strong>。下面先带你逛一圈条目库。</p>`,
    tab: 'pool',
    target: '[data-tour="pool-library"]',
    action: 'close-all',
  },
  {
    id: 'pool-open',
    icon: 'fa-solid fa-database',
    title: '第二步：条目库布局与功能',
    html: `<p>我已经帮你打开了条目库。<strong>顶部一排按钮</strong>：全部展开、新建分组、导入 / 导出文件，以及<strong>魔杖「AI 生成」</strong>——按当前角色批量生成一批条目，是扩充条目库的主力。</p>
<p><strong>下方按分组存放条目</strong>：分组头可重命名、加条目、整组复制 / 删除；点条目展开可编辑<strong>类型、内容、规则</strong>，勾选框用于批量选中。</p>
<p>看完点右上角 × 关闭，回到条目池页。</p>`,
    action: 'pool-library',
    target: '[data-tour="entrypool-toolbar"]',
  },
  {
    id: 'pool-add',
    icon: 'fa-solid fa-list-check',
    title: '第二步：往配置里加条目',
    html: `<p>条目库是仓库，<strong>配置</strong>才决定"这次生成用哪些"。现在<strong>点这个「添加条目」按钮</strong>——它会弹出选择条目界面，下一步我会聚焦给你看。</p>
<p>想移出某条：在配置的已选列表里点条目右侧的 <i class="fa-solid fa-xmark"></i>；想整批调整，重新打开这个按钮取消勾选即可。</p>`,
    target: '[data-tour="pool-add"]',
    action: 'close-all',
  },
  {
    id: 'pool-select',
    icon: 'fa-solid fa-square-check',
    title: '第二步：勾选条目并确认',
    html: `<p>这就是<strong>「选择条目」</strong>界面：点分组名展开，勾选要参与生成的条目（分组头的复选框可整组全选），点底部<strong>「确认」</strong>写入当前配置。</p>
<p>底部实时显示已选数量；确认后回到条目池页就能看到它们。之后想增减，随时点「添加条目」回来改。</p>`,
    action: 'pool-select-entries',
    target: '[data-tour="select-entries-list"]',
  },
  {
    id: 'gen-auto',
    icon: 'fa-solid fa-bolt',
    title: '第三步：自动生成与输入润色',
    html: `<p><strong>「自动生成」开关</strong>：打开后每次 AI 回复完成都会自动出一组选项，不用手动点（仅对当前聊天生效）。</p>
<p><strong>「启用输入润色」开关</strong>：发送你的消息前，AI 先把你的输入改写成多个润色版本供挑选，选中的才真正发出。</p>
<p>两个都建议保持开启。</p>`,
    tab: 'generation',
    target: '[data-tour="gen-auto"]',
  },
  {
    id: 'gen-behavior',
    icon: 'fa-solid fa-paper-plane',
    title: '第三步：点击行为',
    html: `<p><strong>点击行为</strong>决定你点一条选项后发生什么：</p>
<p><strong>发送</strong>——直接把这条选项作为消息发出；<strong>覆盖</strong>——填入输入框并替换已有内容，你可以先改再发；<strong>尾附</strong>——追加到输入框末尾，保留你自己写的内容。</p>
<p>这里的设置与选项面板头部的切换按钮保持同步，聊天中随时可改。</p>`,
    target: '[data-tour="gen-behavior"]',
  },
  {
    id: 'gen-count',
    icon: 'fa-solid fa-sliders',
    title: '第三步：数量、字数与人称',
    html: `<p><strong>生成数量</strong>：填数字 = 每次固定条数，填区间 = 每次随机（如 <code>3-6</code>）；<strong>润色版本数</strong>同理。</p>
<p>往下还有<strong>每条字数</strong>（选项 / 润色的字数区间，中文字符）和<strong>人称视角</strong>（默认第三人称，可改成第一人称 / 第二人称）。</p>
<p>这些都有默认值，按喜好微调即可。</p>`,
    target: '[data-tour="gen-count"]',
  },
  {
    id: 'prompt-intro',
    icon: 'fa-solid fa-align-left',
    title: '提示词：生成指令怎么组装',
    html: `<p>选项内容由这里的<strong>提示词模块</strong>驱动：<strong>顶部工具栏</strong>可切换上下文轮数模式、开关预填充；下方是模块列表，可拖拽排序、编辑内容。</p>
<p>默认配置开箱即用，新手无需改动；想调整时点 <i class="fa-solid fa-circle-question"></i> 查看本页详细说明。</p>`,
    tab: 'prompt',
    target: '[data-tour="prompt-toolbar"]',
  },
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
  {
    id: 'filter-zones',
    icon: 'fa-solid fa-filter',
    title: '过滤：三个分区',
    html: `<p><strong>过滤是干什么的</strong>：发送生成请求前，插件先按你定的规则清洗聊天记录——删掉思维链、小剧场等不该让"出选项的 AI"看到的内容。</p>
<p>规则按三个分区管理：<strong>① 全局正则区</strong>（始终生效）　<strong>② 预设正则区</strong>（随酒馆预设切换）　<strong>③ 角色卡正则区</strong>（随角色卡切换）；不属于当前预设 / 角色的分组会<strong>半透明显示</strong>且不生效。顶部状态栏显示当前实际生效的分组数。</p>`,
    tab: 'filter',
    target: '[data-tour="filter-global-head"]',
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
  {
    id: 'appearance-panel',
    icon: 'fa-solid fa-window-maximize',
    title: '外观：面板与悬浮球',
    html: `<p><strong>「悬浮窗」开关</strong>控制屏幕右下角的悬浮球——它是生成选项的快捷入口，建议保持开启（关闭后只能从扩展菜单进入设置）。</p>
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
  {
    id: 'run-generate',
    icon: 'fa-solid fa-wand-magic-sparkles',
    title: '最后一步：生成你的第一组选项',
    html: `<p>所有设置完成！点面板右上角 <strong>×</strong> 关闭设置，然后用任意一种方式生成：</p>
<p><strong>① 选项面板上的「生成」按钮</strong>　<strong>② 输入框旁的魔杖菜单</strong>　<strong>③ 悬浮球</strong></p>
<p>生成成功后会自动进入最后一步。</p>`,
    done: () => lastOptionsGeneratedAt.value > 0,
  },
  {
    id: 'done',
    icon: 'fa-solid fa-flag-checkered',
    title: '完成！',
    html: `<p>初步配置到此完成：API 已就绪、条目已就位、你也生成过第一组选项了。</p>
<p>之后想深入了解：每个标签页的 <i class="fa-solid fa-circle-question"></i> 按钮都有详细说明；tab 栏的 <i class="fa-solid fa-graduation-cap"></i> 按钮可随时重看本向导。</p>
<p><strong>祝游玩愉快！</strong></p>`,
  },
];

/**
 * 设置面板打开时调用：从未看过引导则弹出。弹出瞬间就置 done 而非关闭时置——
 * 用户中途刷新页面/直接杀进程也视为看过，避免每次打开设置都被向导拦截；
 * 想重看走 tab 栏 🎓 按钮。done 写入 settings 后由 global-settings store 的
 * deep watch 自动落盘
 */
export function maybeAutoOpenOnboarding(): void {
  const gs = useGlobalSettingsStore(pinia);
  if (gs.settings.ui.onboarding_done) return;
  gs.settings.ui.onboarding_done = true;
  onboardingStepIndex.value = 0;
  onboardingVisible.value = true;
}

/** 手动重开（tab 栏 🎓 按钮），不检查 done */
export function openOnboarding(): void {
  onboardingStepIndex.value = 0;
  onboardingVisible.value = true;
}

export function closeOnboarding(): void {
  onboardingVisible.value = false;
}

/** 步骤切换 tab 用：只发信号不关向导（聚光灯导览中切页后继续停留在当前步） */
export function requestOnboardingTab(tab: TabId): void {
  onboardingPendingTab.value = tab;
}
