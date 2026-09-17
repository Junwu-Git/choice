import type { ChoiceOption } from '@/core/options-store';
import toastr from 'toastr';
import { sendTextareaMessage } from '@sillytavern/script';
import { parseOptionContent } from '@/util/option-format';
import { recordOptionSelected } from '@/core/stats';

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
 * 该维度，避免点击时切了 config 导致记错；旧代消息缺该字段时由统计层兜底搜索。 */
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
) {
  const content = parseOptionContent(option.text);
  const $textarea = $('#send_textarea');
  // 发送框 DOM 缺失（酒馆重构/隐藏聊天界面）时短路：jQuery 空集的 .val() 是
  // getter 语义不生效、insert 分支的 [0] 为 undefined 访问 selectionStart 会抛错。
  // 统一在此拦截，行为不执行、统计也不计（选项并未真正应用）
  if (!$textarea.length) {
    toastr.error(t`发送框不可用，无法应用选项`);
    return;
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
  } else {
    $textarea.val(content)[0].dispatchEvent(new Event('input', { bubbles: true }));
  }
  // 统计埋点（共享层唯一计数点）：主面板与悬浮球弹窗都走这里，弹窗内禁止另写。
  // 润色视图完全不计入；调用方须显式传 view='enrich'，默认 'options'
  // （漏标只多计、不丢计，安全方向）。精确归因优先（matchedEntryId 三态），
  // 命中口径由 core/stats.ts 判定（string 命中 / null 不命中 / undefined 旧代回退共现）。
  // content 为 parse 后的选项正文，写入 last_selected_text 供统计页展示与归因种子。
  if ((opts?.view ?? 'options') === 'options') {
    recordOptionSelected(opts?.poolEntryIds ?? [], opts?.generationId, content, opts?.matchedEntryId, opts?.scopeId);
  }
  if (behavior === 'send') {
    await sendTextareaMessage();
  }
}
