# TERRA CRAFT 科学データカタログ

シミュレーションに使う科学的・生物学的・経済学的・軍事学的な定数を、
**単位つき・出典つき・操作しやすい JSON** として集めたものです。
すべての値は「出発点」であり、実測と見た目で調整します。

## ファイル一覧

| ファイル | 対象 | 主な出典 |
| --- | --- | --- |
| `scale.json` | 世界の物理スケール（グリッド・セルサイズ・時間） | 計画書 §4.1 |
| `terrain.json` | 地形生成（ラスタライズ、緩和、ridged fBm、プリセット3世界） | 計画書 §4.3; Musgrave et al. 1989 |
| `hydrology.json` | 水文・侵食（浸透、Priority-Flood、Stream Power、土砂輸送、安息角） | Barnes et al. 2014; Whipple & Tucker 1999; Braun & Willett 2013; USDA TR-55 |
| `climate.json` | 気候（気温減率、地形性降雨、雨陰、アルベド、海の緩和） | Roe 2005; 標準大気 |
| `ecology-biomes.json` | 生態系（Whittaker のバイオーム気候空間、NPP、植生ダイミクス） | Whittaker 1975; Lieth 1972; Körner 1998 |
| `biology-movement.json` | 動物と人の移動（行動圏アロメトリー、種テーブル、捕食関係） | Harestad & Bunnell 1979; Jetz et al. 2004; Elton & Nicholson 1942; Lindeman 1942 |
| `geology-soils.json` | 地質・土壌（岩種の侵食係数、土壌肥沃度、USLE） | Wischmeier & Smith 1978; Selby 1993 |
| `settlements.json` | 集落・文明（適性、発生、成長、道路、移住） | 計画書 §8; Christaller 1933 |
| `disasters.json` | 災害（洪水、干ばつ、土砂災害、山火事、地震、嵐） | 計画書 §8.5; Gutenberg–Richter 1942 |
| `economy.json` | 経済（生業密度、収量、輸送コスト、重力モデル、価格、マルサス動態、DI重み） | Glaeser & Kohlhase 2004; Boserup 1965; Malthus 1798 |
| `war.json` | 戦争（Lanchester 2乗法則、3:1ルール、地形補正、兵站、戦争疲弊） | Lanchester 1916; Dupuy 1987; RAND 1992 |
| `nations.json` | 国家（神アルゴリズム、AI性格、国境コスト、災害確率） | 計画書 §21〜22 |

## 設計原則

1. **単位を必ず書く**（`"unit"` または `_doc` フィールド）。セル単位と実単位（m, km, kg, K, mm/年）の変換は実装側で一括して行う
2. **出典を必ず書く**（`"sources"` フィールド）。教育への展開を考え、根拠は文献名つきで残す
3. **1つの値が1つの意味を持つ**。派生値はシミュレーション側で計算する
4. **`_doc` フィールドに日本語の説明を書く**。JSON なのでコメントの代わり
5. **しきい値付近のちらつき**はヒステリシス（±0.03程度）で防ぐ設計を前提とした数値にしている

## 単位の慣行

- **降水量**: mm/年（`climate.json` の `precip.calibration` で生の湿度単位から較正）
- **流出・流量**: m/年。`flowAcc` はこの単位で累積し、`hydrology.json` の `river.flowThreshold` と揃う
- **標高**: 正規化0〜1（`scale.json` の `maxElevation` で実メートルに換算）
- **時間**: 1 tick = 1年
- **距離**: セル（`cellSize` = 500 m）と実単位を併記

## 読み方（実装側）

実装は `docs/implementation-plan.md` の計画に従い、`data/` の JSON を
型付きで import して定数オブジェクトとして使う。
**JSON を書き換えるだけで、水の動き・森の成長・経済・戦争の挙動が変わる**ように、
数値はすべてこのディレクトリに集約する（実装コードにマジックナンバーを置かない）。
