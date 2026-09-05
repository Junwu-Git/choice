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
  DEFAULT_PERSON_STYLE,
  DEFAULT_OPTION_RULES,
  USER_INSTRUCTION_DEFAULT,
  PROMPT_TEXT_MIGRATIONS,
  OPEN_CONFIG_NAME,
  OPEN_GROUP_NAMES,
  OPEN_PERSON_STYLE,
  OPEN_OPTION_RULES,
  OPEN_MODULE_CONTENTS,
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
 * 「通用」分组：4 条跨世界观/背景/场景通用的抽象元引导条目。
 * 与旧默认条目的本质区别：只给"思考方向/维度"不给具体行为——AI 拿到"风格反差"
 * 会按当前场景自行想一个反差行动，而非被"把想法说出口"这类预设动作锁定。
 * 前 2 条 pinned：每轮保证有"稳"（顺承）与"破"（反差）两个自主权锚点；
 * 后 2 条参与随机抽取补充方向。分组轮询按 category 分桶，「通用」独立成组后
 * 与「时间跳跃」轮流出候选，锚点占比稳定。
 */
function buildGeneralEntries(): PoolEntry[] {
  const entry = (type: string, content: string, pinned: boolean): PoolEntry => ({
    id: uuidv4(),
    type,
    content,
    pinned,
    weight: 1,
    category: '通用',
    rule: '',
  });
  return [
    entry('顺势推进', '紧承前文当下的留白，给出情境中最自然顺承的推进方向', true),
    entry('风格反差', '与近几轮选项的基调或行动类型形成反差，制造新鲜与意外', true),
    entry('角色本心', '从 {{user}} 的性格核心与当下心境出发，给出贴合其人设的选择', false),
    entry('开放余地', '给出一个不急于收束、留有后续展开空间的方向', false),
  ];
}

/**
 * 「喵可」分组：4 条以喵可性格侧面切入正文的风格化条目（v27 起随默认条目下发）。
 * 四条 = 好奇/捣蛋/犯懒/粘人四个反差鲜明的猫娘侧面，各自指向一类对正文的方向：
 * 抠细节探索、搞事水花、松弛摆烂、围着主人转。type 统一带「喵可·」前缀作标记，
 * 在条目库与发给 AI 的候选行里都能一眼认出归属（渲染格式 `type: content`）。
 * 两个刻意为之的约束，不要"顺手"改掉：
 * ① content 只用猫的行为比喻（嗅、扑、打滚、黏人），不带"喵"口癖——条目是发给
 *    AI 的方向素材，system_prompt 已硬约束"猫娘腔一个字不许漏进选项"，口癖只允许
 *    存在于 assistant 层；条目里出现口癖会把腔调往选项里带。
 * ② 统一以"给出一个……的选项"收尾，与「通用」分组的引导句式对齐，避免 AI 把
 *    条目内容误读成要照抄的文案。
 * pinned 策略照「通用」分组先例：前 2 条固定当每轮锚点（一探一闹），后 2 条进
 * 分组轮询随机池补充变化。
 */
function buildMiaokeEntries(): PoolEntry[] {
  const entry = (type: string, content: string, pinned: boolean): PoolEntry => ({
    id: uuidv4(),
    type,
    content,
    pinned,
    weight: 1,
    category: '喵可',
    rule: '',
  });
  return [
    entry('喵可·好奇', '正文里被一笔带过的细节和没凑完的热闹最勾猫——给出一个凑上去追问、翻看或一探究竟的选项', true),
    entry('喵可·捣蛋', '爪子痒了想搞点动静——给出一个出其不意、带点小风险小麻烦的选项，先把场面搅出水花再说', true),
    entry(
      '喵可·犯懒',
      '天大的事也不急在这一时——给出一个偷懒省事、借坡下驴或先歇口气的选项，松弛下来反而顺理成章',
      false,
    ),
    entry(
      '喵可·粘人',
      '视线黏在{{user}}身上挪不开——给出一个围着{{user}}转的选项：凑近搭话、跟着走，或者干脆赖着不走',
      false,
    ),
  ];
}

/** 构建默认条目（进默认 config 引用）：「通用」分组 4 条 + 「喵可」分组 4 条 + 「时间跳跃」分组 6 条
 *  （v27 起加入喵可组）。NSFW 分组不在此处——它是 opt-in，只进 master_pool 供条目库勾选，
 *  默认 config 不引用，用户在「选择条目」里自行启用（见 v30 迁移块与 factoryReset） */
function buildDefaultEntries(): PoolEntry[] {
  return [...buildGeneralEntries(), ...buildMiaokeEntries(), ...buildTimeJumpEntries()];
}

/**
 * 「时间跳跃」分组：6 条不同跨度和叙事手法的时间跳跃条目，彼此风格互斥互补。
 * 独立成组是因为分组轮询抽取（drawByCategories）按 category 分桶——单独成组后
 * 该组会与其他组轮流出候选，时间跳跃类选项获得稳定但不过分的出场占比；
 * 若并入未分组，6 条会与既有条目完全平权混合，"时间跳跃"的特色占比无从谈起。
 * 全部非固定（pinned:false），是否参与抽取由各 PoolConfig 的条目引用决定。
 */
function buildTimeJumpEntries(): PoolEntry[] {
  const jump = (type: string, content: string, rule = ''): PoolEntry => ({
    id: uuidv4(),
    type,
    content,
    pinned: false,
    weight: 1,
    category: '时间跳跃',
    rule,
  });
  return [
    jump('须臾之间', '只推进几分钟到半小时的微小时间，用茶凉、雨停、天色暗下一格这类细节完成对话间隙的自然过渡'),
    jump('翌日清晨', '跳到第二天早晨，以晨间光线、声音或身体感受开场，昨夜的事件沉淀为余韵'),
    jump('数日之后', '跳过两三天到一周，用新习惯、将愈未愈的伤、来往的消息等细节交代这段时间留下的痕迹'),
    jump('季节更迭', '大幅推进到换季时节，环境物候明显变化，人物关系与心境随时间产生微妙位移'),
    jump('多年以后', '跨度数年到数十年，外貌、身份、关系发生显著变化，带一丝物是人非的怅然'),
    jump(
      '回溯闪回',
      '反向跳跃：插入一段过去的回忆场景，与当下形成呼应或对照，结尾回到当前时间点',
      '此项为回忆插叙，需明确时间线标记，结尾必须落回当前时间点',
    ),
  ];
}

/**
 * 「NSFW」分组：10 条成人向行动方向条目，覆盖主动 / 被动 / 变换姿势 / 情趣四个维度。
 * opt-in 设计：只进 master_pool（条目库可见），不进 buildDefaultEntries（默认 config 不
 * 引用）。与 v22「时间跳跃」/ v27「喵可」（默认 config 自动引用）刻意不同——NSFW 方向
 * 不应在用户未主动启用时混入每轮候选菜单，即便菜单模式下 AI 会按场景贴合度跳过。
 * 用户想用时在「选择条目」里勾选该分组即可写入当前 config。
 * 两个刻意为之的约束，不要"顺手"改掉：
 * ① 全部 pinned:false——NSFW 方向不应像「通用」锚点那样每轮必发；pinned 会强制每轮
 *    出现 NSFW 候选，对 SFW 场景是噪声。
 * ② 文案一律含蓄方向级（"给出一个……的选项"），只给思考方向不给具体动作脚本——
 *    条目是发给 AI 的方向素材，具体露骨程度由 AI 按当前场景把握；若写成照抄式动作
 *    描写，会把选项内容锁死，与「通用」「喵可」分组的元引导设计原则相悖。
 * type 统一带「NSFW·」前缀作标记，在条目库与发给 AI 的候选行里都能一眼认出归属
 * （渲染格式 `type: content`，与「喵可·」前缀同构）。rule 全部留空——候选条目本就可能
 * 因方向与场景不贴合被 AI 跳过，无需额外写作约束。
 */
function buildNsfwEntries(): PoolEntry[] {
  const entry = (type: string, content: string): PoolEntry => ({
    id: uuidv4(),
    type,
    content,
    pinned: false,
    weight: 1,
    category: 'NSFW',
    rule: '',
  });
  return [
    entry(
      'NSFW·主动出击',
      '给出一个由 {{user}} 主动发起或加码亲密接触的选项——火候与方式贴合当前氛围，不必等对方先递台阶',
    ),
    entry('NSFW·顺势而为', '抓住此刻氛围里最微妙的信号顺势回应，给出一个不点破、却让默契升温半分的选项'),
    entry('NSFW·交出主导', '给出一个把主导权交给对方的选项——示意对方来安排节奏，自己只管接住每一个反应'),
    entry('NSFW·半推半就', '给出一个嘴上矜持、身体诚实的选项——口头的推拒与行动的迎合形成可爱反差'),
    entry('NSFW·变换姿势', '给出一个提议换个姿势或换到别的位置继续的选项——挪动本身也是情趣的一部分'),
    entry('NSFW·就地取材', '给出一个借现场物件或环境为当下氛围添彩的选项——因地制宜，不拘小节'),
    entry('NSFW·情趣道具', '给出一个提议用上情趣小物件助兴的选项——从试探到提议，看对方接不接招'),
    entry('NSFW·语言调情', '给出一个用言语调情或说出羞人请求的选项——声音也是武器，说出口才升温'),
    entry('NSFW·事后温存', '给出一个亲近过后依偎温存的选项——喘息未定时的耳语与轻抚别有滋味'),
    entry('NSFW·大胆尝试', '给出一个以前没试过、此刻却心血来潮想试试的选项——把「要不要」抛给对方'),
  ];
}

/**
 * 「全向」模式新增的 6 个条目分组，共 18 条。与「通用」「喵可」「时间跳跃」「NSFW」
 * 四组的关键差异在两点，不要"顺手"合并或改 pinned：
 * ① 6 组各自成组（category 各异）——分组轮询（drawByCategories）按 category 分桶、
 *   组间轮询各抽 1 条，组数即各方向占比。合并成一组会让 user/char/剧情/关系/日常
 *   五方向坍缩成平权混合、"聚焦什么"无从谈起。各自成组才能让每轮从不同方向各抽一条。
 * ② 全部 pinned:false——全向池不设每轮必发锚点，构成完全随机（默认「通用」组有 2 条
 *   pinned 作自主权锚点，那是 user 锁主体模式的产物；全向的主体应由条目随机决定，
 *   pinned 会把某个方向焊死成每轮必发）。文案照 NSFW 组先例：方向级"给出一个……的选项"
 *   句式，只给思考方向不给具体动作脚本；聚焦·char 三条显式带"只写行动本身、其他各方
 *   反应留给正文"的防越权边界句——角色主语选项本身即某角色的行动，旧防越权"不许替演
 *   别人反应"会与之冲突，需在条目层也把边界交代清楚，配合 OPEN_OPTION_RULES 规则 2。
 * type 不带统一前缀：候选行格式为 "type: content"，分组（category）不发送给 AI，
 *   type 自身需可辨——故 18 条 type 两两不同且语义自明，不依赖前缀做归属标记
 *   （NSFW/喵可 用前缀是因其与"通用"组在默认池同台，前缀防混；全向池只含这 6 组，
 *   不存在跨组混辨的需求）。
 */
function buildOpenEntries(): PoolEntry[] {
  const entry = (type: string, content: string, category: string): PoolEntry => ({
    id: uuidv4(),
    type,
    content,
    pinned: false,
    weight: 1,
    category,
    rule: '',
  });
  return [
    // 聚焦·user：明确 {{user}} 主体 + 行动类型维度，与「通用」组（元引导：顺承/反差/本心/开放）互补
    entry(
      '本色而行',
      '给出一个以 {{user}} 为行动主体的选项——写 {{user}} 此刻能做、想做的具体行动，贴合其性格与当下心境，可包含台词',
      '聚焦·user',
    ),
    entry(
      '破格一试',
      '给出一个以 {{user}} 为主语、略出其常规性格的选项——做平时不太会做的事，让人物立起来，但不脱离当前场景',
      '聚焦·user',
    ),
    entry(
      '心声直陈',
      '给出一个让 {{user}} 把此刻的情绪或想法说出口、写出来的选项——以 {{user}} 为主语，可含台词',
      '聚焦·user',
    ),
    // 聚焦·char：角色主语。三条显式带防越权边界句，兼容"选项本身即某角色行动"的语义
    entry(
      '角色主动',
      '给出一个以 {{char}} 或在场角色为主语的选项——直接写该角色此刻主动会做的行动，可包含其台词；把镜头交给角色，只写行动本身，其他各方的反应留给正文',
      '聚焦·char',
    ),
    entry(
      '角色回应',
      '给出一个以在场角色为主语、回应眼下局面的选项——该角色对刚才发生的事做出自己的举动或表态，可包含其台词',
      '聚焦·char',
    ),
    entry(
      '角色张力',
      '给出一个以角色为主语、与 {{user}} 制造张力或拉近距离的选项——该角色的主动举动让局面更有戏，可包含其台词',
      '聚焦·char',
    ),
    // 剧情演化：不以单一角色行动呈现，事件/环境/第三方自然推进
    entry(
      '事件异动',
      '给出一个让剧情自己往前走的选项——新事件、突发状况或局面突变自然发生，留出各方反应的余地',
      '剧情演化',
    ),
    entry('环境变化', '给出一个由环境推动剧情的选项——天色、天气、声响、场合变动等环境因素自然改变当下局面', '剧情演化'),
    entry('第三方介入', '给出一个由第三方搅动局面的选项——消息传来、他人到场或场外因素介入，剧情推进一步', '剧情演化'),
    // 剧情规划：主动安排剧情走向，与剧情演化（被动推进）互补
    entry(
      '布局铺垫',
      '给出一个为后续埋线的选项——角色或剧情此刻定下计划、许下约定或留下伏笔，效果在之后的正文里展开',
      '剧情规划',
    ),
    entry(
      '导演推进',
      '给出一个导演式的走向选择——切换场景、引入新事件或新角色、推进某条暗线；只定走向，不写具体展开',
      '剧情规划',
    ),
    entry('收束归线', '给出一个往回收的选项——把散开的支线、悬而未决的事往主线收拢，让剧情有个阶段性的落点', '剧情规划'),
    // 关系推进：聚焦 {{user}} 与对方关系的双向维度，主语仍含 {{user}}
    entry(
      '关系靠近',
      '给出一个让 {{user}} 与对方关系更进一步的选项——一次靠近、一次牵手或一句掏心话，由当下氛围决定火候',
      '关系推进',
    ),
    entry('关系试探', '给出一个试探对方态度的选项——旁敲侧击、欲言又止或抛个话头，看对方怎么接', '关系推进'),
    entry('关系袒露', '给出一个袒露真心的选项——说出平时不会说的话、承认平时不承认的事，赌一把对方的回应', '关系推进'),
    // 日常闲趣：松弛日常向，给剧情喘息
    entry('闲话消遣', '给出一个松弛的日常选项——闲聊八卦、打发时间、找点乐子，给剧情一段喘息', '日常闲趣'),
    entry('小嗜好', '给出一个围绕 {{user}} 或对方小嗜好的选项——分享、参与或围观一件与主线无关但鲜活的小事', '日常闲趣'),
    entry('即兴玩乐', '给出一个即兴起意的玩乐选项——玩个游戏、打个赌、来场说走就走的小冒险', '日常闲趣'),
  ];
}

/**
 * 构建「全向」提示词配置：klona DEFAULT_MODULES 后按 OPEN_MODULE_CONTENTS 按 id 覆盖三个
 * 模块内容（system_prompt/user_instruction/thinking_prompt），其余模块照默认。
 * person_style/option_rules 走 OPEN 版（主体跟随条目 + 重写防越权）——generator 的
 * core_rules case 在 option_rules 非空时走"option_rules + person_style + CORE_RULES_STATIC"
 * 组合路径，故 core_rules 模块内容不被用到，无需覆盖。is_default:false——简洁保持出厂默认。
 *
 * 【标量字段为死数据】v35 起配置切换仅同步 modules/person_style/option_rules
 * （copyPromptRulesSubset 已收窄），人称/字数/轮数/预填充/柏宝书收归 prompt_rules 全局值，
 * 严禁随配置切换——历史上硬编码/全量同步曾把用户自定义润色字数洗成 30/80、人称跟着跳变
 * （连环踩雷）。下方标量快照仅为满足 zod 输出类型（PromptConfig 字段 required），
 * 消费端一律读 prompt_rules，勿新增读取。is_default:false——简洁保持出厂默认。
 */
function buildOpenPromptConfig(pr: GlobalSettingsType['prompt_rules']): PromptConfig {
  const modules = klona(DEFAULT_MODULES).map((m: PromptModuleType) => {
    const override = OPEN_MODULE_CONTENTS[m.id];
    return override !== undefined ? { ...m, content: override } : m;
  });
  return {
    id: uuidv4(),
    name: OPEN_CONFIG_NAME,
    is_default: false,
    modules,
    person_style: OPEN_PERSON_STYLE,
    option_rules: OPEN_OPTION_RULES,
    // builtin:'open' 让"恢复默认"识别该配置有专属出厂态（OPEN_*），不会被洗成简洁。
    // 经典/简洁/用户自建不带本字段，"恢复默认"回退全局默认——简洁本就是全局默认。
    builtin: 'open',
    option_person: pr.option_person ?? '第三人称',
    enrich_person: pr.enrich_person ?? '第三人称',
    enrich_person_style: pr.enrich_person_style ?? DEFAULT_ENRICH_PERSON_STYLE,
    option_min_chars: pr.option_min_chars ?? 10,
    option_max_chars: pr.option_max_chars ?? 60,
    enrich_min_chars: pr.enrich_min_chars ?? 30,
    enrich_max_chars: pr.enrich_max_chars ?? 80,
    context_rounds: pr.context_rounds ?? 10,
    context_mode: pr.context_mode ?? 'visible_only',
    prefill_enabled: pr.prefill_enabled ?? true,
    baibai_enabled: pr.baibai_enabled ?? false,
  };
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

/** 将现有模块的 order 重置为 DEFAULT_MODULES 中的值 */
const resetOrderFromDefaults = (validated: GlobalSettingsType) => {
  const defaults = klona(DEFAULT_MODULES);
  const defaultMap = new Map(defaults.map(m => [m.id, m]));
  for (const m of validated.prompt_rules.modules) {
    const d = defaultMap.get(m.id);
    if (d) m.order = d.order;
  }
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
    person_style: pr.person_style ?? '',
    option_rules: pr.option_rules ?? '',
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
    person_style: '',
    option_rules: '',
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
  };

  validated.prompt_configs = [classicConfig, simpleConfig];

  // 3. 将"简洁"配置加载到 prompt_rules
  pr.modules = klona(simpleConfig.modules);
  pr.person_style = '';
  pr.option_rules = '';
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
      person_style: pr.person_style ?? '',
      option_rules: pr.option_rules ?? '',
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

    // 如果没有任何配置，创建默认配置（含 4 条预设条目）
    if (configs.length === 0) {
      const defaultEntries = buildDefaultEntries();
      validated.master_pool = [...defaultEntries];
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
    // v13: 对已迁移但池为空的用户，补建默认条目和配置
    if (validated.master_pool.length === 0 && validated.configs.length === 0) {
      const defaultEntries = buildDefaultEntries();
      validated.master_pool = [...defaultEntries];
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

  // 提示词文本批量迁移：v21~v28 各版本块的提示词文本迁移操作同构（option_rules +
  // person_style + modules + configs 的逐字段 migratePromptText），抽此 helper 消除七处
  // 重复。v29 仅迁移 modules（不碰 option_rules/person_style），用 opts 关闭。
  const migrateAllPromptText = (
    validated: GlobalSettingsType,
    opts: { rules?: boolean; personStyle?: boolean } = {},
  ) => {
    const { rules = true, personStyle = true } = opts;
    if (rules) validated.prompt_rules.option_rules = migratePromptText(validated.prompt_rules.option_rules);
    if (personStyle) validated.prompt_rules.person_style = migratePromptText(validated.prompt_rules.person_style);
    for (const m of validated.prompt_rules.modules) {
      m.content = migratePromptText(m.content);
    }
    for (const cfg of validated.prompt_configs) {
      if (rules) cfg.option_rules = migratePromptText(cfg.option_rules);
      if (personStyle) cfg.person_style = migratePromptText(cfg.person_style);
      for (const m of cfg.modules) {
        m.content = migratePromptText(m.content);
      }
    }
  };

  // v20/v21 提示词文本迁移：v20 删除 condition 字段后 [条件: xxx] 标记不再生成，老存档
  // 引用该标记的段落改写为 [规则] 语义；v21 进一步确立规则=纯写作约束，把 v20 产出的
  // "适用时机不符则跳过"措辞收敛为约束措辞。
  if ((validated.schema_version ?? 0) < 21) {
    // PromptConfig.option_rules 是切换配置时换入 prompt_rules 的快照（见 config 切换逻辑），
    // 漏掉它会导致"切换提示词配置后旧 [条件] 文本复活"
    migrateAllPromptText(validated, { personStyle: false });
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

  // v27: 两件事，全部幂等：
  // ① 奖励文案去"小鱼干"——该梗已与其他预设撞车，换成"顺毛摸头"（呼应 system_prompt
  //    里"被摸头打呼噜"的人格设定）。reward_prompt/assistant_thinking 是存档快照，
  //    改 JSON 默认值触达不了老用户，必须走 PROMPT_TEXT_MIGRATIONS
  // ② 新增「喵可」分组 4 条：照 v22/v23 范式，按 type 去重后补入 master_pool，且只
  //    追加进默认 config——其他 PoolConfig 是用户显式挑选的结果，擅自塞条目等于改
  //    用户配置；迁移块的条目 id 是当场生成的 uuid，只能当场 push + 当场引用
  if ((validated.schema_version ?? 0) < 27) {
    // ① 提示词文本
    migrateAllPromptText(validated);
    // ② 「喵可」分组池迁移（与 v23「通用」组同构；existingTypes/defaultConfig 为块级
    //    const，与 v22/v23 块的同名变量互不可见）
    const existingTypes = new Set(validated.master_pool.map(e => e.type));
    const miaokeEntries = buildMiaokeEntries().filter(e => !existingTypes.has(e.type));
    validated.master_pool.push(...miaokeEntries);
    const defaultConfig = validated.configs.find(c => c.is_default);
    if (defaultConfig) {
      for (const e of miaokeEntries) {
        defaultConfig.entries.push({ entry_id: e.id, pinned: e.pinned, weight: e.weight, enabled: true });
      }
    }
    if (!validated.group_order.includes('喵可')) {
      validated.group_order.push('喵可');
    }
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
    migrateAllPromptText(validated, { rules: false, personStyle: false });
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

  // v31: 新增「全向」多主体模式——6 个新条目分组（18 条）+ 配套「全向」条目池配置 +
  // 「全向」提示词配置。与 v22/v27（加默认池）/ v30（仅条目库）的差异：本版三件套，
  // 且条目池配置只引用新 6 组（不含通用/喵可/时间跳跃，用户明确选择）。
  // 提示词配置的补建分两路：prompt_configs 非空时本块直接 push；为空时（pre-v19 存档
  // 即将被 ensureBuiltinPromptConfigs 整体重建为[经典,简洁]、全新档晚于 ensureDefaultPromptConfig
  // 建）交给 init 的 wasPreV19 后置步，否则会被覆盖或漏掉简洁。条目池配置对所有路径都在本块建
  // （条目池配置 pre-v19 也存在，无重建抹除问题）。
  if ((validated.schema_version ?? 0) < 31) {
    // ① 6 组条目按 type 去重后入 master_pool；group_order 按 OPEN_GROUP_NAMES 序追加
    const existingTypes = new Set(validated.master_pool.map(e => e.type));
    const openEntries = buildOpenEntries().filter(e => !existingTypes.has(e.type));
    validated.master_pool.push(...openEntries);
    for (const name of OPEN_GROUP_NAMES) {
      if (!validated.group_order.includes(name)) {
        validated.group_order.push(name);
      }
    }

    // ② 配套「全向」条目池配置：仅引用新 6 组条目（用户明确选择，不含通用/喵可/时间跳跃）。
    // 全部 pinned:false——全向池不设每轮必发锚点，主体由随机抽取的条目决定。
    // 幂等（关键）：按 name 去重，已存在则不重建——否则迁移若重跑会造出空 entries 的新全向
    // 配置（重跑时 openEntries 因 type 去重为空、entries 引用空数组），且新 uuid 使已绑定的
    // config_id 悬空 → 生效配置回退默认配置（用户报"恢复到简洁配置"的根因之一）。
    // entries 引用 master_pool 中当前全部新 6 组条目（非仅本次新增）：重跑或预存档已有同 type
    // 条目时，仍能引用到正确的条目集合，而非空集。
    if (!validated.configs.some(c => c.name === OPEN_CONFIG_NAME)) {
      const openCats = new Set<string>(OPEN_GROUP_NAMES);
      const allOpenEntries = validated.master_pool.filter(e => openCats.has(e.category));
      validated.configs.push({
        id: uuidv4(),
        name: OPEN_CONFIG_NAME,
        entries: allOpenEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          enabled: true,
        })),
        is_default: false,
        generation: GenerationSettings.parse({}),
      });
    }

    // ③ 「全向」提示词配置：prompt_configs 非空且尚无全向时才建（空路径交给 init 后置步；
    // 已有全向则跳过——幂等，防重跑造重复 uuid 悬空已绑定的 prompt_config_id）
    if (validated.prompt_configs.length > 0 && !validated.prompt_configs.some(c => c.name === OPEN_CONFIG_NAME)) {
      validated.prompt_configs.push(buildOpenPromptConfig(validated.prompt_rules));
    }
  }

  // v32: 给 v31 首版（buildOpenPromptConfig 尚未带 builtin 字段时）创建的全向配置补打标记。
  // builtin:'open' 是 resolveOwnerDefaults 识别"该配置有专属出厂态"的依据——缺标记会让
  // 全向配置的"恢复默认"回退到全局默认（简洁），把全向内容洗成简洁。v31 块改 buildOpenPromptConfig
  // 加 builtin 后，新建的全向配置已带标记；本块只补历史存档里已存在、尚无标记的全向配置。
  // 按 name===OPEN_CONFIG_NAME 且 builtin 缺失匹配——用户极少自建同名配置，即便撞名也是
  // 把它当全向处理（"恢复默认"回退 OPEN 默认），影响可忽略。幂等：已有标记的跳过。
  if ((validated.schema_version ?? 0) < 32) {
    for (const cfg of validated.prompt_configs) {
      if (cfg.name === OPEN_CONFIG_NAME && cfg.builtin === undefined) {
        cfg.builtin = 'open';
      }
    }
  }

  // v33: 全向配置去重自愈——v31 首版无幂等守卫，迁移若重跑（schema_version 未及时落盘到
  // 下次加载即重跑，或手编设置致 schema 回退）会造出重复的全向配置（pool + prompt 各自
  // 多份、uuid 不同）。已绑定 config_id/prompt_config_id 指向的若是被删的重复份，生效配置
  // 解析落空 → 回退默认（简洁/默认配置），即用户报"界面切换/关闭 UI 后恢复到简洁配置"的根因。
  // 修复：保留首个全向、删除其余重复份；chat/character 的 config_id 与 prompt_config_id 若
  // 指向被删重复份则重绑到保留份。幂等：无重复时 no-op。照 v9 迁移的 chat/character 回写范式
  // （chat_metadata + getStCharacter + saveMetadataDebounced/saveCharacterDebounced）。
  if ((validated.schema_version ?? 0) < 33) {
    // 条目池配置去重（configs：PoolConfig）
    const poolKept = validated.configs.find(c => c.name === OPEN_CONFIG_NAME) ?? null;
    if (poolKept) {
      const poolRemovedIds = new Set(
        validated.configs.filter(c => c.name === OPEN_CONFIG_NAME && c.id !== poolKept.id).map(c => c.id),
      );
      if (poolRemovedIds.size > 0) {
        validated.configs = validated.configs.filter(c => !poolRemovedIds.has(c.id));
        rebindConfigId(poolRemovedIds, poolKept.id);
      }
    }

    // 提示词配置去重（prompt_configs：PromptConfig）
    const promptKept = validated.prompt_configs.find(c => c.name === OPEN_CONFIG_NAME) ?? null;
    if (promptKept) {
      const promptRemovedIds = new Set(
        validated.prompt_configs.filter(c => c.name === OPEN_CONFIG_NAME && c.id !== promptKept.id).map(c => c.id),
      );
      if (promptRemovedIds.size > 0) {
        validated.prompt_configs = validated.prompt_configs.filter(c => !promptRemovedIds.has(c.id));
        rebindPromptConfigId(promptRemovedIds, promptKept.id);
      }
    }
  }

  // v34: 修正 v31 首版 buildOpenPromptConfig 误写的选项字数——该版把全向配置的
  // option_min/max_chars 硬编码成 30/80（简洁默认是 v23 字数迁移后的 10/60），而提示词配置
  // 切换会全量换入字数（copyPromptRulesSubset），导致用户切到全向时生成界面字数凭空
  // 10-60 跳成 30-80。builder 已改正，本块只修历史存档里已按错误值落盘的全向配置。
  // 签名 = builtin:'open' 且字数恰为 30/80（错误 builder 的唯一指纹），用户后续手动改过的
  // 其他值不受影响。enrich 30/80 与简洁默认一致，无需处理。幂等：修正后签名不再命中。
  if ((validated.schema_version ?? 0) < 34) {
    for (const cfg of validated.prompt_configs) {
      if (cfg.builtin === 'open' && cfg.option_min_chars === 30 && cfg.option_max_chars === 80) {
        cfg.option_min_chars = 10;
        cfg.option_max_chars = 60;
      }
    }
  }

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
    }
  }

  // v19 的提示词配置创建已移出本函数：分流逻辑（老存档建经典+简洁 / 全新档仅简洁）
  // 依赖"是否存在旧存档"这一信息，只有 store 初始化流程知道，见 init 中 wasPreV19 分支

  validated.schema_version = SCHEMA_VERSION;
};

// PromptConfig 与 PromptRules 共有、切换配置时需同步的字段集。
// v35 起配置收敛为"纯提示词文本快照"：仅 modules + person_style + option_rules 随切换同步。
// 人称/字数/上下文轮数与模式/预填充/柏宝书是全局生成设置（prompt_rules 单一来源），
// 严禁随配置切换——历史上全量同步曾把用户自定义的润色字数洗成 30/80、人称跟着配置跳变
// （用户实测连环踩雷）。用 Pick<…['prompt_rules']> 作共享子集类型：PromptConfig 结构上
// 同样具备这些字段，可作 src/dst。显式逐字段赋值（而非字段名数组 + as any）：新增需同步
// 的字段时 vue-tsc 会在此处报缺字段，避免静默丢失——新增"生成侧"字段时严禁加进本集合
type PromptRulesSubset = Pick<GlobalSettingsType['prompt_rules'], 'modules' | 'person_style' | 'option_rules'>;
const copyPromptRulesSubset = (src: PromptRulesSubset, dst: PromptRulesSubset) => {
  dst.modules = klona(src.modules);
  dst.person_style = src.person_style;
  dst.option_rules = src.option_rules;
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
  if (rawUI && typeof rawUI.enrich_count === 'number') {
    rawUI.enrich_count = String(rawUI.enrich_count);
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
    // v31「全向」提示词配置补建：v31 块对 prompt_configs 为空的路径（pre-v19 存档即将被
    // ensureBuiltinPromptConfigs 整体重建为[经典,简洁]、全新档晚于 ensureDefaultPromptConfig
    // 建）跳过了提示词配置的 push，在此补建。wasPreV19 一次性（此后 schema 已置最新，
    // 分支不再进入），用户删除全向后不会被复活——与 v19/v22/v27/v30 各迁移块的一次性语义一致。
    // 幂等：按 name 去重，防 wasPreV19 分支在异常重入时造重复全向（悬空 prompt_config_id）。
    if (!validated.prompt_configs.some(c => c.name === OPEN_CONFIG_NAME)) {
      validated.prompt_configs.push(buildOpenPromptConfig(validated.prompt_rules));
    }
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
    });
    eventSource.on(event_types.CHAT_CHANGED, () => {
      currentCharacterId.value = normChid(this_chid);
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
  }

  function resetModuleContent(id: string) {
    const modules = settings.value.prompt_rules.modules;
    const mod = modules.find(m => m.id === id);
    if (!mod || mod.marker) return;
    // 按当前归属配置的出厂默认取该模块内容（全向配置走 OPEN_MODULE_CONTENTS 覆盖）
    const defaults = resolveOwnerDefaults();
    const defaultMod = defaults.modules.find(m => m.id === id);
    if (!defaultMod) return;
    mod.content = defaultMod.content;
    // core_rules 模块内容恢复时，同步重置新手字段，保持一致性（全向配置用 OPEN 版）
    if (id === 'core_rules') {
      settings.value.prompt_rules.person_style = defaults.person_style;
      settings.value.prompt_rules.option_rules = defaults.option_rules;
    }
  }

  function resetAllPromptContents() {
    const modules = settings.value.prompt_rules.modules;
    // 按当前归属配置的出厂默认重置（全向配置恢复其专属内容，而非简洁默认）
    const defaults = resolveOwnerDefaults();
    const defaultMap = new Map(defaults.modules.map(m => [m.id, m]));
    for (const mod of modules) {
      if (mod.marker) continue;
      const d = defaultMap.get(mod.id);
      if (d) mod.content = d.content;
    }
    settings.value.prompt_rules.person_style = defaults.person_style;
    settings.value.prompt_rules.option_rules = defaults.option_rules;
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

  function loadPromptConfig(config: PromptConfig) {
    copyPromptRulesSubset(config, settings.value.prompt_rules);
    promptEditConfigId = config.id;
  }

  /** 解析当前工作副本归属配置的"出厂默认"——供三个 reset 函数共用。
   *  全向配置（owner.builtin === 'open'）返回 OPEN 版本：模块内容按 OPEN_MODULE_CONTENTS
   *  覆盖 DEFAULT_MODULES、person_style/option_rules 用 OPEN 常量。其余配置（简洁/经典/
   *  用户自建/无归属）返回全局默认——简洁本就是全局默认，经典/自建没有专属出厂态，
   *  回退全局默认与改动前行为一致。归属判断靠 promptEditConfigId（PromptEditor 切换
   *  配置时由 switchPromptConfig→loadPromptConfig 设置；boot 时 PromptEditor 的
   *  selectedPromptConfigId watch 也会触发 switchPromptConfig，故首次进入即有归属）。 */
  function resolveOwnerDefaults(): {
    modules: PromptModuleType[];
    person_style: string;
    option_rules: string;
  } {
    const configs = settings.value.prompt_configs;
    const owner = promptEditConfigId ? configs.find(c => c.id === promptEditConfigId) : null;
    const isOpen = owner?.builtin === 'open';
    const modules = isOpen
      ? klona(DEFAULT_MODULES).map((m: PromptModuleType) => {
          const ov = OPEN_MODULE_CONTENTS[m.id];
          return ov !== undefined ? { ...m, content: ov } : m;
        })
      : klona(DEFAULT_MODULES);
    return {
      modules,
      person_style: isOpen ? OPEN_PERSON_STYLE : DEFAULT_PERSON_STYLE,
      option_rules: isOpen ? OPEN_OPTION_RULES : DEFAULT_OPTION_RULES,
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
    if (charStore.settings.prompt_config_id === id) charStore.settings.prompt_config_id = null;
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
      person_style: s(fc.person_style),
      option_rules: s(fc.option_rules),
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
    // v31「全向」提示词配置：恢复出厂终态与全新首载一致（v31 块 + wasPreV19 后置步的产物）
    fresh.prompt_configs.push(buildOpenPromptConfig(fresh.prompt_rules));

    const defaultEntries = buildDefaultEntries();
    // NSFW 是 opt-in：进 master_pool（条目库可见可选）但不进默认 config 引用——
    // 全新首载终态与 v30 迁移块（schema<30 时跑）对老存档的处理保持一致
    const nsfwEntries = buildNsfwEntries();
    // 「全向」6 组条目进 master_pool（条目库可见），配套「全向」池配置引用它们——
    // 与 v31 迁移块对老存档的处理保持一致
    const openEntries = buildOpenEntries();
    fresh.master_pool = [...defaultEntries, ...openEntries, ...nsfwEntries];
    // 与 buildDefaultEntries 的分组序一致：「通用」打底、「喵可」紧跟、「时间跳跃」殿后、
    // 6 个新组居中（OPEN_GROUP_NAMES 序）、「NSFW」收尾
    fresh.group_order = ['通用', '喵可', '时间跳跃', ...OPEN_GROUP_NAMES, 'NSFW'];
    fresh.configs = [
      {
        id: uuidv4(),
        name: '默认配置',
        // 仅引用 defaultEntries（通用+喵可+时间跳跃），NSFW/全向留给用户自行勾选启用
        entries: defaultEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          enabled: true,
        })),
        is_default: true,
        generation: GenerationSettings.parse({}),
      },
      {
        id: uuidv4(),
        name: OPEN_CONFIG_NAME,
        // 仅引用新 6 组条目（用户明确选择，不含通用/喵可/时间跳跃）
        entries: openEntries.map(e => ({
          entry_id: e.id,
          pinned: e.pinned,
          weight: e.weight,
          enabled: true,
        })),
        is_default: false,
        generation: GenerationSettings.parse({}),
      },
    ];

    settings.value = fresh;
  }

  function resetPromptToDefaults() {
    // 按当前归属配置的出厂默认重置（全向配置恢复其专属模块与规则，而非简洁默认）
    const defaults = resolveOwnerDefaults();
    settings.value.prompt_rules.modules = defaults.modules;
    settings.value.prompt_rules.person_style = defaults.person_style;
    settings.value.prompt_rules.option_rules = defaults.option_rules;
  }

  // ST 主题自动检测：当 theme_mode 为 'auto' 时，监听 ST 主题变化
  let stopThemeWatcher: (() => void) | null = null;

  // 非 auto 档（含 dusk/sakura/celadon/honey 预设）原样直通，落到 data-choice-theme
  // 属性上由 theme.css 的同名 token 块接管；只有 auto 需要 JS 检测 ST 亮暗极性
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
