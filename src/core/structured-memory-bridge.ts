/**
 * 结构化记忆源检测式桥接（只读、fail-safe，绝不写对方状态）
 *
 * 职责：识别外部结构化记忆插件为当前角色指定的注入目标世界书名，供本扩展的
 * 「结构化记忆」开关与世界书页徽章使用。
 * 隔离原则：不依赖对方内部模块（不 import 其源码）；只读宿主 extensionSettings
 * 的 userscripts 命名空间，解析路径按已核实的第三方存储布局实现，任何环节失败
 * 均静默返回 null。
 *
 * 设置存储路径（运行时契约，名称由对方定义，不可改）：
 *   extension_settings.__userscripts[<命名空间>][<键>]
 *    → JSON 字符串（对方写入时做了字符串序列化）
 *    → characterSettings[<scopeKey>].worldbookConfig.injectionTarget
 *
 * scopeKey 优先级：group:<id> > char:<avatar> > charname:<name>
 */

// 只在 src/core 下接触酒馆源码，符合 AGENTS.md 隔离原则
import { this_chid } from '@sillytavern/script';
import { world_names } from '@sillytavern/scripts/world-info';
import { getStCharacter } from '@/core/st-character';

// ── 存储路径常量（运行时契约：命名空间与键名由对方定义，不能改）──
const EXTERNAL_MEMORY_NS = 'shujuku_v120__userscript_settings_v1';
const EXTERNAL_MEMORY_KEY = 'shujuku_v120_allSettings_v2';

interface ExternalWorldbookConfig {
  injectionTarget?: string;
  source?: string;
}

interface ExternalMemorySettings {
  characterSettings?: Record<string, { worldbookConfig?: ExternalWorldbookConfig }>;
}

/**
 * 读取对方的设置根对象（JSON 字符串 → 对象）。
 * 路径：extension_settings.__userscripts[EXTERNAL_MEMORY_NS][EXTERNAL_MEMORY_KEY]
 */
function readExternalSettings(): ExternalMemorySettings | null {
  try {
    const ext: any = (window as any).SillyTavern?.getContext?.()?.extensionSettings;
    if (!ext) return null;
    const ns = ext?.__userscripts?.[EXTERNAL_MEMORY_NS];
    if (!ns) return null;
    const raw = ns[EXTERNAL_MEMORY_KEY];
    if (raw == null) return null;
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as ExternalMemorySettings);
  } catch {
    return null;
  }
}

/**
 * 解析当前角色卡作用域键（优先级：群聊 > 角色卡 > 角色名）。
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
 * 解析当前角色的注入目标世界书名。
 *
 * injectionTarget 语义：
 *   - 'character' → 角色卡主世界书（character.data.extensions.world）
 *   - 显式书名 → 该书必须存在于 world_names 中才返回
 *
 * 任何环节失败返回 null（fail-safe，绝不抛错、绝不修改对方数据）。
 */
export function getExternalStructuredBook(): string | null {
  try {
    const settings = readExternalSettings();
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
