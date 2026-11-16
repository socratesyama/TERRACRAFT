# data/ — 科学データ

シミュレーションに使う定数の JSON 集。設計原則・単位の慣行・ファイル一覧は
[docs/data-catalog.md](../docs/data-catalog.md) を、
各モデルの科学的根拠は [docs/simulation-science.md](../docs/simulation-science.md) を参照してください。

- すべての JSON は `_doc`（日本語の説明）と `sources`（一次文献）を持ちます
- 単位の慣行: 降水量 mm/年、流出・流量 m/年、標高 0〜1 正規化、1 tick = 1年、距離はセル（500 m）
- 数値はすべてこのディレクトリに集約し、実装コードにはマジックナンバーを置かない
