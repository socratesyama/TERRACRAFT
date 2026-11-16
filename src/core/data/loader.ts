import { checkData, type Issue, type JsonDocs } from './check';
import { FILE_TO_KEY, type DataBundle } from './schema';

/**
 * data/*.json をビルド時に取り込む。JSON を書き換えて再ビルド（開発中は HMR）すれば挙動が変わる。
 * Worker と UI の両方から同じ読み込み口を使う。
 */
const modules = import.meta.glob('../../../data/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, unknown>;

export class DataError extends Error {
  readonly issues: Issue[];
  constructor(issues: Issue[]) {
    super(
      'data/ の検証に失敗しました:\n' +
        issues
          .filter((i) => i.severity === 'error')
          .map((i) => `  - ${i.message}`)
          .join('\n'),
    );
    this.name = 'DataError';
    this.issues = issues;
  }
}

/** "../../../data/hydrology.json" → "hydrology.json" */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export function rawDocs(): JsonDocs {
  const docs: Record<string, unknown> = {};
  for (const [path, mod] of Object.entries(modules)) docs[baseName(path)] = mod;
  return docs;
}

export interface LoadedData {
  data: DataBundle;
  /** 警告（エラーは例外になる） */
  warnings: Issue[];
}

/** 検証つきで全JSONを読む。エラーがあれば DataError を投げる。 */
export function loadData(docs: JsonDocs = rawDocs()): LoadedData {
  const validation = docs['validation.json'] as Parameters<typeof checkData>[1] | undefined;
  if (!validation) {
    throw new DataError([{ severity: 'error', message: '必須ファイルがありません: validation.json' }]);
  }
  const issues = checkData(docs, validation);
  if (issues.some((i) => i.severity === 'error')) throw new DataError(issues);

  const bundle: Record<string, unknown> = {};
  for (const [fname, key] of Object.entries(FILE_TO_KEY)) {
    bundle[key] = docs[`${fname}.json`];
  }
  return { data: bundle as unknown as DataBundle, warnings: issues };
}
