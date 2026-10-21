import { afterEach, describe, expect, it } from 'vitest';
import { isHostGenerationActive, waitForHostIdle } from '@/core/host-generation';

/** 伪造宿主的「生成中」标志（酒馆用 body[data-generating] 维护）。 */
const stubHost = (generating: boolean | undefined): void => {
  (globalThis as unknown as { document: unknown }).document = {
    body: { dataset: generating === undefined ? {} : { generating: String(generating) } },
  };
};

afterEach(() => {
  delete (globalThis as unknown as { document?: unknown }).document;
});

describe('主生成闸门', () => {
  it('没有宿主文档时视为不在途', () => {
    expect(isHostGenerationActive()).toBe(false);
  });

  it('读酒馆的 body[data-generating] 标志', () => {
    stubHost(true);
    expect(isHostGenerationActive()).toBe(true);
    stubHost(false);
    expect(isHostGenerationActive()).toBe(false);
  });

  it('不在生成中时立即放行', async () => {
    stubHost(false);
    const start = Date.now();
    await waitForHostIdle(2000);
    expect(Date.now() - start).toBeLessThan(200);
  });

  it('生成中会等待，标志清除后放行', async () => {
    stubHost(true);
    setTimeout(() => stubHost(false), 40);
    const start = Date.now();
    await waitForHostIdle(2000);
    const waited = Date.now() - start;
    expect(waited).toBeGreaterThanOrEqual(30);
    expect(waited).toBeLessThan(1000);
  });

  it('标志一直不清也会超时放行（不能把选项生成卡死）', async () => {
    stubHost(true);
    const start = Date.now();
    await waitForHostIdle(60);
    expect(Date.now() - start).toBeGreaterThanOrEqual(50);
  });
});
