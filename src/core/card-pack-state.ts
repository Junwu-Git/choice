/**
 * 开卡包弹窗共享信号（v62 卡牌系统）：主面板/悬浮球 chip 触发幸运数开包、卡牌页购买开包
 * 都经 `openCardPack(offer, via)` 唤起同名全局弹窗，由 CardPackDialog.vue 订阅渲染。
 *
 * 为什么用共享信号而非各组件自行弹窗：主面板与悬浮球是既定并行实现（chip/弹窗触发两处需
 * 同步、勿只改一处），且卡牌页（设置面板内）也会开包——共用一个模块级单例避免三处各自维护
 * 一套「当前 offer + 是否打开」状态而串扰。选完即 close；未选关闭一律挂起（parkCardPack，
 * 收藏页可重开）——购买路径已扣币，丢弃 offer 即白扣。不持有任何持久状态。
 */

import type { CardOffer } from '@/core/cards';

export type PackVia = 'lucky' | 'shop';

/** 当前待开的卡包（null = 无弹窗）。同一时间仅一个；via 决定统计埋点（每日领奖计数等）。 */
export const cardPack = ref<{ offer: CardOffer; via: PackVia } | null>(null);

/** 稍后再选挂起的卡包（null = 无挂起）：关闭弹窗但不选时暂存，收藏页可重新打开。
 *  防两类损失——购买路径已扣 5 币、offer 被丢即白扣；幸运路径丢机会。同一时间最多
 *  一个（再挂起覆盖旧的；开新包不影响已挂起的）。 */
export const parkedCardPack = ref<{ offer: CardOffer; via: PackVia } | null>(null);

/** 打开一次开卡包弹窗（幸运/每日/商店统一入口）。 */
export function openCardPack(offer: CardOffer, via: PackVia = 'lucky'): void {
  cardPack.value = { offer, via };
}

/** 关闭开卡包弹窗（选中后的正常清除，不挂起）。 */
export function closeCardPack(): void {
  cardPack.value = null;
}

/** 关闭但不选（稍后再选/点遮罩/×）：offer 挂起待重开，不丢弃。
 *  已有挂起时保留先挂起的（先挂起的「仅选中才清除」承诺不因后开包失效），当前关闭的
 *  offer 被丢弃并返回 'discarded' 供调用方提示——购买路径已扣币，白扣损失必须可见，
 *  勿静默覆盖。当前无弹窗（重复触发）返回 'none'。 */
export function parkCardPack(): 'parked' | 'discarded' | 'none' {
  if (!cardPack.value) return 'none';
  if (parkedCardPack.value) {
    cardPack.value = null;
    return 'discarded';
  }
  parkedCardPack.value = cardPack.value;
  cardPack.value = null;
  return 'parked';
}

/** 重开挂起的卡包（收藏页入口）。无挂起返回 false。 */
export function reopenParkedPack(): boolean {
  if (!parkedCardPack.value) return false;
  cardPack.value = parkedCardPack.value;
  parkedCardPack.value = null;
  return true;
}
