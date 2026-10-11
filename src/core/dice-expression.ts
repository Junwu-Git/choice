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
/** 去除骰子段后的运算串白名单：仅允许数字、`+ - * / ( ) .` 与空白。
 *  校验前先把受控生成的 `__d(...)` 占位标记替换为数字（见 compile），
 *  否则占位标记里的字母会让每次校验都失败、所有骰式被误拒。 */
const EXPR_SAFE_RE = /^(?:[\d\s+\-*/().])+$/;

/** 算术残留语法校验（递归下降，只看语法不执行）：残留只含数字/四则/括号/点（无字母 →
 *  零注入面），不用 new Function/eval 类动态执行。文法 = JS 数字字面量（含 '1.'/'.5'）+
 *  四则 + 括号 + 一元正负号，与 compile 的 new Function 语法口径对齐（数字原子与
 *  __d(...) 调用原子语法同构）。返回 false = compile 必然 SyntaxError。 */
const isArithmeticSyntax = (expr: string): boolean => {
  // JS 词法把 '--'/'++' 吃成单个自增/自减 token（maximal munch），而本字符集只有数字
  // 字面量——自增/减的操作数必须是可赋值引用，字面量恒为早期语法错误（0--3、--0、
  // 0+++3 均实测 SyntaxError）。递归下降按字符处理 '+'/'-' 无法表达这一词法规则，
  // 整体拒绝：本字符集内含 '--'/'++' 的串不存在合法读法
  if (expr.includes('--') || expr.includes('++')) return false;
  let i = 0;
  const n = expr.length;
  const parseNumber = (): boolean => {
    const start = i;
    while (i < n && expr[i] >= '0' && expr[i] <= '9') i++;
    if (i < n && expr[i] === '.') {
      i++;
      while (i < n && expr[i] >= '0' && expr[i] <= '9') i++;
    }
    // 至少一位数字，且 '.' 单独不成数（'1.'/'.5' 合法、'.' 非法）
    return i > start && !(expr[start] === '.' && i === start + 1);
  };
  const parseFactor = (): boolean => {
    // 一元正负号（JS 允许 1--1、(-1)）
    while (i < n && (expr[i] === '+' || expr[i] === '-')) i++;
    if (i >= n) return false;
    if (expr[i] === '(') {
      i++;
      if (!parseExpr()) return false;
      if (i >= n || expr[i] !== ')') return false;
      i++;
      return true;
    }
    return parseNumber();
  };
  const parseTerm = (): boolean => {
    if (!parseFactor()) return false;
    while (i < n && (expr[i] === '*' || expr[i] === '/')) {
      i++;
      if (!parseFactor()) return false;
    }
    return true;
  };
  const parseExpr = (): boolean => {
    if (!parseTerm()) return false;
    while (i < n && (expr[i] === '+' || expr[i] === '-')) {
      i++;
      if (!parseTerm()) return false;
    }
    return true;
  };
  return parseExpr() && i === n; // 全消费才完整（'0+' 残留在尾部检查被拒）
};

/** 判定一段文本是否为合法骰式（供选项标注识别；不含骰子段的纯算术不算）。
 *  与 compile 同口径：剥掉全部骰子段后不允许残留 k/d/h/l——如 `2d6k3`（k 后缺 h/l）
 *  能过字符集白名单但 compile 必拒，若此处放行会出现「徽标显示骰式、实际掷 D100」的
 *  静默不一致（宁可不拆不错拆，见 option-format 的整体回退哲学）。 */
export function isDiceFormula(text: string): boolean {
  if (!text || text.length > 40) return false;
  const t = text.replace(/\s+/g, '');
  if (!t) return false;
  // 骰子段之外只允许数字与运算符号（k/d/h/l 已被骰子段正则消耗，见下）
  if (!/^[\d+\-*/().dkhl]+$/i.test(t)) return false;
  if (!/\d+d\d+/i.test(t)) return false;
  // 骰子段紧邻小数点必拒：'1.5d6' 会把 '5d6' 拆成骰子段（残留 '1.'）、'2d6.5' 残留 '.5'——
  // 残留能过字符白名单甚至语法检查，但 compile 产物 '1.__d(...)' 是数字字面量属性访问
  // （运行时 TypeError）、'__d(...).5' 直接语法错误，rollDiceExpression 必然 null 回退
  // D100，形成「徽标显示骰式、实际掷 D100」的静默不一致。合法小数常量（2d6*0.5）的
  // 小数点不紧贴骰子段，不受影响。
  for (const m of t.matchAll(DICE_SEGMENT_RE)) {
    if (t[m.index - 1] === '.' || t[m.index + m[0].length] === '.') return false;
  }
  // 残留检查：① 拒字母 k/d/h/l（如 2d6k3 段外残留 k）；残留数字是算术常量（2d6+3 的 +3），必须放行。
  // 段位换 '0' 与 compile 把段换成 __d(...) 再白名单替换成 0 网络等效（t 中不含 __d 字面量）
  const residual = t.replace(DICE_SEGMENT_RE, '0');
  if (/[dkhl]/i.test(residual)) return false;
  // ② 残留必须是语法合法的算术表达式：'2d6+'、'2d6..5' 这类残骸能过字符白名单，
  // 但 compile 的 new Function 必然 SyntaxError → 静默回退 D100，同上不一致
  return isArithmeticSyntax(residual);
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
    // 段参数硬钳（n≤100 / m≤1000）：防巨数骰（2000d6）拖垮随机循环与内存。注意钳制是
    // 静默的——isDiceFormula 只对齐解析级口径，徽标仍显示原文，实际按钳后值域掷。
    const n2 = Math.min(Math.max(parseInt(n, 10) || 1, 1), 100);
    const m2 = Math.min(Math.max(parseInt(m, 10) || 1, 1), 1000);
    const kdFull: KeepDrop = kd ? ((kd.toLowerCase() + hl.toLowerCase()) as 'kh' | 'kl' | 'dh' | 'dl') : null;
    // 未给保留/丢弃数量时默认保 1 颗（kh/kl 典型语义），dh/dl 默认丢 1 颗
    const amount = kd ? (amt ? Math.min(parseInt(amt, 10) || 1, n2) : 1) : 0;
    return `__d(${n2},${m2},${kdFull ? `'${kdFull}'` : 'null'},${amount})`;
  });
  // 白名单只校验算术骨架：受控生成的 __d(...) 占位标记替换为数字 0 后再测，
  // 其余仅数字/运算符/括号（注入面只来自 __d 的数字参数），杜绝任意代码注入。
  if (!EXPR_SAFE_RE.test(expr.replace(/__d\([^)]*\)/g, '0'))) return null;
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
    const total = fn(buildDiceFn('random'));
    const min = fn(buildDiceFn('min'));
    const max = fn(buildDiceFn('max'));
    // 除零（如 2d6/0）会产生 ±Infinity、0/0 会产生 NaN：Infinity 恒过彩蛋阈值判大成功、
    // NaN 恒判失败且 chip 显示「NaN」——非法结果整体作废，调用方静默回退 D100。
    if (!Number.isFinite(total) || !Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { total: Math.round(total), min: Math.round(min), max: Math.round(max) };
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
