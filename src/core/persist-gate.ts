/**
 * WI 排他窗口期持久化闸门（P2 竞态修复）。
 *
 * 背景：applyWIExcl 对酒馆全局状态做 save/restore——窗口期内角色绑定书
 * （ch.data.extensions.world）与聊天绑定书（chat_metadata.world_info）被临时写成空串，
 * restore 只救内存。而两条持久化通道都在「调用时刻」序列化全局对象：
 *  - scheduleCharacterPersist 的 run() 同步段 JSON.stringify 整个 ch.data.extensions；
 *  - saveMetadataDebounced 延迟触发时整体序列化 chat_metadata。
 * 窗口持续秒级且 UI 可响应，用户此刻改绑定/聊天设置触发的持久化会把空值落盘
 * （磁盘上绑定静默清空，重启/切角色后丢失），内存被 restore 救回、用户无感知。
 *
 * 闸门语义：窗口开启后，经 persistGateDeferOrRun 的持久化动作不立即执行，排队到
 * restore 完成后统一放行——届时序列化读到的是还原后的真实状态。延迟执行是安全的：
 * 两个通道都是「执行时读最新 live 状态」（scheduleCharacterPersist 的 revision 合并、
 * debounce 的延迟序列化），推迟只改变执行时机、不丢最新值。
 *
 * 残余风险（有意接受）：酒馆自身 UI 触发的 saveCharacterDebounced/saveMetadataDebounced
 * 不经本闸门——用户恰好在生成窗口内于酒馆原生面板改绑定属极小概率事件。
 * 闸门只收敛扩展自己的两条通道（watch 链路与绑定入口全在本扩展内）。
 */

let depth = 0;
const deferred: Array<() => void> = [];

export function persistGateEnter(): void {
  depth++;
}

export function persistGateExit(): void {
  depth = Math.max(0, depth - 1);
  if (depth === 0 && deferred.length > 0) {
    const pending = deferred.splice(0, deferred.length);
    for (const fn of pending) {
      try {
        fn();
      } catch (err) {
        console.warn('[Choice] 排他窗口后排队的持久化失败', err);
      }
    }
  }
}

export function isPersistGateActive(): boolean {
  return depth > 0;
}

/** 闸门激活时推迟执行（窗口结束后按序放行），否则立即执行。 */
export function persistGateDeferOrRun(fn: () => void): void {
  if (depth > 0) {
    deferred.push(fn);
  } else {
    fn();
  }
}
