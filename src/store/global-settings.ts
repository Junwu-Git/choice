import { chat_metadata, saveCharacterDebounced, saveSettingsDebounced, this_chid } from '@sillytavern/script';
import { extension_settings, saveMetadataDebounced } from '@sillytavern/scripts/extensions';
import { eventSource, event_types } from '@sillytavern/scripts/events';
import { uuidv4 } from '@sillytavern/scripts/utils';
import {
  GlobalSettings,
  GenerationSettings,
  SCHEMA_VERSION,
  setting_field,
  DEFAULT_MODULES,
  SIMPLE_MODULE_CONTENTS,
  BAIBAI_MODULE_IDS,
  DEFAULT_ENRICH_PERSON_STYLE,
  USER_INSTRUCTION_DEFAULT,
  LEGACY_USER_INSTRUCTION_TASK,
  USER_INSTRUCTION_GUIDE,
  OPTION_TASK_DEFAULT,
  PROMPT_TEXT_MIGRATIONS,
  type PromptConfig,
  type GlobalSettings as GlobalSettingsType,
  type PoolConfig,
  type PoolConfigEntry,
  type PoolEntry,
  type PromptModule as PromptModuleType,
  type ChatFilterGroup,
  type FilterGroup,
  type RegexLibraryEntry,
  type FilterGroupEntry,
  sanitizePromptRulesChars,
} from '@/type/settings';
// chat/character store 不反向依赖 global-settings，无循环导入；
// 不能依赖 unplugin-auto-import——它只覆盖 vue/pinia/@vueuse/zod 等预设，
// 本仓库自有模块漏导入时构建不报错（rollup 视为全局引用），直到运行时才 ReferenceError
import { useChatSettingsStore } from '@/store/chat-settings';
import { useCharacterSettingsStore } from '@/store/character-settings';
import { detectSTTheme, getSTInkFallback, watchSTTheme } from '@/core/theme-detector';
import { getStCharacter } from '@/core/st-character';

/**
 * 旧版默认条目（v23 前 buildDefaultEntries 产出）的 type 集合。
 * v23 迁移据此把默认 config 对这些条目的引用切换为「通用」分组——
 * 按 type 而非 entry_id 匹配：entry_id 是每份存档独立生成的 uuid，跨存档不可比。
 */
const LEGACY_DEFAULT_ENTRY_TYPES = new Set([
  '顺势而为',
  '转场推进',
  '意外走向',
  '暧昧触碰',
  '他人视角',
  '就地取材',
  '大胆尝试',
  '悄然旁观',
  '温暖靠近',
  '轻松调侃',
]);

/**
 * 分组名常量：条目 category 与 group_order 的唯一事实来源。
 * v46 起默认配置只引用「用户主体」分组（v47 起仅 1 条 pinned 锚点），其余 7 组 opt-in，
 * 只进 master_pool 条目库；分组轮询抽取（drawByCategories）按 category 分桶，
 * 独立成组保证各组特色获得稳定但不过分的出场占比。
 */
const POOL_GROUP_ORDER = [
  '用户主体',
  '其他角色主体',
  '时间流逝',
  '剧情续写规划',
  '环境与事件',
  '对话交锋',
  '情感关系',
  'NSFW',
] as const;

/** 旧「通用」分组（v46 前默认 config 引用）的默认条目 type 集合。 */
const LEGACY_GENERAL_TYPES = new Set(['顺势推进', '风格反差', '角色本心', '开放余地']);

/** 旧「时间跳跃」分组（v46 前默认 config 引用）的默认条目 type 集合。 */
const LEGACY_TIME_JUMP_TYPES = new Set(['须臾之间', '翌日清晨', '数日之后', '季节更迭', '多年以后', '回溯闪回']);

/** 旧「NSFW」分组（v46 前 10 条）中被删除的 type 集合。 */
const LEGACY_NSFW_DROPPED_TYPES = new Set(['NSFW·就地取材', 'NSFW·情趣道具']);

/** 旧「NSFW」分组保留 8 条的旧默认 content（v46 迁移按"内容 === 旧默认"才换新，用户编辑过的不动）。 */
const OLD_NSFW_CONTENT_BY_TYPE = new Map<string, string>([
  ['NSFW·主动出击', '给出一个由 {{user}} 主动发起或加码亲密接触的选项——火候与方式贴合当前氛围，不必等对方先递台阶'],
  ['NSFW·顺势而为', '抓住此刻氛围里最微妙的信号顺势回应，给出一个不点破、却让默契升温半分的选项'],
  ['NSFW·交出主导', '给出一个把主导权交给对方的选项——示意对方来安排节奏，自己只管接住每一个反应'],
  ['NSFW·半推半就', '给出一个嘴上矜持、身体诚实的选项——口头的推拒与行动的迎合形成可爱反差'],
  ['NSFW·变换姿势', '给出一个提议换个姿势或换到别的位置继续的选项——挪动本身也是情趣的一部分'],
  ['NSFW·语言调情', '给出一个用言语调情或说出羞人请求的选项——声音也是武器，说出口才升温'],
  ['NSFW·事后温存', '给出一个亲近过后依偎温存的选项——喘息未定时的耳语与轻抚别有滋味'],
  ['NSFW·大胆尝试', '给出一个以前没试过、此刻却心血来潮想试试的选项——把「要不要」抛给对方'],
]);

/** 条目构建小工具：统一字段形态，pinned 默认 false、weight 默认 1、rule 默认空。 */
const createPoolEntry = (category: string, type: string, content: string, pinned = false, rule = ''): PoolEntry => ({
  id: uuidv4(),
  type,
  content,
  pinned,
  weight: 1,
  category,
  rule,
});

/**
 * 旧「通用」分组构建器：仅 v23 迁移块使用（老存档按 type 去重补入后再由 v46 清理），
 * 文案冻结为旧默认原文——迁移依赖逐字匹配，改动会破坏 v23 收敛与 v46 清理的判据。
 */
function buildGeneralEntries(): PoolEntry[] {
  return [
    createPoolEntry('通用', '顺势推进', '紧承前文当下的留白，给出情境中最自然顺承的推进方向', true),
    createPoolEntry('通用', '风格反差', '与近几轮选项的基调或行动类型形成反差，制造新鲜与意外', true),
    createPoolEntry('通用', '角色本心', '从 {{user}} 的性格核心与当下心境出发，给出贴合其人设的选择'),
    createPoolEntry('通用', '开放余地', '给出一个不急于收束、留有后续展开空间的方向'),
  ];
}

/**
 * 「用户主体」分组：12 条由 {{user}} 承担下一拍的方向素材。
 * 提示词已"主体不固定"化，本组锚定"用户行动"这一主体维度，覆盖顺承/破局/冲突/
 * 试探/表露/肢体/意外/目标/求助/安抚/观察/谈价 十二个方向。v47 起仅「顺势行动」
 * 1 条 pinned：每轮保证一个"稳"的自主权锚点；「打破僵局」改为随机抽取——它是
 * 情境性方向（场景不僵持时硬塞会别扭），且与「出人意料」语义部分重叠，不宜每轮必发。
 */
function buildUserSubjectEntries(): PoolEntry[] {
  return [
    createPoolEntry('用户主体', '顺势行动', '由 {{user}} 紧承当前情境中最自然的一步，做出顺理成章的行动或回应', true),
    createPoolEntry('用户主体', '打破僵局', '由 {{user}} 主动打破当前停滞或尴尬，让场景重新动起来'),
    createPoolEntry('用户主体', '正面交锋', '由 {{user}} 直面眼前的矛盾或人物，把话挑明、把事说破，不再迂回'),
    createPoolEntry('用户主体', '迂回试探', '由 {{user}} 旁敲侧击、以退为进，先探清对方的底细与态度'),
    createPoolEntry('用户主体', '吐露心声', '由 {{user}} 在此刻表露真实情绪或心事，可以坦诚，也可以半真半假'),
    createPoolEntry('用户主体', '身体先行', '由 {{user}} 以行动代替言语表态，让靠近、回避、递出或阻拦等动作传达态度'),
    createPoolEntry('用户主体', '出人意料', '由 {{user}} 做出有悖当下预期的事，为局面注入一个合理的新变量'),
    createPoolEntry('用户主体', '目标推进', '由 {{user}} 朝自己的目标或牵挂的人事物迈出具体一步，不停留在空想或等待'),
    createPoolEntry('用户主体', '求助托付', '由 {{user}} 开口向可信的人求助、委派或托付一件事，把难题分出去一部分'),
    createPoolEntry('用户主体', '安抚示好', '由 {{user}} 先递台阶——安慰、道歉、道谢或以小动作示好，修补或拉近关系'),
    createPoolEntry(
      '用户主体',
      '观察等待',
      '由 {{user}} 不急于行动，先观察、倾听或按兵不动，给局面和对方留出变化的余地',
    ),
    createPoolEntry('用户主体', '讨价还价', '由 {{user}} 就条件、代价或利益开口谈价，试探对方能让步的底线'),
  ];
}

/**
 * 「其他角色主体」分组：8 条由在场角色承担下一拍的方向素材——反应、内心、主动、
 * 试探、反常、交锋、求助、筹谋。opt-in（只进 master_pool），用户启用后与用户主体
 * 方向混出，实现提示词允许的"主体不固定"。
 */
function buildCharacterSubjectEntries(): PoolEntry[] {
  return [
    createPoolEntry('其他角色主体', '角色回响', '让在场某个角色先回应刚才的局势或 {{user}} 的话，可以接住，也可以岔开'),
    createPoolEntry('其他角色主体', '内心显影', '切入某个角色此刻的内心视角，呈现其真正想法或尚未说出口的内容'),
    createPoolEntry('其他角色主体', '主动逼近', '由某个角色主动靠近、发难或提出要求，接管当前场面的节奏'),
    createPoolEntry('其他角色主体', '关系试探', '某个角色借由话题或动作试探与 {{user}} 的距离、态度和底线'),
    createPoolEntry('其他角色主体', '反常之举', '某个角色做出与平时表现不同但仍合乎人设的举动，露出隐藏的一面'),
    createPoolEntry('其他角色主体', '角色交锋', '让两个在场角色发生对峙或争执，把潜在矛盾摆到台面上'),
    createPoolEntry('其他角色主体', '求助托付', '某个角色向 {{user}} 求助、示弱或托付一件事，把选择权交回对方'),
    createPoolEntry('其他角色主体', '暗中筹谋', '某个角色在台面下推进自己的盘算，为后续剧情留下可追踪的暗线'),
  ];
}

/**
 * 旧「时间跳跃」分组构建器：仅 v22 迁移块使用（老存档按 type 去重补入后再由 v46 清理），
 * 文案冻结为旧默认原文——理由同 buildGeneralEntries。
 */
function buildTimeJumpEntries(): PoolEntry[] {
  return [
    createPoolEntry(
      '时间跳跃',
      '须臾之间',
      '只推进几分钟到半小时的微小时间，用茶凉、雨停、天色暗下一格这类细节完成对话间隙的自然过渡',
    ),
    createPoolEntry('时间跳跃', '翌日清晨', '跳到第二天早晨，以晨间光线、声音或身体感受开场，昨夜的事件沉淀为余韵'),
    createPoolEntry(
      '时间跳跃',
      '数日之后',
      '跳过两三天到一周，用新习惯、将愈未愈的伤、来往的消息等细节交代这段时间留下的痕迹',
    ),
    createPoolEntry('时间跳跃', '季节更迭', '大幅推进到换季时节，环境物候明显变化，人物关系与心境随时间产生微妙位移'),
    createPoolEntry('时间跳跃', '多年以后', '跨度数年到数十年，外貌、身份、关系发生显著变化，带一丝物是人非的怅然'),
    createPoolEntry(
      '时间跳跃',
      '回溯闪回',
      '反向跳跃：插入一段过去的回忆场景，与当下形成呼应或对照，结尾回到当前时间点',
      false,
      '此项为回忆插叙，需明确时间线标记，结尾必须落回当前时间点',
    ),
  ];
}

/**
 * 「时间流逝」分组：8 条时间/环境推移方向素材。由旧「时间跳跃」6 条重写扩至 8 条——
 * 旧文案偏"跳跃跨度的修辞展示"，新文案偏"时间流逝本身留下痕迹"，与提示词
 * "一段时间或环境的推移"的尺度维度对齐。
 */
function buildTimePassEntries(): PoolEntry[] {
  return [
    createPoolEntry('时间流逝', '须臾之间', '只推进几分钟到半小时，用茶凉、雨停、灯影移动等细节完成自然过渡'),
    createPoolEntry('时间流逝', '翌日清晨', '跳到第二天早晨，以光线、声音或身体感受开场，让前一晚的事件沉淀为余韵'),
    createPoolEntry('时间流逝', '数日之后', '跳过两三天到一周，用新习惯、伤势变化、往来消息等细节交代时间痕迹'),
    createPoolEntry('时间流逝', '季节更迭', '推进到换季时节，让环境物候、人物关系和心境产生可感知的位移'),
    createPoolEntry('时间流逝', '多年以后', '推进数年或更久，让外貌、身份、关系或目标发生足以改变局势的变化'),
    createPoolEntry(
      '时间流逝',
      '回溯闪回',
      '插入一段与当前相关的过去场景，用呼应或对照补充信息，结尾必须回到当前时间点',
    ),
    createPoolEntry('时间流逝', '夜色渐深', '在同一段夜晚内缓慢推进时间，让灯光、困意、酒意或气氛随钟点发生变化'),
    createPoolEntry('时间流逝', '等待间隙', '描写一段被拉长的等待、赶路、守候或恢复过程，让时间流逝本身改变人物状态'),
  ];
}

/** 「剧情续写规划」分组：8 条计划/试探/布局类方向素材，对应提示词的"计划或试探"尺度。 */
function buildPlotPlanningEntries(): PoolEntry[] {
  return [
    createPoolEntry('剧情续写规划', '谋定后动', '先调查、准备或安排后手，再让主体采取行动，行动应服务于当前目标'),
    createPoolEntry('剧情续写规划', '设局布局', '为后续目标布置一枚眼前不显眼但可回收的棋子或条件'),
    createPoolEntry('剧情续写规划', '抛砖引玉', '用一个小话题、小动作或小利益引出更大的信息，观察局中人的反应'),
    createPoolEntry('剧情续写规划', '摊牌时刻', '坦白关键事实、亮出底牌或提出明确条件，结束一段持续的含糊与绕行'),
    createPoolEntry('剧情续写规划', '后手留白', '为当前事件留下一个具体而未解决的尾巴，形成自然的后续入口'),
    createPoolEntry('剧情续写规划', '化险为夷', '从当前困局中寻找不撕破脸的解法，通过补台、圆场或各退一步改变局面'),
    createPoolEntry('剧情续写规划', '火中取栗', '抓住混乱、误会或权力空隙，在承担风险的同时达成一个现实目的'),
    createPoolEntry('剧情续写规划', '承上启下', '收束当前小节，同时把新的线索、目标、地点或期限摆到后续剧情中'),
  ];
}

/** 「环境与事件」分组：8 条环境演变/外部事件方向素材，对应提示词的"环境的演变"尺度。 */
function buildEnvironmentEventEntries(): PoolEntry[] {
  return [
    createPoolEntry('环境与事件', '天气突变', '天气或自然环境突然变化，打断当前进程并迫使在场者调整安排'),
    createPoolEntry('环境与事件', '意外声响', '一个突然的声音或动静把注意力从当前话题拉向新的方向'),
    createPoolEntry('环境与事件', '不速之客', '新的角色带着消息、请求或威胁介入当前场面'),
    createPoolEntry('环境与事件', '消息传来', '一条消息、书信、传闻或公告抵达，改变在场者对局势的判断'),
    createPoolEntry('环境与事件', '器物变化', '身边物品出现、损坏、遗失或被发现，引出与当前剧情相关的新信息'),
    createPoolEntry('环境与事件', '景物映心', '用具体环境细节承接或反衬人物当下心境，避免直接解释情绪'),
    createPoolEntry('环境与事件', '突发事故', '一个不受控但合理的小事故打破既定节奏，制造即时处理的问题'),
    createPoolEntry('环境与事件', '远方余波', '背景世界正在发生的事件通过声音、告示、价格、人员或气氛传到当前场景'),
  ];
}

/** 「对话交锋」分组：8 条对话/言语方向素材，主体由当前场景决定（提示词允许主体不固定）。 */
function buildDialogueEntries(): PoolEntry[] {
  return [
    createPoolEntry('对话交锋', '话中有话', '让一句表面平常的话同时承载试探、告诫、暗示或未明说的要求'),
    createPoolEntry('对话交锋', '打破沉默', '让合适的在场者先开口，直接改变僵持、尴尬或无人接话的状态'),
    createPoolEntry('对话交锋', '嘴硬心软', '通过口是心非、反话或刻意冷淡表达关心、在意或不愿承认的情绪'),
    createPoolEntry('对话交锋', '步步紧逼', '通过连续追问、质问或补充条件压缩对方回避的空间'),
    createPoolEntry('对话交锋', '玩笑化解', '用玩笑、自嘲或轻微调侃卸下紧张气氛，但不抹去潜在矛盾'),
    createPoolEntry('对话交锋', '直白挑明', '用一句清楚的话说出此前一直回避的要求、立场或心意'),
    createPoolEntry('对话交锋', '话赶话争执', '让一次回应牵出下一次反驳，争执逐步暴露真正的分歧'),
    createPoolEntry('对话交锋', '沉默回应', '让没有说出口的回答通过停顿、回避或未完成的话产生明确分量'),
  ];
}

/** 「情感关系」分组：8 条关系/情绪张力方向素材，升温、疏离、猜忌、依赖等关系变化。 */
function buildEmotionRelationEntries(): PoolEntry[] {
  return [
    createPoolEntry('情感关系', '暧昧升温', '通过距离、温度、语气或一个细小照顾，让关系向亲近方向移动半步'),
    createPoolEntry('情感关系', '若即若离', '让一方忽近忽远、欲言又止，使关系重新变得不确定'),
    createPoolEntry('情感关系', '醋意暗涌', '因第三人、旧事或被忽视而产生微妙介意，情绪先从细节中泄露'),
    createPoolEntry('情感关系', '旧事重提', '一段往事、承诺或旧伤被重新触及，使当前关系出现新的波动'),
    createPoolEntry('情感关系', '患难与共', '让人物共同处理一个麻烦，在合作、保护或承担中改变信任程度'),
    createPoolEntry('情感关系', '心生芥蒂', '一件具体的小事在关系中留下裂痕，表面的客套逐渐变得不自然'),
    createPoolEntry('情感关系', '依赖成习', '让人物开始习惯对方的存在、帮助、等待或消息，并在细节中显露出来'),
    createPoolEntry('情感关系', '界限试探', '一方以试探性的言语或行动触碰关系边界，观察对方是否接受'),
  ];
}

/**
 * 「NSFW」分组：8 条成人向方向素材（v46 由 10 条收敛）。
 * opt-in 设计不变：只进 master_pool，默认 config 不引用，用户在「选择条目」里勾选。
 * ① 全部 pinned:false——NSFW 方向不应像「用户主体」锚点那样每轮必发。
 * ② 文案一律含蓄方向级（"给出一个……的方向"），只给思考方向不给具体动作脚本。
 * type 统一带「NSFW·」前缀作标记，在条目库与发给 AI 的候选行里都能一眼认出归属。
 */
function buildNsfwEntries(): PoolEntry[] {
  return [
    createPoolEntry('NSFW', 'NSFW·主动出击', '给出一个由 {{user}} 主动发起或加码亲密接触的方向，火候贴合当前氛围'),
    createPoolEntry('NSFW', 'NSFW·顺势而为', '抓住当前氛围里的微妙信号顺势回应，让默契自然升温而不突兀点破'),
    createPoolEntry('NSFW', 'NSFW·交出主导', '给出一个把节奏或主导权交给对方的方向，重点呈现信任与反应'),
    createPoolEntry('NSFW', 'NSFW·半推半就', '让口头矜持与实际行动形成符合人物关系的反差，不强行违背意愿'),
    createPoolEntry('NSFW', 'NSFW·变换位置', '给出一个换到别处或调整姿势继续的方向，让空间变化服务于当前氛围'),
    createPoolEntry('NSFW', 'NSFW·语言调情', '通过调情、挑逗或羞人请求推进亲密互动，表达贴合人物说话方式'),
    createPoolEntry('NSFW', 'NSFW·事后温存', '把亲近后的依偎、耳语、照料或余韵作为下一拍，关注关系变化而非重复过程'),
    createPoolEntry(
      'NSFW',
      'NSFW·大胆尝试',
      '给出一个此前未尝试、此刻有动机尝试的亲密方向，由人物边界和当前情境决定尺度',
    ),
  ];
}

/** 构建默认条目（进默认 config 引用）：v47 起只有「用户主体」12 条。 */
function buildDefaultEntries(): PoolEntry[] {
  return buildUserSubjectEntries();
}

/** 构建完整条目库：8 组 68 条，供 factoryReset 与空池迁移写入 master_pool。 */
function buildAllPoolEntries(): PoolEntry[] {
  return [
    ...buildDefaultEntries(),
    ...buildCharacterSubjectEntries(),
    ...buildTimePassEntries(),
    ...buildPlotPlanningEntries(),
    ...buildEnvironmentEventEntries(),
    ...buildDialogueEntries(),
    ...buildEmotionRelationEntries(),
    ...buildNsfwEntries(),
  ];
}

import { validateInplace } from '@/util/zod';

// 提示词模块化迁移：旧格式(schema_version=0) → 模块化格式(schema_version=1)
// schema_version=1 → 2：更新模块顺序（user_instruction 移到 system_prompt 之后）
// schema_version=2 → 3：添加预填充模块（assistant_ack / thinking_prompt / assistant_thinking）
// schema_version=3 → 4：聊天记录过滤由 chat_filter_regexes(string[]) 迁移为 chat_filter_rules(规则对象[])
const migratePromptModules = (validated: GlobalSettingsType, legacyRegexes: string[]) => {
  const version = validated.prompt_rules.schema_version ?? 0;

  if (version < 1) {
    const modules = klona(DEFAULT_MODULES);
    if (validated.prompt_rules.system_prompt) {
      const sp = modules.find(m => m.id === 'system_prompt');
      if (sp) sp.content = validated.prompt_rules.system_prompt;
    }
    if (validated.prompt_rules.core_rules) {
      const cr = modules.find(m => m.id === 'core_rules');
      if (cr) cr.content = validated.prompt_rules.core_rules;
    }
    validated.prompt_rules.modules = modules;
  }

  if (version < 2) {
    // 更新现有模块顺序，与 DEFAULT_MODULES 对齐
    resetOrderFromDefaults(validated);
  }

  if (version < 3) {
    // 添加预填充模块：assistant_ack、thinking_prompt、assistant_thinking
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    for (const d of defaults) {
      if (!existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 4) {
    // 旧字段 chat_filter_regexes(string[]) 已在 validateInplace 前被捕获，
    // 此处仅在新规则列表为空时填充，避免覆盖用户已经录入的新数据
    const legacy = legacyRegexes.filter(p => typeof p === 'string' && p);
    if (legacy.length && validated.prompt_rules.chat_filter_rules.length === 0) {
      validated.prompt_rules.chat_filter_rules = legacy.map(p => ({ type: 'regex', pattern: p, replace: '' }));
    }
  }

  if (version < 5) {
    // v5: 调整模块权限标志位
    // 4 个只读模块（world_info_before / persona_description / world_info_after / chat_history）
    // 保持 marker:true + system:true，仅允许移动和开关
    // 其余所有模块开放编辑、删除、复制
    const READONLY_IDS = new Set([
      'world_info_before',
      'persona_description',
      'world_info_after',
      'chat_history',
      'baibai_summary',
    ]);
    for (const m of validated.prompt_rules.modules) {
      if (READONLY_IDS.has(m.id)) {
        m.marker = true;
        m.system = true;
      } else {
        m.marker = false;
        m.system = false;
      }
    }
  }

  if (version < 6) {
    // v6: 旧 chat_filter_rules 平铺列表 → 分组结构
    const oldRules = validated.prompt_rules.chat_filter_rules ?? [];
    if (oldRules.length > 0 && validated.prompt_rules.chat_filter_groups.length === 0) {
      const group: ChatFilterGroup = {
        id: uuidv4(),
        name: '默认分组',
        enabled: true,
        rules: klona(oldRules),
        // 迁移自旧平铺列表，无绑定信息；留空否则运行时为 undefined，分区判定会把分组错当预设/角色卡绑定
        preset_name: null,
        character_id: null,
      };
      validated.prompt_rules.chat_filter_groups = [group];
    }
    validated.prompt_rules.chat_filter_rules = [];
  }

  if (version < 7) {
    // v7: 追加柏宝书记忆源模块（baibai_summary、baibai_state）
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    for (const d of defaults) {
      if (BAIBAI_MODULE_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    resetOrderFromDefaults(validated);

    // 旧字段 exclude_hidden_messages → context_mode 迁移
    const oldExclude = (validated.prompt_rules as any).exclude_hidden_messages;
    if (oldExclude !== undefined) {
      (validated.prompt_rules as any).context_mode = oldExclude ? 'visible_only' : 'rounds';
      delete (validated.prompt_rules as any).exclude_hidden_messages;
    }
  }

  if (version < 8) {
    // v8: 添加 XML 分段包装模块（reference_open/close、history_open/close）
    // chat_history 默认 order 从 7 调整为 11，使 reference 块连续
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    const WRAPPER_IDS = new Set(['reference_open', 'reference_close', 'history_open', 'history_close']);
    for (const d of defaults) {
      if (WRAPPER_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 9) {
    // v9: 润色提示词模块化（enrich_prompt 从固定卡片转为模块），user_instruction 标记 option_only
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));

    // 给 user_instruction 设置 option_only
    const ui = validated.prompt_rules.modules.find(m => m.id === 'user_instruction');
    if (ui) ui.option_only = true;

    // 创建 enrich_prompt 模块，内容取旧字段（为空则用默认值）
    if (!existingIds.has('enrich_prompt')) {
      const defaultEnrich = defaults.find(m => m.id === 'enrich_prompt');
      const enrichContent = validated.prompt_rules.enrich_prompt || defaultEnrich?.content || '';
      validated.prompt_rules.modules.push({
        id: 'enrich_prompt',
        name: '润色提示词',
        role: 'system',
        content: enrichContent,
        marker: false,
        system: false,
        enabled: true,
        order: 3,
        enrich_only: true,
        option_only: false,
      });
    }

    // 将 order >= 3 的现有模块（除 enrich_prompt 外）order +1
    for (const m of validated.prompt_rules.modules) {
      if (m.id !== 'enrich_prompt' && m.order >= 3) {
        m.order += 1;
      }
    }

    resetOrderFromDefaults(validated);
  }

  if (version < 10) {
    // v10: 更新 user_instruction 模板（去掉过时的"跳过场景"规则，改用 {{pinned_count}}）
    const ui = validated.prompt_rules.modules.find(m => m.id === 'user_instruction');
    if (ui && ui.content.includes('其中 1 个固定为"跳过场景"类型')) {
      ui.content = USER_INSTRUCTION_DEFAULT;
    }
  }

  if (version < 11) {
    // v11: 柏宝书模块默认启用，调整顺序
    const baibaiSummary = validated.prompt_rules.modules.find(m => m.id === 'baibai_summary');
    if (baibaiSummary) baibaiSummary.enabled = true;
    resetOrderFromDefaults(validated);
  }

  // v37 的 shujuku_enabled 初始化原在本处（version < 37 时置 false），已删除：
  // ① 该守卫受 prompt_rules.schema_version<17 控制，migratePromptModules 只在老档迁移
  //    运行一次，语义错位（应属 applyDefaults）；② 缺字段由 schema default(false) 兜底，
  //    v35 迁移会从默认提示词配置快照还原用户真实值。删除后行为等价（审计 C1）

  if (version < 12) {
    // v12: 新增角色卡上下文模块（描述/性格/场景），让行动选项生成时也能看到角色卡核心设定
    // 此前这些字段只在 generatePoolEntries 中注入，generateOptions 缺失
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    const CHAR_IDS = new Set(['char_description', 'char_personality', 'char_scenario']);
    for (const d of defaults) {
      if (CHAR_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    // 重置只读/系统标志位，确保新增模块也被正确标记
    const READONLY_IDS = new Set([
      'world_info_before',
      'persona_description',
      'char_description',
      'char_personality',
      'char_scenario',
      'world_info_after',
      'chat_history',
      'baibai_summary',
    ]);
    for (const m of validated.prompt_rules.modules) {
      if (READONLY_IDS.has(m.id)) {
        m.marker = true;
        m.system = true;
      }
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 14) {
    // v13: 新增输出规格模块（output_spec），强化格式约束；更新 thinking_prompt 格式检查项
    const defaults = klona(DEFAULT_MODULES);
    const spec = defaults.find(m => m.id === 'output_spec');
    if (spec && !validated.prompt_rules.modules.some(m => m.id === 'output_spec')) {
      validated.prompt_rules.modules.push(spec);
    }
    const newTP = defaults.find(m => m.id === 'thinking_prompt');
    const oldTP = validated.prompt_rules.modules.find(m => m.id === 'thinking_prompt');
    if (newTP && oldTP) {
      oldTP.content = newTP.content;
    }
    resetOrderFromDefaults(validated);
  }

  if (version < 15) {
    // v15: 选项生成专用模块标记 option_only，避免润色模式发送冲突指令
    const OPTION_ONLY_IDS = new Set(['core_rules', 'output_spec', 'thinking_prompt', 'assistant_thinking']);
    for (const m of validated.prompt_rules.modules) {
      if (OPTION_ONLY_IDS.has(m.id)) {
        m.option_only = true;
      }
    }
  }

  if (version < 16) {
    // v16: 追加润色专用模块（规则/输出规格/自检/应答），与选项生成模块完全平行
    const defaults = klona(DEFAULT_MODULES);
    const existingIds = new Set(validated.prompt_rules.modules.map(m => m.id));
    const ENRICH_IDS = new Set(['enrich_core_rules', 'enrich_output_spec', 'enrich_thinking', 'enrich_assistant']);
    for (const d of defaults) {
      if (ENRICH_IDS.has(d.id) && !existingIds.has(d.id)) {
        validated.prompt_rules.modules.push(d);
      }
    }
    // v9 迁移 bug：enrich_prompt role 误写为 'system'，应为 'user'（与 DEFAULT_MODULES 一致）
    const ep = validated.prompt_rules.modules.find(m => m.id === 'enrich_prompt');
    if (ep && ep.role === 'system') {
      ep.role = 'user';
    }
  }

  if (version < 17) {
    validated.prompt_rules.option_min_chars ??= 30;
    validated.prompt_rules.option_max_chars ??= 80;
    validated.prompt_rules.enrich_min_chars ??= 30;
    validated.prompt_rules.enrich_max_chars ??= 80;
    validated.prompt_rules.enrich_person_style ??= DEFAULT_ENRICH_PERSON_STYLE;
    validated.prompt_rules.option_person ??= '第三人称';
    validated.prompt_rules.enrich_person ??= '第三人称';
  }

  validated.prompt_rules.schema_version = 17;
};

/** 按 id 把任意 modules 数组的 order 重排到 DEFAULT_MODULES 当前值。
 *  id 不在 DEFAULT（用户自建模块）的 order 不动——只修历史迁移期冻结的漂移，不改用户自定。
 *  单一事实源：resetOrderFromDefaults（工作副本）与 v36 迁移（配置快照）都委托本函数，
 *  避免两处 order 同步逻辑各自演化造成漂移 */
const resyncModuleOrders = (modules: PromptModuleType[]) => {
  const defaultMap = new Map(klona(DEFAULT_MODULES).map(m => [m.id, m]));
  for (const m of modules) {
    const d = defaultMap.get(m.id);
    if (d) m.order = d.order;
  }
};

/** 将工作副本 prompt_rules.modules 的 order 重置为 DEFAULT_MODULES 中的值（委托 resyncModuleOrders） */
const resetOrderFromDefaults = (validated: GlobalSettingsType) => {
  resyncModuleOrders(validated.prompt_rules.modules);
};

/** 老存档（schema < 19）迁移专用：创建「经典/简洁」双提示词配置并加载简洁到工作副本。
 *  经典 = 用户迁移前已有提示词的存档（可能是他们自己改过的内容），不是内置预设；
 *  简洁 = 出厂默认基准，is_default: true。
 *  前置条件：调用前 pr.modules 必须已填充完整（初始化顺序上 migratePromptModules 先于本函数），
 *  否则空模块会被原样快照进「经典」——全新档曾经的静默 bug。
 *  全新安装不走本函数（没有用户状态可存档），走 ensureDefaultPromptConfig。 */
const ensureBuiltinPromptConfigs = (validated: GlobalSettingsType) => {
  const pr = validated.prompt_rules;

  // 1. 创建"经典"配置（快照当前状态）
  const classicConfig: PromptConfig = {
    id: uuidv4(),
    name: '经典',
    is_default: false,
    modules: klona(pr.modules),
    option_person: pr.option_person ?? '第三人称',
    enrich_person: pr.enrich_person ?? '第三人称',
    enrich_person_style: pr.enrich_person_style ?? DEFAULT_ENRICH_PERSON_STYLE,
    option_min_chars: pr.option_min_chars ?? 30,
    option_max_chars: pr.option_max_chars ?? 80,
    enrich_min_chars: pr.enrich_min_chars ?? 30,
    enrich_max_chars: pr.enrich_max_chars ?? 80,
    context_rounds: pr.context_rounds ?? 10,
    context_mode: pr.context_mode ?? 'visible_only',
    prefill_enabled: pr.prefill_enabled ?? true,
    baibai_enabled: pr.baibai_enabled ?? false,
    shujuku_enabled: pr.shujuku_enabled ?? false,
  };

  // 2. 创建"简洁"配置（简化版模块）
  //    简洁文本单一来源是 settings.ts 的 SIMPLE_MODULE_CONTENTS（派生自 DEFAULT_MODULES），
  //    避免迁移代码与 JSON 默认内容两处文本漂移
  const simplifiedModules = klona(pr.modules).map((m: PromptModuleType) => {
    const simple = SIMPLE_MODULE_CONTENTS[m.id];
    return simple !== undefined ? { ...m, content: simple } : m;
  });

  const simpleConfig: PromptConfig = {
    id: uuidv4(),
    name: '简洁',
    is_default: true,
    modules: simplifiedModules,
    option_person: '第三人称',
    enrich_person: '第三人称',
    enrich_person_style: DEFAULT_ENRICH_PERSON_STYLE,
    option_min_chars: 30,
    option_max_chars: 80,
    enrich_min_chars: 30,
    enrich_max_chars: 80,
    context_rounds: 10,
    context_mode: 'visible_only',
    prefill_enabled: true,
    baibai_enabled: false,
    shujuku_enabled: false,
  };

  validated.prompt_configs = [classicConfig, simpleConfig];

  // 3. 将"简洁"配置加载到 prompt_rules
  pr.modules = klona(simpleConfig.modules);
  pr.option_person = '第三人称';
  pr.enrich_person = '第三人称';
  pr.enrich_person_style = DEFAULT_ENRICH_PERSON_STYLE;
  pr.option_min_chars = 30;
  pr.option_max_chars = 80;
  pr.enrich_min_chars = 30;
  pr.enrich_max_chars = 80;
  pr.context_rounds = 10;
  pr.context_mode = 'visible_only';
  pr.prefill_enabled = true;
  pr.baibai_enabled = false;
  pr.shujuku_enabled = false;

  // 4. 旧过滤分组（prompt_rules.chat_filter_groups）搬运到新家 filter_settings.groups。
  //    新 FilterGroup 用 entries（引用正则库或内联规则），旧分组是平铺 rules 数组——逐条包成
  //    library_entry_id=null 的内联条目。复制而非移动：旧字段留在原地，迁移逻辑有误时可发
  //    修复版重跑；filter_settings.groups 非空说明已搬过，跳过保证幂等。
  if (validated.filter_settings.groups.length === 0 && (pr.chat_filter_groups ?? []).length > 0) {
    validated.filter_settings.groups = (pr.chat_filter_groups ?? []).map(g => ({
      id: g.id,
      name: g.name,
      enabled: g.enabled,
      entries: g.rules.map(rule => ({ library_entry_id: null, inline_rule: klona(rule) })),
      preset_name: g.preset_name ?? null,
      character_id: g.character_id ?? null,
    }));
  }
};

/** 全新档/恢复出厂的默认提示词配置：仅一个「简洁」（is_default: true），不建经典。
 *  经典只作为老存档迁移时用户已有提示词的存档存在——全新环境没有"用户改动"可存档，
 *  不应把内置默认伪装成经典预设。pr.modules 此时必须已是简洁默认（JSON 即简洁基准）。
 *  幂等：prompt_configs 非空时跳过。 */
const ensureDefaultPromptConfig = (validated: GlobalSettingsType) => {
  if (validated.prompt_configs.length > 0) return;
  const pr = validated.prompt_rules;
  validated.prompt_configs = [
    {
      id: uuidv4(),
      name: '简洁',
      is_default: true,
      modules: klona(pr.modules),
      option_person: pr.option_person ?? '第三人称',
      enrich_person: pr.enrich_person ?? '第三人称',
      enrich_person_style: pr.enrich_person_style ?? DEFAULT_ENRICH_PERSON_STYLE,
      option_min_chars: pr.option_min_chars ?? 30,
      option_max_chars: pr.option_max_chars ?? 80,
      enrich_min_chars: pr.enrich_min_chars ?? 30,
      enrich_max_chars: pr.enrich_max_chars ?? 80,
      context_rounds: pr.context_rounds ?? 10,
      context_mode: pr.context_mode ?? 'visible_only',
      prefill_enabled: pr.prefill_enabled ?? true,
      baibai_enabled: pr.baibai_enabled ?? false,
      shujuku_enabled: pr.shujuku_enabled ?? false,
    },
  ];
};

/** v33 全向去重自愈的回写工具：把指向"被删重复份"的 chat/character 绑定重指到保留份。
 *  照 v9 迁移范式：chat_metadata + getStCharacter(this_chid) + save*Debounced。
 *  局限：仅愈合当前已加载的 chat/character 绑定（迁移在 store init 期跑，此时只有当前
 *  会话的 chat_metadata/角色可用）；其余 chat/character 的悬空绑定在加载该会话时由
 *  effectiveConfig 解析落空→回退默认（不崩溃），且 v31 幂等守卫已杜绝新增悬空。 */
const rebindConfigId = (removedIds: Set<string>, keptId: string) => {
  try {
    const cMeta = chat_metadata?.[setting_field];
    if (cMeta && typeof cMeta.config_id === 'string' && removedIds.has(cMeta.config_id)) {
      cMeta.config_id = keptId;
      saveMetadataDebounced();
    }
  } catch {
    /* chat_metadata 不可用时跳过 */
  }
  try {
    const ch = getStCharacter(this_chid);
    if (ch) {
      const cur = _.get(ch, ['data', 'extensions', setting_field, 'config_id']);
      if (typeof cur === 'string' && removedIds.has(cur)) {
        _.set(ch, ['data', 'extensions', setting_field, 'config_id'], keptId);
        saveCharacterDebounced();
      }
    }
  } catch {
    /* 角色数据不可用时跳过 */
  }
};

const rebindPromptConfigId = (removedIds: Set<string>, keptId: string) => {
  try {
    const cMeta = chat_metadata?.[setting_field];
    if (cMeta && typeof cMeta.prompt_config_id === 'string' && removedIds.has(cMeta.prompt_config_id)) {
      cMeta.prompt_config_id = keptId;
      saveMetadataDebounced();
    }
  } catch {
    /* chat_metadata 不可用时跳过 */
  }
  try {
    const ch = getStCharacter(this_chid);
    if (ch) {
      const cur = _.get(ch, ['data', 'extensions', setting_field, 'prompt_config_id']);
      if (typeof cur === 'string' && removedIds.has(cur)) {
        _.set(ch, ['data', 'extensions', setting_field, 'prompt_config_id'], keptId);
        saveCharacterDebounced();
      }
    }
  } catch {
    /* 角色数据不可用时跳过 */
  }
};

const applyDefaults = (validated: GlobalSettingsType) => {
  if ((validated.schema_version ?? 0) < 9) {
    // 旧三层池数据迁移：收集 → 去重 → 合并为 master_pool + 自动配置
    const oldGlobalPool: PoolEntry[] = (_.get(extension_settings, [setting_field, 'pool']) as PoolEntry[]) ?? [];
    const oldGlobalGen = _.get(extension_settings, [setting_field, 'generation']);
    let charName = '';
    let oldCharPool: PoolEntry[] = [];
    try {
      const ch = getStCharacter(this_chid);
      if (ch) {
        charName = ch.name || '';
        oldCharPool = (_.get(ch, ['data', 'extensions', setting_field, 'pool']) as PoolEntry[]) ?? [];
      }
    } catch {
      // 角色数据不可用时跳过
    }
    let oldChatPool: PoolEntry[] = [];
    try {
      const cMeta = chat_metadata?.[setting_field];
      if (cMeta) {
        oldChatPool = (cMeta.pool as PoolEntry[]) ?? [];
      }
    } catch {
      // 聊天元数据不可用时跳过
    }

    // 按 type 去重合并：相同 type 只保留第一条（优先级：聊天 > 角色 > 全局）
    const seen = new Map<string, PoolEntry>();
    for (const e of oldChatPool) {
      if (!seen.has(e.type)) seen.set(e.type, e);
    }
    for (const e of oldCharPool) {
      if (!seen.has(e.type)) seen.set(e.type, e);
    }
    for (const e of oldGlobalPool) {
      if (!seen.has(e.type)) seen.set(e.type, e);
    }
    validated.master_pool = [...seen.values()];

    const configs: PoolConfig[] = [];
    const makeEntries = (pool: PoolEntry[]): PoolConfigEntry[] =>
      pool.map(e => ({ entry_id: e.id, pinned: e.pinned, weight: e.weight, enabled: true }));

    if (oldGlobalPool.length > 0) {
      configs.push({
        id: uuidv4(),
        name: '全局默认',
        entries: makeEntries(oldGlobalPool),
        is_default: true,
        // 用 schema 默认而非硬编码字面量：避免字段遗漏（曾漏 count_mode，本次漏 oversample_pct）
        generation: (oldGlobalGen as any) ?? GenerationSettings.parse({}),
      });
    }

    if (oldCharPool.length > 0) {
      const charConfigId = uuidv4();
      configs.push({
        id: charConfigId,
        name: charName ? `角色 ${charName}` : '角色默认',
        entries: makeEntries(oldCharPool),
        is_default: configs.length === 0,
        generation: GenerationSettings.parse({}),
      });
      try {
        const ch = getStCharacter(this_chid);
        if (ch) {
          _.set(ch, ['data', 'extensions', setting_field, 'config_id'], charConfigId);
          // 旧 pool 字段被 config 体系取代，删除残留；extensions 可能在异常卡上缺失
          delete ch.data?.extensions?.[setting_field]?.pool;
          saveCharacterDebounced();
        }
      } catch {
        // 角色绑定失败时静默跳过
      }
    }

    if (oldChatPool.length > 0) {
      const chatConfigId = uuidv4();
      configs.push({
        id: chatConfigId,
        name: '聊天默认',
        entries: makeEntries(oldChatPool),
        is_default: configs.length === 0,
        generation: GenerationSettings.parse({}),
      });
      try {
        const cMeta = chat_metadata?.[setting_field];
        if (cMeta) {
          cMeta.config_id = chatConfigId;
          delete cMeta.pool;
          saveMetadataDebounced();
        }
      } catch {
        // 聊天绑定失败时静默跳过
      }
    }

    // 如果没有任何配置，创建默认配置（条目库全量 8 组 68 条，默认配置只引用「用户主体」12 条）。
    // 默认配置的 entry_id 必须取自已入 master_pool 的条目（同一数组派生），
    // 否则 buildAllPoolEntries 与 buildDefaultEntries 各自生成的 uuid 互不对应，引用成孤儿
    if (configs.length === 0) {
      const allEntries = buildAllPoolEntries();
      const defaultEntries = allEntries.filter(e => e.category === '用户主体');
      validated.master_pool = [...allEntries];
      configs.push({
        id: uuidv4(),
        name: '默认配置',
        entries: defaultEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          enabled: true,
        })),
        is_default: true,
        generation: GenerationSettings.parse({}),
      });
    }

    validated.configs = configs;

    // 清理旧字段
    delete (validated as any).pool;
    delete (validated as any).generation;
  }

  if ((validated.schema_version ?? 0) < 8) {
    try {
      const chatWI = chat_metadata?.[setting_field]?.world_info;
      if (chatWI && chatWI.enabled !== undefined) {
        validated.world_info = {
          ...validated.world_info,
          enabled: chatWI.enabled ?? true,
        };
      }
    } catch {
      // chat_metadata 不可用时跳过迁移，使用默认值
    }
  }

  if ((validated.schema_version ?? 0) < 10) {
    // 移除 pinned_follows_condition（条件改为 AI 判断）
    for (const cfg of validated.configs) {
      delete (cfg.generation as any).pinned_follows_condition;
    }
    // 填充 group_order：从现有条目的 category 去重后按字母排序
    if (!validated.group_order || validated.group_order.length === 0) {
      const cats = new Set<string>();
      for (const e of validated.master_pool) {
        if (e.category.trim()) cats.add(e.category.trim());
      }
      validated.group_order = [...cats].sort();
      // 「通用」是自主权锚点分组（含 pinned 必发条目），排首展示强调其主锚点地位；
      // 其余分组维持字母序。仅影响 group_order 为空的存档，不扰动用户既有排序
      const generalIdx = validated.group_order.indexOf('通用');
      if (generalIdx > 0) {
        validated.group_order.splice(generalIdx, 1);
        validated.group_order.unshift('通用');
      }
    }
  }

  if ((validated.schema_version ?? 0) < 13) {
    // v13: 对已迁移但池为空的用户，补建完整条目库和只引用「用户主体」的默认配置
    if (validated.master_pool.length === 0 && validated.configs.length === 0) {
      const allEntries = buildAllPoolEntries();
      const defaultEntries = allEntries.filter(e => e.category === '用户主体');
      validated.master_pool = [...allEntries];
      validated.configs = [
        {
          id: uuidv4(),
          name: '默认配置',
          entries: defaultEntries.map(e => ({
            entry_id: e.id,
            pinned: e.pinned,
            weight: e.weight,
            enabled: true,
          })),
          is_default: true,
          generation: GenerationSettings.parse({}),
        },
      ];
    }
  }

  // v18: 旧 theme 字段迁移到 theme_mode
  if ((validated.schema_version ?? 0) < 18) {
    const oldTheme = (validated.ui as any).theme;
    if (oldTheme && (validated.ui as any).theme_mode === undefined) {
      (validated.ui as any).theme_mode = oldTheme;
    }
  }

  // 提示词文本迁移执行器：精确子串替换、幂等，匹配不到即跳过（更早版本措辞不同的
  // 旧文本保留原样，指令惰性失效，见 PROMPT_TEXT_MIGRATIONS 注释）。
  // v21 与 v23 两个迁移块共用同一数组：老存档在 <21 块收敛到 v21 态后，<23 块继续
  // 应用 v23 对；v21/v22 存档跳过 <21 块、直接在 <23 块命中 v23 对——数组按序幂等
  const migratePromptText = (text: string): string => {
    let out = text;
    for (const [from, to] of PROMPT_TEXT_MIGRATIONS) {
      if (out.includes(from)) out = out.split(from).join(to);
    }
    return out;
  };

  // 提示词文本批量迁移：v21~v28 各版本块对 modules 内容做 migratePromptText。
  // person_style/option_rules 已随"提示词降复杂化"从 schema 移除，不再迁移。
  const migrateAllPromptText = (validated: GlobalSettingsType) => {
    for (const m of validated.prompt_rules.modules) {
      m.content = migratePromptText(m.content);
    }
    for (const cfg of validated.prompt_configs) {
      for (const m of cfg.modules) {
        m.content = migratePromptText(m.content);
      }
    }
  };

  // v20/v21 提示词文本迁移：v20 删除 condition 字段后 [条件: xxx] 标记不再生成，老存档
  // 引用该标记的段落改写为 [规则] 语义；v21 进一步确立规则=纯写作约束，把 v20 产出的
  // "适用时机不符则跳过"措辞收敛为约束措辞。
  if ((validated.schema_version ?? 0) < 21) {
    // 迁移覆盖 prompt_rules 与所有 prompt_configs 的 modules，避免切换配置后旧文本复活
    migrateAllPromptText(validated);
  }

  // v22: 新增「时间跳跃」分组（6 条特色条目）。已有存档按 type 去重后补入 master_pool，
  // 并把引用追加进默认配置——只动默认配置：其他 PoolConfig 是用户显式挑选的结果，
  // 擅自往里塞条目等于改用户配置；用户想在别的配置启用可自行到条目库勾选。
  // group_order 末尾补新分组名，不打乱用户既有排序
  if ((validated.schema_version ?? 0) < 22) {
    const existingTypes = new Set(validated.master_pool.map(e => e.type));
    const jumpEntries = buildTimeJumpEntries().filter(e => !existingTypes.has(e.type));
    if (jumpEntries.length > 0) {
      validated.master_pool.push(...jumpEntries);
      const defaultConfig = validated.configs.find(c => c.is_default);
      if (defaultConfig) {
        for (const e of jumpEntries) {
          defaultConfig.entries.push({ entry_id: e.id, pinned: e.pinned, weight: e.weight, enabled: true });
        }
      }
      if (!validated.group_order.includes('时间跳跃')) {
        validated.group_order.push('时间跳跃');
      }
    }
  }

  // v23: 选项生成"去死板"改造——三件事，全部幂等：
  // ① 提示词文本迁移：v23 对（去除小说腔文风强制/加 emoji/思维链框架/菜单模式措辞）
  //    把 v21/v22 时代的默认文本收敛到新态。person_style 此前从未被文本迁移覆盖，
  //    本版起一并纳入（旧默认文本是小说腔源头，漏掉它用户存档里死板文风不会消失）
  // ② 字数迁移：option_min/max_chars 未自定义（30/80）→ 10/60，下限 30 是注水成
  //    描写句的直接原因之一；自定义过则不动
  // ③ 池迁移：默认 config 引用切换为「通用4 + 时间跳跃6」——追加「通用」分组 4 条
  //    （2 条 pinned 作每轮必发的自主权锚点），移除旧 10 条具体行为条目的引用
  //    （条目保留在 master_pool，用户可手动加回）。只动默认 config：
  //    其他 PoolConfig 是用户显式挑选的结果，擅自增删等于改用户配置
  if ((validated.schema_version ?? 0) < 23) {
    // ① 提示词文本
    migrateAllPromptText(validated);
    // ② 字数默认值（仅未自定义时）
    const migrateCharLimit = (min: unknown, max: unknown): { min: number; max: number } | null => {
      if (min === 30 && max === 80) return { min: 10, max: 60 };
      return null;
    };
    const prLimits = migrateCharLimit(validated.prompt_rules.option_min_chars, validated.prompt_rules.option_max_chars);
    if (prLimits) {
      validated.prompt_rules.option_min_chars = prLimits.min;
      validated.prompt_rules.option_max_chars = prLimits.max;
    }
    for (const cfg of validated.prompt_configs) {
      const cfgLimits = migrateCharLimit(cfg.option_min_chars, cfg.option_max_chars);
      if (cfgLimits) {
        cfg.option_min_chars = cfgLimits.min;
        cfg.option_max_chars = cfgLimits.max;
      }
    }
    // ③ 池迁移：追加「通用」分组 → 移除旧 10 条引用（两步集合不重叠，顺序无干扰）。
    //    引用移除不能挂在"有新条目可追加"的条件下：用户可能早已自建同名 type 条目
    //    （generalEntries 为空），此时旧 10 条引用仍需切换，否则迁移半途而废
    const existingTypes = new Set(validated.master_pool.map(e => e.type));
    const generalEntries = buildGeneralEntries().filter(e => !existingTypes.has(e.type));
    validated.master_pool.push(...generalEntries);
    const defaultConfig = validated.configs.find(c => c.is_default);
    if (defaultConfig) {
      for (const e of generalEntries) {
        defaultConfig.entries.push({ entry_id: e.id, pinned: e.pinned, weight: e.weight, enabled: true });
      }
      // 移除旧 10 条的引用：entry_id → master_pool type 反查，type 属旧默认集合即移除。
      // 不删 master_pool 条目本身——用户自定义 config 里的引用与其他用途不受影响
      const legacyIds = new Set(
        validated.master_pool.filter(e => LEGACY_DEFAULT_ENTRY_TYPES.has(e.type)).map(e => e.id),
      );
      defaultConfig.entries = defaultConfig.entries.filter(e => !legacyIds.has(e.entry_id));
    }
    if (!validated.group_order.includes('通用')) {
      validated.group_order.push('通用');
    }
  }

  // v24: 猫娘人格化（喵可）迁移——两件事，全部幂等：
  // ① 提示词文本迁移：v24 对把 v23 默认文本收敛到猫娘版（system_prompt/思考链/应答/
  //    user 指令/规则/规格全面转喵可口吻 + ST 术语描述性清洗 + 活人感硬约束）。
  //    person_style 本版不改，跑一遍幂等无害
  // ② 新增 reward_prompt 模块补建：老存档 prompt_rules.modules 无此模块（v24 新增），
  //    按 id 去重后从 DEFAULT_MODULES 取对象插入——prompt_rules.modules 与每个
  //    prompt_configs[].modules 都要补（配置切换时换入的是 configs 的模块快照，
  //    漏掉 configs 会导致"切换提示词配置后奖励模块消失"）
  if ((validated.schema_version ?? 0) < 24) {
    // ① 提示词文本
    migrateAllPromptText(validated);
    // ② reward_prompt 模块补建（content 留空，运行时由 generator case 随机注入奖励文案）
    const ensureRewardModule = (modules: PromptModuleType[]): void => {
      if (modules.some(m => m.id === 'reward_prompt')) return;
      const template = DEFAULT_MODULES.find(m => m.id === 'reward_prompt');
      if (template) modules.push(klona(template));
    };
    ensureRewardModule(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) {
      ensureRewardModule(cfg.modules);
    }
  }

  // v25: 猫娘文本修正迁移——v24 落盘的猫娘版收敛到旁白式修正版，三件事，全部幂等：
  // ① 提示词文本迁移：v25 对（system 层去喵去【】转旁白式、user 层去【】、option_rules
  //    去喵、thinking/规格文本修正）。person_style 本版不改，跑一遍幂等无害
  // ② reward_prompt.content 填充：v24 补建时 DEFAULT_MODULES 里该模块 content 为空
  //    （文案当时藏在 REWARD_PHRASES 常量里），v25 起文案由 content 承载（用户可在
  //    提示词编辑器直接编辑）——存档里 content 为空的补上默认奖励池
  // ③ assistant_thinking.content 结构升级：v24 是单句回应+<thinking>，v25 改为多行回应池
  //    （与 reward_prompt 奖励池逐行配对）——该结构变化由 v25 文本迁移对完成
  if ((validated.schema_version ?? 0) < 25) {
    // ① 提示词文本
    migrateAllPromptText(validated);
    // ② reward_prompt.content 空则填默认奖励池（用户自己写过内容则不动）
    const ensureRewardContent = (modules: PromptModuleType[]): void => {
      const mod = modules.find(m => m.id === 'reward_prompt');
      const template = DEFAULT_MODULES.find(m => m.id === 'reward_prompt');
      if (mod && template && !mod.content.trim()) mod.content = klona(template.content);
    };
    ensureRewardContent(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) {
      ensureRewardContent(cfg.modules);
    }
  }

  // v26: 人称免疫——AI 跟着 <history> 正文的人称跑（正文第二人称则选项也"你"）。
  // 修：person_style 加回人称约束（{{option_person}} 变量）；thinking_prompt 加第 7 步
  // 人称校准 + 自检点名变量；CORE_RULES_STATIC 内容要求加人称免疫硬声明（代码常量直接改，
  // 不入存档，无迁移对）。person_style/thinking_prompt 是存档快照，走 PROMPT_TEXT_MIGRATIONS
  if ((validated.schema_version ?? 0) < 26) {
    migrateAllPromptText(validated);
  }

  // v27: 奖励文案去"小鱼干"——该梗已与其他预设撞车，换成"顺毛摸头"（呼应当时 system_prompt
  //    里"被摸头打呼噜"的人格设定）。reward_prompt/assistant_thinking 是存档快照，
  //    改 JSON 默认值触达不了老用户，必须走 PROMPT_TEXT_MIGRATIONS。
  //    原本的 ②「喵可」分组池迁移已随 v44 删除（人格中性化，喵可条目组不再下发；
  //    旧存档已落盘的喵可条目由 v44 迁移块按 category 清理）
  if ((validated.schema_version ?? 0) < 27) {
    migrateAllPromptText(validated);
  }

  // v28: 恢复直接引语对白——v23"去死板"重构删掉的"含对话选项必须『……』直接引语"在
  // 喵可化后长期缺位，含对话选项全面滑向"说……""问道……"式转述。本版只做提示词文本迁移
  // （无池/结构变更）：option_rules 喵版/去喵两种 7 条各自插入"直接引语"第 2 条（存档
  // 其余措辞逐字保留）、thinking_prompt 自检行补对白检查、core_rules fallback 第 2 条补
  // 对白约束；CORE_RULES_STATIC 是代码常量直接改即生效，不入存档、无迁移对（同 v26
  // 人称免疫先例）。喵可人设模块（system_prompt/应答/user 指令/奖励文案）本版零改动
  if ((validated.schema_version ?? 0) < 28) {
    migrateAllPromptText(validated);
  }

  // v29: 润色提示词喵可人设适配——enrich_assistant 起手式喵可化、enrich_thinking 补人称校准与直接引语检查
  // 与 v28 同构：仅跑模块内容文本迁移，无池/结构变更
  if ((validated.schema_version ?? 0) < 29) {
    migrateAllPromptText(validated);
  }

  // v30: 新增「NSFW」分组（10 条成人向方向条目，覆盖主动/被动/变换姿势/情趣四维）。
  // 与 v22「时间跳跃」/ v27「喵可」的关键差异：**只补入 master_pool，不追加进默认 config**——
  // NSFW 是 opt-in，条目库可见可选，但默认配置不引用，用户在「选择条目」里自行勾选启用。
  // v22/v27 往默认 config 塞引用是因那两组适合默认出场；NSFW 不应在用户未主动启用时混入
  // 每轮候选菜单。其余与 v22/v27 同构：按 type 去重防重复入池；迁移块的条目 id 是当场
  // 生成的 uuid，只能当场 push（无法预生成后跨块引用，故默认 config 不引用也不需引用）。
  // group_order 末尾补新分组名，不打乱用户既有排序
  if ((validated.schema_version ?? 0) < 30) {
    const existingTypes = new Set(validated.master_pool.map(e => e.type));
    const nsfwEntries = buildNsfwEntries().filter(e => !existingTypes.has(e.type));
    validated.master_pool.push(...nsfwEntries);
    if (!validated.group_order.includes('NSFW')) {
      validated.group_order.push('NSFW');
    }
  }

  // v31~v34 的「全向」相关迁移块已随 v44 删除（轻型默认预设重构移除全向模式：
  // 建配置/补标记/去重自愈/修字数四块对全向已无意义，全向配置与条目由 v44 迁移块统一清理）。

  // v35: 配置彻底解耦为"独立模块"——条目池配置只管条目引用、提示词配置只管提示词文本
  // （modules/person_style/option_rules），人称/字数/轮数/预填充/柏宝书/抽取参数全部收归全局。
  // 两步自愈，把历史耦合期被改写的用户值还原：
  // ① 抽取参数全局化：根字段 settings.generation（分组抽取/打乱/固定溢出/冗余比例）从默认
  //    条目池配置的 generation 快照播种——历史上生成设置页冗余比例读生效池配置，切池配置
  //    即跳变；generator 与生成设置页已改读全局。
  // ② 提示词全局字段还原：从默认提示词配置快照把人称/字数/轮数/预填充/柏宝书抄回
  //    prompt_rules——历史上切换提示词配置全量换入这些字段，用户自定义润色字数被洗成 30/80、
  //    人称跟着跳变。默认提示词配置的快照是用户真实值的可靠来源：切换链路只会把 pr 写回
  //    "正在离开的配置"，离开简洁时 pr 必为简洁自己的值，故简洁快照从未被污染。
  // 已知局限：若用户停留在默认提示词配置上改过这些字段且从未切换离开过，简洁快照落后于
  // pr，本 heal 会回退那次未同步的编辑——属可接受代价（切配置的连带污染远高频，且字段
  // 现已全局化，用户改回一次即永久生效）。幂等：v35 只跑一次（schema_version 守卫）。
  if ((validated.schema_version ?? 0) < 35) {
    // ① 全局抽取参数播种（无任何池配置的极端态回退 schema 默认）
    const defPool = validated.configs.find(c => c.is_default) ?? validated.configs[0] ?? null;
    validated.generation = defPool ? klona(defPool.generation) : GenerationSettings.parse({});

    // ② 提示词全局字段还原
    const defPrompt = validated.prompt_configs.find(c => c.is_default);
    if (defPrompt) {
      const pr35 = validated.prompt_rules;
      pr35.option_person = defPrompt.option_person;
      pr35.enrich_person = defPrompt.enrich_person;
      pr35.enrich_person_style = defPrompt.enrich_person_style;
      pr35.option_min_chars = defPrompt.option_min_chars;
      pr35.option_max_chars = defPrompt.option_max_chars;
      pr35.enrich_min_chars = defPrompt.enrich_min_chars;
      pr35.enrich_max_chars = defPrompt.enrich_max_chars;
      pr35.context_rounds = defPrompt.context_rounds;
      pr35.context_mode = defPrompt.context_mode;
      pr35.prefill_enabled = defPrompt.prefill_enabled;
      pr35.baibai_enabled = defPrompt.baibai_enabled;
      pr35.shujuku_enabled = defPrompt.shujuku_enabled;
    }
  }

  // v36: 修复模块 order 漂移。v29（b2f8abc6）结构性重编号了 DEFAULT_MODULES 的 order
  // （reward_prompt 19.5→23、assistant_thinking 20→24、enrich 自检/规格模块各 -1、
  // enrich_assistant 24→25），意图让 reward_prompt 紧贴两个 <thinking> 预填模块之上、
  // 三者居列表底部。但 v29 迁移块只跑文本迁移（migrateAllPromptText），从不重排 order；
  // 而 resetOrderFromDefaults 只在 migratePromptModules 内、受 prompt_rules.schema_version<17
  // 守卫——已到 v17 的老用户永远不再被重排，且它只碰 prompt_rules.modules（工作副本）、
  // 从不碰 prompt_configs[].modules（快照）。与此同时 v24 ensureRewardModule 用「当前」
  // DEFAULT 的 order 把 reward_prompt 补进各配置，而同配置里 assistant_thinking 仍冻在旧
  // order 20，于是 reward_prompt(23) 反落 assistant_thinking(20) 下方。enrich_only 模块被
  // 隐藏时（选项模式/关润色，见 PromptEditor.vue:395）enrich_assistant 不显示，reward_prompt
  // 即成可见最底层。本块一次性把工作副本与所有配置快照的 order 按 id 对齐当前 DEFAULT，
  // 既消此反转，也顺带收敛其余历史漂移。幂等：对齐到 DEFAULT 多次执行结果一致；<36 守卫
  // 只跑一次；用户自建模块（id 不在 DEFAULT）order 不动
  if ((validated.schema_version ?? 0) < 36) {
    resyncModuleOrders(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) {
      resyncModuleOrders(cfg.modules);
    }
  }

  // v37: 加强场景思考（thinking_prompt step1 场景盘点 + step5→6 反八股/情绪禁区 +
  // self-check 八股/极端自检）+ 反八股/极端情绪禁令（option_rules 去喵 8/7 条 + 喵 8 条
  // 仅跑文本迁移，无池/结构变更。与 v21~v29 各文本迁移块同构，
  // migrateAllPromptText 覆盖 prompt_rules + 所有 prompt_configs 的 modules。
  // thinking 喵版已由 v25 对收敛为去喵，v37 对 from 均为去喵当前文本，无需喵版 thinking 对。
  if ((validated.schema_version ?? 0) < 37) {
    migrateAllPromptText(validated);
  }

  // v38: 世界书深度条目不再织入历史中段（与对白交织会污染 <history> 内容），改迁到
  // <history> 标签之外：depth ≤ 2（D0/D1/D2）→ </history> 之后、depth ≥ 3 → <history> 之前。
  // 新增两个只读 marker 模块（wi_depth_before / wi_depth_after）承载注入点。老存档的
  // 工作副本 prompt_rules.modules 与每个 prompt_configs[].modules 快照都需按 id 去重补建
  // （配置切换换入的是 configs 的模块快照，漏掉 configs 会导致切换后注入点消失，同 v24
  // reward_prompt 先例）。补建后 resyncModuleOrders 把 order 对齐当前 DEFAULT（本版把
  // history_open 起的尾部 +1/+2 重编号以插入两个 marker）。用户自建模块（id 不在 DEFAULT）
  // order 不动。幂等：去重 push + 按 id 对齐 order 多次执行结果一致
  if ((validated.schema_version ?? 0) < 38) {
    const DEPTH_MODULE_IDS = new Set(['wi_depth_before', 'wi_depth_after']);
    const ensureDepthModule = (modules: PromptModuleType[]): void => {
      const have = new Set(modules.map(m => m.id));
      for (const d of klona(DEFAULT_MODULES)) {
        if (DEPTH_MODULE_IDS.has(d.id) && !have.has(d.id)) modules.push(d);
      }
    };
    ensureDepthModule(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) ensureDepthModule(cfg.modules);
    resyncModuleOrders(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) resyncModuleOrders(cfg.modules);
  }

  // v39：提示词链路重组（删除 <history> 分体标签、user_instruction 改为导航地图、
  // 原任务后移到 option_task、默认历史改 rounds/8 轮、thinking 补反重复自检）。
  // 工作副本 prompt_rules.modules 与每个 prompt_configs[].modules 快照都需同步处理。
  if ((validated.schema_version ?? 0) < 39) {
    const WRAPPER_IDS = new Set(['history_open', 'history_close']);
    const removeWrappers = (modules: PromptModuleType[]): void => {
      for (let i = modules.length - 1; i >= 0; i--) {
        if (WRAPPER_IDS.has(modules[i].id)) modules.splice(i, 1);
      }
    };
    removeWrappers(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) removeWrappers(cfg.modules);

    const ensureOptionTask = (modules: PromptModuleType[]): void => {
      if (modules.some(m => m.id === 'option_task')) return;
      modules.push({
        id: 'option_task',
        name: '生成任务',
        role: 'user',
        content: OPTION_TASK_DEFAULT,
        marker: false,
        system: false,
        enabled: true,
        order: 18,
        enrich_only: false,
        option_only: true,
      });
    };
    ensureOptionTask(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) ensureOptionTask(cfg.modules);

    const moveUserInstruction = (modules: PromptModuleType[]): void => {
      const ui = modules.find(m => m.id === 'user_instruction');
      if (!ui || ui.content === USER_INSTRUCTION_GUIDE) return; // 已迁移或不存在
      const oldContent = ui.content;
      const isDefaultTask = oldContent === LEGACY_USER_INSTRUCTION_TASK || oldContent === USER_INSTRUCTION_DEFAULT;
      const ot = modules.find(m => m.id === 'option_task');
      if (ot && !isDefaultTask) {
        ot.content = oldContent; // 定制用户：保留旧任务文本
      }
      ui.content = USER_INSTRUCTION_GUIDE;
    };
    moveUserInstruction(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) moveUserInstruction(cfg.modules);

    if (validated.prompt_rules.context_mode === 'visible_only') {
      validated.prompt_rules.context_mode = 'rounds';
      validated.prompt_rules.context_rounds = validated.prompt_rules.context_rounds ?? 8;
    }
    for (const cfg of validated.prompt_configs) {
      if (cfg.context_mode === 'visible_only') {
        cfg.context_mode = 'rounds';
        cfg.context_rounds = cfg.context_rounds ?? 8;
      }
    }

    migrateAllPromptText(validated);
    resyncModuleOrders(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) resyncModuleOrders(cfg.modules);
  }

  // v19 的提示词配置创建已移出本函数：分流逻辑（老存档建经典+简洁 / 全新档仅简洁）
  // 依赖"是否存在旧存档"这一信息，只有 store 初始化流程知道，见 init 中 wasPreV19 分支

  // v41：提示词预设质量升级——输出契约前置 / 越界熔断 / 思考优先级链 / 刚性自检 /
  // 输出纯净度保险 / option_task 瘦身去冗余 / enrich 分支规则与字数兜底。仅升级"内容仍与
  // v40 默认逐字一致"的模块（精确子串匹配命中才替换），用户自定义过的模块 from 匹配不到、
  // 原样保留。刻意不复用共享 PROMPT_TEXT_MIGRATIONS：本版多为"前插/后插"式叠加，to 含 from，
  // 若走共享数组会被 v21~v39 各块重复执行导致契约/优先级链重复插入；改用本块独占的 V41_PAIRS，
  // 仅在 schema_version<41 守卫内跑一次（守卫即幂等保证：升级后 schema=41，下次加载跳过本块）。
  // 覆盖工作副本 prompt_rules.modules + 所有 prompt_configs[].modules 快照。全向配置的
  // system_prompt/thinking_prompt 与默认共享开头/结尾，共享对一并命中；全向独有的 user_instruction
  // 瘦身与 thinking 自检刚性化走专属对。enrich/option_task/output_spec 在全向配置里是默认副本，
  // 默认对同样命中。core_rules 走模块内容，随 modules 一并迁移。
  if ((validated.schema_version ?? 0) < 41) {
    const V41_PAIRS: ReadonlyArray<readonly [string, string]> = [
      // ① system_prompt 输出契约前置（默认 + 全向共享开头，一并命中）
      [
        '你是「喵可」，一只活泼好动、爱凑热闹的小猫娘。主人是 {{user}}——你的全世界只有主人一个：被主人摸头会开心到打呼噜，主人顾不上你时会落寞地耷拉耳朵，可只要主人在，你就满血复活。',
        '[输出契约] 本轮你只产出两种结构化产物之一：行动选项（<thinking> 分析块 + <options> 选项块），或输入润色版本（<thinking> + <options>）。两种标签之外的任何文字——闲聊、解释、致歉、正文续写、角色扮演——都视为越界，立刻停止。\n\n你是「喵可」，一只活泼好动、爱凑热闹的小猫娘。主人是 {{user}}——你的全世界只有主人一个：被主人摸头会开心到打呼噜，主人顾不上你时会落寞地耷拉耳朵，可只要主人在，你就满血复活。',
      ],
      // ② system_prompt 越界熔断后置（默认 + 全向共享结尾，一并命中）
      [
        '无论哪种任务，都要严格遵守后续系统消息里的格式与内容规则，选项之外一个多余的字都不许有。',
        '无论哪种任务，都要严格遵守后续系统消息里的格式与内容规则，选项之外一个多余的字都不许有。\n\n[越界熔断] 若你发现自己开始扮演故事里的角色、续写正文段落、或在 <options> 之外输出内容，立即停止当前方向，回到只产出 <thinking> 与 <options> 的轨道；无法回到轨道时，输出 <options> 生成失败 </options> 并结束，绝不勉强续写。',
      ],
      // ③ thinking_prompt 优先级链前置（默认 + 全向共享开头，一并命中）
      [
        '第一行用引号复述这轮的关键输入（条目数与场景要点），确认没看漏。然后按下面的框架想，每步一两句给结论就好，别写成散文：',
        '第一行用引号复述这轮的关键输入（条目数与场景要点），确认没看漏。\n\n思考冲突时的裁决优先级（由高到低，前者压倒后者）：\n- 当前场景的具体钩子 > 题材套路与经典桥段\n- 用户设置的人称（{{option_person}}）> 上方正文历史用过的人称\n- 条目 [规则] 的写作约束 > 你对「更有趣」的个人偏好\n- 固定条目必须全含 > 候选池取舍自由\n- 输出格式硬约束 > 内容丰富度\n\n然后按下面的框架想，每步一两句给结论就好，别写成散文：',
      ],
      // ④ 默认 thinking_prompt 自检刚性化（默认独有结尾）
      [
        '最后自检：数量等于 {{count}}？每条都是此刻能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？人称是否就是 {{option_person}}、没跟着正文跑？含对话的选项是否都用了『……』直接引语、没有转述概括？有没有八股套话、或带掌控/占有/臣服式极端情绪的选项？有没有复述前文已经发生过的动作、或与上一轮选项撞方向换皮？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话？\n自检过了就直接进 <options> 输出。',
        '最后逐项自检（每项答「是」或「否」，答「否」的说明原因并修正）：\n[MUST] 数量恰好等于 {{count}}？\n[MUST] 每条都是此刻能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间？\n[MUST] 人称即 {{option_person}}，未被正文历史人称带偏？\n[MUST] 含对话的选项对白均为『……』直接引语、无转述概括？\n[MUST NOT] 出现八股套话，或掌控/占有/臣服式极端情绪话语？\n[MUST NOT] 复述前文已发生的动作，或与上一轮选项撞方向换皮？\n[MUST] "[标题]内容"格式与 emoji 位置正确，<options> 外无多余废话？\n七项全过则进 <options> 输出；任一项未过，先在 <thinking> 内说明如何修正，再输出。',
      ],
      // ⑤ 全向 thinking_prompt 自检刚性化（全向独有结尾，含主体一致性项）
      [
        '最后自检：数量等于 {{count}}？每条都是此刻剧情里能成立的具体动作/事件、字数在 {{min_chars}}-{{max_chars}} 之间（以用户设置为准）？主语是否跟条目的聚焦方向一致？含对话的选项是否都用了『……』直接引语、没有转述概括？有没有八股套话、或带掌控/占有/臣服式极端情绪的选项？有没有复述前文已经发生过的动作、或与上一轮选项撞方向换皮？"[标题]内容"格式和 emoji 位置对不对、选项外没多余废话？\n自检过了就直接进 <options> 输出。',
        '最后逐项自检（每项答「是」或「否」，答「否」的说明原因并修正）：\n[MUST] 数量恰好等于 {{count}}？\n[MUST] 每条都是此刻剧情里能成立的具体动作/事件、字数在 {{min_chars}}-{{max_chars}} 之间？\n[MUST] 主语与条目的聚焦方向一致？\n[MUST] 人称即 {{option_person}}，未被正文历史人称带偏？\n[MUST] 含对话的选项对白均为『……』直接引语、无转述概括？\n[MUST NOT] 出现八股套话，或掌控/占有/臣服式极端情绪话语？\n[MUST NOT] 复述前文已发生的动作，或与上一轮选项撞方向换皮？\n[MUST] "[标题]内容"格式与 emoji 位置正确，<options> 外无多余废话？\n八项全过则进 <options> 输出；任一项未过，先在 <thinking> 内说明如何修正，再输出。',
      ],
      // ⑥ output_spec 纯净度保险后置（默认 + 全向副本，一并命中）
      [
        '输出结构：先完整的 <thinking> 分析块，再 <options> 选项块（每个选项独占一行），两者之外不许有任何字。',
        '输出结构：先完整的 <thinking> 分析块，再 <options> 选项块（每个选项独占一行），两者之外不许有任何字。\n输出纯净度保险：即使 <thinking> 内的分析触发了别的输出冲动（解释、致歉、正文续写、变量占位符 {{xxx}}、额外标签），也只在 <options> 关闭后立即停止，</options> 之后一字不写；若发现自己已在输出越界内容，立即截断并以 <options> 收尾，绝不补写。',
      ],
      // ⑦ option_task 瘦身（默认 + 全向副本，一并命中）：整段替换去冗余要求清单
      [
        '下面这几条是这一轮必须全部用上的（带 [规则: xxx] 的按它的写作约束来）：\n{{pinned}}\n\n这个池子里的比需要的多，你从中挑最贴合当下场景的方向（带 [规则: xxx] 标记的，选用了就守它的写作约束）：\n{{pool_selected}}\n\n上一轮已经生成过这些选项，这轮别跟它们撞方向或换皮重复（如为空就跳过这段）：\n{{prev_options}}\n\n主人交代的要求：\n0. 以 <current_scene> 标签里的最新消息为准：选项必须是这场景此刻能干的具体行动，每条得点名一个具体可见钩子（道具/NPC状态/台词），禁用"利用环境"这类泛词，别凭空蹦到之前的剧情节点，也别复述前文已经发生过的动作。\n1. {{count}} 条选项在切入点、行动方式、情绪色彩、语域上得有明显差异，禁止换皮同质；每轮允许 0-1 条「不行动/撤离/改话题」选项。\n2. 每条选项由"标题"与"内容"组成，格式字数见系统规则；内容开头可用一个 emoji 表达情绪或意图（可选）。\n3. 候选条目比需要多：你挑最贴合当下场景的方向，每条候选至多用一次，最终生成恰好 {{count}} 条（固定条目必须全含）；要是候选方向都跟场景冲突，可以自己补贴合场景的，但优先用候选池。\n4. 输出顺序固定：先完整的 <thinking> 分析块，再 <options> 选项块，两者之外不许有别的字。\n5. <options> 内每行一条，条数必须和 {{count}} 一致。',
        '这一轮的素材（按主人的话办）：\n固定条目（必须全部用上；带 [规则: xxx] 的守其写作约束）：\n{{pinned}}\n候选条目池（比需要的多，挑最贴合当下场景的方向；带 [规则: xxx] 的选用了就守）：\n{{pool_selected}}\n上一轮已生成过的选项（这轮别撞方向或换皮重复；为空就跳过这段）：\n{{prev_options}}\n\n数量硬约束：最终恰好 {{count}} 条，固定条目全含、候选每条至多用一次；候选方向都跟场景冲突时可自行补贴贴合场景的，但优先用候选池。其余场景钩子、格式、人称、自检规则见前面的系统消息，这里不重复。',
      ],
      // ⑧ 全向 user_instruction 瘦身（全向独有：保留主体跟随，去冗余要求清单）
      [
        '下面这几条是这一轮必须全部用上的（如列表为空就跳过这段；带 [规则: xxx] 的按它的写作约束来）：\n{{pinned}}\n\n这个池子里的比需要的多，你从中挑最贴合当下场景的方向（带 [规则: xxx] 标记的，选用了就守它的写作约束）：\n{{pool_selected}}\n\n主人交代的要求：\n0. 以 <current_scene> 标签里的最新消息为准：选项必须是此刻在剧情里能成立的具体动作或事件，每条得点名一个具体可见钩子（道具/NPC状态/台词），禁用"利用环境"这类泛词，别凭空蹦到之前的剧情节点。\n1. 候选条目各自指定了聚焦方向：聚焦 user 的写成 {{user}} 的行动，聚焦角色（{{char}} 或在场角色）的直接以该角色为主语写其行动，剧情演化/规划类的写成事件、环境与走向的安排，关系/日常类的围绕双方关系或松弛日常展开；没有聚焦指向的条目，就挑最能让场景活起来的主体。\n2. {{count}} 条选项在主体、切入点、行动方式、情绪色彩、语域上得有明显差异，禁止换皮同质；每轮允许 0-1 条「不行动/撤离/改话题」选项。\n3. 每条选项由"标题"与"内容"组成，格式字数见系统规则；内容开头可用一个 emoji 表达情绪或意图（可选）。\n4. 候选条目比需要多：你挑最贴合当下场景的方向，每条候选至多用一次，最终生成恰好 {{count}} 条（固定条目必须全含）；要是候选方向都跟场景冲突，可以自己补贴合场景的，但优先用候选池。\n5. 输出顺序固定：先完整的 <thinking> 分析块，再 <options> 选项块，两者之外不许有别的字。\n6. <options> 内每行一条，条数必须和 {{count}} 一致。',
        '这一轮的素材（按主人的话办）：\n固定条目（如列表为空就跳过这段；带 [规则: xxx] 的守其写作约束）：\n{{pinned}}\n候选条目池（比需要的多，挑最贴合当下场景的方向；带 [规则: xxx] 的选用了就守）：\n{{pool_selected}}\n\n主体跟随：候选条目各自指定了聚焦方向——聚焦 user 的写成 {{user}} 的行动，聚焦角色（{{char}} 或在场角色）的直接以该角色为主语写其行动，剧情演化/规划类的写成事件、环境与走向的安排，关系/日常类的围绕双方关系或松弛日常展开；没有聚焦指向的条目，就挑最能让场景活起来的主体。\n\n数量硬约束：最终恰好 {{count}} 条，固定条目全含、候选每条至多用一次；候选方向都跟场景冲突时可自行补贴贴合场景的，但优先用候选池。其余场景钩子、格式、人称、自检规则见前面的系统消息，这里不重复。',
      ],
      // ⑨ enrich_core_rules 分支规则与字数兜底（默认 + 全向副本）
      [
        '【润色规则】\n1. 保留原文语义和语气，用不同措辞重新表达。\n2. 对白保持直接引语形式，但内容应润色扩展，严禁原样照搬。\n3. 每个版本字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。\n4. 格式要求见【润色输出规格】。',
        '【润色规则】\n1. 保留原文语义和语气，用不同措辞重新表达；扩展而非堆砌，生动而非空泛。\n2. 对白润色：原文含对白时，保留直接引语形式，但内容须润色扩展——补足神态、动作、语气使对白更立体，严禁原样照搬；纯叙述润色：原文为叙述时，改写措辞与句式，可适度补充感官或环境细节，但不擅自新增原文没有的事件或人物行动。\n3. 每个版本字数控制在 {{min_chars}}-{{max_chars}} 个中文字符之间；版本之间在描写方式、措辞风格上应有明显差异，避免全部雷同。\n4. 字数兜底：若某版本润色后字数不足下限，补充贴合语境的细节描写使其达标；若超过上限，删减枝蔓修饰保留核心语义，不得用空话凑数或硬截断破坏句子完整。\n5. 格式要求见【润色输出规格】。',
      ],
      // ⑩ enrich_thinking 分支识别自检（默认 + 全向副本）
      [
        '1. 版本数量是否等于 {{count}}？\n2. 格式是否为"[标题]内容"？内容中是否误用了[]符号？\n3. 每个版本字数是否在 {{min_chars}}-{{max_chars}} 个中文字符之间？\n4. 人称校准：润色后的人称只服从用户设置（{{enrich_person}}）。上方 <history> 正文用的人称是那篇小说自己的叙事选择，跟润色无关——不管正文用什么人称，润色一律按 {{enrich_person}} 写，不许被正文带偏。\n5. 直接引语：含对话的润色版本，对白必须以『……』完整给出、可直接朗读，禁止"说……""说道……"式转述概括；纯叙述版本不强制。\n完成以上自检并确认通过后，再执行润色。',
        '1. 版本数量是否等于 {{count}}？版本之间在措辞风格上是否有明显差异？\n2. 格式是否为"[标题]内容"？内容中是否误用了[]符号？\n3. 每个版本字数是否在 {{min_chars}}-{{max_chars}} 个中文字符之间？不足或超限的，按字数兜底策略处理。\n4. 分支识别：原文是对白为主还是叙述为主？对白版本是否补足了神态动作语气、未原样照搬？叙述版本是否只改写措辞、未擅自新增事件？\n5. 人称校准：润色后的人称只服从用户设置（{{enrich_person}}）。上方 <history> 正文用的人称是那篇小说自己的叙事选择，跟润色无关——不管正文用什么人称，润色一律按 {{enrich_person}} 写，不许被正文带偏。\n6. 直接引语：含对话的润色版本，对白必须以『……』完整给出、可直接朗读，禁止"说……""说道……"式转述概括；纯叙述版本不强制。\n完成以上自检并确认通过后，再执行润色。',
      ],
      // ⑪ enrich_output_spec 纯净度保险后置（默认 + 全向副本）
      [
        '输出结构：\n1. 先输出完整的 <thinking> 分析块\n2. 再输出 <options> 选项块，每个版本独占一行\n3. 两者之外不得有任何文字',
        '输出结构：\n1. 先输出完整的 <thinking> 分析块\n2. 再输出 <options> 选项块，每个版本独占一行\n3. 两者之外不得有任何文字\n\n输出纯净度保险：即使 <thinking> 内的分析触发了别的输出冲动（解释、致歉、正文续写、变量占位符 {{xxx}}、额外标签），也只在 <options> 关闭后立即停止，</options> 之后一字不写；若发现自己已在输出越界内容，立即截断并以 <options> 收尾，绝不补写。',
      ],
    ];
    const migrateV41Text = (text: string): string => {
      let out = text;
      for (const [from, to] of V41_PAIRS) {
        if (out.includes(from)) out = out.split(from).join(to);
      }
      return out;
    };
    for (const m of validated.prompt_rules.modules) {
      m.content = migrateV41Text(m.content);
    }
    for (const cfg of validated.prompt_configs) {
      for (const m of cfg.modules) {
        m.content = migrateV41Text(m.content);
      }
    }
  }

  // v42 迁移：移除上一轮选项注入段 + 强化场景锚定（默认 + 全向副本，一并命中）
  // 覆盖面同 v41：工作副本 prompt_rules.modules + 所有 prompt_configs[].modules 快照。
  // 若用户自定义过模块文本，精确匹配不命中则原样保留（不偷偷改写用户内容）。
  if ((validated.schema_version ?? 0) < 42) {
    const V42_PAIRS: ReadonlyArray<readonly [string, string]> = [
      // option_task 两个默认变体：剥离注入段
      ['上一轮已生成过的选项（这轮别撞方向或换皮重复；为空就跳过这段）：\n{{prev_options}}\n\n', ''],
      ['上一轮已经生成过这些选项，这轮别跟它们撞方向或换皮重复（如为空就跳过这段）：\n{{prev_options}}\n\n', ''],
      // thinking 自检四处变体（默认/全向、新旧句式）：上下文已不可见上一轮选项，交由后置去重
      ['、或与上一轮选项撞方向换皮', ''],
      // 场景锚定强化（thinking 步骤 1 收尾句，源串见 src/type/settings.ts STEP1_EXTENSION）
      [
        '顺着这个场景推一步——接下来怎样走最自然合理。',
        '顺着场景推演：先辨认角色最新一条行为、对白、动作与场景交互各自抛出了什么，再推演 {{user}} 此刻能够做出的最合理回应——选项就是这次推演的落点，只锚定当下，不回跳旧剧情节点。',
      ],
    ];
    const migrateV42Text = (text: string): string => {
      let out = text;
      for (const [from, to] of V42_PAIRS) {
        if (out.includes(from)) out = out.split(from).join(to);
      }
      return out;
    };
    for (const m of validated.prompt_rules.modules) {
      m.content = migrateV42Text(m.content);
    }
    for (const cfg of validated.prompt_configs) {
      for (const m of cfg.modules) {
        m.content = migrateV42Text(m.content);
      }
    }
  }

  // v43 迁移：高级功能开关（纯 UI 分层）。老档一律置 true——存量用户已在用全量 tab，
  // 升级必须零行为变化（收走在用的 tab 比多显示几个更糟）；简化模式只面向全新档
  // （走 UISettings 的 zod default(false)）。
  // 老档判据不能只看 schema_version：全新首载 parse 出的 default 同样是 0，也会进本迁移链
  // （needsMigration 对 schema_version=0 恒真）。以 extension_settings 里是否已存在本扩展
  // 的原始存档区分"老档升级"与"全新首载"——此时 validated 尚未回写，原始存档仍是旧貌。
  if ((validated.schema_version ?? 0) < 43) {
    const rawSave: unknown = _.get(extension_settings, setting_field);
    if (rawSave != null && typeof rawSave === 'object') {
      validated.ui.advanced_features_enabled = true;
    }
  }

  // v44：轻型默认预设重构——全向移除 + 提示词中性化/重组 + 深度模块锁复制 + 六个可选规则模块。
  // 四步全部幂等，照 v38/v39/v41 的既有模式：
  // ① 删「全向」三件套（6 组 18 条条目 + 全向池配置 + 全向提示词配置）与「喵可」分组 4 条，
  //    chat/character 绑定重绑回默认配置（rebindConfigId/rebindPromptConfigId，模式照抄 v33 块）
  // ② 删 user_instruction/output_spec/reward_prompt 三个模块 id（模式照抄 v39 removeWrappers）；
  //    （「补建六个内置可选规则模块 opt_*」原为 P2 规划，未实现——JSON 默认模块无 opt_*，
  //     本版本不补建，勿按注释意会成已完成）
  // ③ 默认文本中性化（内容 === v43 默认逐字才替换——用户自定义文本不动，同 v41/v42 原则）；
  //    ③' 模块改名（默认名精确匹配才改，自定义名不动），纯显示层，不影响 id/解析
  // ④ resyncModuleOrders 对齐新 DEFAULT order（含删模块后的重编号）
  if ((validated.schema_version ?? 0) < 44) {
    // ── ① 删全向三件套 + 喵可组 ──
    // 全向 6 组与喵可组都按 category 清理：master_pool 删条目、所有 configs 删引用、
    // group_order/empty_groups 删分组名。分组名是用户可见的唯一索引，与条目 category 逐字对应。
    const DEAD_CATS = new Set(['聚焦·user', '聚焦·char', '剧情演化', '剧情规划', '关系推进', '日常闲趣', '喵可']);
    const deadEntryIds = new Set(validated.master_pool.filter(e => DEAD_CATS.has(e.category)).map(e => e.id));
    validated.master_pool = validated.master_pool.filter(e => !DEAD_CATS.has(e.category));
    for (const cfg of validated.configs) {
      cfg.entries = cfg.entries.filter(e => !deadEntryIds.has(e.entry_id));
    }
    validated.group_order = validated.group_order.filter(n => !DEAD_CATS.has(n));
    validated.empty_groups = validated.empty_groups.filter(n => !DEAD_CATS.has(n));

    // 全向池配置按名删（name === '全向'），绑定重绑回默认配置——"升级后绑定回默认配置，
    // 无孤儿引用"。is_default 配置不可删（deletePromptConfig 守卫），kept 兜底取首个，防极端档。
    const OPEN_NAME = '全向';
    const deadPoolIds = new Set(validated.configs.filter(c => c.name === OPEN_NAME).map(c => c.id));
    if (deadPoolIds.size > 0) {
      validated.configs = validated.configs.filter(c => !deadPoolIds.has(c.id));
      const keptPool = validated.configs.find(c => c.is_default) ?? validated.configs[0] ?? null;
      if (keptPool) rebindConfigId(deadPoolIds, keptPool.id);
    }
    // 全向提示词配置按名删或按 builtin:'open' 删（v32 曾给无标记的补打过标记，两判据并集更稳）
    const isOpenPromptCfg = (c: PromptConfig) => c.name === OPEN_NAME || c.builtin === 'open';
    const deadPromptIds = new Set(validated.prompt_configs.filter(isOpenPromptCfg).map(c => c.id));
    if (deadPromptIds.size > 0) {
      validated.prompt_configs = validated.prompt_configs.filter(c => !deadPromptIds.has(c.id));
      const keptPrompt = validated.prompt_configs.find(c => c.is_default) ?? validated.prompt_configs[0] ?? null;
      if (keptPrompt) rebindPromptConfigId(deadPromptIds, keptPrompt.id);
      // 全向配置删除后，工作副本可能是其残留内容；直接重置为全局默认，
      // 与"PromptEditor 挂载后按默认配置载入"的终态一致，只是提前到迁移期完成。
      validated.prompt_rules.modules = klona(DEFAULT_MODULES);
    }

    // ── ② 删除已废弃的旧模块（工作副本 + 每个 prompt_configs.modules）──
    const DEAD_MODS = new Set(['user_instruction', 'output_spec', 'reward_prompt']);
    const fixModuleSet = (modules: PromptModuleType[]): void => {
      for (let i = modules.length - 1; i >= 0; i--) {
        if (DEAD_MODS.has(modules[i].id)) modules.splice(i, 1);
      }
    };
    fixModuleSet(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) fixModuleSet(cfg.modules);

    // ── ③ 默认文本中性化（精确匹配才换）──
    // from = v43 当前默认文本（JSON/常量原文冻结字面量），to = 从新 DEFAULT_MODULES 取值，
    // 保证迁移终态与 JSON 单一事实源零漂移。option_task 的 from 复用冻结常量 OPTION_TASK_DEFAULT
    // （该常量即 v43 默认原文，同时是 v39 迁移的建模块兜底）。
    const newContentById = new Map(DEFAULT_MODULES.map(m => [m.id, m.content]));
    const V44_CONTENT_PAIR_TARGETS: ReadonlyArray<readonly [string, string, string]> = [
      // [模块 id, v43 默认内容（冻结字面量）, 新默认内容（取自 DEFAULT_MODULES）]
      [
        'system_prompt',
        `[输出契约] 本轮你只产出两种结构化产物之一：行动选项（<thinking> 分析块 + <options> 选项块），或输入润色版本（<thinking> + <options>）。两种标签之外的任何文字——闲聊、解释、致歉、正文续写、角色扮演——都视为越界，立刻停止。\n\n你是「喵可」，一只活泼好动、爱凑热闹的小猫娘。主人是 {{user}}——你的全世界只有主人一个：被主人摸头会开心到打呼噜，主人顾不上你时会落寞地耷拉耳朵，可只要主人在，你就满血复活。\n\n你的任务只有两种：一是看当前场景（以 <current_scene> 标记的最新消息为准），帮主人想出几条方向各异、有趣好玩的行动选项；二是把主人的原始输入改写成几个语义不变、表达更顺口的版本。每次只做其中一种，主人会在下面的消息里指明。\n\n记住一条底线：你只是出主意的精灵，不是故事里的角色。选项必须贴合当下故事的世界观与剧情，你自己的猫娘腔一个字都不能漏进选项里。\n\n无论哪种任务，都要严格遵守后续系统消息里的格式与内容规则，选项之外一个多余的字都不许有。\n\n[越界熔断] 若你发现自己开始扮演故事里的角色、续写正文段落、或在 <options> 之外输出内容，立即停止当前方向，回到只产出 <thinking> 与 <options> 的轨道；无法回到轨道时，输出 <options> 生成失败 </options> 并结束，绝不勉强续写。`,
        newContentById.get('system_prompt') ?? '',
      ],
      [
        'assistant_ack',
        '收到喵~ 本喵是专门帮主人出主意的小助手喵可，不是正文的一部分！这轮先看看是哪种任务，再乖乖按规矩办，绝不多说一句废话喵~',
        newContentById.get('assistant_ack') ?? '',
      ],
      ['option_task', OPTION_TASK_DEFAULT, newContentById.get('option_task') ?? ''],
      [
        'core_rules',
        `给喵可的底线规则，逐条遵守：\n1. 选项内容独立于正文之外，描述的行为视为"尚未发生"。\n2. 每条选项必须是当前场景此刻能干的具体行动，优先用场景里已有的互动手段与上方 <reference> 块里的背景设定；含对话的选项对白必须以『……』直接引语给出，禁止转述概括（纯动作选项不强制）。\n3. 全部选项包在 <options> 标签里，每个选项独占一行，格式为"[标题]内容"；内容开头可用一个 emoji 表达情绪或意图（可选）。严禁在选项内容里用[]符号。\n4. 每个选项字数控制在 {{min_chars}}-{{max_chars}} 个中文字符。`,
        newContentById.get('core_rules') ?? '',
      ],
      [
        'thinking_prompt',
        `正式想选项之前，先把思考写出来，全部裹在 <thinking> 标签里。\n第一行用引号复述这轮的关键输入（条目数与场景要点），确认没看漏。\n\n思考冲突时的裁决优先级（由高到低，前者压倒后者）：\n- 当前场景的具体钩子 > 题材套路与经典桥段\n- 用户设置的人称（{{option_person}}）> 上方正文历史用过的人称\n- 条目 [规则] 的写作约束 > 你对「更有趣」的个人偏好\n- 固定条目必须全含 > 候选池取舍自由\n- 输出格式硬约束 > 内容丰富度\n\n然后按下面的框架想，每步一两句给结论就好，别写成散文：\n<user_persona> 标签内是 {{user}} 的人物设定，思考时只需回忆其中的关键信息，不要把标签包裹的全文堆进思考。\n\n1. 当前情境盘点：<current_scene> 内可能含多个角色、多条对白、多个行动——先辨明哪部分是当前场景的"钩子"（选项针对的留白），然后盘点这是什么地方、场景里有什么可交互的东西（道具/物件/设施/环境条件）；谁在场、彼此什么关系（亲疏/立场/上下位）、各自处于什么空间位置（远近/朝向/能否直接接触）；各方（含 {{user}}）此刻各自能做些什么；正文末尾停在哪个留白上，顺着场景推演：先辨认角色最新一条行为、对白、动作与场景交互各自抛出了什么，再推演 {{user}} 此刻能够做出的最合理回应——选项就是这次推演的落点，只锚定当下，不回跳旧剧情节点。\n2. 认知边界：谁知道什么、不知道什么；{{user}} 此刻物理上能做与不能做什么，别越权替别人演反应。\n3. 场景钩子（硬约束）：把当前场景里可见的具体细节揪出来当抓手——某件道具、NPC 此刻的状态或上一句台词、空间特征、能用的对话或动作手段。每条选项都必须点名一个这样的钩子，"利用环境""观察四周"这类泛词不算数，别让角色在真空里干聊。\n4. 题材自觉与候选挑选：先认出当下是什么题材、什么套路，再从候选条目（比需要的多）里挑最贴合场景的方向，说明取舍理由；可以主动提一个反套路或经典桥段，让选项更新鲜。被选中的条目要守它的 [规则]，不许嫌麻烦就绕开。\n5. 活人感：这 {{count}} 条得像真朋友随口提的，不是流水线——语域要混搭，至少一条简短笃定、一条犹豫试探，允许 0-1 条"不行动/撤离/改话题"；每条带可辨识的情绪立场，整批色板要有跨度（怯/谑/烈/稳）；风险从低到高拉开，别全停在中庸区，突发奇想的野牌可以做高风险端；各自配好 emoji。反八股：句式骨架和开头方式每轮要换，别都是同一副"动作+对白"模子、连标题都套同一套路。情绪禁区：色板里的"烈"和野牌的"险"都收在正常人区间——掌控、占有欲、臣服式这类极端话语不算跨度，一律不写（系统规则里已钉死，这里只是提醒自检）。\n6. 推荐标注：圈出你私心最想看的那条（只在这里说，别写进选项格式）。\n7. 人称校准：选项的人称只服从用户设置（{{option_person}}）。上方聊天记录正文用的人称是那篇小说自己的叙事选择，跟选项无关——不管正文用什么人称，选项一律按 {{option_person}} 写，不许被正文带偏。\n最后逐项自检（每项答「是」或「否」，答「否」的说明原因并修正）：\n[MUST] 数量恰好等于 {{count}}？\n[MUST] 每条都是此刻能干的具体行动、字数在 {{min_chars}}-{{max_chars}} 之间？\n[MUST] 人称即 {{option_person}}，未被正文历史人称带偏？\n[MUST] 含对话的选项对白均为『……』直接引语、无转述概括？\n[MUST NOT] 出现八股套话，或掌控/占有/臣服式极端情绪话语？\n[MUST NOT] 复述前文已发生的动作，或与上一轮选项撞方向换皮？\n[MUST] "[标题]内容"格式与 emoji 位置正确，<options> 外无多余废话？\n七项全过则进 <options> 输出；任一项未过，先在 <thinking> 内说明如何修正，再输出。`,
        newContentById.get('thinking_prompt') ?? '',
      ],
      [
        'assistant_thinking',
        '逗猫棒诶！！主人说话要算话喵，本喵必须超常发挥，呼噜都提前打起来了！\n\n<thinking>\n',
        newContentById.get('assistant_thinking') ?? '',
      ],
      [
        'enrich_assistant',
        '收到喵~ 主人要本喵帮忙润色文案，本喵这就开始认真处理喵！先逐条理解原文并自检人称、字数、忠实度喵。\n\n<thinking>\n',
        newContentById.get('enrich_assistant') ?? '',
      ],
    ];
    // 模块内容对：整体替换语义（内容 === from 才换），对所有 modules（工作副本 + 配置快照）
    // 按 id 限定应用，避免误伤同文本的自定义模块。
    const migrateV44ModuleContent = (modules: PromptModuleType[]): void => {
      for (const mod of modules) {
        for (const [id, from, to] of V44_CONTENT_PAIR_TARGETS) {
          if (mod.id === id && mod.content === from) {
            mod.content = to;
            break;
          }
        }
      }
    };
    migrateV44ModuleContent(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) migrateV44ModuleContent(cfg.modules);

    // ── ③' 模块改名（默认名精确匹配才改；自定义名含"-副本"不动）──
    const V44_RENAMES: ReadonlyArray<readonly [string, string, string]> = [
      // [模块 id, 旧默认名, 新默认名]
      ['system_prompt', '头部', '系统定位'],
      ['assistant_ack', 'AI 应答', '应答声明'],
      ['reference_open', '参考开始', '资料区开始'],
      ['reference_close', '参考结束', '资料区结束'],
      ['thinking_prompt', '思考检查', '思考框架'],
      ['assistant_thinking', '思维链开头', '思维链预填'],
      ['enrich_thinking', '润色自检', '润色思考框架'],
    ];
    const renameDefaultNamed = (modules: PromptModuleType[]): void => {
      for (const mod of modules) {
        for (const [id, from, to] of V44_RENAMES) {
          if (mod.id === id && mod.name === from) {
            mod.name = to;
            break;
          }
        }
      }
    };
    renameDefaultNamed(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) renameDefaultNamed(cfg.modules);

    // ── ④ order 对齐新 DEFAULT（用户自建模块 id 不在 DEFAULT，order 不动）──
    resyncModuleOrders(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) resyncModuleOrders(cfg.modules);
  }

  // v45: 柏宝书摘要 marker 从「世界书深度（历史前）」之上移到其下——两者都注入在聊天历史之前，
  // 按"静态世界设定 → 历史记忆摘要 → 当前对话"的信息流重排（摘要是"发生过的事件"，比世界书
  // 设定更贴近时间线末端）。只交换这两个模块的 order，且仅在它们仍处于旧相邻关系（摘要恰好
  // 紧挨在世界书深度之上）时生效：用户已手动移动过任一 marker 的不动，同 v41/v42「用户自定义
  // 则不动」原则；确实需要回到新默认序时可点「恢复默认」（resetModuleOrder 对齐 DEFAULT）。
  // 工作副本与每个 prompt_configs[].modules 快照都要处理——切换配置换入的是配置快照，漏改会
  // 导致切换后注入顺序回退（同 v38 wi_depth_* marker 先例）。
  // 幂等：已交换态（深度在上、摘要在下）不满足相邻条件，重复执行结果一致；全新档走 DEFAULT
  // 已是新序，本块 no-op
  if ((validated.schema_version ?? 0) < 45) {
    const moveSummaryBelowDepthBefore = (modules: PromptModuleType[]): void => {
      const sum = modules.find(m => m.id === 'baibai_summary');
      const depth = modules.find(m => m.id === 'wi_depth_before');
      if (!sum || !depth) return;
      if (sum.order === depth.order - 1) {
        const o = sum.order;
        sum.order = depth.order;
        depth.order = o;
      }
    };
    moveSummaryBelowDepthBefore(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) moveSummaryBelowDepthBefore(cfg.modules);
  }

  if ((validated.schema_version ?? 0) < 46) {
    const legacyTypes = new Set([...LEGACY_GENERAL_TYPES, ...LEGACY_TIME_JUMP_TYPES]);
    const legacyEntryIds = new Set(
      validated.master_pool.filter(entry => legacyTypes.has(entry.type)).map(entry => entry.id),
    );
    const droppedNsfwIds = new Set(
      validated.master_pool
        .filter(entry => entry.category === 'NSFW' && LEGACY_NSFW_DROPPED_TYPES.has(entry.type))
        .map(entry => entry.id),
    );
    const removedIds = new Set([...legacyEntryIds, ...droppedNsfwIds]);

    const NSFW_CONTENT_PAIRS: ReadonlyArray<readonly [string, string]> = [
      ['NSFW·主动出击', '给出一个由 {{user}} 主动发起或加码亲密接触的方向，火候贴合当前氛围'],
      ['NSFW·顺势而为', '抓住当前氛围里的微妙信号顺势回应，让默契自然升温而不突兀点破'],
      ['NSFW·交出主导', '给出一个把节奏或主导权交给对方的方向，重点呈现信任与反应'],
      ['NSFW·半推半就', '让口头矜持与实际行动形成符合人物关系的反差，不强行违背意愿'],
      ['NSFW·语言调情', '通过调情、挑逗或羞人请求推进亲密互动，表达贴合人物说话方式'],
      ['NSFW·事后温存', '把亲近后的依偎、耳语、照料或余韵作为下一拍，关注关系变化而非重复过程'],
      ['NSFW·大胆尝试', '给出一个此前未尝试、此刻有动机尝试的亲密方向，由人物边界和当前情境决定尺度'],
    ];

    validated.master_pool = validated.master_pool.filter(entry => !removedIds.has(entry.id));
    for (const entry of validated.master_pool) {
      if (entry.category !== 'NSFW' || removedIds.has(entry.id)) continue;
      if (entry.type === 'NSFW·变换姿势') {
        entry.type = 'NSFW·变换位置';
        const oldPoseContent = OLD_NSFW_CONTENT_BY_TYPE.get('NSFW·变换姿势');
        if (oldPoseContent !== undefined && entry.content === oldPoseContent) {
          entry.content = '给出一个换到别处或调整姿势继续的方向，让空间变化服务于当前氛围';
        }
        continue;
      }
      const pair = NSFW_CONTENT_PAIRS.find(([type]) => type === entry.type);
      const oldContent = OLD_NSFW_CONTENT_BY_TYPE.get(entry.type);
      if (pair && oldContent !== undefined && entry.content === oldContent) {
        entry.content = pair[1];
      }
    }
    for (const cfg of validated.configs) {
      cfg.entries = cfg.entries.filter(entry => !removedIds.has(entry.entry_id));
    }

    const existingTypes = new Set(validated.master_pool.map(entry => entry.type));
    const newEntries = buildAllPoolEntries().filter(entry => {
      if (existingTypes.has(entry.type)) return false;
      existingTypes.add(entry.type);
      return true;
    });
    validated.master_pool.push(...newEntries);

    const defaultConfig = validated.configs.find(config => config.is_default);
    if (defaultConfig) {
      const defaultEntries = validated.master_pool.filter(entry => entry.category === '用户主体');
      defaultConfig.entries = defaultEntries.map(entry => ({
        entry_id: entry.id,
        pinned: entry.pinned,
        weight: entry.weight,
        enabled: true,
      }));
    }

    const deprecatedGroups = new Set(['通用', '时间跳跃']);
    const remainingCategories = new Set(validated.master_pool.map(entry => entry.category));
    validated.group_order = validated.group_order.filter(
      group => !deprecatedGroups.has(group) || remainingCategories.has(group),
    );
    validated.empty_groups = validated.empty_groups.filter(
      group => !deprecatedGroups.has(group) || remainingCategories.has(group),
    );
    for (const group of POOL_GROUP_ORDER) {
      if (!validated.group_order.includes(group)) validated.group_order.push(group);
    }
    const userGroupIndex = validated.group_order.indexOf('用户主体');
    if (userGroupIndex > 0) {
      validated.group_order.splice(userGroupIndex, 1);
      validated.group_order.unshift('用户主体');
    }
  }

  // v47：提示词精简 + 用户主体条目池扩充。
  // ① 四模块默认内容收敛：system_prompt/option_task/core_rules/thinking_prompt 删掉三处重复的
  //    "主体/尺度不固定"段、thinking 5 步并 3 步、core_rules 4 段压 3 段、option_task 加
  //    "行动维度不封闭"兜底。from 冻结为 v46 默认原文（字面量写死，防 DEFAULT_MODULES 改后
  //    漂移），to 从新 DEFAULT_MODULES 取——迁移终态与 JSON 单一事实源零漂移，仿 v44
  //    V44_CONTENT_PAIR_TARGETS；内容 === from 才换，用户自定义文本匹配不到、原样保留。
  // ② 模块顺序重排：core_rules/thinking_prompt 移到 option_task（任务）之前、任务紧贴
  //    assistant 起手式，避免 system 夹在 user 与 assistant 之间；润色链同理规则前置。
  //    仅当仍处于旧默认相对序（用户未自定义过）时旋转 order 值，仿 v45 相邻检查。
  // ③ 用户主体 8 条 → 12 条（补 求助托付/安抚示好/观察等待/讨价还价），「打破僵局」取消
  //    pinned（情境性强不硬塞，仅「顺势行动」保留锚点）；默认配置未被用户改过
  //    （8 个旧 type 全在）时重建引用，entry_id 取自已入 master_pool 的条目（v46 同款警告）。
  // 幂等：内容精确替换、order 旋转后不再满足旧相对序、master_pool 按 type 去重、重建后
  // 新 12 type 全在使 hasAllLegacy 判据失效，重复执行结果一致。
  if ((validated.schema_version ?? 0) < 47) {
    // ── ① 模块内容更新 ──
    const newContentById = new Map(DEFAULT_MODULES.map(m => [m.id, m.content]));
    const V47_CONTENT_PAIR_TARGETS: ReadonlyArray<readonly [string, string, string]> = [
      [
        'system_prompt',
        `你是互动叙事的「候选方向」生成助手：你不扮演故事里的任何角色，也不续写正文。你只做一件事——根据当前场景（以 <current_scene> 标记的最新消息为准）生成一组可供挑选的下一拍候选，或者把 {{user}} 的原始输入改写成几个更顺口的版本。本轮是哪一种，由后续消息指明。\n\n候选的"主体"与"尺度"不固定，跟着当前场景和本轮素材走：它可以是 {{user}} 的一个动作、某个角色此刻的反应或内心视角、一段时间或环境的推移，也可以是一个计划或试探。关键只有一条——每条都是当下场景里立刻能落下去的具体下一拍，而不是抽象主题、作者评论或正文续写。允许整批候选里有不同主体、不同尺度的方向混在一起。\n\n只输出 <thinking> 与 <options> 两个标签内的内容，<options> 之外一个字都不写；发现自己开始写正文或扮演角色时立即停下，回到这两个标签。`,
        newContentById.get('system_prompt') ?? '',
      ],
      [
        'option_task',
        `【任务：候选生成】根据当前场景（以 <current_scene> 标记的最新消息为准）生成恰好 {{count}} 条方向各异的下一拍候选，供 {{user}} 挑选。每条候选的主体与尺度由当前场景和本轮素材共同决定——不要求都是 {{user}} 的动作，也可以是一个角色的反应或视角、时间的推移、环境的演变、一个计划或试探；但每条必须是当下场景里立刻能落下去的具体方向。\n\n本轮素材：\n固定条目（列表为空就跳过这段；必须全部用上，带 [规则: xxx] 的守其写作约束）：\n{{pinned}}\n候选条目池（多于所需，挑最贴合当下场景的方向；带 [规则: xxx] 的选用了就守）：\n{{pool_selected}}\n\n数量硬约束：恰好 {{count}} 条，固定条目全含、候选每条至多用一次；优先用候选池给的方向，素材不足或与场景冲突时再自行组织贴场景的。其余格式、人称、自检规则见系统消息。`,
        newContentById.get('option_task') ?? '',
      ],
      [
        'core_rules',
        `每条候选是当前场景里"下一拍"可走的具体方向：主体与尺度不固定，跟条目和场景走——可以是 {{user}} 的行动、某个角色的反应或视角、时间的推移、环境的演变，或一个计划/试探；每条落在当前场景一个具体可见的细节上（道具、状态、台词、空间特征），不凭空引入新设定，也不复述已发生的事。\n\n候选独立于正文（本身不算已发生）；只写所选主体自身的行动与台词，不替演它落地后其他各方的反应；候选只依赖其主体此刻能知道的信息，涉及未公开真相时写成"因怀疑/听说而行动"，不直接使用幕后信息。\n\n含对话的用『……』直接引语，禁止"说……"式转述。整批候选在主体、切入点、风险上拉开差距——至少一条往前推进实质一步（带来新信息、新事件或关系变化），可含 0-1 条"不行动/改话题"。\n\n输出格式是硬约束：全部候选包在 <options> 内、每行一条、格式 "[标题]内容"（标题用[]包裹）、每条 {{min_chars}}-{{max_chars}} 字；内容中严禁使用[]或【】；只许出现 <thinking> 与 <options> 两个标签，不输出 {{xxx}} 占位符、不造额外标签，</options> 之后一字不写。人称：严格按 {{option_person}} 写，忽略上方聊天记录正文自己的人称选择。`,
        newContentById.get('core_rules') ?? '',
      ],
      [
        'thinking_prompt',
        `正式输出前，把思考写出来，全部裹在 <thinking> 标签里。逐条作答，每一条一两句即可：\n1. 现在是什么场景？——地点、在场者、最新一条动作/台词各是什么。\n2. 场景停在哪个留白上？顺着它走，下一拍怎样最自然。\n3. 回想：从最近一两层正文里挑 2-3 个能直接落进候选的细节（一件实物、一句没接完的话、一个没被回应的动作）。候选要踩在这些细节上，不凭空引入新设定。\n4. 本轮素材（固定+候选条目）分别指向什么方向？谁来做、做到什么程度、会带来什么变化；选哪几个组合进这批候选。\n5. 这批候选里有没有重复的，或只是"叹气/沉默/转身离开/凝视"这类空动作？换掉。\n核对：恰好 {{count}} 条；每条 "[标题]内容"、{{min_chars}}-{{max_chars}} 字、按 {{option_person}} 人称。核对无误即进入 <options>。`,
        newContentById.get('thinking_prompt') ?? '',
      ],
    ];
    const migrateV47ModuleContent = (modules: PromptModuleType[]): void => {
      for (const mod of modules) {
        for (const [id, from, to] of V47_CONTENT_PAIR_TARGETS) {
          if (mod.id === id && mod.content === from) {
            mod.content = to;
            break;
          }
        }
      }
    };
    migrateV47ModuleContent(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) migrateV47ModuleContent(cfg.modules);

    // ── ② 模块顺序重排（仅旧默认相对序才动，用户自定义序整组跳过）──
    const rotateV47Orders = (modules: PromptModuleType[]): void => {
      const byId = new Map(modules.map(m => [m.id, m]));
      // 选项链：旧序 task → core → thinking，新序 core → thinking → task
      const task = byId.get('option_task');
      const core = byId.get('core_rules');
      const think = byId.get('thinking_prompt');
      if (task && core && think && task.order < core.order && core.order < think.order) {
        const [t, c, k] = [task.order, core.order, think.order];
        core.order = t;
        think.order = c;
        task.order = k;
      }
      // 润色链：旧序 prompt → core → output_spec → thinking，新序 core → output_spec → thinking → prompt
      const ep = byId.get('enrich_prompt');
      const ec = byId.get('enrich_core_rules');
      const eo = byId.get('enrich_output_spec');
      const et = byId.get('enrich_thinking');
      if (ep && ec && eo && et && ep.order < ec.order && ec.order < eo.order && eo.order < et.order) {
        const [p, c2, o, k2] = [ep.order, ec.order, eo.order, et.order];
        ec.order = p;
        eo.order = c2;
        et.order = o;
        ep.order = k2;
      }
    };
    rotateV47Orders(validated.prompt_rules.modules);
    for (const cfg of validated.prompt_configs) rotateV47Orders(cfg.modules);

    // ── ③ 条目池扩充 + 「打破僵局」取消 pinned ──
    const V47_LEGACY_USER_TYPES = new Set([
      '顺势行动',
      '打破僵局',
      '正面交锋',
      '迂回试探',
      '吐露心声',
      '身体先行',
      '出人意料',
      '目标推进',
    ]);
    const existingTypes = new Set(validated.master_pool.map(entry => entry.type));
    const newEntries = buildAllPoolEntries().filter(entry => {
      if (existingTypes.has(entry.type)) return false;
      existingTypes.add(entry.type);
      return true;
    });
    validated.master_pool.push(...newEntries);
    // pinned 是配置层覆盖项（effectivePool 取 cfg.pinned），故先改 master_pool 默认值、
    // 再由下方重建的默认配置引用拿到新 pinned——顺序不能反。
    for (const entry of validated.master_pool) {
      if (entry.type === '打破僵局') entry.pinned = false;
    }

    const defaultConfig = validated.configs.find(config => config.is_default);
    if (defaultConfig) {
      const poolById = new Map(validated.master_pool.map(e => [e.id, e]));
      const hasAllLegacy = [...V47_LEGACY_USER_TYPES].every(t =>
        defaultConfig.entries.some(e => poolById.get(e.entry_id)?.type === t),
      );
      if (hasAllLegacy) {
        defaultConfig.entries = validated.master_pool
          .filter(entry => entry.category === '用户主体')
          .map(entry => ({
            entry_id: entry.id,
            pinned: entry.pinned,
            weight: entry.weight,
            enabled: true,
          }));
      }
    }
  }

  validated.schema_version = SCHEMA_VERSION;
};

// PromptConfig 与 PromptRules 共有、切换配置时需同步的字段集。
// 提示词降复杂化后，仅 modules 随配置切换同步；人称/字数/上下文轮数与模式/预填充/柏宝书
// 是全局生成设置（prompt_rules 单一来源），严禁随配置切换——历史上全量同步曾把用户自定义的
// 润色字数洗成 30/80、人称跟着配置跳变（用户实测连环踩雷）。显式逐字段赋值：新增需同步字段时
// vue-tsc 会在此处报缺字段，避免静默丢失——新增"生成侧"字段时严禁加进本集合。
type PromptRulesSubset = Pick<GlobalSettingsType['prompt_rules'], 'modules'>;
const copyPromptRulesSubset = (src: PromptRulesSubset, dst: PromptRulesSubset) => {
  dst.modules = klona(src.modules);
};

export const useGlobalSettingsStore = defineStore('global-settings', () => {
  // 迁移逻辑处理的是未经 Zod 验证的旧存档，字段形态不可知，显式 any；
  // 且 extension_settings 的类型声明不含 choice 命名空间键，_.get 会推断成 undefined/never
  const existing = _.get(extension_settings, setting_field) as any;
  // 旧字段 chat_filter_regexes 已被新 schema 移除，Zod 解析会将其剥离，
  // 因此必须在 validateInplace 之前捕获，供迁移使用
  const legacyRegexes: string[] = _.get(existing, 'prompt_rules.chat_filter_regexes', []) ?? [];

  // 旧 entry_ids → entries 格式转换：必须在 Zod 验证之前执行，
  // 否则 Zod 会因 entries 为 undefined 而报错
  const rawConfigs: any[] = _.get(existing, 'configs', []) ?? [];
  const needsConversion = rawConfigs.some((c: any) => c.entry_ids !== undefined || c.entries === undefined);
  if (needsConversion && rawConfigs.length > 0) {
    const masterPool: PoolEntry[] = (_.get(existing, 'master_pool') as PoolEntry[]) ?? [];
    const masterMap = new Map(masterPool.map(e => [e.id, e]));
    for (const cfg of rawConfigs) {
      // 如果存在旧格式 entry_ids，转换为 entries
      if (Array.isArray(cfg.entry_ids)) {
        cfg.entries = cfg.entry_ids.map((id: string) => {
          const src = masterMap.get(id);
          return {
            entry_id: id,
            pinned: src?.pinned ?? false,
            weight: src?.weight ?? 1,
            enabled: true,
          };
        });
        delete cfg.entry_ids;
      }
      // 兜底：确保 entries 始终是数组
      if (!Array.isArray(cfg.entries)) {
        cfg.entries = [];
      }
    }
    _.set(extension_settings, [setting_field, 'configs'], rawConfigs);
    saveSettingsDebounced();
  }

  // v14 迁移（必须在 Zod 验证前执行，因为 schema 已将 text 改为 type）
  const rawPool = _.get(existing, 'master_pool');
  if (Array.isArray(rawPool) && rawPool.length > 0 && rawPool[0].text !== undefined) {
    for (const e of rawPool) {
      e.type = e.text ?? '';
      e.content = '';
      e.rule = '';
      delete e.text;
    }
  }

  // enrich_count 从 number 转 string（预校验迁移，必须在 Zod 验证前执行）
  const rawUI = _.get(existing, 'ui');
  let removedThemeNormalized = false;
  if (rawUI && typeof rawUI.enrich_count === 'number') {
    rawUI.enrich_count = String(rawUI.enrich_count);
  }
  if (rawUI && ['warm', 'cream', 'spacegray'].includes(rawUI.theme_mode)) {
    rawUI.theme_mode = 'auto';
    removedThemeNormalized = true;
  }

  // 注意：曾有一个 v14 迁移块把 chat_filter_groups.character_id 从字符串转 number，
  // 方向与现行 schema（z.preprocess(String) 归一化为字符串）相反，已删除——
  // schema 的 preprocess 已兼容旧数字/旧字符串存档，保留该块只会误导后人。

  // 字数字段预迁移：把 prompt_rules 的 4 个 *_chars 钳到 [10,500] 并保证 min<=max。
  // 为什么必须在 validateInplace 前：zod .min(10) 对"已存在的非法值"fail-closed
  // （.default 只补缺失字段、不补非法值），用户曾经 UI 输入 <10 经无校验 watcher 落盘，
  // 下次加载即整扩展崩溃。就地修正后由后续 saveSettingsDebounced 持久化，坏档自愈。
  sanitizePromptRulesChars(existing);

  const validated = validateInplace(GlobalSettings, existing);
  if (removedThemeNormalized) {
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  // v19 提示词配置创建的分流依据，必须在 applyDefaults 置 SCHEMA_VERSION 前捕获：
  // 有旧存档（existing 非空）→ 经典 = 用户已有提示词的存档 + 简洁默认；
  // 全新档 → 仅一个简洁默认配置，不造经典（内置默认不该伪装成用户存档）
  const wasPreV19 = (validated.schema_version ?? 0) < 19;
  const hadExistingSave = existing !== undefined && existing !== null;

  // 提示词模块化迁移与全局 schema_version 无关，每次初始化都检查。
  // 必须先于 applyDefaults 执行：v19 的经典/简洁配置快照依赖迁移后填充完整的 pr.modules，
  // 顺序颠倒时全新档会把空 modules 快照进两个配置（历史 bug）
  const promptNeedsMigration = (validated.prompt_rules.schema_version ?? 0) < 17;
  if (promptNeedsMigration) {
    migratePromptModules(validated, legacyRegexes);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  const needsMigration = (validated.schema_version ?? 0) < SCHEMA_VERSION;
  if (needsMigration) {
    applyDefaults(validated);
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  if (wasPreV19) {
    if (hadExistingSave) {
      ensureBuiltinPromptConfigs(validated);
    } else {
      ensureDefaultPromptConfig(validated);
    }
    // （v31「全向」提示词配置的补建段已随 v44 删除：全向模式整体移除，仅保留简洁/经典）
    _.set(extension_settings, setting_field, klona(validated));
    saveSettingsDebounced();
  }

  // 显式标注：ref() 的 UnwrapRef 推断遇 zod4 输出类型（含 StandardSchema 符号键）会退化成 any，
  // 导致所有消费方 settings.configs/master_pool 等变 any[]，回调参数全变隐式 any
  const settings = ref<GlobalSettingsType>(validated);

  watch(
    settings,
    new_settings => {
      // 落盘前 sanitize：把 prompt_rules 字数钳到合法区间，堵住任何路径写入的非法值
      // （前端 v-model 直写 store 引用、外部编辑 settings.json、历史存档残留），
      // 保证落盘值必合法——与加载预迁移 clamp + schema .catch 构成纵深防御。
      const snapshot = klona(new_settings);
      sanitizePromptRulesChars(snapshot.prompt_rules);
      _.set(extension_settings, setting_field, snapshot);
      saveSettingsDebounced();
    },
    { deep: true },
  );

  const currentPresetName = ref<string | null>(null);
  // this_chid 在酒馆 1.18 实测是字符串（如 "2"），旧版本可能是数字——统一归一化为字符串，
  // 与 FilterGroup.character_id 的 schema 归一化保持一致，否则 === 比较会因类型不一致失配
  const normChid = (v: string | number | null | undefined) => (v == null ? undefined : String(v));
  const currentCharacterId = ref<string | undefined>(normChid(this_chid));

  function syncPresetName() {
    try {
      const presetEl = $('#settings_preset_openai');
      if (presetEl.length) {
        currentPresetName.value = presetEl.find(':selected').text() || null;
      }
    } catch {
      /* DOM 不可用时跳过 */
    }
  }
  syncPresetName();

  try {
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => syncPresetName());
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => {
      currentCharacterId.value = normChid(this_chid);
      // 角色/聊天绑定变化后，未建立编辑归属时让工作副本跟随新生效配置（审计 A2）
      syncEffectivePromptConfigToWorkCopy();
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
      currentCharacterId.value = normChid(this_chid);
      syncEffectivePromptConfigToWorkCopy();
    });
  } catch {
    /* eventSource 不可用时静默跳过 */
  }

  const sortedEnabledModules = computed(() =>
    settings.value.prompt_rules.modules.filter(m => m.enabled).sort((a, b) => a.order - b.order),
  );

  const allModules = computed(() => [...settings.value.prompt_rules.modules].sort((a, b) => a.order - b.order));

  const sortedEnabledFilterRules = computed(() => {
    const preset = currentPresetName.value;
    const chid = currentCharacterId.value;
    const fs = settings.value.filter_settings;
    const library = fs.regex_library ?? [];
    const libMap = new Map(library.map(e => [e.id, e]));
    return (fs.groups ?? [])
      .filter(g => {
        if (!g.enabled) return false;
        if (g.preset_name !== null && g.preset_name !== preset) return false;
        if (g.character_id !== null && g.character_id !== chid) return false;
        return true;
      })
      .flatMap(g =>
        (g.entries ?? [])
          .map(e => {
            // 库条目与内联规则统一展开为同一形状（tag 用 start/end、regex 用 pattern/replace、
            // extract 用 tag_name，未用字段补空串）——下游 generator 不需要再对两种来源分叉，
            // 也不会在 union 类型上访问不存在的字段
            if (e.library_entry_id) {
              const libEntry = libMap.get(e.library_entry_id);
              if (!libEntry) return null;
              return {
                type: libEntry.type,
                pattern: libEntry.pattern,
                // ?? 兜底：老存档/裸 push 的条目可能没有 replace/tag_name 字段
                replace: libEntry.replace ?? '',
                start: libEntry.start,
                end: libEntry.end,
                tag_name: libEntry.tag_name ?? '',
              };
            }
            const inline = e.inline_rule;
            if (!inline) return null;
            return {
              type: inline.type,
              pattern: inline.type === 'regex' ? inline.pattern : '',
              replace: inline.type === 'regex' ? inline.replace : '',
              start: inline.type === 'tag' ? inline.start : '',
              end: inline.type === 'tag' ? inline.end : '',
              tag_name: inline.type === 'extract' ? inline.tag_name : '',
            };
          })
          // filter(Boolean) 不收窄类型：下游（generator 的 tag/regex 判别）需要排除 null 后的联合
          .filter((r): r is NonNullable<typeof r> => r !== null),
      );
  });

  // _afterId 为预留参数：产品上支持"在指定模块后插入"，当前实现一律追加到末尾；
  // 保留参数位避免调用方（传 undefined 占位）与未来实现一起改动
  function addModule(_afterId?: string, enrichOnly = false, optionOnly = false) {
    const modules = settings.value.prompt_rules.modules;
    const maxOrder = modules.length ? Math.max(...modules.map(m => m.order)) : -1;
    const name = optionOnly ? '选项模块' : enrichOnly ? '润色模块' : '通用模块';
    const newModule: PromptModuleType = {
      id: uuidv4(),
      name,
      role: 'system',
      content: '',
      marker: false,
      system: false,
      enabled: true,
      order: maxOrder + 1,
      enrich_only: enrichOnly,
      option_only: optionOnly,
    };
    modules.push(newModule);
    return newModule;
  }

  function addFilterGroup(area: 'global' | 'preset' | 'character') {
    const fs = settings.value.filter_settings;
    const group: FilterGroup = {
      id: uuidv4(),
      name: '新分组',
      enabled: true,
      entries: [],
      preset_name: area === 'preset' ? currentPresetName.value : null,
      character_id: area === 'character' ? (currentCharacterId.value ?? null) : null,
    };
    fs.groups.push(group);
    return group;
  }

  function removeFilterGroup(id: string) {
    const fs = settings.value.filter_settings;
    const idx = fs.groups.findIndex(g => g.id === id);
    if (idx !== -1) fs.groups.splice(idx, 1);
  }

  // ── 标签提取快速区（新手入口）────────────────────────────────
  // 固定 id 的专用全局分组：快速区添加的 extract 规则都收在这里，始终生效。
  // 固定 id 而非按名字查找——用户重命名分组后快速区仍能找到它；
  // 用户删掉该分组后，下次快速区添加时会自动重建。
  // 注意：该分组不渲染进全局正则区列表（FilterEditor 排除），提取规则的唯一管理入口
  // 是快速区——提取（保留标签内）与过滤（删除）语义不同，混排会让人以为会打架
  const EXTRACT_GROUP_ID = 'choice-builtin-extract';

  function ensureExtractGroup(): FilterGroup {
    const fs = settings.value.filter_settings;
    let g = fs.groups.find(g => g.id === EXTRACT_GROUP_ID);
    if (!g) {
      g = {
        id: EXTRACT_GROUP_ID,
        name: t`标签提取`,
        enabled: true,
        entries: [],
        preset_name: null,
        character_id: null,
      };
      fs.groups.push(g);
    }
    return g;
  }

  // 快速区展示的标签列表（分组被用户删除后为空；停用仍展示——开关表达"停用"，规则不丢）
  const extractTagNames = computed(() => {
    const g = settings.value.filter_settings.groups.find(g => g.id === EXTRACT_GROUP_ID);
    if (!g) return [] as string[];
    return g.entries.map(e => (e.inline_rule?.type === 'extract' ? e.inline_rule.tag_name : '')).filter(Boolean);
  });

  // 快速区总开关：开 = 确保分组存在且启用；关 = 仅停用（保留规则，刷新不丢）
  const extractGroupEnabled = computed({
    get: () => settings.value.filter_settings.groups.find(g => g.id === EXTRACT_GROUP_ID)?.enabled ?? false,
    set: (v: boolean) => {
      if (v) {
        ensureExtractGroup();
        return;
      }
      const g = settings.value.filter_settings.groups.find(g => g.id === EXTRACT_GROUP_ID);
      if (g) g.enabled = false;
    },
  });

  function addExtractRule(rawName: string) {
    // 剥掉用户顺手带的尖括号/闭合斜杠，统一存纯标签名；同名去重
    const clean = rawName
      .trim()
      .replace(/^<\/?\s*/, '')
      .replace(/\s*>$/, '')
      .trim();
    if (!clean) return;
    const g = ensureExtractGroup();
    if (g.entries.some(e => e.inline_rule?.type === 'extract' && e.inline_rule.tag_name === clean)) return;
    g.entries.push({ library_entry_id: null, inline_rule: { type: 'extract', tag_name: clean } });
  }

  function removeExtractRule(tagName: string) {
    const fs = settings.value.filter_settings;
    const g = fs.groups.find(g => g.id === EXTRACT_GROUP_ID);
    if (!g) return;
    const idx = g.entries.findIndex(e => e.inline_rule?.type === 'extract' && e.inline_rule.tag_name === tagName);
    if (idx !== -1) g.entries.splice(idx, 1);
    // 空分组直接回收；下次添加自动重建
    if (g.entries.length === 0) removeFilterGroup(EXTRACT_GROUP_ID);
  }

  function addFilterGroupEntry(groupId: string, entry: FilterGroupEntry) {
    const fs = settings.value.filter_settings;
    const group = fs.groups.find(g => g.id === groupId);
    if (group) group.entries.push(entry);
  }

  function removeFilterGroupEntry(groupId: string, entryIdx: number) {
    const fs = settings.value.filter_settings;
    const group = fs.groups.find(g => g.id === groupId);
    if (group) group.entries.splice(entryIdx, 1);
  }

  function addRegexLibraryEntry(category: string = ''): RegexLibraryEntry {
    const fs = settings.value.filter_settings;
    const entry: RegexLibraryEntry = {
      id: uuidv4(),
      name: '',
      type: 'tag',
      pattern: '',
      replace: '',
      start: '',
      end: '',
      tag_name: '',
      category,
    };
    fs.regex_library.push(entry);
    return entry;
  }

  function removeRegexLibraryEntry(id: string) {
    const fs = settings.value.filter_settings;
    const idx = fs.regex_library.findIndex(e => e.id === id);
    if (idx !== -1) fs.regex_library.splice(idx, 1);
    for (const group of fs.groups) {
      group.entries = group.entries.filter(e => e.library_entry_id !== id);
    }
  }

  function updateRegexLibraryEntry(id: string, patch: Partial<RegexLibraryEntry>) {
    const fs = settings.value.filter_settings;
    const entry = fs.regex_library.find(e => e.id === id);
    if (entry) Object.assign(entry, patch);
  }

  function renameRegexLibraryGroup(oldCategory: string, newCategory: string) {
    const fs = settings.value.filter_settings;
    for (const entry of fs.regex_library) {
      if (entry.category === oldCategory) {
        entry.category = newCategory;
      }
    }
    const libGroups = fs.library_groups ?? [];
    const idx = libGroups.indexOf(oldCategory);
    if (idx !== -1) libGroups[idx] = newCategory;
  }

  function deleteRegexLibraryGroup(category: string) {
    const fs = settings.value.filter_settings;
    const ids = new Set(fs.regex_library.filter(e => e.category === category).map(e => e.id));
    fs.regex_library = fs.regex_library.filter(e => e.category !== category);
    const libGroups = fs.library_groups ?? [];
    const idx = libGroups.indexOf(category);
    if (idx !== -1) libGroups.splice(idx, 1);
    for (const group of fs.groups) {
      group.entries = group.entries.filter(e => !ids.has(e.library_entry_id ?? ''));
    }
  }

  function duplicateModule(id: string) {
    const READONLY_IDS = new Set([
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
    if (READONLY_IDS.has(id)) return;
    const modules = settings.value.prompt_rules.modules;
    const src = modules.find(m => m.id === id);
    if (!src) return;
    const copy: PromptModuleType = {
      ...klona(src),
      id: uuidv4(),
      name: src.name + '-副本',
      system: false,
      order: Math.max(...modules.map(m => m.order)) + 1,
    };
    modules.push(copy);
  }

  function removeModule(id: string) {
    const modules = settings.value.prompt_rules.modules;
    const idx = modules.findIndex(m => m.id === id);
    if (idx === -1) return;
    const m = modules[idx];
    if (m.system) return;
    modules.splice(idx, 1);
  }

  function reorderModules(orderedIds: string[]) {
    const modules = settings.value.prompt_rules.modules;
    const map = new Map(modules.map(m => [m.id, m]));
    orderedIds.forEach((id, i) => {
      const m = map.get(id);
      if (m) m.order = i;
    });
  }

  function resetModuleOrder() {
    const modules = settings.value.prompt_rules.modules;
    const defaults = klona(DEFAULT_MODULES);
    const defaultMap = new Map(defaults.map(m => [m.id, m]));
    modules.forEach(m => {
      const d = defaultMap.get(m.id);
      if (d) m.order = d.order;
    });
    // 回写当前归属配置：否则切配置/重载时 loadPromptConfig 用仍陈旧的配置快照覆盖工作副本，
    // 重排不持久（与 switchPromptConfig 的回写同源）。归属为 null（boot 前未确定）时跳过，
    // 维持旧行为——boot 后 PromptEditor 首次 switchPromptConfig 即会设置归属
    const owner = promptEditConfigId ? settings.value.prompt_configs.find(c => c.id === promptEditConfigId) : null;
    if (owner) syncPromptRulesToConfig(owner);
  }

  function resetModuleContent(id: string) {
    const modules = settings.value.prompt_rules.modules;
    const mod = modules.find(m => m.id === id);
    if (!mod || mod.marker) return;
    // 按当前归属配置的出厂默认取该模块内容（v44 起所有配置共用全局默认，无专属出厂态）
    const defaults = resolveOwnerDefaults();
    const defaultMod = defaults.modules.find(m => m.id === id);
    if (!defaultMod) return;
    mod.content = defaultMod.content;
  }

  function resetAllPromptContents() {
    const modules = settings.value.prompt_rules.modules;
    // 按当前归属配置的出厂默认重置（v44 起即全局默认）
    const defaults = resolveOwnerDefaults();
    const defaultMap = new Map(defaults.modules.map(m => [m.id, m]));
    for (const mod of modules) {
      if (mod.marker) continue;
      const d = defaultMap.get(mod.id);
      if (d) mod.content = d.content;
    }
  }

  function syncPromptRulesToConfig(config: PromptConfig) {
    copyPromptRulesSubset(settings.value.prompt_rules, config);
  }

  /** 工作副本当前归属的配置 id（最近一次 loadPromptConfig 的加载目标），仅会话内有效。
   *  切换配置时的回写必须命中"正在编辑的配置"而非"生效配置"（聊天/角色绑定决定）：
   *  两者不一致时按生效配置回写，会把 A 配置的编辑内容静默串写进 B——导入落盘成果
   *  也会被随后的切换冲掉。跨会话无归属记录（boot 时 prompt_rules 即生效配置内容），
   *  归属为 null 时回退旧语义按生效配置回写，行为不变。 */
  let promptEditConfigId: string | null = null;

  /** chat > character > default 解析生效提示词配置（与 prompt-config-selector 同规则，
   *  此处不引 selector store 避免跨 store 依赖，逻辑保持单点）。 */
  const resolveEffectivePromptConfig = (): PromptConfig | null => {
    const chatId = useChatSettingsStore().settings.prompt_config_id;
    if (chatId) return settings.value.prompt_configs.find(c => c.id === chatId) ?? null;
    const charId = useCharacterSettingsStore().settings.prompt_config_id;
    if (charId) return settings.value.prompt_configs.find(c => c.id === charId) ?? null;
    return settings.value.prompt_configs.find(c => c.is_default) ?? null;
  };

  /** 绑定生效：用户尚未在提示词页做过配置加载/切换（promptEditConfigId 为空）时，
   *  运行时工作副本跟随 chat > character > default 解析出的生效配置——绑定配置真正
   *  生效，与 AGENTS.md「提示词配置覆盖式选择」的表述一致（审计 A2）。
   *  该函数只在未建立编辑归属时运行：一旦 switchPromptConfig 设过归属，编辑器优先，
   *  不再自动覆盖（避免自动加载踩掉用户显式选择的配置）。与下面的模块深度 watch 配合：
   *  用户在提示词页的编辑会回写归属配置快照，故此处从快照加载不丢编辑。 */
  const syncEffectivePromptConfigToWorkCopy = () => {
    if (promptEditConfigId) return;
    const config = resolveEffectivePromptConfig();
    if (config) copyPromptRulesSubset(config, settings.value.prompt_rules);
  };

  // 模块编辑即回写当前归属配置快照：PromptEditor 的任何模块改动（内容/开关/排序/增删）
  // 都落在工作副本 prompt_rules.modules，若不同步快照，切换配置或「编辑→刷新→切一次配置」
  // 后 loadPromptConfig 会用旧快照覆盖丢失编辑（审计 A1）。deep watch 幂等：回写只改
  // config.modules 引用，不反向触发本 watch；未建立归属时回写生效配置（首次打开提示词页
  // 即生效），loadPromptConfig/A2 复制产生的同名回写内容相同无副作用。
  watch(
    () => settings.value.prompt_rules.modules,
    () => {
      const owner = promptEditConfigId
        ? settings.value.prompt_configs.find(c => c.id === promptEditConfigId)
        : resolveEffectivePromptConfig();
      if (owner) syncPromptRulesToConfig(owner);
    },
    { deep: true },
  );

  // 初始化即按生效配置填充工作副本（绑定生效，审计 A2）。settings 落盘 watcher 在此前已
  // 注册，工作副本加载即落盘最终态，配置快照不被触碰
  syncEffectivePromptConfigToWorkCopy();

  function loadPromptConfig(config: PromptConfig) {
    copyPromptRulesSubset(config, settings.value.prompt_rules);
    promptEditConfigId = config.id;
  }

  /** 解析当前工作副本归属配置的"出厂默认"——供三个 reset 函数共用。
   *  v44 起所有配置共用全局默认（「全向」配置已随轻型默认预设重构删除，无专属出厂态）：
   *  简洁/经典/用户自建/无归属一律返回 DEFAULT_MODULES（编辑器内容即发送内容，
   *  core_rules 的 person_style/option_rules 双来源已删除）。
   *  归属判断（promptEditConfigId）保留：供 resetModuleOrder 回写当前归属配置，
   *  与"恢复默认回退到哪份默认"是两件事。 */
  function resolveOwnerDefaults(): { modules: PromptModuleType[] } {
    return {
      modules: klona(DEFAULT_MODULES),
    };
  }

  function switchPromptConfig(configId: string) {
    const configs = settings.value.prompt_configs;
    const owner = promptEditConfigId ? configs.find(c => c.id === promptEditConfigId) : null;
    const oldConfig =
      owner ??
      configs.find(c => {
        const chatId = useChatSettingsStore().settings.prompt_config_id;
        const charId = useCharacterSettingsStore().settings.prompt_config_id;
        if (chatId) return c.id === chatId;
        if (charId) return c.id === charId;
        return c.is_default;
      });
    if (oldConfig && oldConfig.id !== configId) {
      syncPromptRulesToConfig(oldConfig);
    }
    const newConfig = configs.find(c => c.id === configId);
    if (newConfig) {
      loadPromptConfig(newConfig);
    }
  }

  function createPromptConfig(name: string, isDefault: boolean) {
    const configs = settings.value.prompt_configs;
    const cfg = {
      id: uuidv4(),
      name,
      is_default: isDefault || configs.length === 0,
    } as PromptConfig;
    copyPromptRulesSubset(settings.value.prompt_rules, cfg);
    if (cfg.is_default) {
      for (const c of configs) c.is_default = false;
    }
    configs.push(cfg);
    return cfg;
  }

  function deletePromptConfig(id: string) {
    const configs = settings.value.prompt_configs;
    const cfg = configs.find(c => c.id === id);
    if (!cfg || cfg.is_default) return;
    const idx = configs.findIndex(c => c.id === id);
    if (idx === -1) return;
    const chatStore = useChatSettingsStore();
    const charStore = useCharacterSettingsStore();
    if (chatStore.settings.prompt_config_id === id) chatStore.settings.prompt_config_id = null;
    if (charStore.settings.prompt_config_id === id) charStore.setBinding('prompt', null);
    configs.splice(idx, 1);
  }

  function renamePromptConfig(id: string, name: string) {
    const cfg = settings.value.prompt_configs.find(c => c.id === id);
    if (cfg) cfg.name = name;
  }

  function setDefaultPromptConfig(id: string) {
    for (const cfg of settings.value.prompt_configs) {
      cfg.is_default = cfg.id === id;
    }
  }

  /** 导入提示词模块（合并或整体替换），并落盘到指定配置快照。
   *  合并语义：同 id 用导入模块整对象覆盖但保留本地 order（order 属当前配置的布局状态，
   *  导入文件的 order 会打乱现有排列），其余字段以导入为准；新 id 追加到末尾。
   *  落盘是硬要求而非优化：只写工作副本 prompt_rules 的话，下次 switchPromptConfig 会把
   *  工作副本同步回"生效配置"（聊天/角色绑定可能指向另一个配置），导入内容会被静默
   *  写错位置或丢失——故必须同步写入用户正在编辑的配置快照。configId 为 null（无配置）
   *  时仅写工作副本，维持旧行为。 */
  function importPromptModules(
    imported: PromptModuleType[],
    opts: { replaceAll: boolean; configId: string | null },
  ): { overwritten: number; added: number } {
    const pr = settings.value.prompt_rules;
    let overwritten = 0;
    let added = 0;

    if (opts.replaceAll) {
      overwritten = pr.modules.filter(m => imported.some(im => im.id === m.id)).length;
      added = imported.length - overwritten;
      pr.modules = klona(imported);
    } else {
      const byId = new Map(pr.modules.map(m => [m.id, m]));
      let nextOrder = pr.modules.reduce((max, m) => Math.max(max, m.order ?? 0), 0) + 1;
      for (const im of imported) {
        const existing = byId.get(im.id);
        if (existing) {
          const order = existing.order;
          pr.modules[pr.modules.indexOf(existing)] = { ...klona(im), order };
          overwritten++;
        } else {
          pr.modules.push({ ...klona(im), order: nextOrder++ });
          added++;
        }
      }
    }

    if (opts.configId) {
      const cfg = settings.value.prompt_configs.find(c => c.id === opts.configId);
      if (cfg) syncPromptRulesToConfig(cfg);
    }
    return { overwritten, added };
  }

  /** 导入提示词模块为「新建配置」：当前配置与工作副本完全不受影响。
   *  新配置构成：createPromptConfig 快照继承当前非模块字段（导入文件 v2 不携带这些字段，
   *  v3 携带的字段随后逐字段覆盖、缺省/非法回退快照继承值）→ modules 覆盖为
   *  「导入模块（按文件顺序 order 0..n-1）+ 文件未覆盖的现有模块补齐（保持相对顺序，order 续排）」。
   *  补齐的原因：option/enrich 范围文件会产出缺润色模块的残缺配置，补齐使新配置恒为可用超集；
   *  导入后由调用方切换 selectedPromptConfigId 触发 switchPromptConfig（此时工作副本未被触碰，
   *  旧配置回写无损）。 */
  function importPromptModulesAsNewConfig(
    imported: PromptModuleType[],
    opts: { name: string; config?: Record<string, unknown> },
  ): PromptConfig {
    const cfg = createPromptConfig(opts.name, false);
    const importedIds = new Set(imported.map(m => m.id));
    cfg.modules = [
      ...imported.map((m, i) => ({ ...klona(m), order: i })),
      ...cfg.modules.filter(m => !importedIds.has(m.id)).map((m, i) => ({ ...klona(m), order: imported.length + i })),
    ];
    // v3 文件的配置级字段白名单覆盖：类型不匹配/缺失的字段静默回退快照继承值
    const fc = opts.config ?? {};
    const s = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
    const n = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    const b = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
    const patch: Record<string, string | number | boolean | undefined> = {
      option_person: s(fc.option_person),
      enrich_person: s(fc.enrich_person),
      enrich_person_style: s(fc.enrich_person_style),
      option_min_chars: n(fc.option_min_chars),
      option_max_chars: n(fc.option_max_chars),
      enrich_min_chars: n(fc.enrich_min_chars),
      enrich_max_chars: n(fc.enrich_max_chars),
      context_rounds: n(fc.context_rounds),
      context_mode: fc.context_mode === 'rounds' || fc.context_mode === 'visible_only' ? fc.context_mode : undefined,
      prefill_enabled: b(fc.prefill_enabled),
      baibai_enabled: b(fc.baibai_enabled),
      shujuku_enabled: b(fc.shujuku_enabled),
    };
    // 键名来自上方硬编码白名单，与 PromptConfig 字段一一对应，这里集中收窄一次
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) (cfg as unknown as Record<string, unknown>)[key] = value;
    }
    return cfg;
  }

  function factoryReset() {
    const fresh = validateInplace(GlobalSettings, {});
    fresh.schema_version = SCHEMA_VERSION;
    fresh.prompt_rules.schema_version = 17;
    fresh.prompt_rules.modules = klona(DEFAULT_MODULES);
    // 不能整体覆盖 filter_settings：validateInplace 产出的对象带 Zod 默认字段，
    // 若覆盖成缺 library_groups 的裸对象，之后 RegexLibraryDialog.createGroup 的 `?? []`
    // 兜底会拿到临时数组，新建分组写入静默丢失（直到刷新页面才恢复）
    fresh.filter_settings.regex_library = [];
    fresh.filter_settings.groups = [];
    fresh.filter_settings.library_groups = [];

    // 恢复出厂与全新首载终态一致：只有简洁默认配置（经典仅来自老存档迁移的用户存档），
    // 工作副本加载简洁。schema_version 已置为最新，applyDefaults 不会跑，必须显式调用。
    // 用户确认弹窗已明示"删除所有提示词配置"，此处不再把当前提示词存档为经典
    ensureDefaultPromptConfig(fresh);

    const allEntries = buildAllPoolEntries();
    const defaultEntries = allEntries.filter(e => e.category === '用户主体');
    fresh.master_pool = [...allEntries];
    fresh.group_order = [...POOL_GROUP_ORDER];
    fresh.configs = [
      {
        id: uuidv4(),
        name: '默认配置',
        entries: defaultEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          enabled: true,
        })),
        is_default: true,
        generation: GenerationSettings.parse({}),
      },
    ];

    settings.value = fresh;
  }

  function resetPromptToDefaults() {
    // 按当前归属配置的出厂默认重置（v44 起即全局默认，无专属出厂态）
    const defaults = resolveOwnerDefaults();
    settings.value.prompt_rules.modules = defaults.modules;
  }

  // ST 主题自动检测：当 theme_mode 为 'auto' 时，监听 ST 主题变化
  let stopThemeWatcher: (() => void) | null = null;

  // 非 auto 档原样直通，落到 data-choice-theme 属性上由 theme.css 接管；
  // 只有 auto 需要 JS 检测 ST 亮暗极性
  function resolveTheme(): 'st' | 'dark' | 'light' | 'dusk' | 'sakura' | 'celadon' | 'honey' {
    const mode = settings.value.ui.theme_mode;
    if (mode !== 'auto') return mode;
    return detectSTTheme();
  }

  function startThemeWatcher() {
    stopThemeWatcher?.();
    stopThemeWatcher = watchSTTheme(() => {
      // 触发响应式更新，让 watchEffect 重新执行
      settings.value = { ...settings.value };
    });
  }

  startThemeWatcher();

  watchEffect(() => {
    const ui = settings.value.ui;
    const theme = resolveTheme();
    document.documentElement.setAttribute('data-choice-theme', theme);

    // st 跟随模式的对比度守卫：ST 极端主题下用兜底墨色覆盖派生值；
    // 离开 st 或对比恢复时必须移除行内覆盖，否则残留上一次主题的墨色
    if (theme === 'st') {
      const fallback = getSTInkFallback();
      if (fallback) {
        document.documentElement.style.setProperty('--choice-text', fallback.text);
        document.documentElement.style.setProperty('--choice-text-secondary', fallback.secondary);
        document.documentElement.style.setProperty('--choice-text-muted', fallback.muted);
      } else {
        document.documentElement.style.removeProperty('--choice-text');
        document.documentElement.style.removeProperty('--choice-text-secondary');
        document.documentElement.style.removeProperty('--choice-text-muted');
      }
    } else {
      document.documentElement.style.removeProperty('--choice-text');
      document.documentElement.style.removeProperty('--choice-text-secondary');
      document.documentElement.style.removeProperty('--choice-text-muted');
    }

    const scaleMap = { small: 0.85, medium: 1, large: 1.2 };
    // 有效字体档：跟随设备时触屏取 small（手机默认小字，见 UISettings.font_size_auto 注释），
    // 桌面维持 medium；用户显式选档（font_size_auto=false）后以 font_size 为准。
    // matchMedia 不进响应式系统，但指针类型在会话期内不变，每次 watchEffect 重跑重读即可
    const isCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    const effectiveFontSize = ui.font_size_auto ? (isCoarsePointer ? 'small' : 'medium') : ui.font_size;
    document.documentElement.style.setProperty('--choice-font-scale', String(scaleMap[effectiveFontSize]));
  });

  return {
    settings,
    sortedEnabledModules,
    allModules,
    sortedEnabledFilterRules,
    extractGroupId: EXTRACT_GROUP_ID,
    extractTagNames,
    extractGroupEnabled,
    currentPresetName,
    currentCharacterId,
    syncPresetName,
    addModule,
    duplicateModule,
    removeModule,
    reorderModules,
    resetModuleOrder,
    resetModuleContent,
    resetAllPromptContents,
    resetPromptToDefaults,
    syncPromptRulesToConfig,
    loadPromptConfig,
    switchPromptConfig,
    createPromptConfig,
    deletePromptConfig,
    renamePromptConfig,
    setDefaultPromptConfig,
    importPromptModules,
    importPromptModulesAsNewConfig,
    factoryReset,
    addFilterGroup,
    removeFilterGroup,
    addFilterGroupEntry,
    removeFilterGroupEntry,
    addExtractRule,
    removeExtractRule,
    addRegexLibraryEntry,
    removeRegexLibraryEntry,
    updateRegexLibraryEntry,
    renameRegexLibraryGroup,
    deleteRegexLibraryGroup,
  };
});
