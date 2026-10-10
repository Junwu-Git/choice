/**
 * 卡牌定义/卡组解析层（v67 自 cards.ts 拆出）：装备解析、卡定义回查、自动编组等
 * 「纯解析 + 轻 store 读」的共享层。拆分动机——cards.ts 依赖 cards-ai（懒生成角色池），
 * cards-ai 依赖 generator，generator 又需要装备卡摘要做生成端上下文注入
 * （equippedCardsPromptLine）：让 generator 直接 import cards.ts 会成环，故把这条
 * 「generator 也需要的最小解析面」收敛到本模块（只依赖 cards-builtin / cards-constraints /
 * cards-meta / st-character / store，不碰 cards-ai 与 generator）。
 * cards.ts 对公开函数做 re-export，既有组件/共享层的 import 点零改动。
 */

import { BUILTIN_CARDS } from '@/core/cards-builtin';
import { CARD_TYPE_LABEL, effectsLabel, triggerLabel } from '@/core/cards-meta';
import { CARD_SLOT_TYPES, CARD_STAR_BUDGET, checkDeckBudget, isCardBroken } from '@/core/cards-constraints';
import { getStCharacter } from '@/core/st-character';
import { useGlobalSettingsStore } from '@/store/global-settings';
import { usePoolSelectorStore } from '@/store/pool-selector';
import type { Card, CardDeck, CardOwned, CardStar, GlobalSettings } from '@/type/settings';

// ── 配置解析（chat > character > default，复用 pool-selector 思路） ──────

/** 当前生效卡组所属 config id（与条目池同一解析链）。无 config → '__none__'。 */
export function currentCardConfigId(): string {
  return usePoolSelectorStore().effectiveConfig?.id ?? '__none__';
}

// ── 卡定义与持有解析 ─────────────────────────────────────────────────────

/** 按 card_id 取卡定义：内置卡来自 BUILTIN_CARDS，角色主题卡来自 card_definitions。
 *  找不到返回 undefined（已删除/异常 id）。旧主题卡（character_name 为空，生成于
 *  归属字段引入前）在此幂等回填 character_id/name——从 card_character_pools 反查归属池，
 *  名字经 st-character 解析；回填后由 store deep watch 落盘，后续不再算。 */
export function cardDefById(id: string): Card | undefined {
  if (!id) return undefined;
  const b = BUILTIN_CARDS.find(c => c.id === id);
  if (b) return b;
  const gs = useGlobalSettingsStore();
  const def = gs.settings.card_definitions[id];
  if (def && def.source === 'character' && !def.character_name) {
    backfillCharacterAttribution(gs.settings, def);
  }
  return def;
}

/** 旧主题卡无归属字段时从角色池反查 character_id + 名字回填（幂等：仅补空字段）。 */
function backfillCharacterAttribution(s: GlobalSettings, def: Card): void {
  for (const pool of Object.values(s.card_character_pools)) {
    if (pool.card_ids.includes(def.id)) {
      def.character_id = pool.character_id;
      const ch = pool.character_id ? getStCharacter(pool.character_id) : undefined;
      def.character_name = ch?.name ?? '';
      return;
    }
  }
}

/** 装备位解析结果（装备 + 持有态） */
export type EquippedCard = { card: Card; owned: CardOwned };

/** 把卡组槽规整为固定 CARD_SLOT_TYPES 个（按权威顺序）：每类型只保留首个非空卡、缺的类型补空槽
 *  （card_id=''）。兼容旧版动态 ≤5 张、同类 ≤1 的存量数据；幂等。 */
export function normalizeDeckSlots(slots: CardDeck['slots']): CardDeck['slots'] {
  const used = new Set<string>();
  return CARD_SLOT_TYPES.map(type => {
    const hit = slots.find(s => s.type === type && s.card_id && !used.has(s.card_id));
    if (hit) {
      used.add(hit.card_id);
      return { type, card_id: hit.card_id };
    }
    return { type, card_id: '' };
  });
}

/** 防御性星级预算过滤：只保留各高星卡不超过 CARD_STAR_BUDGET 上限的组合（装备编辑页已强校验，此处兜底）。 */
function applyBudget(equipped: EquippedCard[]): EquippedCard[] {
  const ok = checkDeckBudget(equipped.map(e => e.card));
  if (ok.ok) return equipped;
  const counts: Partial<Record<CardStar, number>> = {};
  return equipped.filter(e => {
    const star = e.card.star;
    const max = CARD_STAR_BUDGET[star];
    if (max === undefined) return true;
    const n = (counts[star] ?? 0) + 1;
    if (n > max) return false;
    counts[star] = n;
    return true;
  });
}

/** 生效卡组槽（auto 时取自动编组，否则取存储 slots 规整版）——判定与 UI 显示共用同一口径。 */
function effectiveDeckSlots(configId: string): CardDeck['slots'] {
  const gs = useGlobalSettingsStore();
  if (gs.settings.auto_deck_enabled) return autoDeckCards();
  return normalizeDeckSlots(gs.settings.card_decks[configId]?.slots ?? []);
}

/** 解析某 config 已装备的卡（遍历规整后的固定槽，跳过空槽/定义缺失，防御历史脏数据）。
 *  auto 模式自动编组，手动模式读存储 slots。破损卡（isCardBroken）一律不入选——统一口径：
 *  破损 = 不可装备/不可触发（v70 耐久机制），自动编组与手动槽残留破损 id 自然退化为空槽。 */
export function resolveEquippedCards(configId: string): EquippedCard[] {
  const gs = useGlobalSettingsStore();
  const equipped: EquippedCard[] = [];
  for (const slot of effectiveDeckSlots(configId)) {
    if (!slot.card_id) continue;
    const card = cardDefById(slot.card_id);
    const owned = gs.settings.card_collection[slot.card_id];
    if (!card || !owned || isCardBroken(owned)) continue;
    equipped.push({ card, owned });
  }
  return applyBudget(equipped);
}

/** 自动编组：从已拥有卡里按类型各选最优填满 4 槽（星最高、平手按获得时间早优先），
 *  守星级预算（3★≤2/4★≤1/5★≤1）；预算冲突时退而取更低星或留空。确定性、纯投影不改状态。
 *  破损卡（isCardBroken）不入选——破损后自动编组自然换下一最佳卡，无需手动处理。 */
export function autoDeckCards(): CardDeck['slots'] {
  const gs = useGlobalSettingsStore();
  const budgetCount: Partial<Record<CardStar, number>> = {};
  return CARD_SLOT_TYPES.map(type => {
    // 该类型已拥有卡，星降序（平手按获得时间早优先，稳定且可预期）
    const cands = Object.entries(gs.settings.card_collection)
      .filter(([id, o]) => cardDefById(id)?.type === type && o.card_id && !isCardBroken(o))
      .sort((a, b) => {
        const sa = Number(cardDefById(a[0])!.star);
        const sb = Number(cardDefById(b[0])!.star);
        if (sa !== sb) return sb - sa;
        return a[1].obtained_at - b[1].obtained_at;
      })
      .map(([id]) => id);
    for (const id of cands) {
      const star = cardDefById(id)!.star;
      const max = CARD_STAR_BUDGET[star];
      if (max !== undefined && (budgetCount[star] ?? 0) >= max) continue;
      if (max !== undefined) budgetCount[star] = (budgetCount[star] ?? 0) + 1;
      return { type, card_id: id };
    }
    return { type, card_id: '' };
  });
}

/** 某 config 的固定槽（规整版，按 CARD_SLOT_TYPES 顺序），供卡组编辑按槽位有序渲染。 */
export function resolveDeckSlots(configId: string): CardDeck['slots'] {
  return effectiveDeckSlots(configId);
}

// ── 生成端上下文注入（generator.ts 消费） ────────────────────────────────

/** 装备卡上下文告知行（v67）：让生成选项的 AI 知道玩家装备了什么卡与卡的发动面——
 *  卡与选项从单向触发（卡等选项）变为双向配合。除告知外给出三条明确互动手法
 *  （软模型对「可呼应」类软建议容易忽略，落成具体做法才有效）：
 *  ① demand 触发卡→选项需求值标进触发区间（唯一能让卡「有的放矢」的通道）；
 *  ② type/grade 触发卡→题材/风险档位呼应；③ 效果方向作选项张力来源。
 *  门控与判定路径同口径：card_enabled + 骰子开且非骰式（骰式路径不走卡判定，
 *  告知即为谎言）；无装备卡返回 null（调用方跳过追加）。只告知不强制，
 *  防纯对话轮逼出不自然选项。触发面/效果文案复用 cards-meta 单一来源。 */
export function equippedCardsPromptLine(): string | null {
  const gs = useGlobalSettingsStore();
  if (!gs.settings.card_enabled || !gs.settings.dice.enabled || gs.settings.dice.allow_formula) return null;
  const equipped = resolveEquippedCards(currentCardConfigId());
  if (equipped.length === 0) return null;
  const items = equipped.map(
    eq =>
      `「${eq.card.name}」（${CARD_TYPE_LABEL[eq.card.type]}｜${triggerLabel(eq.card.trigger)}｜${effectsLabel(eq.card.effects)}）`,
  );
  return [
    `玩家当前装备卡牌：${items.join('、')}。与卡牌的配合手法（仅贴合场景时使用，不必每条选项都用，也不必提及卡名）：`,
    '1. 若某张卡以需求值区间触发，可让贴合场景的选项把标题第三段的需求值标注在该区间内，给卡一个发动机会；',
    '2. 若某张卡按选项类型关键词或风险档位（保守/平衡/大胆）触发，可在相应选项的题材与风险上自然呼应；',
    '3. 卡的效果方向（加骰/改需求/扩彩蛋窗/转结局）可作为选项文案张力的可演绎来源。',
  ].join('\n');
}
