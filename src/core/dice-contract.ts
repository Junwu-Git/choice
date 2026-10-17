/**
 * 正文 AI 判定契约注入（v67，dice.main_ai_awareness 默认开）：用 setExtensionPrompt 把
 * 「玩家消息开头的 HTML 注释是骰子裁定指令」的说明常驻注入正文生成请求（IN_CHAT depth 4、
 * system role——文本补全 script.js:5588 与聊天补全 openai.js:847 两条路径都会消费
 * IN_CHAT 深度注入，签名已核对酒馆源码）。判定注释此前全靠自解释（每条消息的注释里
 * 没有任何契约说明），本注入是「立契约」通道：一次常驻说明 + 注释自解释双保险。
 *
 * setExtensionPrompt 是酒馆全局单例槽（按 key 隔离）：开关关闭或骰子关时置空串即撤销
 * （getExtensionPrompt 过滤空 value，不会注入空段）；不随聊天切换变化，无需按 CHAT_CHANGED
 * 重挂。@sillytavern/script 导入按 AGENTS.md 收敛在 core 层；全程 try/catch，桥接失败
 * 只 console.warn 不影响主体功能（第三方桥接可选哲学）。
 *
 * 挂起判定（stagePendingTurn/flushPendingTurnMarker）：判定注释对用户全程隐形的机制——
 * 四种行为（send/fill/insert/append）输入框一律只放纯正文，注释先挂在内存单槽，
 * 玩家消息真正发出（MESSAGE_SENT）时回写进该消息的 mes 开头：AI 请求读到、聊天渲染
 * 不可见、随消息持久化（swipe/continue/总结仍可见）。回写时序已核对酒馆源码——
 * Generate（script.js:4394）先 await sendMessageAsUser（内部存档后 await emit
 * MESSAGE_SENT，script.js:5858），之后才组装提示词（script.js:4401 起），回写必然
 * 早于提示词构建；生成结束 ST 统一存档把回写结果落盘。单槽覆盖式：同回合重复点选
 * 以最后一次为准；未命中（用户整体重写正文）不回写不注入、挂起保留至同内容后发，
 * 换聊天 CHAT_CHANGED 清空防陈旧判定跨聊天误挂。
 * 这是扩展对正文 AI 请求的一个注入点（常驻契约）+ 一条消息内回写通道，全部收敛在
 * 本模块，开关即置空撤销。曾有第二个注入点「每回合动态槽」（choice_dice_turn，判定后
 * depth 1 即时摘要）——与消息内注释+常驻契约三层重复，已按用户要求整体移除，勿回填。
 */

import {
  chat,
  extension_prompt_roles,
  extension_prompt_types,
  saveChatDebounced,
  setExtensionPrompt,
} from '@sillytavern/script';
import { useGlobalSettingsStore } from '@/store/global-settings';

const CONTRACT_KEY = 'choice_dice_contract';
const CONTRACT_DEPTH = 4;

const CONTRACT_TEXT = [
  '【跑团辅助·choice】玩家消息开头可能出现 <!--…--> 形式的隐形注释：这是骰子判定系统对该次行动的自动裁定（成功/失败与程度）。',
  '请按注释中的演绎方向与本回合结局撰写正文；正文中不要提及骰子、点数、需求值等判定细节，也不要模仿或输出任何 HTML 注释。',
].join('');

/** 按当前设置同步契约注入（开 = 写入注入段，关 = 清空注入槽）。幂等，可任意频次调用。 */
export function syncDiceContractPrompt(): void {
  try {
    const gs = useGlobalSettingsStore();
    const on = gs.settings.dice.enabled && gs.settings.dice.main_ai_awareness;
    setExtensionPrompt(
      CONTRACT_KEY,
      on ? CONTRACT_TEXT : '',
      extension_prompt_types.IN_CHAT,
      CONTRACT_DEPTH,
      false,
      extension_prompt_roles.SYSTEM,
    );
  } catch (error) {
    console.warn('[Choice] 判定契约注入失败', error);
  }
}

// ── 挂起判定（判定注释对用户全程隐形） ──────────────────────────────────

/** 内存单槽：content = 点选的选项纯正文（匹配依据），marker = 组装好的完整判定注释。 */
let pendingTurn: {
  content: string;
  marker: string;
} | null = null;

/** 挂起一次判定（点选判定后调用，send/fill/insert/append 四行为统一走此通道）。
 *  marker 为空串（无模板）视为无注入、清槽。 */
export function stagePendingTurn(content: string, marker: string): void {
  pendingTurn = marker ? { content, marker } : null;
}

/** 清空挂起（换聊天防陈旧判定跨聊天误挂；点选覆盖由 stage 自身完成）。幂等。 */
export function clearPendingTurn(): void {
  pendingTurn = null;
}

/** MESSAGE_SENT 回写（index.ts 订阅）：刚入 chat 的玩家消息命中挂起内容时，
 *  把判定注释前插进该消息的 mes 开头——AI 请求读到、聊天渲染不可见、随消息持久化。
 *  匹配口径：玩家可能微调过填入的正文（改字/续写/前后拼接），取正文压平空白后的
 *  前 20 字做包含匹配；整体重写视为放弃该判定（不回写不注入，挂起保留至同内容后发）。 */
export function flushPendingTurnMarker(chatId: number): void {
  try {
    const pending = pendingTurn;
    if (!pending) return;
    const msg = chat[chatId] as StChatMessage | undefined;
    if (!msg?.is_user) return;
    const mes = String(msg.mes ?? '');
    const needle = pending.content.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (!needle || !mes.replace(/\s+/g, ' ').includes(needle)) return;
    pendingTurn = null;
    if (!mes.includes(pending.marker)) {
      msg.mes = `${pending.marker}${mes}`;
      saveChatDebounced();
    }
  } catch (error) {
    console.warn('[Choice] 判定注释回写失败', error);
  }
}
