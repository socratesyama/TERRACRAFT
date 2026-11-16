#!/usr/bin/env python3
"""data/ の JSON を validation.json の定義に従って検証するスクリプト。

使い方:
    python3 scripts/validate.py          # data/ 全ファイルを検証
    python3 scripts/validate.py -v       # 警告も詳細表示

検証内容:
    1. data/ の全JSONがパースできること
    2. validation.json の requiredFiles がすべて存在すること
    3. 各ファイルの必須キー (requiredKeys) が存在すること
    4. fields の型・単位・範囲 (min/max)・enum が正しいこと
    5. references の参照整合性 (地形プリセット・指標・災害IDなどが実在すること)

単位の慣行は docs/data-catalog.md に従う。JSON を書き換えたら必ずこの検証を通す。
"""

import json
import sys
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def resolve_pattern(doc, pattern):
    """'a.*.b' 形式のパターンにマッチする値を (parent, key, value) で返す。* は任意キー。"""
    segments = pattern.split(".")
    results = [(doc, None, doc)]  # (parent, key, value) の初期（親なし）
    for seg in segments:
        if seg == "*":
            next_results = []
            for parent, _key, value in results:
                if isinstance(value, dict):
                    for k, v in value.items():
                        next_results.append((value, k, v))
                elif isinstance(value, list):
                    for i, v in enumerate(value):
                        next_results.append((value, i, v))
                results = next_results
        else:
            next_results = []
            for parent, _key, value in results:
                if isinstance(value, dict) and seg in value:
                    next_results.append((value, seg, value[seg]))
            results = next_results
    return results


def get_path(doc, dotted):
    cur = doc
    parent = None
    for seg in dotted.split("."):
        if isinstance(cur, dict) and seg in cur:
            parent = cur
            cur = cur[seg]
        else:
            return None, None
    return cur, parent


def main():
    verbose = "-v" in sys.argv
    errors = []
    warnings = []
    ok = []

    # 1. 全JSONのパース
    json_files = sorted(DATA_DIR.glob("*.json"))
    docs = {}
    for path in json_files:
        name = path.name
        try:
            docs[name] = load(path)
            ok.append(f"パース成功: {name}")
        except json.JSONDecodeError as e:
            errors.append(f"{name}: JSONの構文エラー → {e}")

    spec_file = DATA_DIR / "validation.json"
    if not spec_file.exists():
        print("validation.json がありません。検証を続行できません。")
        return 1
    spec = docs.get("validation.json") or load(spec_file)

    # 2. requiredFiles
    for name in spec.get("requiredFiles", []):
        if name not in docs:
            errors.append(f"必須ファイルが存在しない: data/{name}")
    for name in docs:
        if name not in spec.get("requiredFiles", []) and name != "validation.json":
            warnings.append(
                f"data/{name} は validation.json の requiredFiles に載っていません"
            )

    # 3〜4. ファイルごとの検証
    for fname, rules in spec.get("files", {}).items():
        doc = docs.get(fname)
        if doc is None:
            continue
        for key in rules.get("requiredKeys", []):
            if key not in doc:
                errors.append(f"{fname}: 必須キー '{key}' がありません")
        for fpath, frule in rules.get("fields", {}).items():
            value, parent = get_path(doc, fpath)
            if value is None and parent is None:
                errors.append(f"{fname}: フィールド '{fpath}' がありません")
                continue
            # 型
            ftype = frule.get("type")
            if ftype == "number" and not isinstance(value, (int, float)):
                errors.append(f"{fname}.{fpath}: 数値であるべき (type=number)")
            if ftype == "integer" and not (isinstance(value, int) and not isinstance(value, bool)):
                errors.append(f"{fname}.{fpath}: 整数であるべき (type=integer)")
            # 単位（仕様に unit があれば、対象の親オブジェクトの unit と比較）
            spec_unit = frule.get("unit")
            actual_unit = parent.get("unit") if isinstance(parent, dict) else None
            if spec_unit and actual_unit and spec_unit != actual_unit:
                errors.append(
                    f"{fname}.{fpath}: 単位が不一致（期待 '{spec_unit}', 実際 '{actual_unit}'）"
                )
            if spec_unit and not actual_unit and isinstance(parent, dict):
                warnings.append(f"{fname}.{fpath}: 単位の記載がない（期待 '{spec_unit}'）")
            # 範囲
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                if "min" in frule and value < frule["min"]:
                    errors.append(
                        f"{fname}.{fpath}: 範囲外（{value} < min {frule['min']}）"
                    )
                if "max" in frule and value > frule["max"]:
                    errors.append(
                        f"{fname}.{fpath}: 範囲外（{value} > max {frule['max']}）"
                    )
            # enum / enumRef
            if "enum" in frule and value not in frule["enum"]:
                errors.append(f"{fname}.{fpath}: 値 '{value}' は enum 外")
            if "enumRef" in frule:
                ref_file, ref_path = frule["enumRef"].split("#", 1)
                ref_doc = docs.get(ref_file, {})
                ref_val, _ = get_path(ref_doc, ref_path)
                if ref_val is not None and value not in ref_val:
                    errors.append(
                        f"{fname}.{fpath}: 値 '{value}' は {ref_file}#{ref_path} に存在しない"
                    )

    # 5. 参照整合性
    for ref in spec.get("references", []):
        from_spec = ref.get("from", "")
        to_spec = ref.get("to", "")
        severity = ref.get("severity", "error")
        from_file, from_path = from_spec.split("#", 1)
        src = docs.get(from_file)
        if src is None:
            errors.append(f"参照元ファイルが読めない: {from_file}")
            continue
        matches = resolve_pattern(src, from_path)
        if not matches:
            # ワイルドカード項目が空（例: effects が空）は警告のみ
            warnings.append(f"{from_file}#{from_path}: 参照元に該当がない（空かも）")
            continue
        if to_spec == "@requiredFiles":
            valid = set(spec.get("requiredFiles", []))
        else:
            if "#" in to_spec:
                to_file, to_path = to_spec.split("#", 1)
                target = docs.get(to_file, {})
                tval, _ = get_path(target, to_path)
            else:
                # 'disasters.json' のようにファイル直指定 → トップレベルのキー（_doc/sources を除く）
                tval = docs.get(to_spec, {})
            valid = (
                {k for k in tval if not k.startswith("_") and k != "sources"}
                if isinstance(tval, dict)
                else set()
            )
            if not valid:
                errors.append(f"参照先が解決できない: {to_spec}")
                continue
        for _parent, key, value in matches:
            # 参照元がリスト（例: expectedBiomes）なら各要素を検査
            values = value if isinstance(value, list) else [value]
            for v in values:
                if v not in valid:
                    msg = (
                        f"{from_file}#{from_path}[{key}]: '{v}' は "
                        f"{to_spec} に存在しない"
                    )
                    (warnings if severity == "warning" else errors).append(msg)

    # 結果表示
    print(f"検査対象: {len(json_files)} ファイル / ルール: validation.json v{spec.get('version')}")
    for m in ok:
        if verbose:
            print(f"  OK: {m}")
    for w in warnings:
        print(f"  警告: {w}")
    for e in errors:
        print(f"  エラー: {e}")
    print(f"結果: {len(errors)} エラー / {len(warnings)} 警告")
    if errors:
        print("検証に失敗しました。修正してからコミットしてください。")
        return 1
    print("検証に成功しました。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
