import { characters } from '@sillytavern/script';
import { setting_field } from '@/type/settings';

/** 绑定类型：pool = 条目池配置（CharacterSettings.config_id），prompt = 提示词配置（prompt_config_id） */
export type BindKind = 'pool' | 'prompt';

/** kind → CharacterSettings 字段名（schema 见 src/type/settings.ts:1211-1217） */
const KIND_FIELD: Record<BindKind, 'config_id' | 'prompt_config_id'> = {
  pool: 'config_id',
  prompt: 'prompt_config_id',
};

export type BoundCharacter = { chid: string; name: string };

/**
 * 全量扫描角色卡，返回绑定了指定配置的角色列表。
 *
 * 绑定方向是「角色卡 → 配置」（每张卡 extensions 里存 config_id），要反向查出
 * 「某配置被哪些角色绑定」只能遍历 characters——这正是过滤页角色卡正则区同款的
 * 反向视角。chid 统一归一化为字符串（酒馆 this_chid 实测是字符串），与
 * global-settings 的 normChid 保持一致，否则与 currentCharacterId 比较会类型失配。
 * characters 是酒馆普通数组（非 Vue 响应式），调用方需自行驱动重算（见 ConfigBindings）。
 */
export function getBoundCharacters(kind: BindKind, configId: string): BoundCharacter[] {
  const field = KIND_FIELD[kind];
  const result: BoundCharacter[] = [];
  for (let i = 0; i < characters.length; i++) {
    const ch = characters[i] as StCharacter | undefined;
    // 浅卡/异常卡可能缺 data.extensions，一律 ?. 防御
    if (ch?.data?.extensions?.[setting_field]?.[field] === configId) {
      const chid = String(i);
      result.push({ chid, name: ch.name || `#${chid}` });
    }
  }
  return result;
}

/**
 * 把角色 data（含最新 extensions）持久化到磁盘。
 *
 * 不能依赖酒馆的 saveCharacterDebounced：它触发 #form_create 表单提交，保存逻辑以
 * 加载角色时的 json_data 旧快照重建 data（见酒馆 src/endpoints/characters.js 的
 * charaFormatData），直接写 characters[].data.extensions 的字段会在保存时被旧快照
 * 覆盖——这正是「配置绑定角色卡无效」的根因。
 *
 * 本函数构造完整 form-data 直接调 /api/characters/edit。关键：json_data 必须以角色
 * 加载时的完整卡 JSON（ch.json_data，形如 { spec, name, data: {...} }）为基底——
 * 若像直觉那样传 JSON.stringify(ch.data)（V2 data 子对象），后端把它 parse 成顶层
 * 结构后再 _.set 出 char.data.*，我们写的 extensions 会落在 char.extensions 顶层，
 * 不进入 data.extensions，读取时被读卡器丢弃。以完整卡为基底则 char.data.extensions
 * 天然就在正确位置。合并策略：旧快照的 data.extensions 与内存中最新 live 扩展深度
 * 合并（live 覆盖同路径），保证既有扩展字段不被旧快照冲掉。
 * 返回是否成功；成功后同步刷新 ch.json_data 快照，杜绝后续旧快照路径覆盖。
 */
export async function persistCharacter(ch: StCharacter): Promise<boolean> {
  const avatar = ch.avatar || '';
  if (!avatar) {
    console.warn('[Choice] persistCharacter skipped: missing avatar', ch.name);
    return false;
  }
  let base: Record<string, any>;
  try {
    base = JSON.parse(ch.json_data ?? '{}');
  } catch {
    base = {};
  }
  if (typeof base.data !== 'object' || base.data === null) {
    base.data = {};
  }
  const baseData = base.data as Record<string, any>;
  const prevExtensions = (baseData.extensions as Record<string, any> | undefined) ?? {};
  const liveExtensions = ch.data?.extensions ?? {};
  baseData.extensions = {};
  _.merge(baseData.extensions, prevExtensions, liveExtensions);

  const formData = new FormData();
  const legacy = ch as Record<string, unknown>;
  formData.set('ch_name', ch.name || '');
  formData.set('json_data', JSON.stringify(base));
  formData.set('avatar_url', avatar);
  formData.set('chat', typeof legacy.chat === 'string' ? legacy.chat : '');
  formData.set(
    'create_date',
    typeof legacy.create_date === 'string' ? legacy.create_date : new Date().toISOString(),
  );
  try {
    const ctx = window.SillyTavern?.getContext?.();
    const headers = ctx?.getRequestHeaders?.({ omitContentType: true }) ?? {};
    const res = await fetch('/api/characters/edit', {
      method: 'POST',
      headers,
      body: formData,
      cache: 'no-cache',
    });
    if (!res.ok) {
      console.warn(`[Choice] persistCharacter failed: ${res.status}`, ch.name);
      return false;
    }
    // 保存成功：刷新内置快照，避免后续任何旧快照路径覆盖本次写入
    ch.json_data = JSON.stringify(base);
    return true;
  } catch (e) {
    console.warn('[Choice] persistCharacter error', e);
    return false;
  }
}

/**
 * 延后并合并角色卡保存：角色卡 JSON 可能很大，不能在点击或 Vue watch 的当前任务中序列化。
 * 同一角色的连续操作只保留最新任务；正在保存时再排队一次最新状态，避免旧结果覆盖新状态。
 */
const persistQueues = new WeakMap<StCharacter, { scheduled: boolean; running: boolean; revision: number }>();

export function scheduleCharacterPersist(ch: StCharacter, onComplete?: (ok: boolean) => void): void {
  let queue = persistQueues.get(ch);
  if (!queue) {
    queue = { scheduled: false, running: false, revision: 0 };
    persistQueues.set(ch, queue);
  }
  queue.revision++;
  const run = () => {
    queue!.scheduled = false;
    if (queue!.running) return;
    const revision = queue!.revision;
    queue!.running = true;
    void persistCharacter(ch)
      .then(ok => {
        if (revision === queue!.revision) onComplete?.(ok);
      })
      .finally(() => {
        queue!.running = false;
        if (revision !== queue!.revision && !queue!.scheduled) {
          queue!.scheduled = true;
          setTimeout(run, 0);
        }
      });
  };
  if (!queue.scheduled) {
    queue.scheduled = true;
    setTimeout(run, 0);
  }
}
