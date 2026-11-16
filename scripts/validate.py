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


def point_in_poly(pt, poly):
    """レイキャスティング法で点が多角形の内側か判定（nesting 検査用）"""
    x, y = pt
    n = len(poly)
    inside = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if ((yi > y) != (yj > y)) and (x < (xj - xi) * (y - yi) / (yj - yi + 1e-12) + xi):
            inside = not inside
        j = i
    return inside


def orient(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def seg_proper_intersect(p1, p2, p3, p4):
    d1 = orient(p3, p4, p1)
    d2 = orient(p3, p4, p2)
    d3 = orient(p1, p2, p3)
    d4 = orient(p1, p2, p4)
    return (
        ((d1 > 0 and d2 < 0) or (d1 < 0 and d2 > 0))
        and ((d3 > 0 and d4 < 0) or (d3 < 0 and d4 > 0))
    )


def pt_seg_dist(p, a, b):
    ax, ay = a
    bx, by = b
    dx, dy = bx - ax, by - ay
    if dx == dy == 0:
        return ((p[0] - ax) ** 2 + (p[1] - ay) ** 2) ** 0.5
    t = max(0, min(1, ((p[0] - ax) * dx + (p[1] - ay) * dy) / (dx * dx + dy * dy)))
    return ((p[0] - ax - t * dx) ** 2 + (p[1] - ay - t * dy) ** 2) ** 0.5


def seg_seg_dist(p1, p2, p3, p4):
    if seg_proper_intersect(p1, p2, p3, p4):
        return 0.0
    return min(
        pt_seg_dist(p1, p3, p4),
        pt_seg_dist(p2, p3, p4),
        pt_seg_dist(p3, p1, p2),
        pt_seg_dist(p4, p1, p2),
    )


def check_terrain_geometry(spec, docs, errors, warnings):
    """terrain.json のプリセット等高線の幾何検証（validation.json files.terrain.json.contourGeometry）"""
    terrain = docs.get("terrain.json", {})
    presets = terrain.get("presets", {})
    scale = docs.get("scale.json", {})
    grid_sizes = scale.get("grid", {}).get("sizes", [192])
    min_grid = min(grid_sizes)
    lo, hi = spec.get("bounds", [0, 1])
    min_sep = spec.get("minSeparationNormalized", 0.04)
    min_vert = spec.get("minVertexSpacing", 0.02)
    enabled = [c for c in spec.get("checks", [])]
    for name, preset in presets.items():
        if name.startswith("_") or not isinstance(preset, dict):
            continue
        contours = preset.get("contours", [])
        for ci, c in enumerate(contours):
            pts = c.get("points", [])
            if not pts:
                errors.append(f"terrain.json presets.{name} c{ci}: 頂点がない")
                continue
            # bounds
            if "bounds" in enabled:
                for k, pt in enumerate(pts):
                    if not (lo <= pt[0] <= hi and lo <= pt[1] <= hi):
                        errors.append(
                            f"terrain.json presets.{name} c{ci} 頂点{k}: {pt} が範囲 [{lo},{hi}] 外"
                        )
            # 最小頂点間隔
            if "minVertexSpacing" in enabled:
                for k in range(len(pts) - 1):
                    d = ((pts[k][0] - pts[k + 1][0]) ** 2 + (pts[k][1] - pts[k + 1][1]) ** 2) ** 0.5
                    if d < min_vert:
                        errors.append(
                            f"terrain.json presets.{name} c{ci} 頂点{k}-{k+1}: "
                            f"頂点間隔 {d:.4f} < {min_vert}"
                        )
            segs = [(pts[k], pts[k + 1]) for k in range(len(pts) - 1)]
            # 自己交差
            if "selfIntersection" in enabled:
                for a in range(len(segs)):
                    for b in range(a + 1, len(segs)):
                        if b == a + 1:
                            continue
                        if seg_proper_intersect(*segs[a], *segs[b]):
                            errors.append(
                                f"terrain.json presets.{name} c{ci}: 自己交差 "
                                f"(seg{a} x seg{b})"
                            )
        # 相互交差・最小距離・標高の単調性
        for i in range(len(contours)):
            for j in range(i + 1, len(contours)):
                A = contours[i].get("points", [])
                B = contours[j].get("points", [])
                if not A or not B:
                    continue
                ei, ej = contours[i].get("elevation"), contours[j].get("elevation")
                wi = contours[i].get("width", 1)
                wj = contours[j].get("width", 1)
                worst = float("inf")
                crossed = False
                for k in range(len(A) - 1):
                    for l in range(len(B) - 1):
                        if seg_proper_intersect(A[k], A[k + 1], B[l], B[l + 1]):
                            crossed = True
                        worst = min(
                            worst,
                            seg_seg_dist(A[k], A[k + 1], B[l], B[l + 1]),
                        )
                if crossed:
                    errors.append(
                        f"terrain.json presets.{name} c{i} x c{j}: 等高線が交差している"
                    )
                elif "minSeparation" in enabled and worst < min_sep:
                    errors.append(
                        f"terrain.json presets.{name} c{i}(elev {ei}) x c{j}(elev {ej}): "
                        f"最小距離 {worst:.4f} < {min_sep}（ブラシ幅 {wi}/{wj} セル、"
                        f"最小グリッド {min_grid}² で換算）"
                    )
        # 標高の単調性（同じプリセット内で、中間標高が最外殻と最高峰の間にあるか）
        if "elevationOrdering" in enabled and len(contours) >= 3:
            elevs = [c.get("elevation") for c in contours]
            lo_e, hi_e = min(elevs), max(elevs)
            for ci, c in enumerate(contours):
                e = c.get("elevation")
                if e not in (lo_e, hi_e) and not (lo_e <= e <= hi_e):
                    errors.append(
                        f"terrain.json presets.{name} c{ci}: 標高 {e} が "
                        f"[{lo_e}, {hi_e}] の範囲外（標高の単調性違反）"
                    )
        # 閉ループの入れ子検査
        # 実地形と同じ規則: 入れ子の閉等高線は「内側ほど高い（山）」か
        # 「内側ほど低い（盆地・火口）」のどちらか。同一の親の中で両方が混ざる
        # 場合は実地形でも稀（火山のカルデラなど）なので警告。標高が等しい
        # 入れ子は縮退しているのでエラー。
        if "elevationOrdering" in enabled:
            closed = [
                (ci, c) for ci, c in enumerate(contours)
                if c.get("points") and c["points"][0] == c["points"][-1]
            ]
            for i, (ci, ca) in enumerate(closed):
                for cj, cb in closed[i + 1:]:
                    ea, eb = ca.get("elevation"), cb.get("elevation")
                    a_in_b = point_in_poly(ca["points"][0], cb["points"])
                    b_in_a = point_in_poly(cb["points"][0], ca["points"])
                    if a_in_b or b_in_a:
                        outer_e, inner_e = (eb, ea) if a_in_b else (ea, eb)
                        if inner_e == outer_e:
                            errors.append(
                                f"terrain.json presets.{name}: 入れ子の等高線の標高が等しい "
                                f"({outer_e})。縮退している（山か盆地か判別できない）"
                            )
            # 同一の親の中で「内側が高い」と「内側が低い」が混ざる場合は警告
            for ci, c in closed:
                children = []
                for cj, cb in closed:
                    if cj == ci:
                        continue
                    if point_in_poly(cb["points"][0], c["points"]):
                        children.append(cb.get("elevation"))
                if children:
                    ce = c.get("elevation")
                    higher = [e for e in children if e > ce]
                    lower = [e for e in children if e < ce]
                    if higher and lower:
                        warnings.append(
                            f"terrain.json presets.{name} c{ci}(elev {ce}): 内側に "
                            f"高い等高線 {higher} と低い等高線 {lower} が混在。"
                            f"山と盆地が同居する（カルデラ型）。意図的か確認を"
                        )


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

    # 4.5. 等高線の幾何検証（terrain.json）
    geo_spec = spec.get("files", {}).get("terrain.json", {}).get("contourGeometry", {})
    if geo_spec.get("enabled"):
        check_terrain_geometry(geo_spec, docs, errors, warnings)

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
                if ref.get("type") == "prefix":
                    # 'climate.json precip.calibration' → 先頭のファイル名を検査
                    head = str(v).split("（")[0].split(" ")[0]
                    if head not in valid:
                        msg = (
                            f"{from_file}#{from_path}[{key}]: '{v}' のファイル部分 "
                            f"'{head}' は data/ に存在しない"
                        )
                        (warnings if severity == "warning" else errors).append(msg)
                    continue
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
