import type { ChoiceOption } from '@/core/options-store';
import { isCardSettled, markCardSettled } from '@/core/options-store';
import toastr from 'toastr';
import { sendTextareaMessage } from '@sillytavern/script';
import { parseOptionContent, parseOptionDice } from '@/util/option-format';
import { resolveOptionSuccessRateWithAttr } from '@/core/attribute-dc';
import { getStCharacter } from '@/core/st-character';
import { recordOptionSelected, recordDiceRoll } from '@/core/stats';
import { rollDice, buildDiceMarker, diceMargin, judgeOutcome, type DiceOutcome, type DiceRollMode } from '@/core/dice';
import { rollDiceExpression, mapProxyToRange } from '@/core/dice-expression';
import { resolveCardRoll, commitCardRun, bumpDailyTask, type CardResolution } from '@/core/cards';
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
 * 成功/失败/大成功/大失败都把演绎指令包在 HTML 注释中拼入应用文本（send 直接发送、
 * fill/insert/append 填入输入框可编辑删除，AI 请求文本原样携带、聊天界面渲染不可见；
 * v57 起成功也注入，模板支持 {margin}/{degree}，degree = 判定差值程度词；v58 成功/失败
 * 按 margin 档位拆独立指令）。
 * 返回判定结果供组件做行内视觉反馈（判定 chip：结局+差值；不再弹酒馆 toastr，避免失败
 * 红得像插件报错），未掷骰（关闭/润色/无需求值）返回 null。margin 已经 diceMargin 归一化
 * （成功侧为正，供 chip 与 marker 同口径）。
 * 判定结果只进战绩统计（stats.dice + 最近判定历史 v61），不进条目统计——last_selected_text 保持原始正文。
 */

/** 单次判定结果（组件 chip 与 marker 共用）：margin = diceMargin(mode, roll, rate) 归一化差值。
 *  v62 卡牌系统：card_enabled 开时判定会叠加卡效果，附加 cards（触发卡/幸运命中/行动币/
 *  卡叙事行）供 chip 展示、commitCardRun 落库与弹窗触发。card_enabled 关时无 cards 字段，
 *  与现状完全一致（零回归）。 */
export type DiceRollResult = {
  outcome: DiceOutcome;
  roll: number;
  rate: number;
  margin: number;
  mode: DiceRollMode;
  cards?: CardResolution;
};

/** 判定方向对应的大成功/大失败阈值组：low 模式用低值大成功/高值大失败（COC），
 *  high 模式用大值大成功/小值大失败（默认）。 */
const critThresholds = (d: DiceSettings): { success: number; fail: number } =>
  d.low_roll
    ? { success: d.low_roll_crit_success_max, fail: d.low_roll_crit_fail_min }
    : { success: d.crit_success_min, fail: d.crit_fail_max };

/** 把卡叙事行合并进既有演绎注释（v62）：插在 `-->` 闭合前，与结局模板共存于同一条注释。 */
const mergeCardNarratives = (marker: string, lines: string[]): string => {
  if (lines.length === 0) return marker;
  const body = lines.join('\n');
  const m = marker.match(/^(<!--[\s\S]*?)(-->\s*)$/);
  if (!m) return marker;
  return `${m[1].replace(/\s*$/, '')}\n${body}\n${m[2]}`;
};

/** 无结局模板时为卡叙事单独包一条注释。 */
const wrapCardNarratives = (lines: string[]): string => (lines.length ? `<!--${lines.join('\n')}-->\n` : '');

/** 按设置掷一次骰并判出结果（D100 或骰式）。无需求值/骰子关闭返回 null。纯判定、不应用、不记账。
 *  供 applyOptionBehavior 与 v61 就地重掷（rollOptionDice → stage → 确认应用）共用。
 *  v62 卡牌：card_enabled 开且未走骰式路径时，改走 cards.ts 的 resolveCardRoll 叠加卡效果
 *  （预掷/后置修正 + 扣耐预留 + 幸运开包 offer），cards 字段随结果返回；关则走现状路径零回归。 */
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
    const dice = parseOptionDice(text);
    if (dice) {
      const expr = rollDiceExpression(dice.formula);
      if (expr) {
        const target = mapProxyToRange(dice.rate, expr.min, expr.max);
        const critS = mapProxyToRange(crits.success, expr.min, expr.max);
        const critF = mapProxyToRange(crits.fail, expr.min, expr.max);
        const outcome = judgeOutcome(expr.total, target, critS, critF, mode);
        return { outcome, roll: expr.total, rate: target, margin: diceMargin(mode, expr.total, target), mode };
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
 *  每次调用重新掷一次（就地重掷的「↻」即重复调本函数取新结果）。 */
export function rollOptionDice(text: string): DiceRollResult | null {
  const gs = useGlobalSettingsStore();
  const d = gs.settings.dice;
  if (!d.enabled) return null;
  const char = gs.currentCharacterId != null ? getStCharacter(gs.currentCharacterId) : undefined;
  return rollForOption(text, d, char);
}

export async function applyOptionBehavior(
  option: ChoiceOption,
  behavior: 'send' | 'fill' | 'append' | 'insert',
  opts?: {
    view?: 'options' | 'enrich';
    poolEntryIds?: string[];
    generationId?: string;
    matchedEntryId?: string | null;
    scopeId?: string;
    /** v63 防刷：楼层标识（message+swipe），用于「同一层只结算一次卡牌经济」。 */
    messageId?: number;
    swipeId?: number;
    /** v61：调用方已 stage 的判定结果（就地重掷两步流），提供则不再内部掷骰 */
    preRolled?: DiceRollResult | null;
  },
): Promise<DiceRollResult | null> {
  const content = parseOptionContent(option.text);
  // 骰子判定（发送框拦截前完成：玩家已点选，先掷骰播报判定结果；若发送框
  // 随后确认不可用，选项不应用、统计不计，行内 chip 仍展示本次判定）
  let diceResult: DiceRollResult | null = opts?.preRolled ?? null;
  let appliedContent = content;
  // v63 防刷：该楼层（message+swipe）是否已结算过卡牌经济——已结算则本次判定走非卡路径
  // （无行动币/无幸运包/无扣耐/无套装），防「单层反复判定」刷卡。
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
      // 隐形演绎注释随所有行为拼接（v57 起成功也注入）：send 直接发送（AI 读到注释）、
      // fill/insert/append 拼进输入框（用户可编辑删除，手动发送时 AI 同样读到）。
      // 注释是 HTML 注释——聊天界面渲染不可见，AI 请求文本原样携带；
      // 占位符 {rate}/{roll}/{margin}/{degree} 全部模板通用（rate=D100 需求值或骰式映射 DC，
      // margin=diceMargin 归一化差值，degree 见 marginDegree）。v58：成功/失败按档位取独立模板。
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
      );
      // v62 卡牌叙事：触发卡的 narrative 与结局模板共存于同一条 HTML 注释（不产生重复
      // `<!--`），AI 读到、聊天界面不可见。模板/叙事均约定避免 `--`（见设置页 hint）。
      const cardLines = diceResult.cards?.narrativeLines ?? [];
      appliedContent = (marker ? mergeCardNarratives(marker, cardLines) : wrapCardNarratives(cardLines)) + content;
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
    const next = cur.slice(0, pos) + appliedContent + cur.slice(end);
    $textarea.val(next)[0].dispatchEvent(new Event('input', { bubbles: true }));
    // 写值后 caret 会被重置，恢复到插入内容之后，方便用户接着编辑
    const caret = pos + appliedContent.length;
    try {
      el.focus();
      el.setSelectionRange(caret, caret);
    } catch {
      /* setSelectionRange 在极少数无 selection 的输入上可能抛错，忽略 */
    }
  } else if (behavior === 'append') {
    $textarea.val($textarea.val() + appliedContent)[0].dispatchEvent(new Event('input', { bubbles: true }));
  } else {
    $textarea.val(appliedContent)[0].dispatchEvent(new Event('input', { bubbles: true }));
  }
  // 统计埋点（共享层唯一计数点）：主面板与悬浮球弹窗都走这里，弹窗内禁止另写。
  // 润色视图完全不计入；调用方须显式传 view='enrich'，默认 'options'
  // （漏标只多计、不丢计，安全方向）。精确归因优先（matchedEntryId 三态），
  // 命中口径由 core/stats.ts 判定（string 命中 / null 不命中 / undefined 旧代回退共现）。
  // content 为 parse 后的选项正文（不带隐形注释），写入 last_selected_text
  // 供统计页展示与归因种子——判定注释只进发送文本，不污染统计口径。
  if ((opts?.view ?? 'options') === 'options') {
    recordOptionSelected(opts?.poolEntryIds ?? [], opts?.generationId, content, opts?.matchedEntryId, opts?.scopeId);
    // v62 每日任务「点选选项」进度：复用本路径埋点（card_enabled 开才累计）
    bumpDailyTask(useGlobalSettingsStore(), 'select');
  }
  if (behavior === 'send') {
    // 发送：输入框此刻短暂包含「隐形注释+正文」，发送后酒馆清空，用户不可感知。
    // 异常（发送被拦截/网络失败等）时输入框会残留注释——必须恢复纯正文，
    // 保证「输入框不注入判定文本」的承诺在失败路径同样成立。
    try {
      await sendTextareaMessage();
    } catch (err) {
      $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
      throw err;
    }
    // 发送失败/取消恢复为纯正文（无异常时输入框已由酒馆清空，兜底幂等）
    const current = String($textarea.val() ?? '');
    if (current !== '' && current !== content && appliedContent !== content) {
      $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
  // 骰子战绩埋点：应用成功后（发送框可用 + 行为已执行）按判定结果记账；
  // 发送框不可用早退路径已提前 return，不计数（与应用口径一致）。v61 起记录
  // 最近判定历史（含选项正文摘要），就地重掷只记最终应用的这一次。
  if (diceResult) {
    recordDiceRoll(diceResult.outcome, diceResult.roll, diceResult.rate, content);
    // v62 每日任务「做一次判定」进度：复用 recordDiceRoll 路径埋点（card_enabled 开才累计）
    bumpDailyTask(useGlobalSettingsStore(), 'judge');
    // v62 卡牌落库（真正应用后才走）：扣触发卡耐久、按结局收支行动币、幸运命中产开卡包
    // offer。就地重掷两步流的预览（rollOptionDice）不 commit，只有这次确认应用才提交。
    // v63 防刷：只有首次结算带 cards（该楼层走卡路径）；首次提交前标记楼层已结算，
    // 此后同一层判定 cards 为空、天然不落经济——「单层最多结算一次」。
    if (diceResult.cards) {
      if (opts?.messageId != null && opts?.swipeId != null) markCardSettled(opts.messageId, opts.swipeId);
      commitCardRun(diceResult.cards);
    }
  }
  return diceResult;
}
