import { describe, expect, it } from 'vitest';
import { ensureEnrichModules, ENRICH_REQUIRED_MODULE_IDS } from '@/core/enrich-modules';
import type { PromptModule } from '@/type/settings';

const mod = (id: string, enabled = true): PromptModule => ({
  id,
  name: id,
  role: 'system',
  content: `${id} 内容`,
  marker: false,
  system: true,
  enabled,
  order: 0,
  enrich_only: true,
  option_only: false,
});

describe('ensureEnrichModules', () => {
  const defaults = ENRICH_REQUIRED_MODULE_IDS.map(id => mod(id));

  it('缺失的润色模块用默认内容补回', () => {
    const out = ensureEnrichModules([mod('option_task')], [], defaults);
    const ids = out.map(m => m.id);
    for (const id of ENRICH_REQUIRED_MODULE_IDS) expect(ids).toContain(id);
  });

  it('被停用的模块不补（尊重用户显式选择）', () => {
    const all = [...defaults, mod('enrich_core_rules', false)];
    const out = ensureEnrichModules([mod('option_task')], all, defaults);
    // 停用的 enrich_core_rules 仍留在 allModules 里 → 不补回
    expect(out.filter(m => m.id === 'enrich_core_rules')).toHaveLength(0);
  });

  it('已存在的模块不被覆盖（用户自定义内容保留）', () => {
    const custom = { ...mod('enrich_core_rules'), content: '我自己的规则' };
    const out = ensureEnrichModules([custom], [custom], defaults);
    const hit = out.find(m => m.id === 'enrich_core_rules');
    expect(hit!.content).toBe('我自己的规则');
  });

  it('默认内容缺失时不凭空造条目', () => {
    const out = ensureEnrichModules([], [], []);
    expect(out).toHaveLength(0);
  });
});
