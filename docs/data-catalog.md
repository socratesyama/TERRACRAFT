# TERRA CRAFT 科学データカタログ

シミュレーションに使う科学的・生物学的・経済学的・軍事学的な定数を、
**単位つき・出典つき・操作しやすい JSON** として集めたものです。
すべての値は「出発点」であり、実測と見た目で調整します。

## ファイル一覧

| ファイル | 対象 | 主な出典 |
| --- | --- | --- |
| `scale.json` | 世界の物理スケール（グリッド・セルサイズ・時間） | 計画書 §4.1 |
| `terrain.json` | 地形生成（ラスタライズ、緩和、ridged fBm、プリセット3世界、等高線の幾何制約 contourRules） | 計画書 §4.3; Musgrave et al. 1989 |
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
| `scenarios.json` | 比較実験用シナリオ（目的・初期条件・期待因果・評価指標つきの7世界） | Diamond 1997; Wittfogel 1957; MacArthur & Wilson 1967 |
| `feedback.json` | 層をまたぐ因果ループ（雨陰→農業、氾濫→肥沃度、飢饉→移住→戦争 など10本） | Roe 2005; Boserup 1965; Jacobsen & Adams 1958 |
| `events.json` | 外生イベント（火山噴火、疫病、技術革新、移住の波、気候変動、黄金時代） | McNeill 1976; Oppenheimer 2003 |
| `policy.json` | 国家政策（灌漑、森林保護、備蓄、軍事費、道路・港、検疫、交易奨励、治水） | Boserup 1965; Wittfogel 1957 |
| `observables.json` | 検証可能な観測指標（人口・食料・貿易・戦争など約45種、単位と集計法つき） | 計画書 §22.11 |
| `validation.json` | data/ 全体の検証ルール（必須キー・単位・範囲・参照整合性） | 本ドキュメントの設計原則 |
| `demography.json` | 人口の年齢構成と動態（5歳コーホート、Coale-Demeny 生命表、出生・死亡・都市化・移住） | Coale & Demeny 1983; Coale & Trussell 1974; Todaro 1969 |
| `technology.json` | 技術ツリー（4元素→採掘・戦争→農業・交易→宗教・経済→法・遺産）と研究・拡散 | Diamond 1997; Mokyr 1990 |
| `energy.json` | エネルギーと原動力（人力75W、馬1馬力、薪1.5m³/人/年、水車2kW、帆船100t） | Smil 1994; Reynolds 1983 |
| `ocean.json` | 海上の物理（漁場・塩・航海の季節・海運コスト、島嶼生物地理） | MacArthur & Wilson 1967; Kurlansky 2002 |
| `culture.json` | 文化・宗教・正統性・同化・反乱（戦争判断の「心」の層） | Weber 1919; Anderson 1983; Tilly 1992 |
| `resources.json` | 資源の分布と採掘（銅・錫・鉄・金・岩塩の鉱床率と枯渇、再生資源の持続収穫） | Pomeranz 2000; Craddock 1995 |
| `law-governance.json` | 法・税・官僚制・国家能力（ラッファー曲線、情報伝達限界、征服地統治） | Weber 1922; Tilly 1992; Finer 1997 |
| `naming.json` | 手続き的な命名規則（地形からの地名生成、国名・神名・王朝名） | 楠原 1998; 山田 1936 |
| `sensitivity.json` | 感度分析の実験定義（OAT法、8実験+ペア分析、トルネード図の出力） | Saltelli et al. 2008; ten Broeke et al. 2016 |

## 検証

`scripts/validate.py` が `data/validation.json` のルールに従って `data/` 全体を検査します。

```bash
python3 scripts/validate.py      # エラーは exit 1、警告も見るなら -v
```

- **必須キー**: 各ファイルに requiredKeys が揃っているか
- **単位・範囲**: 気温減率・降水量較正・収量・増加率などの重要数値が単位つきで範囲内か
- **参照整合性**: シナリオの地形プリセット・バイオーム・評価指標、政策の効果先、
  イベントが呼ぶ災害などが、参照先ファイルに実在するか
- **等高線の幾何**（terrain.json の contourRules）: 等高線の自己交差・相互交差・
  過度の近接（ブラシ幅の換算）・頂点の範囲外・頂点間隔・入れ子の標高の縮退を検査

JSON を書き換えたら必ずこの検証を通してからコミットしてください。

等高線を手描きするときは [docs/contour-guide.md](contour-guide.md)（描き方の作法）
と `python3 scripts/check-contours.py`（1プリセットずつの詳細チェック）を参照。

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
