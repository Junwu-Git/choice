/**
 * 酒馆主生成闸门。
 *
 *  为什么需要：世界书排他窗口（applyWIExcl）会临时改写酒馆全局世界书状态——
 *  selected_world_info、角色绑定书、聊天绑定书、缓存条目的 disable 标志。
 *  窗口期间若酒馆主生成正在跑，它读到的就是被改写的状态（多本书没注入、
 *  某些条目被临时关掉），主请求会与用户预期不符。
 *
 *  状态源用 `document.body.dataset.generating`（酒馆 deactivate/activateSendButtons
 *  成对维护），**不用 GENERATION_STARTED/GENERATION_ENDED 事件**：干跑（提示词预览、
 *  Token 计数）也会发 STARTED，而 ENDED 只在成功路径的 activateSendButtons 里发——
 *  按事件判断会在干跑之后永久卡成「生成在途」，此后每次世界书构建都白等一次超时。
 *
 *  覆盖范围与残余风险：闸门只保证「窗口开始前已在生成」的主生成不会与窗口重叠；
 *  窗口进行中用户新开一次生成仍无法阻止（酒馆没有提供互斥接口）。
 *  窗口本身已收窄到「只构建世界书」，通常在百毫秒级。
 */

/** 轮询间隔：主生成通常在百毫秒内结束，10ms 足够灵敏又不至于空转。 */
const HOST_IDLE_POLL_MS = 10;

/** 酒馆主生成是否在途（干跑不会置位这个标志）。 */
export function isHostGenerationActive(): boolean {
  // 宿主之外（如单测环境）没有 document：视为「不在途」，闸门直接放行
  if (typeof document === 'undefined') return false;
  return document.body?.dataset?.generating === 'true';
}

/** 等主生成结束再进世界书窗口；超时兜底，保证不会把选项生成卡死。 */
export function waitForHostIdle(timeoutMs = 2500): Promise<void> {
  if (!isHostGenerationActive()) return Promise.resolve();
  return new Promise<void>(resolve => {
    const start = Date.now();
    let timer: ReturnType<typeof setInterval> | null = null;
    const finish = (): void => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      resolve();
    };
    timer = setInterval(() => {
      if (!isHostGenerationActive() || Date.now() - start >= timeoutMs) finish();
    }, HOST_IDLE_POLL_MS);
    // 首个 tick 前先判一次：生成可能刚好在这几毫秒内结束，不必白等一个轮询周期
    if (!isHostGenerationActive() || Date.now() - start >= timeoutMs) finish();
  });
}
