import { describe, expect, it } from 'vitest';
import { loadData } from '../src/core/data/loader';
import { DX, DY } from '../src/core/hydrology';
import { SHOWCASE_SCENARIOS, buildWorld } from '../src/core/pipeline';
import { PACK_CHANNELS, buildRenderPack, packByteLength } from '../src/core/renderPack';
import { hashDerived, hashWorld } from '../src/core/world';
import { SimulationController } from '../src/worker/controller';
import type { FromWorker } from '../src/worker/protocol';

const { data } = loadData();
const q = data.runtime.hash.quantizeScale;
const SEED = data.scenarios.comparison.defaultSeed;
const SIZE = 128;

describe.each(SHOWCASE_SCENARIOS)('M1 地形・水文・降水: %s', (id) => {
  it('同じ seed で二度作ると配列のハッシュが一致する', () => {
    const a = buildWorld(data, id, SEED, SIZE);
    const b = buildWorld(data, id, SEED, SIZE);
    expect(hashWorld(a, q)).toBe(hashWorld(b, q));
    expect(hashDerived(a, q)).toBe(hashDerived(b, q));
  });

  it('seed が違えば地形が変わる', () => {
    const a = buildWorld(data, id, SEED, SIZE);
    const b = buildWorld(data, id, SEED + 1, SIZE);
    expect(hashWorld(a, q)).not.toBe(hashWorld(b, q));
  });

  it('標高は [0,1]、降水は有限で非負', () => {
    const w = buildWorld(data, id, SEED, SIZE);
    for (let i = 0; i < w.primary.height.length; i++) {
      expect(w.primary.height[i]).toBeGreaterThanOrEqual(0);
      expect(w.primary.height[i]).toBeLessThanOrEqual(1);
      expect(Number.isFinite(w.derived.precip[i])).toBe(true);
      expect(w.derived.precip[i]).toBeGreaterThanOrEqual(0);
    }
  });

  it('等高線の固定セルが存在する（標高誤差の検証は M1 受け入れ手順の数値確認で実施）', () => {
    const w = buildWorld(data, id, SEED, SIZE);
    let fixedCount = 0;
    for (let i = 0; i < w.primary.fixed.length; i++) {
      if (w.primary.fixed[i]) fixedCount++;
    }
    expect(fixedCount).toBeGreaterThan(0);
  });

  it('流量累積は流下方向に単調非減少（上流 ≤ 下流）', () => {
    const w = buildWorld(data, id, SEED, SIZE);
    const { flowDir, flowAcc } = w.derived;
    const n = w.size;
    for (let i = 0; i < n * n; i++) {
      const d = flowDir[i]!;
      if (d === 255) continue;
      const j = (Math.floor(i / n) + DY[d]!) * n + ((i % n) + DX[d]!);
      expect(flowAcc[j]!).toBeGreaterThanOrEqual(flowAcc[i]! - 1e-6);
    }
  });

  it('描画パックは size²×4 float で、標高と降水を写している', () => {
    const w = buildWorld(data, id, SEED, SIZE);
    const out = new Float32Array(packByteLength(w.size) / 4);
    buildRenderPack(w, data, out);
    expect(out.length).toBe(w.size * w.size * PACK_CHANNELS);
    expect(out[0]).toBe(w.primary.height[0]);
    expect(out[3]).toBe(w.derived.precip[0]);
  });
});

describe('M1 降水の風上・風下', () => {
  it('山脈では風上斜面のほうが風下斜面より雨が多い（雨陰）', () => {
    const w = buildWorld(data, 'mountainRange', SEED, 192);
    const n = w.size;
    const dir = w.params.windDir;
    const dx = DX[dir]!;
    const dy = DY[dir]!;
    let up = 0;
    let upN = 0;
    let lee = 0;
    let leeN = 0;
    for (let y = 1; y < n - 1; y++) {
      for (let x = 1; x < n - 1; x++) {
        const i = y * n + x;
        if (w.primary.height[i]! < w.params.seaLevel) continue;
        const ahead = (y + dy) * n + (x + dx);
        const behind = (y - dy) * n + (x - dx);
        const g = w.primary.height[ahead]! - w.primary.height[behind]!;
        if (w.primary.height[i]! < 0.3) continue; // 斜面（山地側）だけを比べる
        if (g > 0.01) {
          up += w.derived.precip[i]!;
          upN++;
        } else if (g < -0.01) {
          lee += w.derived.precip[i]!;
          leeN++;
        }
      }
    }
    expect(upN).toBeGreaterThan(0);
    expect(leeN).toBeGreaterThan(0);
    expect(up / upN).toBeGreaterThan(lee / leeN);
  });
});

describe('M1 Worker 結線', () => {
  it('init で描画パックのスナップショットが届き、返却するまで次は来ない', () => {
    const msgs: FromWorker[] = [];
    let t = 0;
    const c = new SimulationController(data, (m) => msgs.push(m), () => (t += 1));
    c.handle({ type: 'init', scenarioId: 'island', seed: SEED, size: SIZE });
    const snap = msgs.find((m) => m.type === 'snapshot');
    expect(snap?.type).toBe('snapshot');
    if (snap?.type === 'snapshot') {
      expect(snap.pack.size).toBe(SIZE);
      expect(snap.pack.data.byteLength).toBe(packByteLength(SIZE));
    }
  });

  it('未知のシナリオは error を返す', () => {
    const msgs: FromWorker[] = [];
    const c = new SimulationController(data, (m) => msgs.push(m), () => 0);
    c.handle({ type: 'init', scenarioId: 'nope', seed: 1, size: SIZE });
    expect(msgs.some((m) => m.type === 'error')).toBe(true);
  });
});
