/**
 * core/gf-bridge.ts — 金手指（GoldenFinger）检测式桥接（只读、fail-safe，绝不写金手指状态）
 *
 * 职责：读取金手指扩展的游玩状态快照（等级/货币/进行中任务/被动身心状态），供选项生成端
 * 感知——金手指任务与行动选项从单向并行变为可互相呼应（同卡牌上下文告知的「双向配合」
 * 思路，只告知不强制）。检测原则：金手指未安装、总开关关闭或未绑定系统时一律返回 null，
 * 选项生成零变化；不 import 金手指源码，只镜像其存储路径。
 *
 * 存储路径（已从金手指源码核实）：
 *   游玩状态  chat_metadata.golden_finger → GameState（store/game.ts STATE_FIELD）
 *   全局设置  extension_settings.golden_finger → Settings（store/settings.ts setting_field；
 *             .enabled=总开关，.customSystems=自定义系统定义[把 activeSystemId 解析成名称]）
 */

// 只在 src/core 下接触酒馆源码，符合 AGENTS.md 隔离原则
import { chat_metadata } from '@sillytavern/script';
import { extension_settings } from '@sillytavern/scripts/extensions';

/** 金手指的持久化字段名（游玩状态与全局设置同名，镜像自其源码） */
const GF_FIELD = 'golden_finger';

/** 强度数字 → 文案（镜像金手指 INTENSITY_NAMES，改词需同步其源码） */
const INTENSITY_LABEL: Record<number, string> = { 1: '轻微', 2: '明显', 3: '严重' };

/** 防御性形状：只挑桥接关心的字段做宽松读取，金手指 schema 演进不影响这里 */
interface GfGameStateLike {
  activeSystemId?: unknown;
  level?: unknown;
  points?: unknown;
  currencyName?: unknown;
  tasks?: unknown;
  passiveStates?: unknown;
  attributes?: unknown;
  usedItems?: unknown;
  recentPurchases?: unknown;
}

interface GfSettingsLike {
  enabled?: unknown;
  customSystems?: unknown;
}

/** 任务条目的防御性形状（pick 用） */
interface GfTaskShape {
  title?: unknown;
  requirements?: unknown;
  status?: unknown;
  deadline?: unknown;
}

/** 背包/痕迹条目的防御性形状（pick 用） */
interface GfRecordShape {
  name?: unknown;
  note?: unknown;
  description?: unknown;
}

/** 身体改造属性的防御性形状（pick 用） */
interface GfAttrShape {
  target?: unknown;
  name?: unknown;
  value?: unknown;
  unit?: unknown;
  tiers?: unknown;
}

/** 宽松字段读取：类型对得上才返回，否则兜底 */
const asString = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const asNumber = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** 读金手指全局设置（未安装/读取失败返回 null） */
function readGfSettings(): GfSettingsLike | null {
  // 酒馆类型里的 extension_settings 没有第三方键，经 unknown 转宽记录读取
  const raw = (extension_settings as unknown as Record<string, unknown> | undefined)?.[GF_FIELD];
  return raw && typeof raw === 'object' ? (raw as GfSettingsLike) : null;
}

/** 读当前聊天的金手指游玩状态（未安装/无元数据返回 null） */
function readGfGameState(): GfGameStateLike | null {
  const raw = (chat_metadata as Record<string, unknown> | null | undefined)?.[GF_FIELD];
  return raw && typeof raw === 'object' ? (raw as GfGameStateLike) : null;
}

/** 从金手指全局设置的自定义系统里解析系统名（内置系统不在 settings 里，解析不到返回 ''） */
function resolveSystemName(systemId: string): string {
  const custom = readGfSettings()?.customSystems;
  if (!Array.isArray(custom)) return '';
  for (const def of custom) {
    if (def && typeof def === 'object' && (def as { id?: unknown }).id === systemId) {
      return asString((def as { name?: unknown }).name);
    }
  }
  return '';
}

/** 时限标注：与金手指判定清单同款（[剩余约N分钟] / [已逾期]；无时限不标注） */
function deadlineTag(deadline: unknown, now: number): string {
  if (typeof deadline !== 'number' || !Number.isFinite(deadline)) return '';
  const remainMs = deadline - now;
  if (remainMs <= 0) return '[已逾期]';
  return `[剩余约${Math.max(1, Math.ceil(remainMs / 60000))}分钟]`;
}

/** 面板状态条用的紧凑快照（UI 展示，字段比 AI 面少而精） */
export interface GfHudSnapshot {
  systemName: string;
  level: number;
  currencyName: string;
  points: number;
  /** 进行中任务数（active） */
  activeTasks: number;
  /** 最近一个进行中任务标题（供 tooltip，无任务为 ''） */
  firstTaskTitle: string;
  /** 被动身心状态条目数 */
  stateCount: number;
}

/**
 * 组装金手指状态快照行（AI 面文本，不做 i18n，同 equippedCardsPromptLine）。
 * 返回 null = 金手指未安装/总开关关闭/未绑定系统，调用方跳过注入。
 */
export function readGoldenFingerSnapshot(): string | null {
  try {
    const gs = readGfSettings();
    if (gs?.enabled === false) return null; // 尊重金手指总开关
    const game = readGfGameState();
    if (!game) return null;
    const systemId = asString(game.activeSystemId);
    if (!systemId) return null; // 装了但当前聊天未绑定系统 = 没在玩，不注入

    const lines: string[] = [];
    const level = Math.max(1, Math.floor(asNumber(game.level, 1)));
    const systemName = resolveSystemName(systemId);
    const currencyName = asString(game.currencyName, '积分');
    const points = asNumber(game.points);
    lines.push(
      `【金手指状态】宿主绑定了金手指系统${systemName ? `「${systemName}」` : ''}（等级${level}），持有${currencyName}×${points}。`,
    );

    // 进行中任务：标题+要求+时限（选项可照着任务出，有时限的任务更紧急）
    const now = Date.now();
    const tasks = Array.isArray(game.tasks) ? game.tasks : [];
    const taskLines = tasks
      .filter(t => t && typeof t === 'object' && (t as GfTaskShape).status === 'active')
      .slice(0, 6)
      .map(t => {
        const task = t as GfTaskShape;
        const title = asString(task.title).trim();
        const req = asString(task.requirements).trim();
        if (!title) return '';
        return `- 《${title}》${req ? `（${req}）` : ''}${deadlineTag(task.deadline, now)}`;
      })
      .filter(Boolean);
    if (taskLines.length) {
      lines.push('进行中任务：', ...taskLines);
    }

    // 被动身心状态：受伤/醉酒等非主观状态（选项的可行性/代价应与之相称）
    const states = Array.isArray(game.passiveStates) ? game.passiveStates : [];
    const stateLines = states
      .slice(0, 6)
      .map(s => {
        if (!s || typeof s !== 'object') return '';
        const st = s as { name?: unknown; intensity?: unknown; note?: unknown };
        const name = asString(st.name).trim();
        if (!name) return '';
        const intensity = INTENSITY_LABEL[asNumber(st.intensity, 1)] ?? '';
        const note = asString(st.note).trim();
        return `- ${name}${intensity ? `（${intensity}）` : ''}${note ? `：${note}` : ''}`;
      })
      .filter(Boolean);
    if (stateLines.length) {
      lines.push('宿主身心状态：', ...stateLines);
    }

    // 身体改造数值属性（attribute 类物品使用后的持久改造）：选项的可行性/代价应与改造后
    // 的身体相称（如「逃跑」对被改造束缚的宿主不再轻松）
    const attrs = Array.isArray(game.attributes) ? game.attributes : [];
    const attrLines = attrs
      .slice(0, 8)
      .map(a => {
        if (!a || typeof a !== 'object') return '';
        const attr = a as GfAttrShape;
        const name = asString(attr.name).trim();
        if (!name) return '';
        const value = Math.floor(asNumber(attr.value));
        const unit = asString(attr.unit).trim();
        // tiers 存在时以 value 作下标取档位标签（镜像金手指 attrText 展示规则）
        const tiers = Array.isArray(attr.tiers) ? attr.tiers.filter((t): t is string => typeof t === 'string') : [];
        const label =
          tiers.length > 0
            ? (tiers[Math.min(Math.max(value, 0), tiers.length - 1)] ?? String(value))
            : `${value}${unit}`;
        const target = asString(attr.target).trim();
        return `- ${target ? `${target}·` : ''}${name} ${label}`;
      })
      .filter(Boolean);
    if (attrLines.length) {
      lines.push('身体改造（持久，非状态）：', ...attrLines);
    }

    // 刚使用的物品（金手指本地结算的使用痕迹，正文 AI 正在被要求演出其效果）：
    // 选项应避开与药效/变身进行中的行动直接冲突，或自然利用它
    const used = Array.isArray(game.usedItems) ? game.usedItems : [];
    const usedLines = used
      .slice(0, 5)
      .map(u => {
        if (!u || typeof u !== 'object') return '';
        const rec = u as GfRecordShape;
        const name = asString(rec.name).trim();
        if (!name) return '';
        const note = asString(rec.note).trim();
        return `- ${name}${note ? `：${note}` : ''}`;
      })
      .filter(Boolean);
    if (usedLines.length) {
      lines.push('宿主刚使用的物品（效果正在生效，剧情正在演出）：', ...usedLines);
    }

    // 最近购入（金手指商店刚买到、还没用的东西）：选项可让剧情自然呼应新入手的物件
    const purchased = Array.isArray(game.recentPurchases) ? game.recentPurchases : [];
    const purchaseLines = purchased
      .slice(0, 5)
      .map(p => {
        if (!p || typeof p !== 'object') return '';
        const rec = p as GfRecordShape;
        const name = asString(rec.name).trim();
        if (!name) return '';
        // 购入记录的 note=商品说明；老字段兜底 description
        const desc = asString(rec.note).trim() || asString(rec.description).trim();
        return `- ${name}${desc ? `：${desc}` : ''}`;
      })
      .filter(Boolean);
    if (purchaseLines.length) {
      lines.push('宿主最近购入（尚未使用）：', ...purchaseLines);
    }

    lines.push(
      '出选项时可让部分选项自然呼应上述任务或身心状态；无合适契机则照常，不必强凑，也不要在选项里提及「任务」「系统」等字眼。',
    );
    return lines.join('\n');
  } catch {
    // 桥接绝不能影响选项生成主链路
    return null;
  }
}

/**
 * 面板状态条用的结构化快照（只读、fail-safe 同上）。null 语义与 AI 面一致：
 * 未安装/总开关关/未绑定系统。任务/状态计数与 AI 面共用同一读取路径，口径不漂移。
 */
export function readGoldenFingerHud(): GfHudSnapshot | null {
  try {
    const gs = readGfSettings();
    if (gs?.enabled === false) return null;
    const game = readGfGameState();
    if (!game) return null;
    const systemId = asString(game.activeSystemId);
    if (!systemId) return null;

    const tasks = Array.isArray(game.tasks) ? game.tasks : [];
    const active = tasks.filter(
      t => t && typeof t === 'object' && (t as GfTaskShape).status === 'active',
    ) as GfTaskShape[];
    const states = Array.isArray(game.passiveStates) ? game.passiveStates : [];
    return {
      systemName: resolveSystemName(systemId),
      level: Math.max(1, Math.floor(asNumber(game.level, 1))),
      currencyName: asString(game.currencyName, '积分'),
      points: asNumber(game.points),
      activeTasks: active.length,
      firstTaskTitle: asString(active[0]?.title).trim(),
      stateCount: states.filter(s => {
        if (!s || typeof s !== 'object') return false;
        return asString((s as { name?: unknown }).name).trim() !== '';
      }).length,
    };
  } catch {
    return null;
  }
}
