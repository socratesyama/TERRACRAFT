# TERRA CRAFT — 科学データコレクション

地形シミュレーション作品 **TERRA CRAFT** のための、科学的・生物学的・経済学的・軍事学的データ集です。

水や自然の動きは化学・科学的に、人や動物の移動は生態学・行動学的に、経済は経済学的に正確であることを目指し、
**「地形が違うだけで、こんなにも世界が変わる」** を実感できるシミュレーションの基盤となる数値を、
単位つき・出典つき・操作しやすい JSON として集めています。

実装本体は `docs/implementation-plan.md`（詳細実装計画）に従って別途行います。

## ディレクトリ構成

```
data/                        # 科学データ（本リポジトリの本体）
  scale.json                 # 世界の物理スケール（グリッド・時間）
  terrain.json               # 地形生成とプリセット3世界
  hydrology.json             # 水文・侵食の物理定数
  climate.json               # 気候（気温・地形性降雨・雨陰）
  ecology-biomes.json        # 生態系（バイオーム・植生）
  biology-movement.json      # 動物の行動圏・移動・種テーブル
  geology-soils.json         # 地質・土壌（岩種・肥沃度・USLE）
  settlements.json           # 集落・文明（適性・成長・道路）
  disasters.json             # 災害（洪水・干ばつ・地震・山火事）
  economy.json               # 経済（生産・貿易・価格・開発指標）
  war.json                   # 戦争（Lanchester・地形防御・兵站）
  nations.json               # 国家AI（性格・領土・神アルゴリズム）
  scenarios.json             # 比較実験用シナリオ（雨陰・大河・交易路など）
  feedback.json              # 層をまたぐ因果ループ（雨陰→農業→人口→戦争）
  events.json                # 外生イベント（火山・疫病・技術革新・気候変動）
  policy.json                # 国家政策（灌漑・備蓄・軍事費・治水）
  observables.json           # 検証可能な観測指標（人口・食料・貿易・戦争）
  demography.json            # 人口の年齢構成と動態（コーホート・出生・死亡・移住）
  technology.json            # 技術ツリー（4元素→採掘・戦争→農業・交易→法・遺産）
  energy.json                # エネルギーと原動力（人力・家畜・薪・水車・風車）
  ocean.json                 # 海上の物理（漁場・塩・航海・島嶼生物地理）
  culture.json               # 文化・宗教・正統性・反乱（戦争判断の「心」の層）
  resources.json             # 資源の分布と採掘（鉱床・枯渇・戦略資源）
  law-governance.json        # 法・税・官僚制・国家能力（制度の層）
  naming.json                # 手続き的な命名規則（地名・国名・神話）
  sensitivity.json           # 感度分析の実験定義（どのパラメータに敏感か）
  validation.json            # data/ 全体の検証ルール（単位・範囲・参照整合性）
scripts/
  validate.py                # validation.json に従って data/ を機械検証するスクリプト
docs/
  implementation-plan.md     # 詳細実装計画（全文）
  data-catalog.md            # データカタログ（設計原則・単位の慣行）
  simulation-science.md      # シミュレーションの科学（モデルと出典）
  world-design.md            # 世界設計（ショーケース世界・因果の連鎖）
```

## 使い方

`data/` の JSON は自己文書化されています。各フィールドの `_doc` に日本語の説明があり、
`sources` に一次文献が出ています。**JSON を書き換えるだけでシミュレーションの挙動が変わる**よう、
数値はすべて `data/` に集約する方針です。

JSON を書き換えたら、検証スクリプトを通してください:

```bash
python3 scripts/validate.py
```

`data/validation.json` の定義に従い、必須キー・単位・範囲・参照整合性
（シナリオが参照する地形プリセットや指標が実在するかなど）を機械的に検査します。

## 主要な科学モデル

| 層 | モデル | 出典 |
| --- | --- | --- |
| 水文 | Priority-Flood + D8 + 流量累積 | Barnes et al. 2014 |
| 侵食 | Stream Power Law（陰的解法）+ 土砂輸送 | Whipple & Tucker 1999; Braun & Willett 2013 |
| 気候 | 地形性降雨・雨陰・気温減率 | Roe 2005 |
| 生態系 | Whittaker のバイオーム気候空間 | Whittaker 1975 |
| 動物 | 行動圏アロメトリー・least-cost 移動 | Harestad & Bunnell 1979; Jetz et al. 2004 |
| 経済 | 重力モデル貿易・マルサス動態 | Glaeser & Kohlhase 2004; Malthus 1798 |
| 戦争 | Lanchester 2乗法則・3:1ルール | Lanchester 1916; RAND 1992 |

詳細は [docs/simulation-science.md](docs/simulation-science.md) と [docs/data-catalog.md](docs/data-catalog.md) を参照してください。
