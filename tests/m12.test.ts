import { describe, expect, it } from 'vitest';
import { readCell } from '../src/core/inspect';
import { loadData } from '../src/core/data/loader';
import { buildWorld, stepWorld } from '../src/core/pipeline';
import { buildRenderPack, PACK_CHANNELS, PACK_TEXTURES } from '../src/core/renderPack';
import { mapKey } from '../src/ui/shortcuts';

const { data } = loadData();
const key = (k: string, o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o });
const tools = ['view', 'mountain', 'dig'] as const;

describe('M12 ショートカット（§13.5）', () => {
  it('Space で再生/停止、数字でツール、範囲外の数字は無視', () => {
    expect(mapKey(key(' '), tools, false)).toEqual({ kind: 'togglePlay' });
    expect(mapKey(key('2'), tools, false)).toEqual({ kind: 'tool', tool: 'mountain' });
    expect(mapKey(key('9'), tools, false)).toBeNull();
    expect(mapKey(key('0'), tools, false)).toBeNull();
  });
  it('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y。修飾キー付きの数字や入力欄では何もしない', () => {
    expect(mapKey(key('z', { ctrlKey: true }), tools, false)).toEqual({ kind: 'undo' });
    expect(mapKey(key('Z', { metaKey: true, shiftKey: true }), tools, false)).toEqual({ kind: 'redo' });
    expect(mapKey(key('y', { ctrlKey: true }), tools, false)).toEqual({ kind: 'redo' });
    expect(mapKey(key('1', { ctrlKey: true }), tools, false)).toBeNull();
    expect(mapKey(key('1', { altKey: true }), tools, false)).toBeNull();
    expect(mapKey(key(' '), tools, true)).toBeNull();
  });
});

describe('M12 セル情報（§13.7）', () => {
  const w = buildWorld(data, 'basin', data.scenarios.comparison.defaultSeed, 128, { nations: true });
  for (let i = 0; i < 20; i++) {
    w.tick++;
    stepWorld(w, data, false);
  }
  const pack = new Float32Array(128 * 128 * PACK_CHANNELS * PACK_TEXTURES);
  buildRenderPack(w, data, pack);

  it('パックから読んだ値が世界の値と一致する', () => {
    for (const [x, y] of [[10, 10], [64, 64], [100, 30]] as const) {
      const c = readCell(pack, 128, x, y)!;
      const i = y * 128 + x;
      expect(c.height).toBeCloseTo(w.primary.height[i]!, 6);
      expect(c.vegetation).toBeCloseTo(w.primary.vegetation[i]!, 6);
      expect(c.owner).toBe(w.primary.owner[i]);
      expect(c.erosion).toBeCloseTo(w.primary.erosion[i]!, 6);
    }
  });
  it('範囲外・非整数は null', () => {
    expect(readCell(pack, 128, -1, 0)).toBeNull();
    expect(readCell(pack, 128, 128, 0)).toBeNull();
    expect(readCell(pack, 128, 1.5, 0)).toBeNull();
  });
});
