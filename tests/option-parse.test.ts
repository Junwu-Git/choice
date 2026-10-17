import { describe, expect, it } from 'vitest';
import { parseOptions } from '@/core/option-parse';

/** 事故样本（2026-10 实测，预设模式）：模型输出**未闭合** <thinking>，分析文本里又以文字
 *  提到 <options>（"存入 <options> 的 JSON 数组中"）并附一份候选设计清单（每条以【方向】
 *  开头、带 `1. \`标题|档位\`（固定）：` 编号尾巴），真实 JSON 块在末尾。
 *  旧实现取**第一个** <options> 开标签切片 → 从文字提及一路吞到真实块尾 → 切片不以 `[`
 *  开头 → JSON 主路径失配 → 括号回退把设计清单逐条当选项渲染（玩家截图确认）。 */
const ACCIDENT_OUTPUT = `1. 场景分析与理解：
当前场景：武坐在高处金属御座上，强袭卫士正在发起致命攻击。
任务需求：生成恰好 3 条方向各异的下一拍候选，存入 <options> 的 JSON 数组中。人称：严格按第三人称写。
3. 3条候选设计：
1. \`顺势行动|保守|25\`（固定）：【顺势行动】借着这短暂的喘息空档，武顺着开辟的屏障狭缝跃下御座，借离心力贴地翻滚逃向屏障开口。
2. \`须臾之间|保守|30\`（固定）：【须臾之间】两秒的光景不过眨眼之间，武看着呼啸而至的巨刃，按住左耳的银环纵身跃向殿门缝隙。
4. 校验自检：20条？是的，不多不少。
5. 生成JSON。<options>[{"title":"顺势行动|保守|25","content":"借着这短暂的喘息空档，武顺着开辟的屏障狭缝跃下御座，借离心力贴地翻滚逃向屏障开口。"},{"title":"须臾之间|保守|30","content":"两秒的光景不过眨眼之间，武看着呼啸而至的巨刃，按住左耳的银环纵身跃向殿门缝隙。"},{"title":"讨价还价|平衡|60","content":"面对斩来的高频战刃，武坐在御座上未动，扬声高呼：『再开大两尺，不然我直接往你的亲卫阵里引！』"}]</options>`;

describe('parseOptions — 事故复现：文字提及 <options> + 设计清单 + 未闭合 thinking', () => {
  const r = parseOptions(ACCIDENT_OUTPUT, 20);

  it('只解析真实 JSON 块，条数正确', () => {
    expect(r).toHaveLength(3);
  });

  it('每条为 [标题]正文 形态、内容来自真实 JSON 块', () => {
    expect(r[0]).toBe(
      '[顺势行动|保守|25]借着这短暂的喘息空档，武顺着开辟的屏障狭缝跃下御座，借离心力贴地翻滚逃向屏障开口。',
    );
    expect(r[2]).toBe(
      '[讨价还价|平衡|60]面对斩来的高频战刃，武坐在御座上未动，扬声高呼：『再开大两尺，不然我直接往你的亲卫阵里引！』',
    );
  });

  it('设计清单与文字提及的残留一条都不进结果', () => {
    expect(r.every(t => !t.includes('（固定）'))).toBe(true);
    expect(r.every(t => !t.includes('候选设计'))).toBe(true);
    expect(r.every(t => !t.includes('JSON 数组'))).toBe(true);
    // 设计清单的每条以「【方向】」开头；真实结果由 JSON 重建为 [标题]正文 形态
    expect(r.every(t => t.startsWith('['))).toBe(true);
  });

  it('count 生效（请求多于实际条数时不补空）', () => {
    expect(parseOptions(ACCIDENT_OUTPUT, 2)).toHaveLength(2);
  });
});

describe('parseOptions — 正常路径回归', () => {
  it('标准 <thinking></thinking><options>[JSON]</options>', () => {
    const out =
      '<thinking>分析：格式要求 <options> 标签内 JSON。</thinking>\n<options>[{"title":"A|保守|30","content":"正文A"},{"title":"B|大胆|70","content":"正文B"}]</options>';
    expect(parseOptions(out, 10)).toEqual(['[A|保守|30]正文A', '[B|大胆|70]正文B']);
  });

  it('配对的 thinking 标签剥离（无闭合标签时走 strip 正则）', () => {
    const out = '前言<thinking>内部提及 <options> 字样</thinking><options>[{"title":"甲","content":"乙"}]</options>';
    expect(parseOptions(out, 10)).toEqual(['[甲]乙']);
  });

  it('最后一个 thinking 闭合标签之后才是提取区（闭合标签后的分析文字不干扰）', () => {
    const out =
      '<thinking>初稿 <options> 此处非真</options> 嗯这不对，重来</thinking>\n<options>[{"title":"真","content":"内容"}]</options>';
    expect(parseOptions(out, 10)).toEqual(['[真]内容']);
  });

  it('无任何标签的裸 JSON 数组', () => {
    expect(parseOptions('[{"title":"裸","content":"JSON"}]', 10)).toEqual(['[裸]JSON']);
  });

  it('纯字符串数组元素', () => {
    expect(parseOptions('["甲乙丙", "丁"]', 10)).toEqual(['甲乙丙', '丁']);
  });

  it('{type,content} 形态映射为 [type]正文', () => {
    expect(parseOptions('[{"type":"方向","content":"正文"}]', 10)).toEqual(['[方向]正文']);
  });

  it('markdown 代码围栏被剥离', () => {
    expect(parseOptions('```json\n[{"title":"围栏","content":"内"}]```', 10)).toEqual(['[围栏]内']);
  });
});

describe('parseOptions — 修复层与边界形态', () => {
  it('截断的 </options 残片经修复层剥除后仍解析成功', () => {
    const out = '<options>[{"title":"残片","content":"内容"}]</options';
    expect(parseOptions(out, 10)).toEqual(['[残片]内容']);
  });

  it('正文裸引号经修复层转义后解析成功', () => {
    const out = '<options>[{"title":"裸引号","content":"他说"数到三"就动手"}]</options>';
    expect(parseOptions(out, 10)).toEqual(['[裸引号]他说"数到三"就动手']);
  });

  it('闭合标签后跟尾注（契约禁止但模型常犯）不影响提取', () => {
    const out = '<options>[{"title":"尾注","content":"内容"}]</options>\n以上是全部候选。';
    expect(parseOptions(out, 10)).toEqual(['[尾注]内容']);
  });

  it('格式示例块在前、真实块在后：取真实块', () => {
    const out =
      '示例：<options>[{"title":"示例","content":"不是真选项"}]</options>\n真实输出：<options>[{"title":"真","content":"真内容"}]</options>';
    expect(parseOptions(out, 10)).toEqual(['[真]真内容']);
  });

  it('末尾另提 <options> 字样（块外）：仍取已闭合的真实块', () => {
    const out = '<options>[{"title":"块后提及","content":"内容"}]</options>\n（请严格遵守 <options> 格式）';
    expect(parseOptions(out, 10)).toEqual(['[块后提及]内容']);
  });
});

describe('parseOptions — 括号回退路径', () => {
  it('【标题】内容 逐行切分', () => {
    const out = '【试探】她侧头看了看门缝。\n【等待】她留在原地不动。';
    expect(parseOptions(out, 10)).toEqual(['【试探】她侧头看了看门缝。', '【等待】她留在原地不动。']);
  });

  it('[标题]内容 与 【标题】混用', () => {
    const out = '[甲]内容甲\n【乙】内容乙';
    expect(parseOptions(out, 10)).toEqual(['[甲]内容甲', '【乙】内容乙']);
  });

  it('同一行标签堆叠并入同一条（场景头容错）', () => {
    const out = '[回溯闪回]🎞️ [记忆片段·三年前] 正文内容。';
    expect(parseOptions(out, 10)).toEqual(['[回溯闪回]🎞️ [记忆片段·三年前] 正文内容。']);
  });

  it('旧格式「标题: 内容」按行拆分', () => {
    const out = '试探: 她侧头看了看门缝。\n等待: 她留在原地不动。';
    expect(parseOptions(out, 10)).toEqual(['试探: 她侧头看了看门缝。', '等待: 她留在原地不动。']);
  });

  it('事故形态若 JSON 亦不可修复：回退不再吞设计清单（回退取真实内容侧）', () => {
    // 真实块被截断（JSON 无法修复）——回退起点应落在「最后一个开标签之后」，
    // 而不是旧实现的「第一个开标签之后」（那会从文字提及处开始把清单切出来）
    const out =
      '任务：存入 <options> 的 JSON 数组中。\n1. `顺势行动|保守|25`（固定）：【设计清单】不该出现在结果里。\n<options>[{"title":"真","content":"截断的内容';
    const r = parseOptions(out, 10);
    expect(r.every(t => !t.includes('设计清单'))).toBe(true);
  });

  it('空输出与纯文字防御：不抛错', () => {
    expect(parseOptions('', 10)).toEqual([]);
    expect(() => parseOptions('（空回复）', 10)).not.toThrow();
  });
});

/** 拒答/散文防御（2026-10 实测：Gemini 拒答被渲染成伪选项）。拒答文与选项在结构上
 *  的区别：拒答是"句子里的方括号引用"，没有"行首 [标题]正文"的选项结构。回退路径必须
 *  按此收窄，否则玩家会看到一条点不了的假选项（甚至整屏）。 */
describe('parseOptions — 拒答/散文不产出伪选项', () => {
  it('英文拒答 + markdown 链接：不产出伪选项', () => {
    const out =
      "I'm just a language model and can't help with that, but from what I can see, it appears this one would go against my [guidelines](https://gemini.google/policy-guidelines).";
    expect(parseOptions(out, 10)).toEqual([]);
  });

  it('中文拒答（无任何选项结构行）：不产出伪选项', () => {
    const out = '抱歉，我不能协助这个请求。\n请换一个不涉及该内容的方向后重试。';
    expect(parseOptions(out, 10)).toEqual([]);
  });

  it('散文中行内引用 [xxx]：不算选项起点', () => {
    const out = '任务要求把结果存入 <options> 的 JSON 数组中，格式见 [输出契约] 一节。';
    expect(parseOptions(out, 10)).toEqual([]);
  });

  it('引用标注 [1] 行：标题为纯数字，不算选项', () => {
    const out = '抱歉，无法协助。\n[1] 详见使用条款。';
    expect(parseOptions(out, 10)).toEqual([]);
  });

  it('行首 emoji 的散文句（无「标题:」结构）：不产出伪选项', () => {
    const out = '😔 非常抱歉，这个请求我无法完成。';
    expect(parseOptions(out, 10)).toEqual([]);
  });

  it('合法选项与收尾散文混排：剔除散文行、保留选项（不整段作废）', () => {
    const out = '试探: 她侧头看了看门缝。\n以上是全部候选。';
    expect(parseOptions(out, 10)).toEqual(['试探: 她侧头看了看门缝。']);
  });

  it('同行前置说明（冒号收尾）不阻断首条锚定', () => {
    const out = '以下是候选：[试探]她侧头看了看门缝。\n[等待]她留在原地不动。';
    expect(parseOptions(out, 10)).toEqual(['[试探]她侧头看了看门缝。', '[等待]她留在原地不动。']);
  });
});
