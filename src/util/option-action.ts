import type { ChoiceOption } from '@/core/options-store';
import { isCardSettled, markCardSettled } from '@/core/options-store';
import toastr from 'toastr';
import { sendTextareaMessage } from '@sillytavern/script';
import { parseOptionContent, parseOptionDice, parseOptionType } from '@/util/option-format';
import { resolveOptionSuccessRateWithAttr } from '@/core/attribute-dc';
import { getStCharacter } from '@/core/st-character';
import { recordOptionSelected, recordDiceRoll } from '@/core/stats';
import {
  rollDice,
  buildDiceMarker,
  diceMargin,
  judgeOutcome,
  marginDegree,
  DICE_MARKER_TAIL,
  type DiceOutcome,
  type DiceRollMode,
} from '@/core/dice';
import { armDiceTurnPrompt, clearDiceTurnPrompt, stagePendingTurn } from '@/core/dice-contract';
import { rollDiceExpression, mapProxyToRange } from '@/core/dice-expression';
import { sanitizeNarrative } from '@/core/cards-constraints';
import { resolveCardRoll, commitCardRun, type CardResolution } from '@/core/cards';
import type { DiceSettings } from '@/type/settings';
import { useGlobalSettingsStore } from '@/store/global-settings';

/**
 * 选项点击后的行为应用（共享层）：主面板与悬浮球弹窗共用。behavior 语义：
 * insert = 光标处插入（有选区则替换）；append = 追加到输入框末尾；send = 覆盖后直接发送；
 * fill = 覆盖输入框内容。取值来源与设置页校验见 src/type/settings.ts 的 behavior 字段。
 * opts.view 标记来源视图：统计口径仅行动选项视图计入，润色（enrich）完全不计。
 * opts.poolEntryIds 为被点选项所在轮的条目 id 集合（轮次共现整轮归因的兜底依据），
 * 由调用方从 panelStore.currentGeneration 传入；旧消息缺该字段时回退 []（只计总量）。
 * opts.generationId 为被点选项所在代（同代重复点击只计 1 次命中轮次）。
 * opts.matchedEntryId 为被点选项的精确归因条目（生成时文本匹配，见 option-attribution.ts）：
 * 保留三态不归一化——string 时统计「命中」只记该条目；null（新代显式未匹配 / L1 AI 归因写回
 * 的自由发挥）不命中任何条目；undefined（旧代消息无该字段）回退整轮共现。勿在此处 `?? null`
 * 归一，否则旧代会从「共现回退」误变为「不命中」（见 core/stats.ts recordOptionSelected 注释）。
 * opts.scopeId 为被点选项所在代的生成维度（ChoiceGeneration.scopeId）：命中回写直接归到
 * 该维度，避免点击时切了 config 导致记错；旧代消息缺该字段时由统计层兜底搜索。
 * opts.preRolled（v61 就地重掷）：调用方已通过 rollOptionDice 掷好并 stage 的判定结果——
 * 提供时不再内部掷骰，直接用其结果构建 marker、应用并记账；配合 dice.reroll_enabled 两步流。
 *
 * v57 骰子判定（难度制）：仅行动选项视图（view='options'）且骰子开关开启时掷骰。
 * v61 起支持判定方向（dice.low_roll：high=点数≥需求成功 / low=COC 点数≤需求成功）与
 * 骰式表达式（dice.allow_formula：AI 标注 NdM 时掷表达式，需求值按比映射到骰式值域）；
 * 角色属性驱动 DC（dice.attr_dc_enabled）：无显式标注时从当前角色卡解析属性值。有需求值
 * （AI 标注/属性/档位兜底）才判定——掷出 ≥ 需求值才算成功（high）。判定结果随所有行为生效：
 * 成功/失败/大成功/大失败都把演绎指令包在 HTML 注释中对用户全程隐形注入（v67 起：
 * 四种行为输入框一律只放纯正文，注释挂 pendingTurn，玩家消息真正发出时由 MESSAGE_SENT
 * 回写进该消息 mes——AI 请求原样携带、聊天界面渲染不可见、随消息持久化；v57 起成功
 * 也注入，模板支持 {margin}/{degree}，degree = 判定差值程度词；v58 成功/失败按 margin
 * 档位拆独立指令）。
 * 返回判定结果供组件做行内视觉反馈（判定 chip：结局+差值；不再弹酒馆 toastr，避免失败
 * 红得像插件报错），未掷骰（关闭/润色/无需求值）返回 null。margin 已经 diceMargin 归一化
 * （成功侧为正，供 chip 与 marker 同口径）。
 * 判定结果只进战绩统计（stats.dice + 最近判定历史 v61），不进条目统计——last_selected_text 保持原始正文。
 */

/** 单次判定结果（组件 chip 与 marker 共用）：margin = diceMargin(mode, roll, rate) 归一化差值。
 *  v62 卡牌系统：card_enabled 开时判定会叠加卡效果，附加 cards（触发卡/幸运命中/行动币/
 *  机制行）供 chip 展示、commitCardRun 落库与弹窗触发。card_enabled 关时无 cards 字段，
 *  与现状完全一致（零回归）。
 *  bounds（v73）：骰式路径 = 表达式值域（程度占比制按它算判定空间），D100 路径缺省。 */
export type DiceRollResult = {
  outcome: DiceOutcome;
  roll: number;
  rate: number;
  margin: number;
  mode: DiceRollMode;
  bounds?: { min: number; max: number };
  cards?: CardResolution;
};

/** 判定方向对应的大成功/大失败阈值组：low 模式用低值大成功/高值大失败（COC），
 *  high 模式用大值大成功/小值大失败（默认）。 */
const critThresholds = (d: DiceSettings): { success: number; fail: number } =>
  d.low_roll
    ? { success: d.low_roll_crit_success_max, fail: d.low_roll_crit_fail_min }
    : { success: d.crit_success_min, fail: d.crit_fail_max };

/** 把卡机制行合并进既有演绎注释（v62，叙事/演出行不注入、只剩机制行）：插在 `-->` 闭合前、
 *  纪律尾注（v67）之前，与结局模板共存于同一条注释。行文本（AI 生成的卡名等，不可信）
 *  先经 sanitizeNarrative 滤连续连字符，防 `-->` 提前闭合注释。 */
const mergeCardNarratives = (marker: string, lines: string[]): string => {
  if (lines.length === 0) return marker;
  const body = lines.map(sanitizeNarrative).join('\n');
  const m = marker.match(/^(<!--[\s\S]*?)(-->\s*)$/);
  if (!m) return marker;
  const head = m[1].replace(/\s*$/, '');
  // v67 三段结构：机制行插在固定纪律尾注之前（机制说明在纪律前收尾更自然）；旧结构无尾注则附在正文后
  const tailIdx = head.endsWith(DICE_MARKER_TAIL) ? head.length - DICE_MARKER_TAIL.length : -1;
  if (tailIdx > 0) {
    return `${head.slice(0, tailIdx).replace(/\s*$/, '')}\n${body}\n${head.slice(tailIdx)}\n${m[2]}`;
  }
  return `${head}\n${body}\n${m[2]}`;
};

/** 无结局模板时为卡行单独包一条注释（同样滤连续连字符；v67 带固定头部与纪律尾注，
 *  让正文 AI 知道这段也是系统注入的机制说明）。卡行以「机制记录」开头，
 *  头部用「卡牌系统」避免窄化成纯演出。 */
const wrapCardNarratives = (lines: string[]): string =>
  lines.length
    ? `<!--【卡牌系统·系统注入，玩家不可见】\n${lines.map(sanitizeNarrative).join('\n')}\n${DICE_MARKER_TAIL}-->\n`
    : '';

/** 按设置掷一次骰并判出结果（D100 或骰式）。无需求值/骰子关闭返回 null。纯判定、不应用、不记账。
 *  供 applyOptionBehavior 与 v61 就地重掷（rollOptionDice → stage → 确认应用）共用。
 *  v62 卡牌：card_enabled 开且未走骰式路径时，改走 cards.ts 的 resolveCardRoll 叠加卡效果
 *  （预掷/后置修正 + 套装加成 + 幸运开包 offer），cards 字段随结果返回；关则走现状路径零回归。 */
function rollForOption(
  text: string,
  d: DiceSettings,
  char: StCharacter | undefined,
  opts?: { cardDisabled?: boolean },
): DiceRollResult | null {
  const gs = useGlobalSettingsStore();
  // 卡牌路径：仅当总开关开且不使用骰式表达式（卡效果作用于 D100 需求/骰值/彩蛋，与骰式
  // 值域映射不兼容，保持该路径零行为变化）。未装备卡也走这里——纯判定结果带 cards 空决议，
  // 但 currencyDelta 仍按结局计（卡系统开启时点选项判定即有行动币收支）。
  // v63 防刷：cardDisabled（该楼层已结算）时走非卡路径，无卡决议/无幸运开包/无行动币，零经济。
  if (gs.settings.card_enabled && !d.allow_formula && !opts?.cardDisabled) {
    return resolveCardRoll(text, char, d, true);
  }
  const mode: DiceRollMode = d.low_roll ? 'low' : 'high';
  const crits = critThresholds(d);
  // 骰式表达式路径（allow_formula，v61）：AI 标注 NdM 时掷表达式，需求值(0-100)按比映射到
  // 骰式值域当 DC；彩蛋阈值同样按比映射（代理 96/5 → 骰式近上下端）。表达式非法静默回退 D100。
  if (d.allow_formula) {
    const dice = parseOptionDice(text, d.low_roll);
    if (dice) {
      const expr = rollDiceExpression(dice.formula);
      if (expr) {
        const target = mapProxyToRange(dice.rate, expr.min, expr.max);
        const critS = mapProxyToRange(crits.success, expr.min, expr.max);
        const critF = mapProxyToRange(crits.fail, expr.min, expr.max);
        const outcome = judgeOutcome(expr.total, target, critS, critF, mode, { min: expr.min, max: expr.max });
        // bounds = 表达式值域（程度占比制 / 需求防呆共用同一值域）
        return {
          outcome,
          roll: expr.total,
          rate: target,
          margin: diceMargin(mode, expr.total, target),
          mode,
          bounds: { min: expr.min, max: expr.max },
        };
      }
      // 表达式非法：不抛错，落回 D100 路径（下方）
    }
  }
  // D100 路径：需求值 = AI 标注优先 → 角色属性（attr_dc_enabled；属性 DC 按模式反向，
  // 见 attribute-dc.resolveOptionSuccessRateWithAttr）→ 档位兜底
  const rate = resolveOptionSuccessRateWithAttr(text, char, d.attr_dc_enabled, d.low_roll);
  if (rate === null) return null;
  const { roll, outcome } = rollDice(rate, crits.success, crits.fail, mode);
  return { outcome, roll, rate, margin: diceMargin(mode, roll, rate), mode };
}

/** 只判定不应用（v61 就地重掷用）：按当前设置掷骰并返回结果；骰子关闭/无需求值返回 null。
 *  每次调用重新掷一次（就地重掷的「↻」即重复调本函数取新结果）。
 *  opts.cardDisabled 与 applyOptionBehavior 的 layerSettled 同义：该楼层已结算卡牌经济时
 *  走非卡路径——重掷/预掷预览与最终应用（cards 会被剥除）口径一致，防预告与实际不符。 */
export function rollOptionDice(text: string, opts?: { cardDisabled?: boolean }): DiceRollResult | null {
  const gs = useGlobalSettingsStore();
  const d = gs.settings.dice;
  if (!d.enabled) return null;
  const char = gs.currentCharacterId != null ? getStCharacter(gs.currentCharacterId) : undefined;
  return rollForOption(text, d, char, opts);
}

type ApplyOptionOpts = {
  view?: 'options' | 'enrich';
  poolEntryIds?: string[];
  generationId?: string;
  matchedEntryId?: string | null;
  scopeId?: string;
  /** v63 防刷：楼层标识（message+swipe），用于「同一层只结算一次判定」（战绩与卡牌经济同口径）。 */
  messageId?: number;
  swipeId?: number;
  /** v61：调用方已 stage 的判定结果（就地重掷两步流），提供则不再内部掷骰 */
  preRolled?: DiceRollResult | null;
};

/** 同楼层互斥锁：send 往返（await sendTextareaMessage）窗口内同一楼层的第二次点击整体忽略，
 *  防连点双发消息、双掷骰、双结算判定——markCardSettled 在 send 之后才落标记，
 *  isCardSettled 检查与标记之间隔着 await，仅靠它挡不住并发点击（v63 防刷的并发补口）。 */
const layerBusy = new Set<string>();

/** 同楼层点击是否处理中（send 往返窗口）：调用方在触发副作用（选中打勾/收起/emit）前查询，
 *  被拒时整次点击跳过——applyOptionBehavior 内部互斥只挡重复应用，调用方 UI 态需自行规避 */
export function isOptionApplyBusy(messageId: number | null | undefined, swipeId: number | null | undefined): boolean {
  if (messageId == null || swipeId == null) return false;
  return layerBusy.has(`${messageId}:${swipeId}`);
}

export async function applyOptionBehavior(
  option: ChoiceOption,
  behavior: 'send' | 'fill' | 'append' | 'insert',
  opts?: ApplyOptionOpts,
): Promise<DiceRollResult | null> {
  const busyKey = opts?.messageId != null && opts?.swipeId != null ? `${opts.messageId}:${opts.swipeId}` : null;
  if (busyKey) {
    if (layerBusy.has(busyKey)) return null;
    layerBusy.add(busyKey);
  }
  try {
    return await applyOptionBehaviorInner(option, behavior, opts);
  } finally {
    if (busyKey) layerBusy.delete(busyKey);
  }
}

async function applyOptionBehaviorInner(
  option: ChoiceOption,
  behavior: 'send' | 'fill' | 'append' | 'insert',
  opts?: ApplyOptionOpts,
): Promise<DiceRollResult | null> {
  const content = parseOptionContent(option.text);
  // 骰子判定（发送框拦截前完成：玩家已点选，先掷骰播报判定结果；若发送框
  // 随后确认不可用，选项不应用、统计不计，行内 chip 仍展示本次判定）
  let diceResult: DiceRollResult | null = opts?.preRolled ?? null;
  // v63 防刷：该楼层（message+swipe）是否已结算过卡牌经济——已结算则本次判定走非卡路径
  // （无行动币/无幸运包/无卡触发/无套装），防「单层反复判定」刷卡。
  const layerSettled = opts?.messageId != null && opts?.swipeId != null && isCardSettled(opts.messageId, opts.swipeId);
  if ((opts?.view ?? 'options') === 'options') {
    const gs = useGlobalSettingsStore();
    const d = gs.settings.dice;
    // 未提供 preRolled（常规点击）才在此掷骰；就地重掷路径由组件先 rollOptionDice stage
    if (d.enabled && !opts?.preRolled) {
      const char = gs.currentCharacterId != null ? getStCharacter(gs.currentCharacterId) : undefined;
      diceResult = rollForOption(option.text, d, char, { cardDisabled: layerSettled });
    }
    // 已结算楼层的 preRolled（就地重掷二次确认）也不带卡决议，杜绝 packOffer 二次开窗
    if (layerSettled && diceResult?.cards) {
      diceResult = { ...diceResult, cards: undefined };
    }
    if (diceResult) {
      // 判定注释对用户全程隐形（v67）：输入框一律只放纯正文，注释挂 pendingTurn，
      // 等玩家消息真正发出（MESSAGE_SENT）时回写进该消息——AI 读到、聊天渲染不可见、
      // 随消息持久化。v67 三段结构：代码固定头部（结局/裁定对象/点数/需求/差值/程度）
      // + 模板正文 + 固定纪律尾注，占位符 {rate}/{roll}/{margin}/{degree} 全部模板通用
      // （rate=D100 需求值或骰式映射 DC，margin=diceMargin 归一化差值，degree 见
      // marginDegree）。v58：成功/失败按档位取独立模板；v73：档位改占比制
      // （按差值占判定空间比例，ctx 含 mode+bounds）。
      // 裁定对象回显：头部「裁定对象」键消歧注释修饰的是哪个行动（编辑、
      // 单消息多行动场景）；压平空白并截 20 字，防长标题撑爆头部
      const optionTitle = parseOptionType(option.text).replace(/\s+/g, ' ').trim().slice(0, 20) || undefined;
      const marker = buildDiceMarker(
        diceResult.outcome,
        diceResult.roll,
        diceResult.rate,
        {
          fail: {
            low: d.fail_send_low_template,
            mid_low: d.fail_send_mid_low_template,
            mid: d.fail_send_mid_template,
            mid_high: d.fail_send_mid_high_template,
            high: d.fail_send_high_template,
          },
          critSuccess: d.crit_success_send_template,
          critFail: d.crit_fail_send_template,
          success: {
            low: d.success_send_low_template,
            mid_low: d.success_send_mid_low_template,
            mid: d.success_send_mid_template,
            mid_high: d.success_send_mid_high_template,
            high: d.success_send_high_template,
          },
        },
        {
          fail: {
            low: d.fail_template,
            mid_low: d.fail_template,
            mid: d.fail_template,
            mid_high: d.fail_template,
            high: d.fail_template,
          },
          critSuccess: d.crit_success_template,
          critFail: d.crit_fail_template,
          success: {
            low: d.success_template,
            mid_low: d.success_template,
            mid: d.success_template,
            mid_high: d.success_template,
            high: d.success_template,
          },
        },
        diceResult.margin,
        { mode: diceResult.mode, rate: diceResult.rate, bounds: diceResult.bounds },
        optionTitle,
      );
      // v62 卡牌机制行：触发卡的效果摘要与结局模板共存于同一条 HTML 注释（不产生重复
      // `<!--`），AI 读到、聊天界面不可见。叙事/演出行不注入正文 AI，只剩机制因果行。
      // 模板/卡行均约定避免 `--`（见设置页 hint）。
      const cardLines = diceResult.cards?.narrativeLines ?? [];
      // 动态槽摘要素材与 armDiceTurnPrompt 同源：stage 带上 meta，MESSAGE_SENT 回写成功
      // 后由 flushPendingTurnMarker 挂同一份摘要（send 分支不再重复计算）。
      // degree 用与注释同一占比口径（v73 起需带 ctx）
      const degreeCtx = { mode: diceResult.mode, rate: diceResult.rate, bounds: diceResult.bounds };
      stagePendingTurn(content, marker ? mergeCardNarratives(marker, cardLines) : wrapCardNarratives(cardLines), {
        outcome: diceResult.outcome,
        degree: marginDegree(diceResult.outcome, diceResult.margin, degreeCtx),
        cardNames: diceResult.cards?.triggered.map(t => t.card.name),
      });
      // 判定结果不弹酒馆 toastr（失败用 toastr.error 红得像插件报错）——
      // 改由视图层行内判定 chip 反馈（结局+差值，主面板/悬浮球各自实现），
      // 本共享层只返回 diceResult 供组件消费。
    }
  }
  const $textarea = $('#send_textarea');
  // 发送框 DOM 缺失（酒馆重构/隐藏聊天界面）时短路：jQuery 空集的 .val() 是
  // getter 语义不生效、insert 分支的 [0] 为 undefined 访问 selectionStart 会抛错。
  // 统一在此拦截，行为不执行、统计也不计（选项并未真正应用）
  if (!$textarea.length) {
    toastr.error(t`发送框不可用，无法应用选项`);
    return diceResult;
  }
  if (behavior === 'insert') {
    // 光标处插入：selectionStart/End 保留点选项按钮（textarea 失焦）前的 caret 位置——
    // 浏览器规范行为，移动端同样适用。有选区时替换选区（标准文本插入），
    // 无选区时纯插入；空输入框或 caret 在末尾时等价尾附，无需特判。
    // textarea.value 的 setter 规范会把 caret 移到值末尾，故"从未手动聚焦"场景
    // 自然退化为末尾插入，不会把内容塞到开头。
    const el = $textarea[0] as HTMLTextAreaElement;
    const pos = el.selectionStart ?? String($textarea.val() ?? '').length;
    const end = el.selectionEnd ?? pos;
    const cur = String($textarea.val() ?? '');
    const next = cur.slice(0, pos) + content + cur.slice(end);
    $textarea.val(next)[0].dispatchEvent(new Event('input', { bubbles: true }));
    // 写值后 caret 会被重置，恢复到插入内容之后，方便用户接着编辑
    const caret = pos + content.length;
    try {
      el.focus();
      el.setSelectionRange(caret, caret);
    } catch {
      /* setSelectionRange 在极少数无 selection 的输入上可能抛错，忽略 */
    }
  } else if (behavior === 'append') {
    $textarea.val($textarea.val() + content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  } else if (behavior === 'fill') {
    $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  }
  // 统计埋点（共享层唯一计数点）：主面板与悬浮球弹窗都走这里，弹窗内禁止另写。
  // 润色视图完全不计入；调用方须显式传 view='enrich'，默认 'options'
  // （漏标只多计、不丢计，安全方向）。精确归因优先（matchedEntryId 三态），
  // 命中口径由 core/stats.ts 判定（string 命中 / null 不命中 / undefined 旧代回退共现）。
  // content 为 parse 后的选项正文（纯正文，无隐形注释），写入 last_selected_text
  // 供统计页展示与归因种子——判定注释经挂起回写进消息，从源头不接触输入框与统计口径。
  if ((opts?.view ?? 'options') === 'options') {
    recordOptionSelected(opts?.poolEntryIds ?? [], opts?.generationId, content, opts?.matchedEntryId, opts?.scopeId);
  }
  if (behavior === 'send') {
    // 每回合动态摘要槽（与常驻契约分工：depth 4 常驻教「注释是什么」，本槽 depth 1 管
    // 「本回合裁定」）：位置贴近生成点、不依赖注释在历史中存活。send 即发即读先挂摘要版；
    // fill/insert/append 由 MESSAGE_SENT 回写时挂同一份摘要（见 dice-contract 文件头注释）。
    // 门控（dice.enabled + main_ai_awareness）在 arm 内部。
    if (diceResult) {
      armDiceTurnPrompt(
        diceResult.outcome,
        marginDegree(diceResult.outcome, diceResult.margin, {
          mode: diceResult.mode,
          rate: diceResult.rate,
          bounds: diceResult.bounds,
        }),
        diceResult.cards?.triggered.map(t => t.card.name),
      );
    }
    // 发送：输入框此刻只含纯正文（判定注释已挂起，发送管线内由 MESSAGE_SENT 回写）。
    // 异常（发送被拦截/网络失败等）时输入框兜底恢复纯正文，保证可手动重试；
    // 挂起判定保留——用户随后手动发送同一正文时回写仍然生效。
    try {
      await sendTextareaMessage();
    } catch (err) {
      clearDiceTurnPrompt();
      $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
      throw err;
    }
    // 非空 = 本次发送未真正发生（正常路径酒馆已清空输入框）：恢复纯正文兜底 +
    // 撤下动态摘要槽（防过期裁定污染无关生成）；挂起判定同上保留待手动发送。
    const current = String($textarea.val() ?? '');
    if (current !== '') {
      if (current !== content) {
        $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
      }
      clearDiceTurnPrompt();
    }
  }
  // 骰子战绩埋点：应用成功后（发送框可用 + 行为已执行）按判定结果记账；
  // 发送框不可用早退路径已提前 return，不计数（与应用口径一致）。v61 起记录
  // 最近判定历史（含选项正文摘要），就地重掷只记最终应用的这一次。
  // 战绩与卡牌经济同口径（同层只记首次）：该层已结算（layerSettled）则不进战绩
  // ——同层反复换选项点击/反复重掷确认不再刷判定统计与最近判定历史。楼层标记的语义
  // 因此从「卡牌经济已结算」扩展为「该层判定已结算（战绩+经济）」：首次应用即标记，
  // 卡牌关/骰式路径同样生效（否则这两条路径没有防重载体，战绩仍会每次记）。
  // 楼层标识缺失（旧调用方未传 messageId/swipeId）无法防重，保持如实记录。
  if (diceResult) {
    if (!layerSettled) {
      if (opts?.messageId != null && opts?.swipeId != null) markCardSettled(opts.messageId, opts.swipeId);
      recordDiceRoll(diceResult.outcome, diceResult.roll, diceResult.rate, content);
    }
    // v62 卡牌落库（真正应用后才走）：按结局收支行动币、幸运命中产开卡包 offer。
    // 就地重掷两步流的预览（rollOptionDice）不 commit，只有这次确认应用才提交。
    // v63 防刷：只有首次结算带 cards（该楼层走卡路径）；标记已在上方首次路径完成，
    // 此后同一层判定 cards 为空、天然不落经济——「单层最多结算一次」。
    if (diceResult.cards) commitCardRun(diceResult.cards);
  }
  return diceResult;
}
