import { describe, expect, it } from 'vitest';
import { copyRenderPackData, readCell } from '../src/core/inspect';
import { PACK_CHANNELS, PACK_TEXTURES } from '../src/core/renderPack';

describe('InspectTooltip render pack ownership', () => {
  it('Workerへ元バッファを返却してもセル情報のコピーは読み取れる', () => {
    const size = 2;
    const source = new Float32Array(size * size * PACK_CHANNELS * PACK_TEXTURES);
    const temperatureOffset = size * size * PACK_CHANNELS;
    source[temperatureOffset] = 18.5;

    const transferredBuffer = source.buffer;
    const retained = copyRenderPackData(transferredBuffer);
    structuredClone(transferredBuffer, { transfer: [transferredBuffer] });

    expect(transferredBuffer.byteLength).toBe(0);
    expect(readCell(retained, size, 0, 0)?.temperature).toBe(18.5);
  });
});
