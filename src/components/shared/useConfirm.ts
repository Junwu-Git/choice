import { ref } from 'vue';

/**
 * 确认弹窗的 Promise 化封装。
 *
 * 为什么独立：Statistics.vue 原有三组「showXxxConfirm = ref(false) + ConfirmDialog :open + @cancel 复位」
 * 样板（清空/应用建议/应用阵容），三处的 open 标记、复位逻辑、确认处理函数各自手写。
 * 收敛为单个 composable 后：show() 一次传入标题/文案/按钮文案并 await 返回布尔，
 * 模板只绑定 :open 与 @confirm/@cancel 两个事件，省去手写 ref 与复位语句。
 *
 * 其余 ConfirmDialog 调用点是「open 由领域状态派生」（如 :open="deleteTarget !== null"，
 * 标题/文案是 computed），不存在独立 open 标记样板，不强行套本封装（套了反而重复状态）。
 *
 * 注意：返回值是若干 ref 与函数的普通对象——在 <script setup> 顶层解构后，
 * ref 在模板中自动解包（顶层绑定才解包，嵌套对象里的 ref 不解包，故调用方须解构使用）。
 */

export type ConfirmOptions = {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
};

export function useConfirm() {
  const open = ref(false);
  const title = ref('');
  const message = ref('');
  const confirmText = ref('');
  const cancelText = ref('');
  // 当前未决的 resolve：同一对话框串行使用，上一轮 settle 后才可再 show。
  // 未 show 时为 null，confirm/cancel 为 no-op（resolve?. 短路）
  let resolveFn: ((ok: boolean) => void) | null = null;

  const show = (opts: ConfirmOptions): Promise<boolean> => {
    // 防御重入：对话框已打开（上一轮未 settle）时再次 show，先把旧调用以「取消」结束，
    // 保证旧 Promise 必被 resolve、不永久悬挂。当前 UI 触发点都在全屏遮罩下、实际不可达，
    // 但本封装是共享 API，防未来程序化/快速连点的调用方踩坑
    if (open.value) settle(false);
    title.value = opts.title;
    message.value = opts.message;
    confirmText.value = opts.confirmText ?? '';
    cancelText.value = opts.cancelText ?? '';
    open.value = true;
    return new Promise<boolean>(resolve => {
      resolveFn = resolve;
    });
  };

  const settle = (ok: boolean) => {
    open.value = false;
    resolveFn?.(ok);
    resolveFn = null;
  };

  const confirm = () => settle(true);
  const cancel = () => settle(false);

  return { open, title, message, confirmText, cancelText, show, confirm, cancel };
}
