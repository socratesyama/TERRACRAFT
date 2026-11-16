#!/usr/bin/env python3
"""等高線の即時チェックツール。

terrain.json を直接編集して等高線を描くときのための簡易検証。
データ全体の検証 (scripts/validate.py) と同じ基準で、指定プリセットの
等高線だけを詳しく報告する。

使い方:
  python3 scripts/check-contours.py                    # data/terrain.json の全プリセット
  python3 scripts/check-contours.py data/terrain.json  # ファイルを指定
  python3 scripts/check-contours.py --preset mountainRange
  python3 scripts/check-contours.py my-terrain.json    # presets 形式でない単体ファイルも可

単体ファイルは次のどの形でもよい:
  - {"contours": [...], "elevationMax": 1.0, ...}   (プリセット1個ぶん)
  - {"presets": {"name": {...}, ...}}                (terrain.json 形式)
  - [ {...}, {...} ]                                  (等高線のリスト)

基準 (terrain.json の contourRules があればそれを使う。なければ既定値):
  bounds [0,1] / 最小頂点間隔 0.02 / 最小等高線間距離 0.04
"""

import json
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from validate import point_in_poly, pt_seg_dist, seg_proper_intersect, seg_seg_dist  # noqa: E402

DEFAULT_SPEC = {
    "enabled": True,
    "bounds": [0, 1],
    "minSeparationNormalized": 0.04,
    "minVertexSpacing": 0.02,
}


def value_of(rule):
    """terrain.json の contourRules は {"value": 0.04, "_doc": ...} 形式。
    validation.json 由来ならそのままの値。どちらも扱えるように正規化する。"""
    if isinstance(rule, dict):
        if "min" in rule and "max" in rule:
            return [rule["min"], rule["max"]]
        if "value" in rule:
            return rule["value"]
    return rule


def normalize_rules(rules):
    return {
        "bounds": value_of(rules.get("bounds", DEFAULT_SPEC["bounds"])),
        "minSeparationNormalized": value_of(
            rules.get("minSeparationNormalized", DEFAULT_SPEC["minSeparationNormalized"])
        ),
        "minVertexSpacing": value_of(
            rules.get("minVertexSpacing", DEFAULT_SPEC["minVertexSpacing"])
        ),
    }


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def grid_sizes():
    """最小グリッドを scale.json から読む。読めなければ既定値。"""
    try:
        scale = load(Path(__file__).parent.parent / "data" / "scale.json")
        return scale["grid"]["sizes"]
    except Exception:
        return [128, 192, 256]


def contour_length(pts):
    return sum(
        math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1])
        for i in range(len(pts) - 1)
    )


def analyze(name, preset, rules, grid):
    """プリセット1個の詳細分析。エラーのリストを返す。"""
    lo, hi = rules["bounds"]
    min_sep = rules["minSeparationNormalized"]
    min_v = rules["minVertexSpacing"]
    errors = []

    contours = preset.get("contours", [])
    print(f"\n=== {name} ({len(contours)} 本) ===")

    closed = {}
    elev = {}
    for idx, c in enumerate(contours):
        tag = f"c{idx}"
        pts = c.get("points", [])
        elev[tag] = c.get("elevation", 0)
        closed[tag] = pts and pts[0] == pts[-1]
        kind = "閉ループ" if closed[tag] else "開いた線"
        print(
            f"  {tag}: 標高{elev[tag]:.2f} 幅{c.get('width', 1)} "
            f"{kind} {len(pts)}頂点 長さ{contour_length(pts):.2f}"
        )
        for vi, p in enumerate(pts):
            if not (lo <= p[0] <= hi and lo <= p[1] <= hi):
                errors.append(f"{tag} 頂点{vi} {p}: 範囲 [{lo},{hi}] 外")
        for vi in range(len(pts) - 1):
            d = seg_seg_dist(pts[vi], pts[vi], pts[vi + 1], pts[vi + 1])
            if d < min_v:
                errors.append(f"{tag} 頂点{vi}-{vi+1}: 間隔 {d:.4f} < {min_v}")

    # 自己交差
    for idx, c in enumerate(contours):
        tag = f"c{idx}"
        pts = c["points"]
        n = len(pts) - 1
        for i in range(n):
            for j in range(i + 1, n):
                if j == i + 1 or (i == 0 and j == n - 1):
                    continue
                if seg_proper_intersect(pts[i], pts[i + 1], pts[j], pts[j + 1]):
                    errors.append(f"{tag}: 自分自身と交差 (区間{i} x 区間{j})")

    # ペア距離と交差
    print("  ペア距離 (閾値 {:.2f}):".format(min_sep))
    for a in range(len(contours)):
        for b in range(a + 1, len(contours)):
            pa, pb = contours[a]["points"], contours[b]["points"]
            d = seg_seg_dist(pa[0], pa[-1], pb[0], pb[-1])  # placeholder
            d = min(
                seg_seg_dist(pa[i], pa[i + 1], pb[j], pb[j + 1])
                for i in range(len(pa) - 1)
                for j in range(len(pb) - 1)
            )
            cross = any(
                seg_proper_intersect(pa[i], pa[i + 1], pb[j], pb[j + 1])
                for i in range(len(pa) - 1)
                for j in range(len(pb) - 1)
            )
            ta, tb = f"c{a}", f"c{b}"
            if cross:
                errors.append(f"{ta} x {tb}: 交差している")
                print(f"    {ta} x {tb}: 交差 (最小距離 {d:.4f}) → 修正が必要")
            elif d < min_sep:
                errors.append(f"{ta}({elev[ta]}) x {tb}({elev[tb]}): 最小距離 {d:.4f} < {min_sep}")
                print(f"    {ta} x {tb}: {d:.4f} → 近すぎる")
            else:
                print(f"    {ta} x {tb}: {d:.4f} → OK")

    # 入れ子と標高順序
    for a in range(len(contours)):
        for b in range(len(contours)):
            if a == b:
                continue
            ta, tb = f"c{a}", f"c{b}"
            if not closed[ta] or not closed[tb]:
                continue
            inside = all(point_in_poly(p, contours[a]["points"]) for p in contours[b]["points"][:-1])
            if inside:
                rel = "山（内側ほど高い）" if elev[tb] > elev[ta] else ("盆地（内側ほど低い）" if elev[tb] < elev[ta] else "⚠ 標高が等しい（縮退）")
                print(f"  入れ子: {ta} ⊃ {tb} → {rel}")
                if elev[ta] == elev[tb]:
                    errors.append(f"{ta} ⊃ {tb}: 同じ標高の入れ子（中間の標高が消える）")

    if errors:
        print(f"  判定: NG ({len(errors)} 件)")
        for e in errors:
            print(f"    - {e}")
    else:
        print("  判定: OK")
    return errors


def main():
    args = [a for a in sys.argv[1:]]
    preset_filter = None
    if "--preset" in args:
        i = args.index("--preset")
        preset_filter = args[i + 1]
        args = args[:i] + args[i + 2:]

    path = Path(args[0]) if args else Path(__file__).parent.parent / "data" / "terrain.json"
    doc = load(path)

    # 形式を判定して {name: preset} に揃える
    if "presets" in doc:
        presets = doc["presets"]
        rules = normalize_rules(doc.get("contourRules", DEFAULT_SPEC))
    elif "contours" in doc:
        presets = {path.stem: doc}
        rules = normalize_rules(DEFAULT_SPEC)
    elif isinstance(doc, list):
        presets = {path.stem: {"contours": doc}}
        rules = normalize_rules(DEFAULT_SPEC)
    else:
        print(f"{path}: 等高線が見つかりません (contours / presets が必要)")
        return 1

    if preset_filter and preset_filter not in presets:
        print(f"プリセット '{preset_filter}' が見つかりません。候補: {', '.join(presets)}")
        return 1

    grid = grid_sizes()
    print(f"ファイル: {path}")
    print(f"基準: 範囲{rules['bounds']} 最小距離{rules['minSeparationNormalized']} 最小頂点間隔{rules['minVertexSpacing']} グリッド{grid}")

    total = 0
    for name, preset in presets.items():
        if name.startswith("_") or not isinstance(preset, dict):
            continue  # _doc などのメタ情報は読み飛ばす
        if preset_filter and name != preset_filter:
            continue
        total += len(analyze(name, preset, rules, grid))

    print(f"\n合計: {total} 件の問題")
    if total:
        print("修正するか、等高線を引き直してください。")
        return 1
    print("すべての等高線が基準を満たしています。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
