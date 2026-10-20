/**
 * 预设条目覆盖层的键与查找（纯函数，可单测）。
 *
 *  为什么要按预设名隔离：覆盖层原本只用条目标识符（identifier）作键，而
 *  main / nsfw / jailbreak 这类内置标识符在所有预设里都相同——在 A 预设里改掉的
 *  「系统提示词」会静默作用到 B 预设。用户看到的却是「当前预设的条目」列表。
 *
 *  兼容：新键为 `预设名::条目标识符`；旧键（只有标识符）继续作为全局回退，
 *  已有配置不失效。旧键在 UI 上标注为「旧版全局覆盖」。
 *
 *  写入规则（UI 与生成侧共用这一份）：
 *  - 一切改动都写 scoped 键；旧全局键原样保留，继续对其它预设生效；
 *  - 只有「恢复原样」会连旧全局键一起清——恢复意味着这条不该受任何覆盖约束，
 *    而旧全局键仍在生效就等于没恢复。
 */

/** 覆盖层值的结构（与 GlobalSettings.st_preset_overrides 同构）。 */
export type PresetEntryOverride = { disabled?: boolean; enabled?: boolean; content?: string };

/** 覆盖层映射：标识符（或 `预设名::标识符`）→ 覆盖值。 */
export type PresetOverrideMap = Record<string, PresetEntryOverride>;

/** 分隔符：预设名与条目标识符之间（预设名本身不含 `::`）。 */
const SCOPE_SEPARATOR = '::';

/** 生成带预设名的覆盖键。 */
export function presetOverrideKey(presetName: string, identifier: string): string {
  return `${presetName}${SCOPE_SEPARATOR}${identifier}`;
}

/** 取某个条目的覆盖值：先查带预设名的键，再回退旧版全局键。 */
export function getPresetOverride(
  overrides: PresetOverrideMap | undefined,
  presetName: string | undefined,
  identifier: string,
): PresetEntryOverride | undefined {
  if (!overrides) return undefined;
  if (presetName) {
    const scoped = overrides[presetOverrideKey(presetName, identifier)];
    // 空对象不算覆盖：它既没覆盖什么，又会遮住旧全局键
    if (scoped && Object.keys(scoped).length) return scoped;
  }
  return overrides[identifier];
}

/** 是否存在旧版全局覆盖键（该键对所有含此标识符的预设都生效）。 */
export function hasLegacyPresetOverride(overrides: PresetOverrideMap | undefined, identifier: string): boolean {
  return Boolean(overrides?.[identifier]);
}

/** 写入本预设的覆盖（就地改 map——调用方持有 store 里的同一对象）。 */
export function writePresetOverride(
  overrides: PresetOverrideMap,
  presetName: string,
  identifier: string,
  value: PresetEntryOverride | undefined,
): PresetOverrideMap {
  const key = presetOverrideKey(presetName, identifier);
  if (!value || !Object.keys(value).length) delete overrides[key];
  else overrides[key] = value;
  return overrides;
}

/**
 * 翻转一个覆盖开关（disabled / enabled），就地改 map。
 *
 *  取值用「生效覆盖」（scoped 优先、旧全局键回退），写回 scoped 键；
 *  旧全局键保持不动——它对其它预设仍然生效，在当前预设改一下就把全局覆盖抹掉，
 *  等于让别的预设的覆盖静默失效。
 */
export function togglePresetOverrideFlag(
  overrides: PresetOverrideMap,
  presetName: string,
  identifier: string,
  flag: 'disabled' | 'enabled',
): PresetOverrideMap {
  const cur = getPresetOverride(overrides, presetName, identifier) ?? {};
  const next: PresetEntryOverride = { ...cur };
  if (next[flag]) delete next[flag];
  else next[flag] = true;
  return writePresetOverride(overrides, presetName, identifier, next);
}

/**
 * 写内容覆盖（就地改 map）。空串 = 清空（恢复预设原文）。
 */
export function writePresetContentOverride(
  overrides: PresetOverrideMap,
  presetName: string,
  identifier: string,
  content: string,
): PresetOverrideMap {
  const cur = getPresetOverride(overrides, presetName, identifier) ?? {};
  return writePresetOverride(overrides, presetName, identifier, { ...cur, content });
}

/**
 * 清除内容覆盖（「恢复原样」）：scoped 键的内容与旧全局键一起清。
 *
 *  只动 scoped 键自己的字段，不把旧全局键的其它字段物化进 scoped 键——
 *  物化等于把「全局覆盖」偷偷改成「只对当前预设生效」。
 */
export function clearPresetContentOverride(
  overrides: PresetOverrideMap,
  presetName: string,
  identifier: string,
): PresetOverrideMap {
  const key = presetOverrideKey(presetName, identifier);
  const scoped = overrides[key];
  if (scoped) {
    const { content: _content, ...rest } = scoped;
    writePresetOverride(overrides, presetName, identifier, rest);
  }
  // 旧全局键整体清掉：恢复原样意味着这条不该再受任何覆盖约束
  delete overrides[identifier];
  return overrides;
}
