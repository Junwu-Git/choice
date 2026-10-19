import { describe, expect, it } from 'vitest';
import {
  buildKnowledgeExport,
  checkCommitGuards,
  computeChatFingerprint,
  enforceCapacity,
  entrySortScore,
  findDuplicateGroups,
  freshnessScore,
  IMPORTANCE_RANK,
  isMessageCoveredByFingerprint,
  MAX_ALIAS_LEN,
  MAX_ALIASES,
  MAX_RETIRED_ENTRIES,
  MAX_STORED_ENTRIES,
  mergeDuplicateGroup,
  mergeKnowledgePatch,
  migrateKnowledgeReport,
  parseKnowledgePatch,
  parseKnowledgeResponse,
  parseKnowledgeExport,
  renderExistingTable,
  resolveAnalysisHistoryStart,
  type KnowledgePatch,
} from '@/core/knowledge-report';
import { injectKnowledgeBlock, renderKnowledgeInjection, renderKnowledgeInjectionDetailed } from '@/core/knowledge-injection';
import type { ChatMsg } from '@/core/api-client';
import type { KnowledgeReport, KnowledgeReportEntry } from '@/type/settings';

const report = (entries: KnowledgeReportEntry[], patch: Partial<KnowledgeReport> = {}): KnowledgeReport => ({
  updated_at: 1700000000000,
  based_on_message: 10,
  based_on_fingerprint: '',
  revision: 1,
  entries,
  last_changes: [],
  ...patch,
});

const e = (
  topic: string,
  status: KnowledgeReportEntry['status'],
  basis = '',
  impact = '',
  updated_at_message = 0,
  extra: Partial<KnowledgeReportEntry> = {},
): KnowledgeReportEntry => ({
  id: `kb_${topic}`,
  topic,
  subject: '',
  aliases: [],
  keywords: [],
  status,
  source: 'unspecified',
  importance: 'normal',
  previous_status: '',
  basis,
  impact,
  event_time: '',
  first_seen_message: 0,
  updated_at_message,
  revision: 0,
  locked: false,
  retired: false,
  retired_reason: '',
  ...extra,
});

const patch = (over: Partial<Extract<KnowledgePatch, { drop?: false }>> & { topic: string }): KnowledgePatch => ({
  status: 'known',
  source: 'witnessed',
  importance: 'normal',
  basis: '',
  impact: '',
  aliases: [],
  keywords: [],
  event_time: '',
  ...over,
});

describe('parseKnowledgeResponse', () => {
  it('解析对象形态（含 base_revision）', () => {
    const out = parseKnowledgeResponse(
      '{"base_revision":3,"entries":[{"topic":"真实身份","status":"unknown","source":"none","basis":"未交代获取过程","impact":"不得叫出真名"}]}',
    );
    expect(out?.baseRevision).toBe(3);
    expect(out?.patches).toHaveLength(1);
    expect(out?.patches[0]).toMatchObject({ topic: '真实身份', status: 'unknown', source: 'none' });
  });

  it('兼容裸数组（baseRevision 为 null）', () => {
    const out = parseKnowledgeResponse('[{"topic":"仓库位置","status":"known","source":"heard"}]');
    expect(out?.baseRevision).toBeNull();
    expect(out?.patches[0]).toMatchObject({ topic: '仓库位置', status: 'known', source: 'heard' });
  });

  it('剥离 thinking 块与代码围栏', () => {
    const text = `<thinking>先想想</thinking>
\`\`\`json
{"base_revision":0,"entries":[{"topic":"仓库位置","status":"known","source":"witnessed","basis":"第 3 楼被告知"}]}
\`\`\``;
    const out = parseKnowledgeResponse(text);
    expect(out?.patches).toHaveLength(1);
    expect(out?.patches[0]).toMatchObject({ topic: '仓库位置', status: 'known' });
  });

  it('中文状态与来源归一', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"存疑","source":"听闻"},{"topic":"B","status":"已知","source":"目击"}]}',
    );
    expect(out?.patches[0]).toMatchObject({ status: 'uncertain', source: 'heard' });
    expect(out?.patches[1]).toMatchObject({ status: 'known', source: 'witnessed' });
  });

  it('大写英文枚举同样识别（Known / Witnessed / High）', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"Known","source":"Witnessed","importance":"High"}]}',
    );
    expect(out?.patches[0]).toMatchObject({
      status: 'known',
      source: 'witnessed',
      importance: 'high',
      status_explicit: true,
      source_explicit: true,
      importance_explicit: true,
    });
  });

  it('无法识别的枚举不算显式值（按缺失处理，保留旧值）', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"部分已知","source":"?","importance":"离谱"}]}',
    );
    expect(out?.patches[0]).toMatchObject({
      status_explicit: false,
      source_explicit: false,
      importance_explicit: false,
    });
  });

  it('aliases/keywords 支持字符串拆分', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","aliases":"货仓、仓库","keywords":"城北，旧宅","status":"known"}]}',
    );
    expect(out?.patches[0]).toMatchObject({ aliases: ['货仓', '仓库'], keywords: ['城北', '旧宅'] });
  });

  it('超过 16 字的描述被整条丢弃（不是截成半句）', () => {
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          {
            topic: '苏凛的发情期',
            status: 'uncertain',
            aliases: ['苏凛精液渴求症及上精需求与近期行为观察记录'],
            keywords: ['苏凛前日发消息后今日未联系'],
          },
        ],
      }),
    );
    expect(out!.patches[0]).toMatchObject({ aliases: [], keywords: [] });
  });

  it('正常长度的别名不受影响', () => {
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          {
            topic: '苏凛的发情期',
            status: 'uncertain',
            aliases: ['渴求症', '上次上贡时间'],
            keywords: ['精液', '发情'],
          },
        ],
      }),
    );
    expect(out!.patches[0]).toMatchObject({
      aliases: ['渴求症', '上次上贡时间'],
      keywords: ['精液', '发情'],
    });
    expect(MAX_ALIAS_LEN).toBeGreaterThanOrEqual(12);
  });

  it('句子式「别名」被整条丢弃，不截成半句', () => {
    // 真实案例：模型把判断当别名回传
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          {
            topic: '苏凛的渴求症',
            status: 'uncertain',
            aliases: [
              '苏凛可能处于稳定期或发情边缘',
              '苏凛前日发消息后今日未联系',
              '上次上贡时间', // 正常简称，应保留
              '渴求症',
            ],
            keywords: ['苏凛今日可能心情复杂', '是否发情', '精液'],
          },
        ],
      }),
    );
    expect(out!.patches[0]).toMatchObject({ aliases: ['上次上贡时间', '渴求症'], keywords: ['精液'] });
  });

  it('别名与检索词归一内部空白', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"known","aliases":["  旧  称  "],"keywords":["城北   仓库"]}]}',
    );
    expect(out!.patches[0]).toMatchObject({ aliases: ['旧 称'], keywords: ['城北 仓库'] });
  });

  it('event_time 归一空白并截断，非字符串归一为空串', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"known","event_time":"  2026年10月15日   下午  "},{"topic":"B","status":"known","event_time":123}]}',
    );
    expect(out?.patches[0]).toMatchObject({ event_time: '2026年10月15日 下午' });
    expect(out?.patches[1]).toMatchObject({ event_time: '' });
  });

  it('模糊时段被判空：某日上午 / 只有时段没有日期', () => {
    // 真实案例：模型把「某日上午」当时间回传——它自己都说不清是哪天
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          { topic: 'A', status: 'known', event_time: '某日上午' },
          { topic: 'B', status: 'known', event_time: '下午' },
          { topic: 'C', status: 'known', event_time: '傍晚' },
          { topic: 'D', status: 'known', event_time: '某天夜里' },
          { topic: 'E', status: 'known', event_time: '第二天' },
          { topic: 'F', status: 'known', event_time: '2026年10月15日 下午' },
          { topic: 'G', status: 'known', event_time: '民国二十三年 秋' },
          { topic: 'H', status: 'known', event_time: '三日后' },
        ],
      }),
    );
    const times = out!.patches.map(p => ('event_time' in p ? p.event_time : null));
    // 前四条是伪时间；后四条有可定位锚点（相对推进或纪年/日期）
    expect(times).toEqual(['', '', '', '', '第二天', '2026年10月15日 下午', '民国二十三年 秋', '三日后']);
  });

  it('关联对象归一：占位词判空，保留正名', () => {
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          { topic: 'A', status: 'known', subject: '富川立花' },
          { topic: 'B', status: 'known', subject: '未指定' },
          { topic: 'C', status: 'known', subject: '无' },
          { topic: 'D', status: 'known', subject: '  世界设定  ' },
          { topic: 'E', status: 'known' },
        ],
      }),
    );
    const subjects = out!.patches.map(p => ('subject' in p ? p.subject : null));
    expect(subjects).toEqual(['富川立花', '', '', '世界设定', '']);
  });

  it('模板句 basis 被清洗为空串，具体依据放行', () => {
    // 真实案例：提示词给过「未交代获取过程」范例，模型把它刷满整列
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          { topic: '立花的勾引意图', status: 'unknown', source: 'none', basis: '未交代获取过程', impact: '不得点破' },
          { topic: '立花过去的私情', status: 'unknown', source: 'none', basis: '只有读者可见', impact: '不得提及' },
          { topic: '她的真实身份', status: 'unknown', source: 'none', basis: '没有依据', impact: '不得叫破' },
          { topic: '男主人姓名', status: 'unknown', source: 'none', basis: '剧情只字未提，没有任何人告知主角', impact: '不可断言' },
        ],
      }),
    );
    // drop 变体没有 basis，先窄化再取字段
    const bases = out!.patches.map(p => ('basis' in p ? p.basis : ''));
    expect(bases).toEqual(['', '', '', '剧情只字未提，没有任何人告知主角']);
  });

  it('不再解析 evidence_floors（楼层号已废弃）', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"known","evidence_floors":["3",7]}]}',
    );
    expect(out?.patches[0]).not.toHaveProperty('evidence_floors');
  });

  it('drop 接受布尔与字符串', () => {
    const out = parseKnowledgeResponse('{"entries":[{"id":"kb_a","drop":true},{"topic":"B","drop":"true"}]}');
    expect(out?.patches).toHaveLength(2);
    expect(out?.patches[0]).toMatchObject({ id: 'kb_a', drop: true });
  });

  it('空 entries 是合法结果（本轮无变化）', () => {
    expect(parseKnowledgeResponse('{"base_revision":2,"entries":[]}')).toEqual({ baseRevision: 2, patches: [] });
    expect(parseKnowledgePatch('[]')).toEqual([]);
  });

  it('完全没有 JSON 时返回 null', () => {
    expect(parseKnowledgeResponse('模型拒绝输出')).toBeNull();
    expect(parseKnowledgePatch('模型拒绝输出')).toBeNull();
  });

  it('截断抢救：数组形态保留完整对象', () => {
    const out = parseKnowledgeResponse('[{"topic":"A","status":"known"},{"topic":"B","status":"uncert');
    expect(out?.patches.map(x => x.topic)).toEqual(['A']);
  });

  it('截断抢救：对象形态保留完整对象', () => {
    const out = parseKnowledgeResponse(
      '{"base_revision":4,"entries":[{"topic":"A","status":"known"},{"topic":"B","status":"uncert',
    );
    expect(out?.baseRevision).toBe(4);
    expect(out?.patches.map(x => x.topic)).toEqual(['A']);
  });

  it('非法 status 归 unknown', () => {
    const out = parseKnowledgeResponse('{"entries":[{"topic":"A","status":"maybe"}]}');
    expect(out?.patches[0]).toMatchObject({ topic: 'A', status: 'unknown' });
  });

  it('空 topic 且无 id 的行跳过', () => {
    const out = parseKnowledgeResponse('{"entries":[{"topic":"  ","status":"known"},{"topic":"B"}]}');
    expect(out?.patches.map(x => x.topic)).toEqual(['B']);
  });

  it('同 id / 同 topic 后出现的覆盖先出现的', () => {
    const out = parseKnowledgeResponse(
      '{"entries":[{"topic":"A","status":"uncertain"},{"topic":"A","status":"unknown"},{"id":"x","topic":"B","status":"known"}]}',
    );
    expect(out?.patches.map(x => `${x.topic}:${'status' in x ? x.status : 'drop'}`)).toEqual(['A:unknown', 'B:known']);
  });

  it('上限 60 条（与存储上限对齐）', () => {
    const arr = Array.from({ length: 70 }, (_, i) => ({ topic: `T${i}`, status: 'known' }));
    expect(parseKnowledgeResponse(JSON.stringify({ entries: arr }))?.patches).toHaveLength(60);
  });
});

describe('mergeKnowledgePatch', () => {
  it('新增条目追加，未触碰的条目原样保留', () => {
    const existing = [e('旧条目', 'known', '第 2 楼', '', 5)];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '新条目', status: 'unknown', source: 'none' })], 20);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toEqual(existing[0]);
    expect(out.entries[1]).toMatchObject({ topic: '新条目', status: 'unknown', updated_at_message: 20 });
    expect(out.changed).toBe(true);
    expect(out.changes[0]).toMatchObject({ kind: 'added', topic: '新条目' });
  });

  it('同 topic 覆盖并刷新时间戳，位置不变', () => {
    const existing = [e('A', 'uncertain', '传闻', '', 5), e('B', 'known', '第 1 楼', '', 6)];
    const out = mergeKnowledgePatch(existing, [patch({ topic: 'A', basis: '第 9 楼当面告知' })], 30);
    expect(out.entries.map(x => x.topic)).toEqual(['A', 'B']);
    expect(out.entries[0]).toMatchObject({ topic: 'A', status: 'known', basis: '第 9 楼当面告知', updated_at_message: 30 });
    expect(out.entries[1]).toEqual(existing[1]);
    expect(out.changes[0]).toMatchObject({ kind: 'updated' });
  });

  it('id 命中优先于 topic 改名', () => {
    const existing = [e('旧名', 'known', '', '', 5, { id: 'kb_x' })];
    const out = mergeKnowledgePatch(existing, [patch({ id: 'kb_x', topic: '新名' })], 20);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ id: 'kb_x', topic: '新名' });
  });

  it('只有 id 的改档补丁命中已有条目时正常更新', () => {
    const existing = [e('仓库位置', 'known', '', '', 5, { importance: 'low' })];
    const out = mergeKnowledgePatch(
      existing,
      [
        {
          id: 'kb_仓库位置',
          topic: '',
          importance: 'high',
          importance_explicit: true,
          basis: '',
          impact: '',
          aliases: [],
          keywords: [],
          event_time: '',
        },
      ],
      20,
    );
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ topic: '仓库位置', importance: 'high' });
  });

  it('只有 id 且未命中时不创建空主题条目', () => {
    // 模型漏传 topic（或 id 来自别的聊天/已被淘汰）时，空条目会占容量、
    // 在面板里显示空白行，却永远无法被定位。
    const out = mergeKnowledgePatch(
      [],
      [
        {
          id: 'kb_ghost',
          topic: '',
          importance: 'high',
          importance_explicit: true,
          basis: '',
          impact: '',
          aliases: [],
          keywords: [],
          event_time: '',
        },
      ],
      20,
    );
    expect(out.entries).toHaveLength(0);
    expect(out.changes[0]).toMatchObject({ kind: 'drop_missing' });
  });

  it('未识别的枚举按缺失处理，保留旧状态/来源/档位', () => {
    const existing = [e('仓库位置', 'known', '', '', 5, { source: 'witnessed', importance: 'high' })];
    const parsed = parseKnowledgeResponse(
      JSON.stringify({
        entries: [{ id: 'kb_仓库位置', topic: '仓库位置', status: '部分已知', source: '?', importance: '离谱' }],
      }),
    );
    const out = mergeKnowledgePatch(existing, parsed!.patches, 20);
    expect(out.entries[0]).toMatchObject({ status: 'known', source: 'witnessed', importance: 'high' });
  });

  it('别名命中合并到同一条并记录 merged', () => {
    const existing = [e('仓库位置', 'known', '', '', 5, { aliases: ['货仓'] })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '货仓', basis: '第 8 楼看见' })], 20);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].topic).toBe('仓库位置');
    expect(out.changes[0]).toMatchObject({ kind: 'merged' });
  });

  it('补丁的 aliases 不参与匹配：不同事实不会被吸进同一角色条目', () => {
    // 真实故障：模型把「同一段剧情里的不同事实」当成别名回传，共享人名/头衔的补丁
    // 被整条并进主条目，别名逐轮膨胀到几十个。
    const existing = [e('绫濑遥的正宫身份', 'known', '', '', 5, { aliases: ['女仆长'] })];
    const out = mergeKnowledgePatch(
      existing,
      [
        patch({ topic: '女仆长掌管监控', aliases: ['女仆长'] }),
        patch({ topic: '侍寝排表制度', aliases: ['女仆长'] }),
        patch({ topic: '庄园着装规矩', aliases: ['女仆长'] }),
      ],
      20,
    );
    expect(out.entries).toHaveLength(4);
    expect(out.entries[0].aliases).toEqual(['女仆长']);
    expect(out.entries.map(x => x.topic)).toEqual(
      expect.arrayContaining(['女仆长掌管监控', '侍寝排表制度', '庄园着装规矩']),
    );
  });

  it('共享检索词不触发相似度归并', () => {
    // keywords 是场景检索词，共享人名只说明涉及同一对象，不说明是同一件事
    const existing = [e('张子薇抽烟', 'known', '', '', 5, { keywords: ['张子薇'] })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '张子薇逃课', keywords: ['张子薇'] })], 20);
    expect(out.entries).toHaveLength(2);
  });

  it('别名数量受 MAX_ALIASES 硬约束（多轮归并也不膨胀）', () => {
    let entries = [
      e('主题', 'known', '', '', 1, { aliases: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6'] }),
    ];
    for (let i = 0; i < 10; i++) {
      entries = mergeKnowledgePatch(entries, [patch({ topic: `新说法${i}` })], 20 + i).entries;
    }
    expect(entries[0].aliases.length).toBe(MAX_ALIASES);
  });

  it('合并时顺带清洗旧数组里超限的别名', () => {
    const existing = [
      e('主题', 'known', '', '', 1, { aliases: ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'] }),
    ];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '主题', basis: '补充' })], 20);
    expect(out.entries[0].aliases.length).toBe(MAX_ALIASES);
  });

  it('相似度命中合并（分数领先足够）', () => {
    const existing = [e('城北仓库的货物', 'known', '', '', 5)];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '城北仓库的货' })], 20);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].revision).toBe(1);
  });

  it('相似度接近但领先不足 → 新建并记录 ambiguous', () => {
    const existing = [e('城北仓库的货物', 'known', '', '', 5), e('城北仓库的货单', 'known', '', '', 6)];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '城北仓库的货' })], 20);
    expect(out.entries).toHaveLength(3);
    expect(out.changes.some(c => c.kind === 'ambiguous')).toBe(true);
  });

  it('锁定条目拒绝更新与删除', () => {
    const existing = [e('A', 'known', '原依据', '', 5, { locked: true })];
    const updated = mergeKnowledgePatch(existing, [patch({ topic: 'A', basis: '新依据' })], 20);
    expect(updated.entries[0].basis).toBe('原依据');
    expect(updated.changes[0]).toMatchObject({ kind: 'rejected_locked' });

    const dropped = mergeKnowledgePatch(existing, [{ topic: 'A', drop: true }], 21);
    expect(dropped.entries[0].retired).toBe(false);
    expect(dropped.changes[0]).toMatchObject({ kind: 'rejected_locked' });
  });

  it('改名绕过锁定同样被拒绝', () => {
    const existing = [e('主角的真实身份', 'unknown', '', '', 5, { locked: true })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '主角真实身份' })], 20);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].topic).toBe('主角的真实身份');
    expect(out.changes[0]).toMatchObject({ kind: 'rejected_locked' });
  });

  it('带括号/标点的改名同样被锁定守卫拦住', () => {
    // 两边都走 normalizeTopic：否则补丁多一个括号就把相似度压到阈值以下。
    const existing = [e('城北仓库的位置', 'known', '', '', 5, { locked: true })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '城北仓库（位置）' })], 20);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0].topic).toBe('城北仓库的位置');
    expect(out.changes[0]).toMatchObject({ kind: 'rejected_locked' });
  });

  it('drop 软退役，精确主题重新出现时恢复', () => {
    const existing = [e('A', 'known', '', '', 5)];
    const dropped = mergeKnowledgePatch(existing, [{ topic: 'A', drop: true }], 20);
    expect(dropped.entries[0].retired).toBe(true);
    expect(dropped.changes[0]).toMatchObject({ kind: 'retired' });

    const restored = mergeKnowledgePatch(dropped.entries, [patch({ topic: 'A', basis: '重新确认' })], 30);
    expect(restored.entries[0].retired).toBe(false);
    expect(restored.changes[0]).toMatchObject({ kind: 'restored' });
  });

  it('退役条目不被相似度误恢复', () => {
    const existing = [e('城北仓库的货物', 'known', '', '', 5, { retired: true })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '城北仓库的货' })], 20);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0].retired).toBe(true);
  });

  it('drop 找不到目标记录 drop_missing', () => {
    const out = mergeKnowledgePatch([], [{ id: 'kb_missing', topic: '', drop: true }], 20);
    expect(out.changes[0]).toMatchObject({ kind: 'drop_missing' });
    expect(out.changed).toBe(false);
  });

  it('unknown 强制 source=none；none + known 降级 uncertain', () => {
    const out = mergeKnowledgePatch(
      [],
      [patch({ topic: 'A', status: 'unknown', source: 'witnessed' }), patch({ topic: 'B', status: 'known', source: 'none' })],
      20,
    );
    expect(out.entries[0]).toMatchObject({ status: 'unknown', source: 'none' });
    expect(out.entries[1]).toMatchObject({ status: 'uncertain', source: 'none' });
  });

  it('缺省 status/source 时保留旧值，不误降级', () => {
    const existing = [e('A', 'known', '第 2 楼', '', 5, { id: 'kb_a', source: 'witnessed' })];
    const out = mergeKnowledgePatch(existing, [{ id: 'kb_a', topic: 'A', basis: '补充依据' } as KnowledgePatch], 20);
    expect(out.entries[0]).toMatchObject({ status: 'known', source: 'witnessed', basis: '补充依据' });
  });

  it('模板句补丁不覆盖已有的具体依据', () => {
    // 关键：更新路径是「patch.basis || target.basis」，模板句入库前已被清洗成空串，
    // 于是旧的具体依据保留下来——否则弱模型每次刷新都把依据刷回同一句空话
    const existing = [e('立花的过往', 'unknown', '剧情未交代她的过往', '', 5)];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '立花的过往', basis: '未交代获取过程' })], 20);
    expect(out.entries[0].basis).toBe('剧情未交代她的过往');
  });

  it('空补丁不改动任何条目', () => {
    const existing = [e('A', 'known', '', '', 5)];
    const out = mergeKnowledgePatch(existing, [], 99);
    expect(out.entries).toEqual(existing);
    expect(out.changed).toBe(false);
    expect(out.changes).toEqual([]);
  });

  it('超存储上限时淘汰最久未更新的条目', () => {
    const existing = Array.from({ length: MAX_STORED_ENTRIES }, (_, i) => e(`old${i}`, 'known', '', '', i + 1));
    const out = mergeKnowledgePatch(existing, [patch({ topic: '最新', status: 'unknown', source: 'none' })], 999);
    expect(out.entries).toHaveLength(MAX_STORED_ENTRIES);
    expect(out.entries.some(x => x.topic === '最新')).toBe(true);
    expect(out.entries.some(x => x.topic === 'old0')).toBe(false);
    expect(out.changes.some(c => c.kind === 'evicted')).toBe(true);
  });

  it('锁定条目永不淘汰', () => {
    const existing = Array.from({ length: MAX_STORED_ENTRIES }, (_, i) =>
      e(`old${i}`, 'known', '', '', i + 1, i === 0 ? { locked: true } : {}),
    );
    const out = mergeKnowledgePatch(existing, [patch({ topic: '最新', status: 'unknown', source: 'none' })], 999);
    expect(out.entries.some(x => x.topic === 'old0')).toBe(true);
    expect(out.entries.some(x => x.topic === 'old1')).toBe(false);
  });

  it('淘汰时先清低档位，即使它更新', () => {
    // 与注入侧同一套取舍：低档位的近期条目先走，而不是单纯最久未更新
    const existing = Array.from({ length: MAX_STORED_ENTRIES }, (_, i) =>
      e(`old${i}`, 'known', '', '', i + 1, i === MAX_STORED_ENTRIES - 1 ? { importance: 'low' } : {}),
    );
    const out = mergeKnowledgePatch(existing, [patch({ topic: '最新', status: 'unknown', source: 'none' })], 999);
    expect(out.entries.some(x => x.topic === `old${MAX_STORED_ENTRIES - 1}`)).toBe(false);
    expect(out.entries.some(x => x.topic === 'old0')).toBe(true);
  });

  it('退役条目超上限时清理最旧的', () => {
    const existing = Array.from({ length: MAX_RETIRED_ENTRIES + 5 }, (_, i) =>
      e(`r${i}`, 'known', '', '', i + 1, { retired: true }),
    );
    const out = mergeKnowledgePatch(existing, [], 999);
    expect(out.entries.filter(x => x.retired)).toHaveLength(MAX_RETIRED_ENTRIES);
    expect(out.entries.some(x => x.topic === 'r0')).toBe(false);
  });

  it('活跃条目全锁定时临时超限并记 capacity_full，新条目不丢', () => {
    const existing = Array.from({ length: MAX_STORED_ENTRIES }, (_, i) =>
      e(`old${i}`, 'known', '', '', i + 1, { locked: true }),
    );
    const out = mergeKnowledgePatch(existing, [patch({ topic: '最新', status: 'unknown', source: 'none' })], 999);
    // 锁定条目不可淘汰 → 临时超限一条，且必须留痕
    expect(out.entries).toHaveLength(MAX_STORED_ENTRIES + 1);
    expect(out.entries.some(x => x.topic === '最新')).toBe(true);
    expect(out.changes.some(c => c.kind === 'capacity_full')).toBe(true);
    expect(out.changes.some(c => c.kind === 'evicted')).toBe(false);
  });

  it('本轮新增的条目不会被同轮容量治理淘汰', () => {
    const existing = Array.from({ length: MAX_STORED_ENTRIES }, (_, i) =>
      e(`old${i}`, 'unknown', '', '', i + 1, { locked: true }),
    );
    const out = mergeKnowledgePatch(existing, [patch({ topic: '刚新增', status: 'unknown', source: 'none' })], 999);
    expect(out.entries.some(x => x.topic === '刚新增')).toBe(true);
  });

  it('锁定的退役条目不被退役容量清理', () => {
    const existing = Array.from({ length: MAX_RETIRED_ENTRIES + 5 }, (_, i) =>
      e(`r${i}`, 'known', '', '', i + 1, { retired: true, locked: i === 0 }),
    );
    const out = mergeKnowledgePatch(existing, [], 999);
    // r0 最早且锁定：普通淘汰会先清它，锁定语义要求保留
    expect(out.entries.some(x => x.topic === 'r0')).toBe(true);
    expect(out.entries.filter(x => x.retired)).toHaveLength(MAX_RETIRED_ENTRIES + 1);
  });
});

describe('enforceCapacity — 所有写入口共用的容量治理', () => {
  it('活跃条目超限时按统一顺序淘汰，返回淘汰数', () => {
    const entries = Array.from({ length: MAX_STORED_ENTRIES + 3 }, (_, i) => e(`条目${i}`, 'known', '', '', i));
    const out = enforceCapacity(entries, 100, 0);
    expect(out.entries).toHaveLength(MAX_STORED_ENTRIES);
    expect(out.evicted).toBe(3);
    expect(out.changed).toBe(true);
    expect(out.changes.filter(c => c.kind === 'evicted')).toHaveLength(3);
  });

  it('protectedIds 不参与淘汰（刚新增/刚恢复的条目不会被自己挤掉）', () => {
    const entries = Array.from({ length: MAX_STORED_ENTRIES + 2 }, (_, i) => e(`条目${i}`, 'known', '', '', i));
    const out = enforceCapacity(entries, 100, 0, new Set(['kb_条目0', 'kb_条目1']));
    expect(out.entries).toHaveLength(MAX_STORED_ENTRIES);
    expect(out.entries.some(x => x.id === 'kb_条目0')).toBe(true);
    expect(out.entries.some(x => x.id === 'kb_条目1')).toBe(true);
  });

  it('锁定条目永不淘汰；无可淘汰时临时超限并记 capacity_full', () => {
    const entries = Array.from({ length: MAX_STORED_ENTRIES + 1 }, (_, i) =>
      e(`锁定${i}`, 'known', '', '', i, { locked: true }),
    );
    const out = enforceCapacity(entries, 100, 0);
    expect(out.entries).toHaveLength(MAX_STORED_ENTRIES + 1);
    expect(out.evicted).toBe(0);
    expect(out.changed).toBe(false);
    expect(out.changes.some(c => c.kind === 'capacity_full')).toBe(true);
  });

  it('退役条目超限先清最久未更新的，且跳过锁定', () => {
    const entries = [
      e('锁定退役', 'known', '', '', 0, { retired: true, locked: true }),
      ...Array.from({ length: MAX_RETIRED_ENTRIES + 2 }, (_, i) =>
        e(`退役${i}`, 'known', '', '', i + 1, { retired: true }),
      ),
    ];
    const out = enforceCapacity(entries, 100, 0);
    expect(out.entries.filter(x => x.retired)).toHaveLength(MAX_RETIRED_ENTRIES + 1);
    expect(out.entries.some(x => x.topic === '锁定退役')).toBe(true);
    expect(out.entries.some(x => x.topic === '退役0')).toBe(false);
  });

  it('幂等：治理后再跑一次不再变化', () => {
    const entries = Array.from({ length: MAX_STORED_ENTRIES + 5 }, (_, i) => e(`条目${i}`, 'known', '', '', i));
    const once = enforceCapacity(entries, 100, 0);
    const twice = enforceCapacity(once.entries, 100, 0);
    expect(twice.changed).toBe(false);
    expect(twice.evicted).toBe(0);
    expect(twice.entries).toEqual(once.entries);
  });

  it('旧报告迁移也会执行容量上限', () => {
    const legacy = report(
      Array.from({ length: MAX_STORED_ENTRIES + 4 }, (_, i) => e(`旧条目${i}`, 'known', '', '', i)),
    );
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries.filter(x => !x.retired)).toHaveLength(MAX_STORED_ENTRIES);
  });
});

describe('renderExistingTable', () => {
  it('空表返回空串', () => {
    expect(renderExistingTable([])).toBe('');
  });

  it('表头带修订号与活跃条数，条目标注 id/状态/来源/档位', () => {
    const out = renderExistingTable([e('A', 'known', '第 2 楼', '', 1), e('B', 'unknown', '未交代', '不得叫破', 2)], 3);
    expect(out).toContain('当前修订号=3；活跃条目 2 条');
    // 档位必须让模型看见，否则它无法提出改档（只能凭记忆猜）
    expect(out).toContain('[id=kb_A] [已知] [来源=未标注] [档位=中] A｜依据：第 2 楼');
    expect(out).toContain('[id=kb_B] [未知] [来源=未标注] [档位=中] B｜依据：未交代｜约束：不得叫破');
  });

  it('已知条目的 impact 不再重复发送，存疑/未知仍带约束', () => {
    // 分析侧只需要判定依据；已知项的约束对判定没有增量信息，省下的预算留给未知项。
    const out = renderExistingTable([
      e('已知项', 'known', '第 2 楼', '可以直接去', 1),
      e('未知项', 'unknown', '未交代', '不得叫破', 2),
    ]);
    expect(out).not.toContain('可以直接去');
    expect(out).toContain('约束：不得叫破');
  });

  it('锁定条目标记 [锁定]，退役条目不出现在表格中', () => {
    const out = renderExistingTable([
      e('A', 'known', '', '', 1, { locked: true }),
      e('B', 'known', '', '', 2, { retired: true }),
    ]);
    expect(out).toContain('[锁定] A');
    expect(out).not.toContain('B');
  });

  it('字段超长截断', () => {
    const out = renderExistingTable([e('A', 'known', 'x'.repeat(300), 'y'.repeat(300))]);
    expect(out).toContain('…');
    expect(out.length).toBeLessThan(400);
  });
});

describe('renderKnowledgeInjection', () => {
  it('空报告返回空串', () => {
    expect(renderKnowledgeInjection(report([]))).toBe('');
  });

  it('注入带剧情内时间，模型可区分「刚知道」与「早就知道」', () => {
    const out = renderKnowledgeInjection(
      report([e('城北仓库的位置', 'known', '守卫告知', '', 5, { event_time: '2026年10月15日 下午' })]),
    );
    expect(out).toContain('时间：2026年10月15日 下午');
  });

  it('结构化结果给出选中/省略/字符用量', () => {
    const entries = Array.from({ length: 5 }, (_, i) => e(`条目${i}`, 'known', '依据内容', '', i));
    const out = renderKnowledgeInjectionDetailed(report(entries), { maxEntries: 2 });
    expect(out.chosen).toHaveLength(2);
    expect(out.omitted).toBe(3);
    expect(out.total).toBe(5);
    expect(out.usedChars).toBeGreaterThan(0);
    expect(out.block).toContain('另有 3 项未注入');
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

  it('未知项缺 impact 时兜底约束；inferred 追加推断提示', () => {
    const out = renderKnowledgeInjection(
      report([
        e('K', 'known', '线索', '', 1, { source: 'inferred' }),
        e('U', 'unknown', '未交代', '', 2),
      ]),
    );
    expect(out).toContain('来源：推断（只能以推断口吻使用）');
    expect(out).toContain('U｜依据：未交代；约束：不得作为行动依据');
  });

  it('听闻的存疑项追加传闻提示', () => {
    const out = renderKnowledgeInjection(report([e('S', 'uncertain', '街坊说', '', 1, { source: 'heard' })]));
    expect(out).toContain('来源：传闻（未经证实）');
  });

  it('场景命中优先于最近更新', () => {
    const entries = [
      e('远处传闻', 'known', '', '', 100),
      e('城北仓库', 'known', '', '', 1, { keywords: ['城北'] }),
    ];
    const out = renderKnowledgeInjection(report(entries), { sceneText: '你来到城北，看见仓库大门', maxEntries: 1 });
    expect(out).toContain('城北仓库');
    expect(out).not.toContain('远处传闻');
  });

  it('锁定与未知优先于已知', () => {
    const entries = [
      ...Array.from({ length: 3 }, (_, i) => e(`K${i}`, 'known', '', '', 100 - i)),
      e('U', 'unknown', '', '不得', 1),
      e('L', 'known', '', '', 1, { locked: true }),
    ];
    const out = renderKnowledgeInjection(report(entries), { maxEntries: 2 });
    expect(out).toContain('U');
    expect(out).toContain('L');
  });

  it('锁定条目内部未知优先于已知（预算紧张时先保约束项）', () => {
    const entries = [
      e('锁定已知', 'known', '', '', 9, { locked: true }),
      e('锁定未知', 'unknown', '未交代', '不得作为依据', 8, { locked: true }),
    ];
    const out = renderKnowledgeInjectionDetailed(report(entries), { maxEntries: 1 });
    expect(out.chosen).toHaveLength(1);
    expect(out.chosen[0].topic).toBe('锁定未知');
  });

  it('条数上限生效并标注省略数量', () => {
    const entries = [
      ...Array.from({ length: 30 }, (_, i) => e(`K${i}`, 'known')),
      ...Array.from({ length: 2 }, (_, i) => e(`S${i}`, 'uncertain')),
      ...Array.from({ length: 2 }, (_, i) => e(`U${i}`, 'unknown')),
    ];
    const out = renderKnowledgeInjection(report(entries), { maxEntries: 10 });
    const lineCount = out.split('\n').filter(l => l.startsWith('- ')).length;
    expect(lineCount).toBe(10);
    expect(out).toContain('U0');
    expect(out).toContain('S0');
    expect(out).toContain('未注入');
  });

  it('字符预算生效，超长条目不阻断后续短条目', () => {
    const entries = [
      e('超长', 'unknown', 'x'.repeat(600), 'y'.repeat(600)),
      e('短条目', 'unknown', '未交代', '不得'),
    ];
    const out = renderKnowledgeInjection(report(entries), { charBudget: 300 });
    expect(out).toContain('短条目');
    expect(out).not.toContain('超长');
  });

  it('退役条目不注入', () => {
    const out = renderKnowledgeInjection(report([e('A', 'known', '', '', 1, { retired: true }), e('B', 'known')]));
    expect(out).toContain('B');
    expect(out).not.toContain('A｜');
  });

  it('标题明示只针对玩家角色本人', () => {
    const out = renderKnowledgeInjection(report([e('A', 'known')]));
    expect(out).toContain('仅玩家角色本人');
  });

  it('有场景文本时，未命中的已知条目受配额限制', () => {
    const entries = [
      e('城北仓库', 'known', '', '', 9, { keywords: ['城北'] }),
      ...Array.from({ length: 6 }, (_, i) => e(`无关${i}`, 'known', '', '', i)),
    ];
    const out = renderKnowledgeInjectionDetailed(report(entries), {
      sceneText: '你走向城北的方向',
      maxEntries: 8,
    });
    expect(out.chosen.some(x => x.topic === '城北仓库')).toBe(true);
    // 命中 1 条 + 未命中配额 4 条（ceil((8-0)/2)）
    expect(out.chosen.length).toBeLessThan(entries.length);
    expect(out.omitted).toBeGreaterThan(0);
  });

  it('无场景文本时不做配额削减（全部 known 仍按预算注入）', () => {
    const entries = Array.from({ length: 6 }, (_, i) => e(`条目${i}`, 'known', '', '', i));
    const out = renderKnowledgeInjectionDetailed(report(entries), { maxEntries: 8 });
    expect(out.chosen).toHaveLength(6);
    expect(out.omitted).toBe(0);
  });

  it('组内按档位+新鲜度排序：老的高档位不自动压过近期普通条目', () => {
    const entries = [
      e('老高权重', 'known', '', '', 1, { importance: 'high' }),
      e('近期普通', 'known', '', '', 99, { importance: 'normal' }),
    ];
    const out = renderKnowledgeInjectionDetailed(report(entries), { maxEntries: 1 });
    // 老高 3-3=0，近期普通 0+4=4 → 后者胜出
    expect(out.chosen[0].topic).toBe('近期普通');
  });

  it('全表同为 high 时不改变相对顺序（通胀自愈）', () => {
    const entries = [
      e('旧的', 'known', '', '', 10, { importance: 'high' }),
      e('新的', 'known', '', '', 95, { importance: 'high' }),
    ];
    const out = renderKnowledgeInjectionDetailed(report(entries), { maxEntries: 1 });
    expect(out.chosen[0].topic).toBe('新的');
  });

  it('高权重 known 豁免「未命中一半配额」限制', () => {
    const entries = [
      e('场景命中', 'known', '', '', 9, { keywords: ['城北'] }),
      e('高权重未命中', 'known', '', '', 8, { importance: 'high' }),
      ...Array.from({ length: 4 }, (_, i) => e(`普通${i}`, 'known', '', '', i)),
    ];
    const out = renderKnowledgeInjectionDetailed(report(entries), {
      sceneText: '你走向城北的方向',
      maxEntries: 3,
    });
    expect(out.chosen.some(x => x.topic === '高权重未命中')).toBe(true);
  });

  it('字符预算放不下完整形态时 known 降级为单行，未知不降级', () => {
    // 只用一条很长的 known：预算够它降级后的一行，但不够完整形态。
    // （不要混入 unknown——unknown 排序在前且不可降级，会先吃掉预算让断言变脆）
    const entries = [e('长依据已知', 'known', '依'.repeat(400), '约束'.repeat(200), 9)];
    // 头部固定开销 120，留 80 给正文：完整形态 ~600 字放不下，单行 ~7 字放得下
    const out = renderKnowledgeInjection(report(entries), { charBudget: 200 });
    expect(out).toContain('- 长依据已知');
    expect(out).not.toContain('依'.repeat(400));
  });

  it('未知项超预算时直接省略，绝不降级成只剩主题', () => {
    // unknown 的约束句是唯一价值：降级成「- 真名」会让模型以为可以随便用。
    // charBudget 下限是 200，扣掉 120 字固定开销后正文只剩 80 字：
    // 完整行 130+ 字放不下，而单行形态只有 5 字——若实现错误地允许降级，就会漏出来。
    const entries = [e('真名', 'unknown', '材料到此为止'.repeat(20), '不得叫出', 5)];
    const out = renderKnowledgeInjection(report(entries), { charBudget: 200 });
    expect(out).not.toContain('真名');
    expect(out).not.toContain('不得叫出');
    // 一条都放不下时仍要保留非全知提醒，不能静默返回空块
    expect(out).toContain('<knowledge_boundary_report>');
    expect(out).toContain('未注入具体条目');
    expect(out).toContain('不得作为行动依据');
  });

  it('注入文本不出现档位字样（档位是预算参数，不该引发元推理）', () => {
    const out = renderKnowledgeInjection(
      report([e('A', 'unknown', '材料到此为止', '不得引用', 5, { importance: 'high' })]),
    );
    expect(out).not.toContain('档位');
    expect(out).not.toContain('high');
    expect(out).not.toContain('重要性');
  });

  it('条数上限是硬上限，降级不能突破', () => {
    const entries = Array.from({ length: 5 }, (_, i) => e(`条目${i}`, 'known', '依据', '', i));
    const out = renderKnowledgeInjectionDetailed(report(entries), { maxEntries: 3 });
    expect(out.chosen).toHaveLength(3);
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

describe('computeChatFingerprint', () => {
  it('内容变化改变指纹', () => {
    const a = computeChatFingerprint([{ mes: '你好', is_user: true }]);
    const b = computeChatFingerprint([{ mes: '你好呀', is_user: true }]);
    expect(a).not.toBe(b);
  });

  it('隐藏楼层不参与指纹', () => {
    const a = computeChatFingerprint([{ mes: '你好', is_user: true }]);
    const b = computeChatFingerprint([{ mes: '你好', is_user: true }, { mes: '系统注入', is_system: true }]);
    expect(a).toBe(b);
  });

  it('同一内容稳定', () => {
    const msgs = [{ mes: '甲', is_user: true }, { mes: '乙' }];
    expect(computeChatFingerprint(msgs)).toBe(computeChatFingerprint(msgs));
  });

  it('编辑早期楼层（窗口外）同样改变指纹', () => {
    // 40 条消息：第 0 条远在尾部 12 条之外，旧实现只看尾部会漏判
    const msgs = Array.from({ length: 40 }, (_, i) => ({ mes: `第 ${i} 条内容`, is_user: i % 2 === 0 }));
    const before = computeChatFingerprint(msgs);
    const edited = msgs.map((m, i) => (i === 0 ? { ...m, mes: '第 0 条被改写' } : m));
    expect(computeChatFingerprint(edited)).not.toBe(before);
  });

  it('早期抽样层不改动时保持稳定（避免每次事件都扫全量）', () => {
    const msgs = Array.from({ length: 40 }, (_, i) => ({ mes: `第 ${i} 条内容`, is_user: i % 2 === 0 }));
    const before = computeChatFingerprint(msgs);
    // 改的是抽样步长之间的楼层（第 1 条不在 0/8/16… 采样点上，且不在尾部 12 条内）
    const edited = msgs.map((m, i) => (i === 1 ? { ...m, mes: '第 1 条被改写' } : m));
    // 该层刻意只做粗粒度检测：未命中采样点时允许指纹不变，由 MESSAGE_UPDATED 的
    // isMessageCoveredByFingerprint 强制分析兜底。
    expect(computeChatFingerprint(edited)).toBe(before);
  });

  it('尾部消息 400 字之后的改动也改变指纹', () => {
    const long = 'a'.repeat(600);
    const a = computeChatFingerprint([{ mes: long, is_user: true }]);
    const b = computeChatFingerprint([{ mes: long.slice(0, 599) + 'b', is_user: true }]);
    expect(a).not.toBe(b);
  });
});

describe('isMessageCoveredByFingerprint — 未抽样编辑的强制分析判定', () => {
  const msgs = (n: number): Array<{ mes: string; is_user?: boolean; is_system?: boolean }> =>
    Array.from({ length: n }, (_, i) => ({ mes: `第 ${i} 条`, is_user: i % 2 === 0 }));

  it('尾部楼层全部覆盖', () => {
    const m = msgs(30); // 尾部从第 18 条（30 - 12）开始
    expect(isMessageCoveredByFingerprint(m, 18)).toBe(true);
    expect(isMessageCoveredByFingerprint(m, 29)).toBe(true);
  });

  it('早期抽样点覆盖，抽样点之间不覆盖', () => {
    const m = msgs(30);
    expect(isMessageCoveredByFingerprint(m, 0)).toBe(true);
    expect(isMessageCoveredByFingerprint(m, 8)).toBe(true);
    expect(isMessageCoveredByFingerprint(m, 9)).toBe(false);
  });

  it('隐藏楼层不参与指纹，视为覆盖', () => {
    const m = msgs(30);
    m[3].is_system = true;
    expect(isMessageCoveredByFingerprint(m, 3)).toBe(true);
  });

  it('越界下标按覆盖处理（没有可分析的编辑）', () => {
    expect(isMessageCoveredByFingerprint(msgs(5), 99)).toBe(true);
  });
});

describe('resolveAnalysisHistoryStart — 增量分析窗口', () => {
  it('非增量 / 无基线 / 消息变少时用完整窗口', () => {
    expect(resolveAnalysisHistoryStart(4, 10, 12, false)).toBe(4);
    expect(resolveAnalysisHistoryStart(4, 0, 12, true)).toBe(4);
    expect(resolveAnalysisHistoryStart(4, 15, 12, true)).toBe(4);
  });

  it('增量从上次分析前一条开始（保留重叠）', () => {
    expect(resolveAnalysisHistoryStart(4, 10, 12, true)).toBe(9);
  });

  it('增量起点不早于完整窗口起点', () => {
    expect(resolveAnalysisHistoryStart(20, 10, 12, true)).toBe(20);
  });

  it('完整窗口没有可见消息（-1）时从 0 开始', () => {
    expect(resolveAnalysisHistoryStart(-1, 3, 5, true)).toBe(2);
  });
});

describe('checkCommitGuards — 落库三重守卫', () => {
  const base = { chatIdentity: 'chat-a', fingerprint: '12:abc', revision: 3 };

  it('三项一致时通过', () => {
    expect(checkCommitGuards(base, { ...base })).toBeNull();
  });

  it('切换聊天优先于其他差异', () => {
    expect(checkCommitGuards(base, { chatIdentity: 'chat-b', fingerprint: 'x', revision: 9 })).toBe('chat-changed');
  });

  it('内容指纹变化判 stale', () => {
    expect(checkCommitGuards(base, { ...base, fingerprint: '13:def' })).toBe('stale');
  });

  it('报告修订号变化判 revision-changed（用户手动改过）', () => {
    expect(checkCommitGuards(base, { ...base, revision: 4 })).toBe('revision-changed');
  });
});

describe('migrateKnowledgeReport', () => {
  it('旧条目补齐 id/来源/别名等字段', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known', basis: '第 2 楼', impact: '', updated_at_message: 5 }],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0]).toMatchObject({
      topic: 'A',
      status: 'known',
      source: 'unspecified',
      aliases: [],
      locked: false,
      retired: false,
      revision: 0,
    });
    expect(out.entries[0].id).toMatch(/^kb_/);
    expect(out.based_on_fingerprint).toBe('');
  });

  it('幂等：迁移两次结果一致', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known', basis: '', impact: '', updated_at_message: 5 }],
    } as unknown as KnowledgeReport;
    const once = migrateKnowledgeReport(legacy);
    const twice = migrateKnowledgeReport(once);
    expect(twice).toEqual(once);
  });

  it('同 topic 重复条目合并并保留较新结论', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [
        { topic: 'A', status: 'uncertain', basis: '传闻', impact: '', updated_at_message: 2 },
        { topic: 'A', status: 'known', basis: '第 5 楼当面告知', impact: '', updated_at_message: 5 },
      ],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries).toHaveLength(1);
    expect(out.entries[0]).toMatchObject({ topic: 'A', status: 'known', basis: '第 5 楼当面告知' });
    expect(out.last_changes.some(c => c.kind === 'merged')).toBe(true);
  });
});

describe('migrateKnowledgeReport — 别名清洗', () => {
  it('旧档里的超长/句子式别名在迁移时被清掉', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [
        {
          topic: '苏凛的渴求症',
          status: 'uncertain',
          aliases: [
            '上次上贡时间',
            '苏凛可能处于稳定期或发情边缘',
            '苏凛前日发消息后今日未联系',
            '渴求症',
          ],
          keywords: ['精液', '苏凛今日可能心情复杂'],
        },
      ],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0].aliases).toEqual(['上次上贡时间', '渴求症']);
    expect(out.entries[0].keywords).toEqual(['精液']);
  });

  it('超限别名在迁移时被截断并留下变更记录', () => {
    // 真实故障：软上限让别名堆到 27 个；迁移是唯一会扫全表的清洗入口
    const many = Array.from({ length: 27 }, (_, i) => `别名${i}`);
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: '绫濑遥的正宫身份', status: 'known', aliases: many, keywords: [], updated_at_message: 5 }],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0].aliases).toHaveLength(MAX_ALIASES);
    expect(out.last_changes.some(c => c.detail.includes('别名超出上限'))).toBe(true);
  });

  it('未超限的别名不产生多余变更记录', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known', aliases: ['简称'], keywords: [], updated_at_message: 5 }],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0].aliases).toEqual(['简称']);
    expect(out.last_changes.some(c => c.detail.includes('别名超出上限'))).toBe(false);
  });

  it('矛盾的三态/来源组合在迁移时被纠正', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [
        // 未知却声称目击 → 来源必须是 none
        { topic: 'A', status: 'unknown', source: 'witnessed', basis: '', impact: '' },
        // 已知却没有任何获取过程 → 降级为存疑
        { topic: 'B', status: 'known', source: 'none', basis: '', impact: '' },
      ],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0]).toMatchObject({ topic: 'A', status: 'unknown', source: 'none' });
    expect(out.entries[1]).toMatchObject({ topic: 'B', status: 'uncertain', source: 'none' });
  });
});

describe('migrateKnowledgeReport — evidence_floors 清理', () => {
  it('旧档的 evidence_floors 被显式删除，不随落盘残留', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known', basis: 'x', impact: '', evidence_floors: [3, 7] }],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0]).not.toHaveProperty('evidence_floors');
    expect(out.entries[0].event_time).toBe('');
  });

  it('已有 event_time 原样保留', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known', event_time: '2026年10月15日 下午' }],
    } as unknown as KnowledgeReport;
    expect(migrateKnowledgeReport(legacy).entries[0].event_time).toBe('2026年10月15日 下午');
  });

  it('旧档模板句 basis 被清空，并在「最近变更」留痕', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [
        { topic: '立花的过往', status: 'unknown', source: 'none', basis: '未交代获取过程', impact: '不得提及' },
        { topic: '武的家教身份', status: 'known', source: 'witnessed', basis: '立花当面称「老师」', impact: '以家教身份言行' },
      ],
    } as unknown as KnowledgeReport;
    const out = migrateKnowledgeReport(legacy);
    expect(out.entries[0].basis).toBe('');
    expect(out.entries[1].basis).toBe('立花当面称「老师」');
    // 静默清洗必须留痕：用户在面板看到「依据」变空时能找到原因
    expect(out.last_changes[0]).toMatchObject({ kind: 'updated', topic: '立花的过往' });
    expect(out.last_changes[0].detail).toContain('模板句');
  });
});

describe('previous_status — 状态变更来路', () => {
  it('unknown → known 时记录 previous_status', () => {
    const existing = [e('真名', 'unknown', '未交代', '', 3)];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '真名', status: 'known', source: 'witnessed' })], 10);
    expect(out.entries[0].status).toBe('known');
    expect(out.entries[0].previous_status).toBe('unknown');
  });

  it('状态未变时不清空既有来路（保留最近一次变更）', () => {
    const existing = [e('真名', 'known', '', '', 3, { previous_status: 'uncertain' })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: '真名', status: 'known', source: 'witnessed' })], 10);
    expect(out.entries[0].previous_status).toBe('uncertain');
  });

  it('新建条目的 previous_status 为空', () => {
    const out = mergeKnowledgePatch([], [patch({ topic: '新事', status: 'known', source: 'read' })], 5);
    expect(out.entries[0].previous_status).toBe('');
  });
});

describe('findDuplicateGroups — 手动整理扫描', () => {
  it('识别同一件事的不同说法', () => {
    const entries = [
      e('城北仓库的位置', 'known', '', '', 10, { aliases: ['仓库地址'] }),
      e('城北仓库的位置在哪', 'known', '', '', 8),
    ];
    const groups = findDuplicateGroups(entries);
    expect(groups).toHaveLength(1);
    expect(groups[0].merge).toHaveLength(1);
  });

  it('共享人名但实质不同的条目不合并', () => {
    const entries = [
      e('张子薇抽烟', 'known', '', '', 10, { keywords: ['张子薇', '抽烟'] }),
      e('张子薇逃课', 'known', '', '', 9, { keywords: ['张子薇', '逃课'] }),
    ];
    // 相似度可能过阈值，但领先幅度不足 → 不合并（保守策略）
    expect(findDuplicateGroups(entries)).toHaveLength(0);
  });

  it('共享四字检索词的不同事实也不合并（keywords 不参与身份判定）', () => {
    // 旧实现把 keywords 纳入身份：两条共享四字人名时 isRestatement 与 Dice 同时满分，
    // 会直接并成一条。三字人名恰好被短串闸门挡住，所以此前的测试没暴露。
    const entries = [
      e('富川立花的身份', 'known', '', '', 10, { keywords: ['富川立花'] }),
      e('富川立花的私情', 'known', '', '', 9, { keywords: ['富川立花'] }),
    ];
    expect(findDuplicateGroups(entries)).toHaveLength(0);
  });

  it('锁定条目完全不参与', () => {
    const entries = [
      e('城北仓库的位置', 'known', '', '', 10, { locked: true }),
      e('城北仓库的位置在哪', 'known', '', '', 8),
    ];
    expect(findDuplicateGroups(entries)).toHaveLength(0);
  });

  it('退役条目不参与', () => {
    const entries = [
      e('城北仓库的位置', 'known', '', '', 10, { retired: true }),
      e('城北仓库的位置在哪', 'known', '', '', 8),
    ];
    expect(findDuplicateGroups(entries)).toHaveLength(0);
  });
});

describe('知识报告导出 / 导入格式', () => {
  it('导出只含活跃条目，带类型与版本', () => {
    const out = buildKnowledgeExport([e('甲', 'known'), e('乙', 'known', '', '', 0, { retired: true })]);
    expect(out.type).toBe('choice-knowledge-export');
    expect(out.version).toBe(1);
    expect(out.entries.map(x => x.topic)).toEqual(['甲']);
  });

  it('导出 → 解析 往返保留知识字段', () => {
    const src = e('城北仓库的位置', 'known', '守卫当面告知', '可以直接去', 5, {
      aliases: ['仓库'],
      keywords: ['城北'],
      event_time: '2026年10月15日 下午',
      source: 'witnessed',
    });
    const text = JSON.stringify(buildKnowledgeExport([src]));
    const back = parseKnowledgeExport(text);
    expect(back).toHaveLength(1);
    expect(back![0]).toMatchObject({
      topic: '城北仓库的位置',
      status: 'known',
      source: 'witnessed',
      aliases: ['仓库'],
      keywords: ['城北'],
      event_time: '2026年10月15日 下午',
    });
  });

  it('拒绝非本扩展格式与未来版本', () => {
    expect(parseKnowledgeExport('{"entries":[]}')).toBeNull();
    expect(parseKnowledgeExport('not json')).toBeNull();
    expect(parseKnowledgeExport(JSON.stringify({ type: 'choice-knowledge-export', version: 99, entries: [] }))).toBeNull();
  });

  it('导入时清洗脏字段（与迁移同口径）', () => {
    const text = JSON.stringify({
      type: 'choice-knowledge-export',
      version: 1,
      exported_at: 0,
      entries: [
        {
          topic: '苏凛的渴求症',
          status: 'unknown',
          source: 'witnessed',
          aliases: ['苏凛可能处于稳定期或发情边缘', '渴求症'],
          keywords: ['精液'],
        },
      ],
    });
    const back = parseKnowledgeExport(text);
    expect(back![0].source).toBe('none');
    expect(back![0].aliases).toEqual(['渴求症']);
  });
});

describe('mergeDuplicateGroup — 合并结果', () => {
  it('保留更权威状态，并入别名/检索词/时间', () => {
    const keep = e('城北仓库的位置', 'uncertain', '传闻', '', 10, {
      aliases: ['仓库'],
      keywords: ['城北'],
      event_time: '2026年10月15日 下午',
    });
    const dup = e('城北仓库的位置在哪', 'known', '亲眼所见', '', 8, {
      aliases: ['仓库在哪'],
      keywords: ['仓库'],
      event_time: '',
    });
    const out = mergeDuplicateGroup([keep, dup], { keep, merge: [dup], score: 0.9 }, 12);
    expect(out.entries).toHaveLength(1);
    const merged = out.entries[0];
    expect(merged.status).toBe('known');
    expect(merged.previous_status).toBe('uncertain');
    expect(merged.aliases).toContain('仓库在哪');
    expect(merged.keywords).toContain('仓库');
    // 保留条目已有时间时不被空值覆盖
    expect(merged.event_time).toBe('2026年10月15日 下午');
    expect(out.change.kind).toBe('merged');
  });
});

describe('importance — 档位归一与合并', () => {
  it('中文/英文档位归一，无法识别落 normal', () => {
    const out = parseKnowledgeResponse(
      JSON.stringify({
        entries: [
          { topic: 'A', status: 'unknown', importance: '高' },
          { topic: 'B', status: 'known', importance: '次要' },
          { topic: 'C', status: 'known', importance: 'HIGH' },
          { topic: 'D', status: 'known', importance: '中' },
          { topic: 'E', status: 'known', importance: '莫名其妙' },
          { topic: 'F', status: 'known' },
        ],
      }),
    );
    const values = out!.patches.map(p => ('importance' in p ? p.importance : undefined));
    // 猜高会让约束项无端抢预算，猜低会让要紧的条目先被淘汰，故未知值落 normal
    expect(values).toEqual(['high', 'low', 'high', 'normal', 'normal', 'normal']);
  });

  it('补丁未给档位时保留旧档位，不静默降回 normal', () => {
    const existing = [e('A', 'known', '', '', 5, { id: 'kb_a', importance: 'high' })];
    const out = mergeKnowledgePatch(existing, [{ id: 'kb_a', topic: 'A', basis: '补充依据' } as KnowledgePatch], 20);
    expect(out.entries[0].importance).toBe('high');
  });

  it('补丁显式给档位时覆盖', () => {
    const existing = [e('A', 'known', '', '', 5, { id: 'kb_a', importance: 'high' })];
    const out = mergeKnowledgePatch(existing, [patch({ topic: 'A', importance: 'low' })], 20);
    expect(out.entries[0].importance).toBe('low');
  });

  it('新建条目缺省档位落 normal', () => {
    const out = mergeKnowledgePatch([], [{ topic: '新事' } as KnowledgePatch], 5);
    expect(out.entries[0].importance).toBe('normal');
  });

  it('手动整理合并时档位取更高的一侧', () => {
    const keep = e('城北仓库的位置', 'known', '', '', 10, { importance: 'low' });
    const dup = e('城北仓库的位置在哪', 'known', '', '', 8, { importance: 'high' });
    const out = mergeDuplicateGroup([keep, dup], { keep, merge: [dup], score: 0.9 }, 12);
    expect(out.entries[0].importance).toBe('high');
  });

  it('旧档缺 importance 时迁移落 normal', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known' }],
    } as unknown as KnowledgeReport;
    expect(migrateKnowledgeReport(legacy).entries[0].importance).toBe('normal');
  });

  it('补丁未给 subject 时保留旧值，给了则覆盖', () => {
    const existing = [e('她的私情', 'unknown', '', '不得提及', 5, { id: 'kb_a', subject: '富川立花' })];
    // 只改 status 的补丁不该把关联对象清空
    const keep = mergeKnowledgePatch(existing, [{ id: 'kb_a', topic: '她的私情', status: 'known' } as KnowledgePatch], 20);
    expect(keep.entries[0].subject).toBe('富川立花');
    const replace = mergeKnowledgePatch(existing, [patch({ topic: '她的私情', subject: '富川家' })], 21);
    expect(replace.entries[0].subject).toBe('富川家');
  });

  it('旧档缺 subject 时迁移为空串（面板显示未分类）', () => {
    const legacy = {
      updated_at: 1,
      based_on_message: 5,
      entries: [{ topic: 'A', status: 'known' }],
    } as unknown as KnowledgeReport;
    expect(migrateKnowledgeReport(legacy).entries[0].subject).toBe('');
  });

  it('已有表渲染带 [对象=…]，缺省时不输出空标签', () => {
    const out = renderExistingTable([
      e('立花的私情', 'unknown', '剧情未提及', '不得提及', 5, { subject: '富川立花' }),
      e('世界规则', 'known', '', '', 6),
    ]);
    expect(out).toContain('[对象=富川立花] 立花的私情');
    expect(out).toContain('[档位=中] 世界规则');
    expect(out).not.toContain('[对象=]');
  });
});

describe('entrySortScore — 动态取舍', () => {
  it('新鲜度随楼层衰减', () => {
    expect(freshnessScore(100, 100)).toBe(4);
    expect(freshnessScore(95, 100)).toBe(4);
    expect(freshnessScore(80, 100)).toBe(2);
    expect(freshnessScore(30, 100)).toBe(0);
    expect(freshnessScore(1, 100)).toBe(-3);
  });

  it('档位与新鲜度相加，老的高档位可以被近期普通条目反超', () => {
    const oldHigh = { importance: 'high' as const, updated_at_message: 1 };
    const recentNormal = { importance: 'normal' as const, updated_at_message: 99 };
    expect(entrySortScore(oldHigh, 100)).toBe(0);
    expect(entrySortScore(recentNormal, 100)).toBe(4);
    expect(entrySortScore(recentNormal, 100)).toBeGreaterThan(entrySortScore(oldHigh, 100));
  });

  it('全表同档时档位互相抵消，排序退化为时间与场景信号', () => {
    // 通胀自愈的核心断言：模型把整表标成 high 也不改变相对顺序
    const old = { importance: 'high' as const, updated_at_message: 10 };
    const recent = { importance: 'high' as const, updated_at_message: 95 };
    expect(entrySortScore(recent, 100)).toBeGreaterThan(entrySortScore(old, 100));
    // 与全部标 normal 时的相对顺序一致
    const oldN = { importance: 'normal' as const, updated_at_message: 10 };
    const recentN = { importance: 'normal' as const, updated_at_message: 95 };
    expect(entrySortScore(recentN, 100) - entrySortScore(oldN, 100)).toBe(
      entrySortScore(recent, 100) - entrySortScore(old, 100),
    );
  });

  it('场景命中提高分数', () => {
    const entry = { importance: 'normal' as const, updated_at_message: 90 };
    expect(entrySortScore(entry, 100, 2)).toBeGreaterThan(entrySortScore(entry, 100, 0));
  });

  it('档位优先级 low < normal < high', () => {
    expect(IMPORTANCE_RANK.low).toBeLessThan(IMPORTANCE_RANK.normal);
    expect(IMPORTANCE_RANK.normal).toBeLessThan(IMPORTANCE_RANK.high);
  });
});
