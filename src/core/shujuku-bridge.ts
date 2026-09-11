/**
 * core/shujuku-bridge.ts — SP·数据库 检测式桥接（只读、fail-safe，绝不写 SP·数据库 状态）
 *
 * 职责：识别 SP·数据库 当前角色的注入目标世界书名，供 choice 的「数据库」开关与世界书页徽章使用。
 * 隔离原则：不依赖 SP·数据库 内部模块（不 import shujuku 源码）；只读 `extension_settings`
 * 的 userscripts 命名空间，解析路径完全镜像 SP·数据库 自身的 tavern-storage.ts，
 * 任何环节失败均静默返回 null。
 *
 * 设置存储路径（已从 shujuku 源码核实）：
 *   extension_settings.__userscripts['shujuku_v120__userscript_settings_v1']['shujuku_v120_allSettings_v2']
 *    → JSON 字符串（setItem 时 String(value) 序列化）
 *    → Settings_ACU
 *    → characterSettings[<scopeKey>].worldbookConfig.injectionTarget
 *
 * scopeKey 优先级：group:<id> > char:<avatar> > charname:<name>
 */

// 只在 src/core 下接触酒馆源码，符合 AGENTS.md 隔离原则
import { this_chid } from '@sillytavern/script';
import { world_names } from '@sillytavern/scripts/world-info';
import { getStCharacter } from '@/core/st-character';

// ── 存储路径常量（与 shujuku 的 STORAGE_KEY_ALL_SETTINGS_ACU / TAVERN_SETTINGS_NAMESPACE_ACU 完全对齐）──
const SHUJUKU_NS = 'shujuku_v120__userscript_settings_v1';
const SHUJUKU_KEY = 'shujuku_v120_allSettings_v2';

interface ShujukuWorldbookConfig {
  injectionTarget?: string;
  source?: string;
}

interface ShujukuSettings {
  characterSettings?: Record<string, { worldbookConfig?: ShujukuWorldbookConfig }>;
}

/**
 * 读取 SP·数据库 的设置根对象（JSON 字符串 → 对象）。
 * 与 shujuku 的 tavern-storage.ts getConfigStorage_ACU() 路径一致：
 *   extension_settings.__userscripts[SHUJUKU_NS][SHUJUKU_KEY]
 */
function readShujukuSettings(): ShujukuSettings | null {
  try {
    const ext: any = (window as any).SillyTavern?.getContext?.()?.extensionSettings;
    if (!ext) return null;
    const ns = ext?.__userscripts?.[SHUJUKU_NS];
    if (!ns) return null;
    const raw = ns[SHUJUKU_KEY];
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as ShujukuSettings);
  } catch {
    return null;
  }
}

/**
 * 解析当前角色卡作用域键（镜像 shujuku 的 getCurrentCharacterCardKey_ACU 优先级）。
 * 1. 群聊：group:<groupId>
 * 2. 角色卡：char:<avatar 文件名>
 * 3. 回退：charname:<角色名>
 * 4. 全部失败返回 null
 */
function resolveScopeKey(): string | null {
  try {
    const ctx = (window as any).SillyTavern?.getContext?.();
    const groupId = String(ctx?.groupId ?? '').trim();
    if (groupId) return `group:${groupId}`;

    const ch = getStCharacter(this_chid);
    const avatar = String(ch?.avatar ?? '').trim();
    if (avatar) return `char:${avatar}`;

    const name = String(ch?.name ?? ch?.data?.name ?? '').trim();
    if (name) return `charname:${name}`;

    return null;
  } catch {
    return null;
  }
}

/**
 * 解析 SP·数据库 当前角色的注入目标世界书名。
 *
 * injectionTarget 语义（来自 shujuku settings-model.ts）：
 *   - 'character' → 角色卡主世界书（character.data.extensions.world）
 *   - 显式书名 → 该书必须存在于 world_names 中才返回
 *
 * 任何环节失败返回 null（fail-safe，绝不抛错、绝不修改 SP·数据库 数据）。
 */
export function getShujukuTargetBook(): string | null {
  try {
    const settings = readShujukuSettings();
    if (!settings?.characterSettings) return null;

    const scopeKey = resolveScopeKey();
    if (!scopeKey) return null;

    const cfg = settings.characterSettings[scopeKey]?.worldbookConfig;
    const target = cfg?.injectionTarget;
    if (!target) return null;

    if (target === 'character') {
      // 默认角色卡主世界书
      const ch = getStCharacter(this_chid);
      const w = String(ch?.data?.extensions?.world ?? '').trim();
      return w || null;
    }

    // 显式书名：必须存在于世界书列表中（防止残留/重命名配置返回不存在书名）
    const names = world_names ?? [];
    return names.includes(target) ? target : null;
  } catch {
    return null;
  }
}
