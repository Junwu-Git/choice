/**
 * 角色属性驱动 DC（v61，dice.attr_dc_enabled 默认关）：选项无显式需求值时，尝试从当前
 * 角色卡解析属性值做「需求值」（D100 目标，0-100 语义）。AI 标注需求值始终优先，属性解析
 * 只替换「档位兜底」这一级；识别不到任何属性静默返回 null，由调用方回退档位兜底。
 *
 * 存储位置不标准（角色卡无统一属性 schema）：走「启发式 + 可配置来源」的宽松口径——
 * 递归扫角色卡 `data.extensions` 与 `data` 常见属性区（有界深度、跳过字符串/大数组），
 * 收集 {label, value} 候选，再与选项里检测出的属性名做字符串相似度匹配。属性名检测也是
 * 启发式（`【力量】` / `力量检定` / `动用 XX` 等）。全程失败返回 null，绝不抛错。
 *
 * 属性值按刻度自适应换算成「等效成功率」（0-100 语义）再交调用方按判定方向反向：
 * 值 ≤ 20 视作 DND 型 3-18 刻度（×5 换算，力量 16 → 80% 成功率——直接 100−v 会让
 * 3-18 值域整体压进 3-19% 成功率区间、几乎必败）；值 > 20 视作 COC 百分位刻度原样
 * 采用（现状）。取舍：COC 卡个别 ≤20 的低属性会被误判成 DND 高胜率，但 attr 只替换
 * 档位兜底这一级、AI 标注始终优先，影响可控。实现前已核对 st-character.ts 的
 * StCharacter 类型：角色卡对象需访问 ch.data.extensions / ch.data（V2 卡字段），
 * 访问一律走 ?.。
 */

import {
  parseOptionContent,
  parseOptionDice,
  parseOptionRate,
  parseOptionStyle,
  gradeFallbackRate,
} from '@/util/option-format';

/** 从选项正文提取可能的属性名引用（启发式）。返回规范化名或 null。
 *  识别三类：
 *   1. 【属性名】（方括号/书名号括起的短词，1-8 字）；
 *   2. 「XXX检定/判定/对抗/考验/挑战」（动名词短语）；
 *   3. 「动用|施展|施展|运用|以|用|过｜进行 + 空格? + 属性名」后的名词段（尽力而为）。
 *  命中的词作为 ref 供 collectAttributeCandidates 相似度匹配。 */
function detectAttributeRef(text: string): string | null {
  if (!text) return null;
  const bracket = text.match(/[【《[]([^】》\]]{1,8})[】》\]]/);
  if (bracket) return bracket[1];
  const checkWord = text.match(/([\u4e00-\u9fa5A-Za-z]{2,6})(?:检定|判定|对抗|考验|挑战)/);
  if (checkWord) return checkWord[1];
  const verbNoun = text.match(/(?:动用|施展|运用|使出|以|用|进行)\s*([\u4e00-\u9fa5]{2,6})/);
  if (verbNoun) return verbNoun[1];
  return null;
}

/** 规范化标签做相似匹配（小写 + 去空白；中文原样）。 */
const norm = (s: string): string => s.toLowerCase().replace(/[\s:：_.-]/g, '');

/** 两个标签的相似度（0-1）：全等 1；包含 0.75；否则按公共子串占比给分。 */
const labelSimilarity = (a: string, b: string): number => {
  const A = norm(a);
  const B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.75;
  // 简单字符重叠比（两串并集里共同字符占比的上界，低门槛近似）
  const setA = new Set(A);
  let common = 0;
  for (const ch of B) if (setA.has(ch)) common++;
  const union = setA.size + new Set(B).size;
  return union > 0 ? common / union : 0;
};

type AttrCandidate = { label: string; value: number };

/** 有界递归收集属性候选 {label, value}。只采「值是数字或数字字符串、且 key 不长」的叶子；
 *  也识别 {value/base/current/total: 数字} 形式的嵌套属性对象。跳过字符串/数组大内容以控成本。 */
const COLLECT_DEPTH_LIMIT = 5;
const collectAttributeCandidates = (node: unknown, out: AttrCandidate[], depth = 0): void => {
  if (node == null || depth > COLLECT_DEPTH_LIMIT) return;
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    if (node.length > 200) return; // 大数组（如聊天历史/世界书）跳过
    for (const item of node) collectAttributeCandidates(item, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const [key, val] of Object.entries(obj)) {
    if (key.length > 24) continue;
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      out.push({ label: key, value: val });
    } else if (typeof val === 'string' && /^\d{1,4}$/.test(val) && Number(val) > 0) {
      out.push({ label: key, value: Number(val) });
    } else if (typeof val === 'object' && val != null) {
      // 嵌套属性对象：优先 value/current/base/total 字段
      const inner = val as Record<string, unknown>;
      for (const numKey of ['value', 'current', 'base', 'total']) {
        const n = inner[numKey];
        if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
          out.push({ label: key, value: n });
          break;
        }
      }
      // 普通对象继续下钻
      collectAttributeCandidates(val, out, depth + 1);
    }
  }
};

/** 解析当前角色卡中 ref 对应的属性，换算为「等效成功率」（0-100 语义，夹取到 [1,99]）：
 *  值 ≤ 20 视 DND 型 3-18 刻度按 ×5 放大（16 → 80），> 20 视百分位刻度原样采用。
 *  匹配不到 / 角色卡缺失 / 异常一律 null。 */
function resolveAttributeDc(character: { data?: unknown } | undefined, ref: string): number | null {
  try {
    if (!character || !ref) return null;
    const candidates: AttrCandidate[] = [];
    const data = character.data as Record<string, unknown> | undefined;
    if (!data) return null;
    // 优先扫 extensions 扩展区（TRPG 卡属性多在 data.extensions），再扫 data 顶层
    if (data.extensions && typeof data.extensions === 'object') {
      collectAttributeCandidates(data.extensions, candidates);
    }
    collectAttributeCandidates(data, candidates);
    if (candidates.length === 0) return null;
    // 选相似度最高且超过门槛的候选
    let best: AttrCandidate | null = null;
    let bestScore = 0;
    for (const c of candidates) {
      const score = labelSimilarity(ref, c.label);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best || bestScore < 0.6) return null;
    const v = Math.round(best.value);
    if (!Number.isFinite(v)) return null;
    // 刻度自适应：≤20 在百分位语义下成功率 ≤20%（几乎必败），按 DND 型 ×5 放大才符合
    // 「高属性→高胜率」直觉；>20 保持百分位原样（COC 卡零变化）
    return v <= 20 ? Math.min(99, Math.max(1, v * 5)) : Math.min(99, Math.max(1, v));
  } catch {
    return null;
  }
}

/** 统一带属性的需求值解析：AI 标注优先，无标注且 attr_dc_enabled 时尝试属性，最后档位兜底。
 *  返回值 = D100 目标需求值（null = 不掷骰）。
 *  v61 low_roll：属性来源的 DC 随模式反向——先把属性值换算成「等效成功率」（≤20 视 DND
 *  型 ×5 放大、>20 视百分位原样，见 resolveAttributeDc），再 low（COC）DC = 成功率、
 *  high DC = 100 − 成功率；两模式成功率一致，高属性 → 高胜率。
 *  v67：档位兜底改走 gradeFallbackRate 模式感知对偶（COC 65/40/15，成功率与 high 对齐）。
 *  旧版「档位兜底不随模式反向」在 low 模式下会把保守档变成最难、大胆档变成最易，与本意
 *  相悖——本函数不再委托模式盲的 resolveOptionSuccessRate，显式标注/属性/档位兜底三级
 *  全部在此收敛。 */
export function resolveOptionSuccessRateWithAttr(
  text: string,
  character: { data?: unknown } | undefined,
  attrEnabled: boolean,
  lowRoll = false,
): number | null {
  // AI 显式数值标注始终优先
  const explicitRate = parseOptionRate(text);
  if (explicitRate !== null) return explicitRate;
  // 属性 DC 替换档位兜底这一级（settings.ts attr_dc_enabled 注释口径）：检测失败静默落回
  // 档位兜底而非直接不掷——此前档位兜底短路在属性之前，attr_dc_enabled 在 AI 标档位的
  // 常见形态下永不生效。在正文（剥掉标题括号）上检测——括号形态选项的标题括号恒在
  // 最前，整条文本匹配会拿标题当属性名、正文里的【力量】永远轮不到
  if (attrEnabled) {
    const ref = detectAttributeRef(parseOptionContent(text));
    if (ref) {
      const rate = resolveAttributeDc(character, ref);
      if (rate !== null) {
        // 等效成功率按判定方向反向成 D100 需求值：low（COC）DC = 成功率，high（DND/难度制）
        // DC = 100 − 成功率——两模式成功率一致，高属性 → 高胜率
        return lowRoll ? rate : Math.min(99, Math.max(1, 100 - rate));
      }
    }
  }
  const style = parseOptionStyle(text);
  if (style !== null) return gradeFallbackRate(style, lowRoll);
  return null;
}

/** 徽标/判定共用的统一需求值解析（v61）：先看骰式标注（allow_formula）返回 0-100 难度代理，
 *  否则走「AI 标注优先 → 角色属性 → 档位兜底」。两处各写一套的口径在此收敛。
 *  dice 取 dice 设置子集（allow_formula / attr_dc_enabled / low_roll）；character 为当前角色卡（可缺省）。 */
export function resolveRateForDisplay(
  text: string,
  character: { data?: unknown } | undefined,
  dice: { allow_formula: boolean; attr_dc_enabled: boolean; low_roll: boolean },
): number | null {
  if (dice.allow_formula) {
    const parsed = parseOptionDice(text, dice.low_roll);
    if (parsed) return parsed.rate;
  }
  return resolveOptionSuccessRateWithAttr(text, character, dice.attr_dc_enabled, dice.low_roll);
}
