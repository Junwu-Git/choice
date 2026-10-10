/**
 * ChoiceDialog 打开栈（模块级）：多弹窗叠开时（如条目池弹窗内再开确认框）
 * Esc 只关最上层，防一键连环关闭。id 由各实例自建 Symbol，开关随 open watch 进出栈。
 */
const openStack: symbol[] = [];

export const pushDialog = (id: symbol): void => {
  openStack.push(id);
};

export const popDialog = (id: symbol): void => {
  const i = openStack.lastIndexOf(id);
  if (i >= 0) openStack.splice(i, 1);
};

export const isTopDialog = (id: symbol): boolean => openStack[openStack.length - 1] === id;

// ── body 滚动锁（计数制）──────────────────────────────────────────────
// 0→1 保存原值并锁定、1→0 还原。不做逐实例 save/restore：乱序关闭（父级 v-if 卸载
// 外层弹窗）时后关者会拿过期快照把 body 永久锁死；计数制只认首个持有者。
// 锁 body.overflow——FloatingRoot 锁的是 documentElement，属性不同互不踩踏
let lockCount = 0;
let savedBodyOverflow: string | null = null;

export const lockBodyScroll = (): void => {
  if (lockCount++ === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
};

export const unlockBodyScroll = (): void => {
  if (lockCount === 0) return;
  if (--lockCount === 0 && savedBodyOverflow !== null) {
    document.body.style.overflow = savedBodyOverflow;
    savedBodyOverflow = null;
  }
};
