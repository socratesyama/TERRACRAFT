# TERRA CRAFT — 科学データコレクション

地形シミュレーション作品 **TERRA CRAFT** のための、科学的・生物学的・経済学的・軍事学的データ集です。

水や自然の動きは化学・科学的に、人や動物の移動は生態学・行動学的に、経済は経済学的に正確であることを目指し、
**「地形が違うだけで、こんなにも世界が変わる」** を実感できるシミュレーションの基盤となる数値を、
単位つき・出典つき・操作しやすい JSON として集めています。

## 遊び方

山を盛り、雨を降らせると、川・森・町・国が生まれます。地形が気候を決め、気候が植生を決め、植生が集落と経済を決め、経済が戦争を決めます。

1. 初回の画面で **「デモを再生（30 秒）」**、または **「地形を描いて始める」** を選びます。
2. 等高線を描くと、その線の高さを通る地形ができます（線の高さは「海・湖／海岸／低地／丘／山／高山」から選択）。始点の近くで終えると線が閉じます。
3. 「豪雨」で雨を降らせ、再生（1x / 4x / 16x）で時間を進めます。レイヤー（地形・降水・気温・水分・バイオーム・植生・洪水・国・防御・変化・侵食）で、原因と結果を見比べます。
4. 国家モードでは、4 か国（自国 + AI 3）が交易・外交・戦争をします。地形が違えば、国の運命が変わります。
5. 「共有・保存」で URL をコピーすると、同じ世界を他の人が開けます（世界の配列は保存せず、入力だけを保存。決定論的に再生）。

| 操作 | キー / ジェスチャ |
| --- | --- |
| 再生・停止 | Space |
| ツール切り替え | 1〜9 |
| 元に戻す / やり直す | Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y） |
| カメラ | ドラッグで回転、ホイールで拡大縮小、右ドラッグでパン |
| スマホ | 1 本指でツール（描く）、2 本指でカメラ。パネルは下のシート |

## 開発

```bash
npm install
npm run dev        # 開発サーバー
npm test           # vitest
npm run build      # 型検査 + ビルド
python3 scripts/validate.py   # data/ の検証（0 エラー / 0 警告にする）
```

- **数値は全部 `data/*.json`**。JSON を書き換えるだけで挙動が変わります（コードに定数を置かない）。
- TypeScript + Vite、UI は React、UI 状態だけ Zustand、3D は素の Three.js、シミュレーションは Web Worker（`new Worker(new URL(..., import.meta.url))`）。依存は完全固定（`^` なし）。
- 決定論: seed 付き PRNG のみ（`Math.random` は使わない）。同じ seed と同じ操作で同じ世界になります。
- 性能: 1 tick 33 ms の予算、スナップショットは 10 Hz 以下、バッファプール + 背圧。描画が間に合わないときは高速モードで間引きます。
- デプロイ: Cloudflare Pages（`docs/deploy.md`）。
- タッチ端末は標準グリッドを 128² にし、DPR を制限します（`data/runtime.json`）。

## 実装の状況

`docs/mN-acceptance.md` に、各マイルストーンの受け入れ記録（できたこと・計画書との食い違い・未検証）があります。

| 記録 | 内容 |
| --- | --- |
| M0〜M3 | 足場、地形、水文、気候、植生、集落、災害、因果ログ |
| M4〜M5 | 国家・領土・経済・貿易・外交・戦争 |
| M6・M7 | 禁輸・食料輸入依存・ダム破壊・バランス統計 |
| M8 | URL 共有・自動保存 |
| M9 | モバイル対応・30 秒デモ・初回の入口 |
| M10 | 侵食エンジン・侵食レイヤー |
| M11 | 等高線を描いて始める |
| M12 | ショートカット・セル情報 |

**注意（正直な未検証）**: この開発環境には npm のネットワークが無く、React / Three.js の UI、`npm run build`、本物の vitest、ブラウザ描画は未実行です。`src/core`・`src/worker` は型検査と互換シムでのテスト（m1〜m12）を通しています。


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
  runtime.json               # 実行・性能・描画の運用定数（tick予算・スナップショット頻度など）
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
