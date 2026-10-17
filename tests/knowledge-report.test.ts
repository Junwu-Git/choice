import { describe, expect, it } from 'vitest';
import {
  injectKnowledgeBlock,
  MAX_INJECT_ENTRIES,
  MAX_STORED_ENTRIES,
  mergeKnowledgePatch,
  parseKnowledgePatch,
  parseKnowledgeReport,
  renderExistingTable,
  renderKnowledgeInjection,
} from '@/core/knowledge-report';
import type { ChatMsg } from '@/core/api-client';
import type { KnowledgeReport, KnowledgeReportEntry } from '@/type/settings';

const report = (entries: KnowledgeReportEntry[], patch: Partial<KnowledgeReport> = {}): KnowledgeReport => ({
  updated_at: 1700000000000,
  based_on_message: 10,
  entries,
  ...patch,
});

const e = (
  topic: string,
  status: KnowledgeReportEntry['status'],
  basis = '',
  impact = '',
  updated_at_message = 0,
): KnowledgeReportEntry => ({ topic, status, basis, impact, updated_at_message });

describe('parseKnowledgePatch', () => {
  it('解析裸 JSON 数组', () => {
    const out = parseKnowledgePatch(
      '[{"topic":"真实身份","status":"unknown","basis":"未交代获取过程","impact":"不得叫出真名"}]',
    );
    expect(out).toEqual([
      { topic: '真实身份', status: 'unknown', basis: '未交代获取过程', impact: '不得叫出真名' },
    ]);
  });

  it('剥离 thinking 块与代码围栏', () => {
    const text = `<thinking>先想想</thinking>
\`\`\`json
[{"topic":"仓库位置","status":"known","basis":"第 3 楼被告知"}]
\`\`\``;
    const out = parseKnowledgePatch(text);
    expect(out).toHaveLength(1);
    expect(out![0]).toMatchObject({ topic: '仓库位置', status: 'known' });
  });

  it('解析 drop 补丁', () => {
    const out = parseKnowledgePatch('[{"topic":"旧线索","drop":true}]');
    expect(out).toEqual([{ topic: '旧线索', drop: true }]);
  });

  it('空数组是合法结果（本轮无变化）', () => {
    expect(parseKnowledgePatch('[]')).toEqual([]);
  });

  it('完全没有 JSON 数组时返回 null', () => {
    expect(parseKnowledgePatch('模型拒绝输出')).toBeNull();
  });

  it('截断抢救：无闭合 ] 时保留完整对象', () => {
    const out = parseKnowledgePatch('[{"topic":"A","status":"known"},{"topic":"B","status":"uncert');
    expect(out?.map(x => x.topic)).toEqual(['A']);
  });

  it('非法 status 归 unknown', () => {
    const out = parseKnowledgePatch('[{"topic":"A","status":"maybe"}]');
    expect(out![0]).toMatchObject({ topic: 'A', status: 'unknown' });
  });

  it('空 topic 整行跳过', () => {
    const out = parseKnowledgePatch('[{"topic":"  ","status":"known"},{"topic":"B","status":"known"}]');
    expect(out?.map(x => x.topic)).toEqual(['B']);
  });

  it('同 topic 后出现的覆盖先出现的', () => {
    const out = parseKnowledgePatch(
      '[{"topic":"A","status":"uncertain"},{"topic":"A","status":"unknown"},{"topic":"B","status":"known"}]',
    );
    expect(out?.map(x => `${x.topic}:${'status' in x ? x.status : 'drop'}`)).toEqual(['A:unknown', 'B:known']);
  });

  it('上限 40 条', () => {
    const arr = Array.from({ length: 60 }, (_, i) => ({ topic: `T${i}`, status: 'known' }));
    expect(parseKnowledgePatch(JSON.stringify(arr))).toHaveLength(40);
  });
});

describe('parseKnowledgeReport', () => {
  it('忽略 drop 补丁', () => {
    const out = parseKnowledgeReport('[{"topic":"A","status":"known"},{"topic":"B","drop":true}]');
    expect(out.map(x => x.topic)).toEqual(['A']);
  });
});

describe('mergeKnowledgePatch', () => {
  it('新增条目追加，未触碰的条目原样保留', () => {
    const existing = [e('旧条目', 'known', '第 2 楼', '', 5)];
    const out = mergeKnowledgePatch(existing, [{ topic: '新条目', status: 'unknown', basis: '未交代', impact: '不得' }], 20);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(existing[0]);
    expect(out[1]).toMatchObject({ topic: '新条目', status: 'unknown', updated_at_message: 20 });
  });

  it('同 topic 覆盖并刷新时间戳，位置不变', () => {
    const existing = [e('A', 'uncertain', '传闻', '', 5), e('B', 'known', '第 1 楼', '', 6)];
    const out = mergeKnowledgePatch(existing, [{ topic: 'A', status: 'known', basis: '第 9 楼当面告知', impact: '' }], 30);
    expect(out.map(x => x.topic)).toEqual(['A', 'B']);
    expect(out[0]).toMatchObject({ topic: 'A', status: 'known', basis: '第 9 楼当面告知', updated_at_message: 30 });
    expect(out[1]).toEqual(existing[1]);
  });

  it('drop 删除条目', () => {
    const existing = [e('A', 'known'), e('B', 'unknown')];
    const out = mergeKnowledgePatch(existing, [{ topic: 'A', drop: true }], 20);
    expect(out.map(x => x.topic)).toEqual(['B']);
  });

  it('空补丁不改动任何条目', () => {
    const existing = [e('A', 'known', '', '', 5)];
    expect(mergeKnowledgePatch(existing, [], 99)).toEqual(existing);
  });

  it('超存储上限时淘汰最久未更新的条目', () => {
    const existing = Array.from({ length: MAX_STORED_ENTRIES }, (_, i) => e(`old${i}`, 'known', '', '', i));
    const out = mergeKnowledgePatch(existing, [{ topic: '最新', status: 'unknown', basis: '', impact: '' }], 999);
    expect(out).toHaveLength(MAX_STORED_ENTRIES);
    expect(out.some(x => x.topic === '最新')).toBe(true);
    // 时间戳为 0 的条目最先被淘汰
    expect(out.some(x => x.topic === 'old0')).toBe(false);
  });
});

describe('renderExistingTable', () => {
  it('空表返回空串', () => {
    expect(renderExistingTable([])).toBe('');
  });

  it('按三态标签渲染已有条目', () => {
    const out = renderExistingTable([e('A', 'known', '第 2 楼', ''), e('B', 'unknown', '未交代', '不得叫破')]);
    expect(out).toContain('- [已知] A｜依据：第 2 楼');
    expect(out).toContain('- [未知] B｜依据：未交代；约束：不得叫破');
  });
});

describe('renderKnowledgeInjection', () => {
  it('空报告返回空串', () => {
    expect(renderKnowledgeInjection(report([]))).toBe('');
  });

  it('按已知→存疑→未知分组并带标签', () => {
    const out = renderKnowledgeInjection(
      report([e('U', 'unknown'), e('K', 'known', '第 2 楼'), e('S', 'uncertain', '传闻')]),
    );
    expect(out.startsWith('<knowledge_boundary_report>')).toBe(true);
    expect(out.endsWith('</knowledge_boundary_report>')).toBe(true);
    expect(out.indexOf('【已知】')).toBeLessThan(out.indexOf('【存疑】'));
    expect(out.indexOf('【存疑】')).toBeLessThan(out.indexOf('【未知】'));
    expect(out).toContain('K｜依据：第 2 楼');
    expect(out).toContain('S｜依据：传闻');
  });

  it('已知项只带依据，未知项带依据与约束', () => {
    const out = renderKnowledgeInjection(
      report([e('K', 'known', '当面告知', '不该出现的约束'), e('U', 'unknown', '未交代', '不得行动')]),
    );
    expect(out).toContain('K｜依据：当面告知');
    expect(out).not.toContain('不该出现的约束');
    expect(out).toContain('U｜依据：未交代；约束：不得行动');
  });

  it('总数封顶：超出时优先裁掉已知，保住未知与存疑', () => {
    // 已知 30 条 + 存疑 2 条 + 未知 2 条，总数远超上限
    const entries = [
      ...Array.from({ length: 30 }, (_, i) => e(`K${i}`, 'known')),
      ...Array.from({ length: 2 }, (_, i) => e(`S${i}`, 'uncertain')),
      ...Array.from({ length: 2 }, (_, i) => e(`U${i}`, 'unknown')),
    ];
    const out = renderKnowledgeInjection(report(entries));
    const lineCount = out.split('\n').filter(l => l.startsWith('- ')).length;
    expect(lineCount).toBe(MAX_INJECT_ENTRIES);
    // 存疑与未知必须全在
    expect(out).toContain('S0');
    expect(out).toContain('S1');
    expect(out).toContain('U0');
    expect(out).toContain('U1');
    // 已知只保留填满剩余名额的部分
    expect(out).toContain('K0');
    expect(out).not.toContain('K29');
    expect(out).toContain('因篇幅省略');
  });

  it('存疑数量少时不浪费名额给已知以外的状态', () => {
    // 只有 1 条存疑 + 大量已知：已知可占满剩余名额，不因「每态上限」被压到 20
    const entries = [
      ...Array.from({ length: 30 }, (_, i) => e(`K${i}`, 'known')),
      e('S0', 'uncertain'),
    ];
    const out = renderKnowledgeInjection(report(entries));
    const lineCount = out.split('\n').filter(l => l.startsWith('- ')).length;
    expect(lineCount).toBe(MAX_INJECT_ENTRIES);
    expect(out).toContain('S0');
  });

  it('总字符预算超限时截断', () => {
    const long = 'x'.repeat(400);
    const entries = Array.from({ length: 20 }, (_, i) => e(`T${i}${long}`, 'unknown', long, long));
    const out = renderKnowledgeInjection(report(entries));
    expect(out.length).toBeLessThan(3500);
    expect(out).toContain('因篇幅省略');
  });

  it('标题明示只针对玩家角色本人', () => {
    const out = renderKnowledgeInjection(report([e('A', 'known')]));
    expect(out).toContain('仅玩家角色本人');
  });
});

describe('injectKnowledgeBlock', () => {
  it('插到最后一条 user 消息之前', () => {
    const msgs: ChatMsg[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { role: 'assistant', content: 'prefill' },
    ];
    injectKnowledgeBlock(msgs, '<report/>');
    expect(msgs.map(m => m.role)).toEqual(['system', 'system', 'user', 'assistant']);
    expect(msgs[1].content).toBe('<report/>');
  });

  it('没有 user 消息时追加到末尾', () => {
    const msgs: ChatMsg[] = [{ role: 'system', content: 'sys' }];
    injectKnowledgeBlock(msgs, '<report/>');
    expect(msgs).toHaveLength(2);
    expect(msgs[1]).toEqual({ role: 'system', content: '<report/>' });
  });

  it('空块不插入', () => {
    const msgs: ChatMsg[] = [{ role: 'user', content: 'task' }];
    injectKnowledgeBlock(msgs, '');
    expect(msgs).toHaveLength(1);
  });
});
