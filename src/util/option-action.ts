import type { ChoiceOption } from '@/core/options-store';
import toastr from 'toastr';
import { sendTextareaMessage } from '@sillytavern/script';
import { parseOptionContent, resolveOptionSuccessRate } from '@/util/option-format';
import { recordOptionSelected, recordDiceRoll } from '@/core/stats';
import { rollDice, buildDiceMarker, type DiceOutcome } from '@/core/dice';
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
 *
 * v57 骰子判定（难度制）：仅行动选项视图（view='options'）且骰子开关开启时掷 D100。
 * 有需求值（AI 标注或档位兜底）的选项按 resolveOptionSuccessRate 判定——掷出 ≥ 需求值
 * 才算成功，点数越大越好。判定结果随所有行为生效：成功/失败/大成功/大失败都把演绎指令
 * 包在 HTML 注释中拼入应用文本（send 直接发送、fill/insert/append 填入输入框可编辑删除，
 *  AI 请求文本原样携带、聊天界面渲染不可见；v57 起成功也注入，模板支持 {margin}/{degree}，
 *  degree = 点数与需求差值的程度词，见 core/dice.ts marginDegree；成功模板为空则不注入）。
 *  v58：成功/失败模板按 margin 档位拆独立指令（见 core/dice.ts degreeTierFor），
 *  每档 send 为空回退该结局单条回退文案。
 * 返回判定结果供组件做行内视觉反馈（判定 chip：结局+差值；不再弹酒馆 toastr，避免失败
 * 红得像插件报错），未掷骰（关闭/润色/无需求值）返回 null。
 * 判定结果只进战绩统计（stats.dice），不进条目统计——last_selected_text 保持原始正文。
 */
export async function applyOptionBehavior(
  option: ChoiceOption,
  behavior: 'send' | 'fill' | 'append' | 'insert',
  opts?: {
    view?: 'options' | 'enrich';
    poolEntryIds?: string[];
    generationId?: string;
    matchedEntryId?: string | null;
    scopeId?: string;
  },
): Promise<{ outcome: DiceOutcome; roll: number; rate: number } | null> {
  const content = parseOptionContent(option.text);
  // 骰子判定（发送框拦截前完成：玩家已点选，先掷骰播报判定结果；若发送框
  // 随后确认不可用，选项不应用、统计不计，行内 chip 仍展示本次判定）
  let diceResult: { outcome: DiceOutcome; roll: number; rate: number } | null = null;
  let appliedContent = content;
  if ((opts?.view ?? 'options') === 'options') {
    const gs = useGlobalSettingsStore();
    const d = gs.settings.dice;
    if (d.enabled) {
      const rate = resolveOptionSuccessRate(option.text);
      if (rate !== null) {
        const { roll, outcome } = rollDice(rate, d.crit_success_min, d.crit_fail_max);
        diceResult = { outcome, roll, rate };
        // 隐形演绎注释随所有行为拼接（v57 起成功也注入）：send 直接发送（AI 读到注释）、
        // fill/insert/append 拼进输入框（用户可编辑删除，手动发送时 AI 同样读到）。
        // 注释是 HTML 注释——聊天界面渲染不可见，AI 请求文本原样携带；
        // 占位符 {rate}/{roll}/{margin}/{degree} 全部模板通用（degree 见 marginDegree）。
        // v58：成功/失败按档位取独立模板；单条 fallback 文案铺到三档兜底（档位无关短标签）。
        const marker = buildDiceMarker(
          outcome,
          roll,
          rate,
          {
            fail: {
              low: d.fail_send_low_template,
              mid: d.fail_send_mid_template,
              high: d.fail_send_high_template,
            },
            critSuccess: d.crit_success_send_template,
            critFail: d.crit_fail_send_template,
            success: {
              low: d.success_send_low_template,
              mid: d.success_send_mid_template,
              high: d.success_send_high_template,
            },
          },
          {
            fail: { low: d.fail_template, mid: d.fail_template, high: d.fail_template },
            critSuccess: d.crit_success_template,
            critFail: d.crit_fail_template,
            success: { low: d.success_template, mid: d.success_template, high: d.success_template },
          },
        );
        appliedContent = marker + content;
        // 判定结果不弹酒馆 toastr（失败用 toastr.error 红得像插件报错）——
        // 改由视图层行内判定 chip 反馈（结局+差值，主面板/悬浮球各自实现），
        // 本共享层只返回 diceResult 供组件消费。
      }
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
  // 发送框不可用早退路径已提前 return，不计数（与应用口径一致）
  if (diceResult) {
    recordDiceRoll(diceResult.outcome, diceResult.roll, diceResult.rate);
  }
  return diceResult;
}
