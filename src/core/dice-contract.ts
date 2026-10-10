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
 * 每回合动态槽（armDiceTurnPrompt/clearDiceTurnPrompt，key `choice_dice_turn`）：
 * send 点选判定后挂载「本回合已裁定：结局（程度）[受卡牌影响]」的即时指令，IN_CHAT
 * depth 1、system——位置贴近生成点、不依赖判定注释在历史消息中存活（预设/正则/总结
 * 可能改写消息文本），弱模型对「最近 system 指令」的服从率也高于历史里的内嵌说明。
 * 与常驻契约分工：depth 4 常驻教「注释是什么」，动态槽管「本回合裁定」。挂载门控
 * （dice.enabled + main_ai_awareness）在 arm 内部；AI 回复落地（MESSAGE_RECEIVED/
 * GENERATION_ENDED）或中止（GENERATION_STOPPED）即清空，事件订阅在 index.ts。
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
 * 这是扩展对正文 AI 请求的两个注入点（常驻契约 + 每回合动态槽）+ 一条消息内回写
 * 通道，全部收敛在本模块，开关/清空即置空撤销。
 */

import {
  chat,
  extension_prompt_roles,
  extension_prompt_types,
  saveChatDebounced,
  setExtensionPrompt,
} from '@sillytavern/script';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { DICE_OUTCOME_LABEL, type DiceOutcome } from '@/core/dice';

const CONTRACT_KEY = 'choice_dice_contract';
const CONTRACT_DEPTH = 4;

/** 每回合动态槽独立 key/深度：depth 1 紧贴玩家刚发送的消息 */
const TURN_KEY = 'choice_dice_turn';
const TURN_DEPTH = 1;

const CONTRACT_TEXT = [
  '【跑团辅助·choice】玩家消息开头可能出现 <!--…--> 形式的隐形注释：这是骰子判定系统对该次行动的自动裁定（成功/失败与程度），可能附带卡牌发动的原因信息。',
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

/** 每回合动态槽的摘要文本（armDiceTurnPrompt 与 flushPendingTurnMarker 回写共用）：
 *  槽内恒为短摘要（结局+程度+受卡名），完整判定注释只活在消息内——回写成功后槽里再放
 *  一份完整注释是与消息内容完全重复的长注入（百余 token/回合），摘要兜底语义不变。 */
function buildTurnSummary(outcome: DiceOutcome, degree: string, cardNames?: string[]): string {
  const cards = cardNames?.length ? `，受卡牌「${cardNames.join('」「')}」影响` : '';
  return (
    `【跑团辅助·choice】玩家刚发送的行动已由骰子判定：${DICE_OUTCOME_LABEL[outcome]}（程度 ${degree}）${cards}。` +
    '请按此结局与程度演绎本回合；正文中不得提及骰子、点数、需求值或判定字样。'
  );
}

/** 挂载本回合裁定指令（send 点选判定后调用；degree 为 marginDegree 程度词，
 *  cardNames 为本次触发的卡名）。门控在内部：骰子关或 main_ai_awareness 关时静默不挂。
 *  覆盖式写入——同回合重复点选以最后一次判定为准。 */
export function armDiceTurnPrompt(outcome: DiceOutcome, degree: string, cardNames?: string[]): void {
  try {
    const gs = useGlobalSettingsStore();
    if (!(gs.settings.dice.enabled && gs.settings.dice.main_ai_awareness)) return;
    setExtensionPrompt(
      TURN_KEY,
      buildTurnSummary(outcome, degree, cardNames),
      extension_prompt_types.IN_CHAT,
      TURN_DEPTH,
      false,
      extension_prompt_roles.SYSTEM,
    );
  } catch (error) {
    console.warn('[Choice] 判定回合注入失败', error);
  }
}

/** 清空每回合动态槽（消费即清：AI 回复落地/中止、发送取消、init 兜底）。幂等。 */
export function clearDiceTurnPrompt(): void {
  try {
    setExtensionPrompt(TURN_KEY, '', extension_prompt_types.IN_CHAT, TURN_DEPTH, false, extension_prompt_roles.SYSTEM);
  } catch (error) {
    console.warn('[Choice] 判定回合注入清空失败', error);
  }
}

// ── 挂起判定（判定注释对用户全程隐形） ──────────────────────────────────

/** 内存单槽：content = 点选的选项纯正文（匹配依据），marker = 组装好的完整判定注释，
 *  meta = 动态槽摘要素材（回写成功后重挂摘要用，与 armDiceTurnPrompt 同源三参）。 */
let pendingTurn: {
  content: string;
  marker: string;
  meta?: { outcome: DiceOutcome; degree: string; cardNames?: string[] };
} | null = null;

/** 挂起一次判定（点选判定后调用，send/fill/insert/append 四行为统一走此通道）。
 *  marker 为空串（无模板且无卡机制行）视为无注入、清槽。 */
export function stagePendingTurn(
  content: string,
  marker: string,
  meta?: { outcome: DiceOutcome; degree: string; cardNames?: string[] },
): void {
  pendingTurn = marker ? { content, marker, meta } : null;
}

/** 清空挂起（换聊天防陈旧判定跨聊天误挂；点选覆盖由 stage 自身完成）。幂等。 */
export function clearPendingTurn(): void {
  pendingTurn = null;
}

/** MESSAGE_SENT 回写（index.ts 订阅）：刚入 chat 的玩家消息命中挂起内容时，
 *  把判定注释前插进该消息的 mes 开头——AI 请求读到、聊天渲染不可见、随消息持久化。
 *  匹配口径：玩家可能微调过填入的正文（改字/续写/前后拼接），取正文压平空白后的
 *  前 20 字做包含匹配；整体重写视为放弃该判定（不回写不注入，挂起保留至同内容后发）。
 *  回写成功后动态槽只挂短摘要（buildTurnSummary，与 armDiceTurnPrompt 同文本）：
 *  完整注释已随消息进提示词，槽内再放一份是纯冗余；depth 1 摘要兜底防消息内注释被
 *  预设/正则改写（受 main_ai_awareness 门控）。meta 缺失时保持槽现状不动。 */
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
    const gs = useGlobalSettingsStore();
    if (gs.settings.dice.enabled && gs.settings.dice.main_ai_awareness && pending.meta) {
      setExtensionPrompt(
        TURN_KEY,
        buildTurnSummary(pending.meta.outcome, pending.meta.degree, pending.meta.cardNames),
        extension_prompt_types.IN_CHAT,
        TURN_DEPTH,
        false,
        extension_prompt_roles.SYSTEM,
      );
    }
  } catch (error) {
    console.warn('[Choice] 判定注释回写失败', error);
  }
}
