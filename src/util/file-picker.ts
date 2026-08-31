// JSON 文件选择工具：两库导入共用的文件拾取入口。
//
// 为什么不用「隐藏 input + .click()」这一老方案：
// 真实浏览器（非 CDP 自动化）里，file input 的选择器能否弹出受元素可见性、
// 挂载状态、内核版本多重限制——此前条目库/正则库的导入"点击毫无反应"即栽在这上面；
// 且 CDP 自动化会拦截文件选择器，使这类问题在自动化测试中完全不可见（假通过）。
//
// 策略：桌面 Chrome/Edge 优先 showOpenFilePicker（File System Access API，
// 直接弹系统级选择器，无 input 元素参与，最稳）；不支持的环境（Firefox/Safari/
// 移动端）回退到「挂载到 body 的可视隐藏 input」——挂载 + display:block 是
// 回退路径可用的最低要求（detached 或 display:none 的 input 在真机上会被拦截）。
export async function pickJsonFile(): Promise<File | null> {
  const w = window as any;
  if (typeof w.showOpenFilePicker === 'function') {
    try {
      const [handle] = await w.showOpenFilePicker({
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      return (await handle.getFile()) as File;
    } catch (err: any) {
      // 用户在原生选择器里点取消：静默返回
      if (err?.name === 'AbortError') return null;
      // 其他异常（权限/策略）落到底部 input 回退
    }
  }

  return new Promise<File | null>(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    // 必须挂载到文档：detached input 在部分内核不弹选择器；
    // 必须可见性例外于 ST 的 input[type=file]{display:none}：display:block + 1px + 透明
    input.style.display = 'block';
    input.style.position = 'fixed';
    input.style.top = '-100px';
    input.style.left = '-100px';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.onchange = async () => {
      const file = input.files?.[0] ?? null;
      input.remove();
      resolve(file);
    };
    document.body.appendChild(input);
    input.click();
    // 用户取消时 change 不触发：延时清理挂载的 input，避免残留
    setTimeout(() => input.remove(), 60_000);
  });
}
