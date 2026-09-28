/**
 * 开卡包弹窗共享信号（v62 卡牌系统）：主面板/悬浮球 chip 触发幸运数开包、卡牌页商店/每日
 * 任务领包都经 `openCardPack(offer, via)` 唤起同名全局弹窗，由 CardPackDialog.vue 订阅渲染。
 *
 * 为什么用共享信号而非各组件自行弹窗：主面板与悬浮球是既定并行实现（chip/弹窗触发两处需
 * 同步、勿只改一处），且卡牌页（设置面板内）也会开包——共用一个模块级单例避免三处各自维护
 * 一套「当前 offer + 是否打开」状态而串扰。选完即 close；不持有任何持久状态。
 */

import type { CardOffer } from '@/core/cards';

export type PackVia = 'lucky' | 'daily' | 'shop';

/** 当前待开的卡包（null = 无弹窗）。同一时间仅一个；via 决定统计埋点（每日领奖计数等）。 */
export const cardPack = ref<{ offer: CardOffer; via: PackVia } | null>(null);

/** 打开一次开卡包弹窗（幸运/每日/商店统一入口）。 */
export function openCardPack(offer: CardOffer, via: PackVia = 'lucky'): void {
  cardPack.value = { offer, via };
}

/** 关闭开卡包弹窗（选中 / 取消）。 */
export function closeCardPack(): void {
  cardPack.value = null;
}