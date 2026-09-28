/**
 * 骰子表达式解析/求值（v61，dice.allow_formula 默认关）：让 AI 可以标注真实骰式
 * （如 `2d6+3`、`3d6*5`、`2d6+1d10`、`4d6kH3` / `dl1` 保留丢弃），替代固定 D100。
 * 本模块是纯函数、不持有任何 UI/统计依赖，也不感知 schema。
 *
 * 求值方式：把骰子段替换为 `__d(N,M,kd,amount)` 调用，剩余运算串经白名单正则校验
 * （只允许数字/运算符/括号，杜绝任意代码注入）后 `new Function` 求值。`__d` 以 mode
 * 区分 random / min / max 三种取值，用于一次解析同时给出
 * 随机总和、值域下界与上界（供按比映射 DC）。
 *
 * 值域口径：所有骰子同时取最小值/最大值（min=每骰 1、max=每骰面数）。对最常见的
 * 「骰子和 ± 常量」「多组骰子和」是精确值域；对 `2d6-1d6` 这类正负混合组是近似
 * （真实极值需 min 与 max 交错，此处不展开）。DC 映射用近似值域可接受。
 *
 * 非法/超范围输入一律返回 null，调用方静默回退 D100 或档位兜底——绝不抛错。
 */

type KeepDrop = 'kh' | 'kl' | 'dh' | 'dl' | null;
type RollFn = (n: number, m: number, kd: KeepDrop, amt: number) => number;

/** 骰子段正则（大小写容忍）：`NdM`，可选保留/丢弃后缀 `kH`/`kl`/`dh`/`dl` + 数量。
 *  例：`4d6`、`2d6kH3`、`3d10dl1`。 */
const DICE_SEGMENT_RE = /(\d+)d(\d+)(?:([kKdD])([hHlL])(\d+)?)?/g;
/** 去除骰子段后的运算串白名单：仅允许数字、`+ - * / ( ) .` 与空白。 */
const EXPR_SAFE_RE = /^(?:[\d\s+\-*/().])+$/;

/** 判定一段文本是否为合法骰式（供选项标注识别；不含骰子段的纯算术不算）。 */
export function isDiceFormula(text: string): boolean {
  if (!text || text.length > 40) return false;
  const t = text.replace(/\s+/g, '');
  if (!t) return false;
  // 骰子段之外只允许数字与运算符号（k/d/h/l 已被骰子段正则消耗，见下）
  if (!/^[\d+\-*/().dkhl]+$/i.test(t)) return false;
  if (!/\d+d\d+/i.test(t)) return false;
  return true;
}

const buildDiceFn =
  (mode: 'random' | 'min' | 'max'): RollFn =>
  (n, m, kd, amount) => {
    const rolls: number[] = [];
    for (let i = 0; i < n; i++)
      rolls.push(mode === 'random' ? Math.floor(Math.random() * m) + 1 : mode === 'min' ? 1 : m);
    rolls.sort((a, b) => a - b); // 升序，便于保留最高/最低、丢弃最低/最高
    const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
    const k = Math.min(Math.max(amount, 0), n);
    if (kd === 'kh') return sum(rolls.slice(n - k)); // 保留最高 k 颗
    if (kd === 'kl') return sum(rolls.slice(0, k)); // 保留最低 k 颗
    if (kd === 'dh') return sum(rolls.slice(0, Math.max(0, n - Math.min(Math.max(amount, 0), n - 1)))); // 丢弃最高 d 颗
    if (kd === 'dl') return sum(rolls.slice(Math.min(Math.max(amount, 0), n - 1))); // 丢弃最低 d 颗
    return sum(rolls);
  };

/** 编译骰式为受控求值函数（每轮求值以不同 __d 注入 random/min/max）。非法返回 null。 */
const compile = (formula: string): ((d: RollFn) => number) | null => {
  const t = formula.replace(/\s+/g, '');
  if (!t) return null;
  const expr = t.replace(DICE_SEGMENT_RE, (_all, n, m, kd, hl, amt) => {
    const n2 = Math.min(Math.max(parseInt(n, 10) || 1, 1), 100);
    const m2 = Math.min(Math.max(parseInt(m, 10) || 1, 1), 1000);
    const kdFull: KeepDrop = kd ? ((kd.toLowerCase() + hl.toLowerCase()) as 'kh' | 'kl' | 'dh' | 'dl') : null;
    // 未给保留/丢弃数量时默认保 1 颗（kh/kl 典型语义），dh/dl 默认丢 1 颗
    const amount = kd ? (amt ? Math.min(parseInt(amt, 10) || 1, n2) : 1) : 0;
    return `__d(${n2},${m2},${kdFull ? `'${kdFull}'` : 'null'},${amount})`;
  });
  if (!EXPR_SAFE_RE.test(expr)) return null;
  try {
    const fn = new Function('__d', `return (${expr})`);
    return fn as (d: RollFn) => number;
  } catch {
    return null;
  }
};

/** 掷一个骰式（随机），并给出其值域 [min,max]。非法/越界输入返回 null。 */
export function rollDiceExpression(formula: string): { total: number; min: number; max: number } | null {
  const fn = compile(formula);
  if (!fn) return null;
  try {
    const total = Math.round(fn(buildDiceFn('random')) ?? 0);
    const min = Math.round(fn(buildDiceFn('min')) ?? 0);
    const max = Math.round(fn(buildDiceFn('max')) ?? 0);
    return { total, min, max };
  } catch {
    return null;
  }
}

/** 把 0-100 难度代理按比映射到 [min,max] 值域（取 DC）。目标取整并夹取到 [min,max]。
 *  纯函数，供判定模块计算骰式路径的比较目标与彩蛋阈值。 */
export function mapProxyToRange(proxy: number, min: number, max: number): number {
  if (!Number.isFinite(proxy) || !Number.isFinite(min) || !Number.isFinite(max) || max <= min) return min;
  const frac = Math.min(100, Math.max(1, proxy)) / 100;
  return Math.round(min + frac * (max - min));
}
