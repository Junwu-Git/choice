import type { ChatMsg } from '@/core/api-client';

interface BaiBaiBookApi {
  apiVersion: number;
  pluginVersion: string;
  capabilities: Record<string, boolean>;
  getSnapshot(options?: { floor?: number; at?: 'before' | 'after' }): BaiBaiSnapshot | null;
  getHistory(options: { before: number }): BaiBaiHistory | null;
  getInjectedHistory(): BaiBaiHistory | null;
  getContextAtFloor(options: { floor: number }): BaiBaiContext | null;
}

interface BaiBaiSnapshot {
  apiVersion: number;
  pluginVersion: string;
  revision: number;
  chat: { id: string; characterName: string; groupId: string | null; length: number };
  point: { floor: number; at: string; upToExclusive: number };
  coverage: { complete: boolean; missingAiFloors: number[] };
  state: { time: string; location: string; locationPath: string[] };
  protagonist: { gender: string; identity: string; appearance: string; outfit: string; condition: string };
  vars: Record<string, any>;
  items: any[];
  plans: any[];
  scenes: any[];
  npcs: any[];
  itemLog: any[];
}

interface BaiBaiHistory {
  text: string;
  relativeText: string;
  nodes: any[];
  coverage: { complete: boolean; missingAiFloors: number[] };
}

interface BaiBaiContext {
  floorData: any;
  floorSummary: string | null;
  floorDelta: string | null;
  snapshotBefore: BaiBaiSnapshot | null;
  snapshotAfter: BaiBaiSnapshot | null;
  historyBefore: BaiBaiHistory | null;
  coverage: { complete: boolean; missingAiFloors: number[] };
}

function getApi(): BaiBaiBookApi | null {
  return (globalThis as any).STBaiBaiBook ?? null;
}

export function isBaiBaiBookAvailable(): boolean {
  return getApi() !== null;
}

/** 获取柏宝书摘要/历史剧情文本（使用注入口径，与正常记忆注入同规则）。
 *  优先 getInjectedHistory()（跳过滑动窗口内仍发全文的摘要），
 *  降级为 getHistory()（从最开始到最新楼的全部历史）。 */
export function getBaiBaiSummary(): string | null {
  const api = getApi();
  if (!api) return null;
  try {
    const injected = api.getInjectedHistory();
    if (injected?.relativeText) return injected.relativeText;
    // 降级：取全部历史（截止到最新楼）
    const chat = window.SillyTavern?.getContext?.()?.chat;
    const len = chat?.length ?? 0;
    if (len > 0) {
      const hist = api.getHistory({ before: len });
      if (hist?.relativeText) return hist.relativeText;
    }
  } catch (e) {
    console.warn('[Choice][BaiBaiBook] 获取摘要失败:', e);
  }
  return null;
}

/** 获取柏宝书状态快照并格式化为提示词可用的文本。
 *  包含：当前时间/地点、主角信息、场景、NPC、变量。 */
export function getBaiBaiState(): string | null {
  const api = getApi();
  if (!api) return null;
  try {
    const snap = api.getSnapshot();
    if (!snap) return null;
    const parts: string[] = [];

    const st = snap.state;
    if (st?.time || st?.location) {
      const loc = st.locationPath?.length ? st.locationPath.join(' > ') : st.location;
      parts.push(
        `【当前状态】${st.time ? `时间: ${st.time}` : ''}${st.time && loc ? ' / ' : ''}${loc ? `地点: ${loc}` : ''}`,
      );
    }

    const p = snap.protagonist;
    if (p) {
      const fields = [
        p.gender ? `性别: ${p.gender}` : '',
        p.identity ? `身份: ${p.identity}` : '',
        p.appearance ? `外貌: ${p.appearance}` : '',
        p.outfit ? `衣着: ${p.outfit}` : '',
        p.condition ? `状态: ${p.condition}` : '',
      ].filter(Boolean);
      if (fields.length) parts.push(`【主角】${fields.join(' / ')}`);
    }

    if (snap.scenes?.length) {
      const sceneText = snap.scenes
        .map((s: any) => {
          const name = s.name || s.title || '';
          const desc = s.description || s.desc || '';
          return name && desc ? `${name}: ${desc}` : name || desc;
        })
        .filter(Boolean)
        .join('；');
      if (sceneText) parts.push(`【场景】${sceneText}`);
    }

    if (snap.npcs?.length) {
      const npcText = snap.npcs
        .map((n: any) => {
          const name = n.name || '';
          const info = [n.identity, n.appearance, n.condition].filter(Boolean).join(' / ');
          return name && info ? `${name}(${info})` : name || info;
        })
        .filter(Boolean)
        .join('；');
      if (npcText) parts.push(`【NPC】${npcText}`);
    }

    if (snap.vars && Object.keys(snap.vars).length > 0) {
      const varText = JSON.stringify(snap.vars);
      if (varText !== '{}') parts.push(`【变量】${varText}`);
    }

    return parts.length ? parts.join('\n') : null;
  } catch (e) {
    console.warn('[Choice][BaiBaiBook] 获取状态失败:', e);
  }
  return null;
}
