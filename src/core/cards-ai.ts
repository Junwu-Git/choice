/**
 * 角色 AI 主题卡池懒生成（§6）：首次幸运数掉落用到某角色时，若该角色 `card_character_pools`
 * 未生成（generated=false），异步调 AI 按当前角色卡**世界观**生成一小批主题卡（4–8 张、
 * 与内置四类型对齐），经 validateCard + 硬限 clamp 校验后固定入池。
 *
 * 设计要点：
 *  - 懒生成、fire-and-forget（由 cards.ts ensureCharacterPool 触发）；该次掉落回退纯内置池。
 *  - 池生成后 generated=true 固定不再重生成，但池内卡反复掉落 → 升级/修耐久（可重复获得）。
 *  - 批内每张过 validateCard 校验 + clampEffect 硬限：数值超限/字段非法/叙事超长 → 该张作废；
 *    整批至少保留合法张才置 generated=true；全作废则不置位（下次掉落重试，避免拉低掉落体验）。
 *  - 未配置 API / 无当前角色 / 解析失败 / 断网 → 静默回退纯内置池，不影响内置抽卡。
 *  - 合法张入 card_collection（source='character'、按角色池归组、耐久按功能×星级初始化）。
 */

import { uuidv4 } from '@sillytavern/scripts/utils';
import { substituteParams } from '@sillytavern/script';
import { callSecondaryApiWithRetry, resolveCustomApi, type ChatMsg } from '@/core/api-client';
import { getStCharacter } from '@/core/st-character';
import { clampEffect, cardMaxDurability, validateCard } from '@/core/cards-constraints';
import { useGlobalSettingsStore } from '@/store/global-settings';
import type { Card } from '@/type/settings';

/** 生成系统提示：说明产出的是「效果卡规则」而非行动选项，强调触发/效果越界会被作废。 */
const SYSTEM_PROMPT = `你是一位卡牌设计师，为角色的冒险主题设计「效果卡」。
每张卡是可装备的效果规则：满足「触发条件」时对一次行动判定施加效果（改骰值/改需求/改彩蛋窗口/结局转化/强制重掷/注入叙事）。请贴合当前角色的世界观与风格，生成富有角色特色的 4-8 张主题卡。输出必须是 JSON 数组，数组元素结构：
{"name":"卡名","type":"weapon|spell|blessing|trial","star":"1|2|3|4|5","trigger":{"kind":"type|grade|demand|roll|outcome",...},"effects":[...],"narrative":"（可选，一段叙事注入指令）"}
字段约束（越界必被作废）：
- star: 1=最常见到 5=最稀有最强，高星卡应更强但不要每张都顶配。
- trigger: 与四种 kind 对应的字段只填一种，其余省略。type→typeValue（选项类型关键词）；grade→grade（conservative/balanced/bold）；demand→min/max（需求值区间 0-100）；roll→min/max（骰值区间 1-100）；outcome→outcome（success/fail/crit_success/crit_fail）。
- effects（数组，至少 1 个，最多 3 个）：{"kind":"roll_bonus","amount":±30以内} 或 {"kind":"demand_mod","amount":±40以内} 或 {"kind":"crit_window","success_delta":±5,"fail_delta":±5} 或 {"kind":"outcome_convert","from":"fail|crit_success","to":"success|crit_success"} 或 {"kind":"reroll","on":"fail|crit_fail"} 或 {"kind":"narrative","text":"≤40字"}。
- narrative（卡的叙事演绎指令）≤40字。
- 数值请严格落在上述范围内，给出有取舍感的平衡设计，不要所有卡都强力。`;

/** 输出契约：解析 AI 返回的 JSON 数组，容忍被 ```json ... ``` 包裹，失败返回 []。 */
function parseCardPool(raw: string): Card[] {
  const text = raw.trim();
  const inner = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const start = inner.indexOf('[');
  const end = inner.lastIndexOf(']');
  if (start < 0 || end < 0 || start >= end) return [];
  try {
    const arr = JSON.parse(inner.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is Card => !!x && typeof x === 'object');
  } catch {
    return [];
  }
}

/** clamp 一张卡的所有效果（数值硬限）并保证必填字段存在（缺 id 补 uuid、缺 source 补 character）。 */
function sanitizeCard(input: Card): Card {
  const base = { ...input };
  if (!base.id) base.id = `char_${uuidv4()}`;
  base.source = 'character';
  base.effects = (base.effects ?? []).map(clampEffect);
  base.narrative = (base.narrative ?? '').slice(0, 40);
  return base;
}

/** 懒生成某角色主题卡池（fire-and-forget，失败静默）。 */
export async function generateCharacterPool(charId: string): Promise<void> {
  const gs = useGlobalSettingsStore();
  const ch = getStCharacter(charId);
  if (!ch) return;
  const api = resolveCustomApi(gs.settings.active_api_id, gs.settings.apis);
  if (!api) return;
  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT }];
  // 角色世界观注入（复用 generator 同源同法）：描述/性格/场景最能体现角色主题
  if (ch.data?.description) messages.push({ role: 'system', content: substituteParams(ch.data.description) });
  if (ch.data?.personality) messages.push({ role: 'system', content: substituteParams(ch.data.personality) });
  if (ch.data?.scenario) messages.push({ role: 'system', content: substituteParams(ch.data.scenario) });
  messages.push({
    role: 'user',
    content:
      '请依据上述角色信息，为这个角色设计 4-8 张贴合其世界观的主题效果卡，输出 JSON 数组。若无法或不全生成，数量可以更少，但必须是合法的 JSON。',
  });

  try {
    const raw = await callSecondaryApiWithRetry(
      messages,
      api,
      gs.settings.retry_count,
      gs.settings.retry_interval,
      undefined,
      true, // quiet：后台任务，不 toastr 重试进度
    );
    const legal: Card[] = [];
    for (const c of parseCardPool(raw)) {
      const candidate = sanitizeCard(c as Card);
      // 批内每张校验 + 硬限；超限/非法作废该张（勿让 AI 瞎写越权卡）
      const v = validateCard(candidate);
      if (!v.ok) continue;
      legal.push(candidate);
    }
    if (legal.length === 0) return; // 全作废：不置位，下次掉落重试
    // 合法的角色主题卡入册：定义 + 持有（source=character、按角色池归组、耐久初始化）
    for (const card of legal) {
      gs.settings.card_definitions[card.id] = card;
      const owned = gs.settings.card_collection[card.id];
      if (!owned) {
        const max = cardMaxDurability(card.type, card.star, 1);
        gs.settings.card_collection[card.id] = {
          card_id: card.id,
          level: 1,
          obtained_at: Date.now(),
          trigger_count: 0,
          durability: max,
          max_durability: max,
          source: 'character',
        };
      }
    }
    gs.settings.card_character_pools[charId] = {
      character_id: charId,
      generated: true,
      card_ids: legal.map(c => c.id),
    };
  } catch {
    /* 静默回退：任何失败都不 toastr，不影响内置抽卡；next 掉落重试 */
  }
}
