/**
 * data/ の実行時検査。ルールは data/validation.json から読む（コードに書き写さない）。
 * ここで見るのは必須ファイル・必須キー・数値フィールドの型/範囲/単位/enum。
 * 参照整合性と等高線の幾何は scripts/validate.py（CIで実行）が担当する。
 */

export type JsonDocs = Readonly<Record<string, unknown>>; // キーは "scale.json" 形式

export interface Issue {
  severity: 'error' | 'warning';
  message: string;
}

interface FieldRule {
  type?: 'number' | 'integer' | 'object' | 'enum';
  unit?: string;
  min?: number;
  max?: number;
  enumRef?: string;
}

interface FileRule {
  requiredKeys?: string[];
  fields?: Record<string, FieldRule>;
}

interface ValidationRules {
  requiredFiles: string[];
  files: Record<string, FileRule>;
}

export function getPath(doc: unknown, dotted: string): unknown {
  let cur: unknown = doc;
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function checkData(docs: JsonDocs, rules: ValidationRules): Issue[] {
  const issues: Issue[] = [];
  const err = (message: string) => issues.push({ severity: 'error', message });
  const warn = (message: string) => issues.push({ severity: 'warning', message });

  for (const fname of rules.requiredFiles) {
    if (!(fname in docs)) err(`必須ファイルがありません: ${fname}`);
  }

  for (const [fname, rule] of Object.entries(rules.files)) {
    const doc = docs[fname];
    if (doc === undefined) continue; // 欠落は上で報告済み

    for (const key of rule.requiredKeys ?? []) {
      if (getPath(doc, key) === undefined) err(`${fname}: 必須キーがありません: ${key}`);
    }

    for (const [fpath, frule] of Object.entries(rule.fields ?? {})) {
      const value = getPath(doc, fpath);
      if (value === undefined) {
        err(`${fname}.${fpath}: 値がありません`);
        continue;
      }

      const lastDot = fpath.lastIndexOf('.');
      const parent = lastDot >= 0 ? getPath(doc, fpath.slice(0, lastDot)) : doc;
      const actualUnit =
        parent !== null && typeof parent === 'object'
          ? (parent as Record<string, unknown>)['unit']
          : undefined;
      if (frule.unit && typeof actualUnit === 'string' && actualUnit !== frule.unit) {
        err(`${fname}.${fpath}: 単位が不一致（期待 '${frule.unit}', 実際 '${actualUnit}'）`);
      }
      if (frule.unit && actualUnit === undefined && parent !== null && typeof parent === 'object') {
        warn(`${fname}.${fpath}: 単位の記載がありません（期待 '${frule.unit}'）`);
      }

      switch (frule.type) {
        case 'number':
        case 'integer': {
          if (typeof value !== 'number' || !Number.isFinite(value)) {
            err(`${fname}.${fpath}: 数値ではありません`);
            break;
          }
          if (frule.type === 'integer' && !Number.isInteger(value)) {
            err(`${fname}.${fpath}: 整数ではありません`);
          }
          if (frule.min !== undefined && value < frule.min) {
            err(`${fname}.${fpath}: ${value} が下限 ${frule.min} 未満`);
          }
          if (frule.max !== undefined && value > frule.max) {
            err(`${fname}.${fpath}: ${value} が上限 ${frule.max} 超過`);
          }
          break;
        }
        case 'object':
          if (value === null || typeof value !== 'object' || Array.isArray(value)) {
            err(`${fname}.${fpath}: オブジェクトではありません`);
          }
          break;
        case 'enum': {
          if (!frule.enumRef) break;
          const [refFile, refPath] = frule.enumRef.split('#', 2);
          const allowed = getPath(docs[refFile], refPath);
          if (!Array.isArray(allowed) || !allowed.includes(value)) {
            err(`${fname}.${fpath}: ${String(value)} は ${frule.enumRef} に含まれません`);
          }
          break;
        }
      }
    }
  }
  return issues;
}
