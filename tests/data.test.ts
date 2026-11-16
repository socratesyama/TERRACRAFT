import { describe, expect, it } from 'vitest';
import { checkData, getPath } from '../src/core/data/check';
import { DataError, loadData, rawDocs } from '../src/core/data/loader';
import { FILE_TO_KEY } from '../src/core/data/schema';

type Docs = Record<string, unknown>;
const clone = (): Docs => structuredClone(rawDocs()) as Docs;

describe('data ローダー', () => {
  it('data/ の全JSONを検証つきで読み込める（エラー0・警告0）', () => {
    const { data, warnings } = loadData();
    expect(warnings).toEqual([]);
    expect(Object.keys(data).sort()).toEqual(Object.values(FILE_TO_KEY).sort());
  });

  it('FILE_TO_KEY が validation.json の requiredFiles を過不足なく覆う', () => {
    const docs = rawDocs();
    const required = (docs['validation.json'] as { requiredFiles: string[] }).requiredFiles;
    const mapped = Object.keys(FILE_TO_KEY).map((f) => `${f}.json`);
    for (const f of required) expect(mapped).toContain(f);
    expect(Object.keys(docs).sort()).toEqual([...mapped].sort());
  });

  it('必須ファイルが欠けると DataError', () => {
    const docs = clone();
    delete docs['hydrology.json'];
    expect(() => loadData(docs)).toThrow(DataError);
  });

  it('必須キーが欠けると DataError', () => {
    const docs = clone();
    delete (docs['climate.json'] as Docs)['precip'];
    expect(() => loadData(docs)).toThrow(/climate\.json: 必須キーがありません: precip/);
  });

  it('範囲外の値（気温減率 100 K/km）は DataError', () => {
    const docs = clone();
    (getPath(docs['climate.json'], 'temperature.environmentalLapseRate') as Docs)['value'] = 100;
    expect(() => loadData(docs)).toThrow(/上限/);
  });

  it('単位の不一致は DataError', () => {
    const docs = clone();
    (docs['scale.json'] as Docs & { cellSize: Docs }).cellSize['unit'] = 'km';
    expect(() => loadData(docs)).toThrow(/単位が不一致/);
  });

  it('enumRef: defaultSize が grid.sizes に無いと DataError', () => {
    const docs = clone();
    (docs['scale.json'] as { grid: Docs }).grid['defaultSize'] = 100;
    expect(() => loadData(docs)).toThrow(/grid\.sizes/);
  });

  it('JSON を書き換えると読み出す値が変わる（数値は data/ だけが持つ）', () => {
    const docs = clone();
    (docs['runtime.json'] as { tick: Docs }).tick['budgetMs'] = 50;
    expect(loadData(docs).data.runtime.tick.budgetMs).toBe(50);
  });

  it('checkData は警告とエラーを分けて返す', () => {
    const docs = clone();
    const rules = docs['validation.json'] as Parameters<typeof checkData>[1];
    expect(checkData(docs, rules).filter((i) => i.severity === 'error')).toEqual([]);
  });
});
