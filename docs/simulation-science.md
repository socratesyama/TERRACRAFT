# シミュレーションの科学 — モデルと出典

この文書は、TERRA CRAFT の各シミュレーション層が**どの科学的モデルに基づいているか**を整理したものです。
数値そのものは `data/` の各 JSON に、実装仕様は `docs/implementation-plan.md` にあります。

## 水 — 水文学

- **流路の決定（D8 + Priority-Flood）**: 各セルから最も低い隣接セルへ流す D8 法と、窪地を epsilon 版 Priority-Flood で充填する方式（Barnes et al. 2014）。これにより、どんな地形でもすべての水が出口へ到達する
- **流量累積**: 上流から順に流出を加算。保存則（出口の流量の総和 = 全流出量）が厳密に成り立つ
- **浸透と流出**: SCS Curve Number 法（USDA TR-55）の簡略化。森林ほど地表流出が減る
- **川の定義**: 流量が閾値（流域面積 約10 km²）を超えるセルを川として描画

## 地形の変化 — 侵食地形学

- **河川侵食（Stream Power Law）**: 侵食速度 E = K·A^m·S^n。m/n ≈ 0.5 は侵食地形学の標準値（Whipple & Tucker 1999）。n=1 の陰的解法（Braun & Willett 2013）で時間刻みに依存せず安定に解く
- **土砂輸送**: 運搬能力 ∝ A^0.5 × 勾配。超過分が堆積し、河口で勾配が落ちるため三角州が自然にできる
- **斜面崩壊**: 安息角（乾燥35°・飽和22°）を超えた斜面が緩む。土砂災害の物理
- **植生の保護**: 根による土壌保持で侵食係数が最大80%減る（USLE の被覆係数 C に対応）

## 気候 — 気象学

- **気温**: 標準大気の気温減率 6.5 K/km、緯度勾配、海の熱容量による緩和（比熱の差 4.18 vs ~1 kJ/kgK）、植生の蒸散冷却
- **降水（地形性降雨）**: 風上の縁から空気塊を運び、上昇冷却で凝結、風下で乾く——雨陰の再現（Roe 2005）。山脈1本で風上と風下の降水量が数倍〜10倍違う
- **水分**: 降水量と水域までの距離から決まる

## 生態系 — 植物地理学

- **バイオーム分類**: Whittaker (1975) の気候空間（年平均気温 × 年降水量）。ツンドラ・亜寒帯林・温帯林・草原・砂漠・サバンナ・熱帯雨林の境界は実測に基づく
- **植生の成長**: ロジスティック成長 + 種子散布。環境収容力は水分・日照・気温から決まる
- **NPP（純一次生産量）**: 熱帯雨林 ~2000、温帯林 ~1200、草原 ~600、砂漠 ~90 g/m²/年（Lieth 1972 の世界平均値）

## 動物の移動 — 動物行動学・生態学

- **行動圏のアロメトリー**: H = a·M^b（Harestad & Bunnell 1979）。草食動物は H ∝ M^1.02、肉食動物は H ∝ M^1.36——肉食動物の行動圏がはるかに大きいのは獲物密度が低いため
- **日中移動距離**: D ∝ M^0.25（Jetz et al. 2004）。大型動物ほど行動圏を横断する割合が小さい
- **移動の選択**: least-cost 経路（植生・水分・傾斜のコスト）で生息地を選ぶ
- **季節移動**: トナカイ・ワピチ型の altitudinal / longDistance 移動。雪と牧草の季節変化に駆動される
- **個体数動態**: 捕食者−被捕食者の Lotka–Volterra 振動、エネルギー・ピラミッド（栄養段階間の転換効率 ~10%、Lindeman 1942）

## 経済 — 経済学

- **生産と人口**: マルサス的動態（人口は食料で頭打ち）+ ボセラップの農業集約化
- **貿易**: 重力モデル（貿易量 ∝ 経済規模の積 / 距離）。輸送コストは海運が陸運の約1/10（Glaeser & Kohlhase 2004）——港町が栄える物理的根拠
- **開発指標（DI）**: 8指標の加重平均（食料自給率・森林率・貿易収支・都市化率・技術・教育・医療・持続可能性）

## 戦争 — 軍事学

- **戦闘の解決**: Lanchester の2乗法則（1916）。兵力差が2乗で効くため、少数精鋭 vs 大軍の非対称性が再現される
- **地形の防御効果**: 攻撃側は防御側の3倍の戦力が必要（3:1ルール、Dupuy 1987 / RAND 1992）。山岳2.2倍・森林1.4倍・都市2.5倍・渡河0.4倍
- **兵站**: 補給線が伸びるほど戦闘力が減衰。遠征の限界
- **戦争の終結**: 戦争疲弊が閾値を超えると講和。占領地の統治コストが膨らむ

## 地質と土壌 — 土壌学

- **岩種の侵食抵抗**: 花崗岩 < 砂岩 < 石灰岩 < 頁岩 < 火山灰（Selby 1993 の相対抵抗度）
- **土壌肥沃度**: チェルノーゼム（黒土）0.95、ラテライト0.25 など、バイオームごとの代表値
- **USLE**: A = R·K·LS·C·P（Wischmeier & Smith 1978）。被覆係数 C は森林0.01〜裸地1.0

## 出典一覧（一次文献）

- Barnes, R., Lehman, C., & Mulla, D. (2014). Priority-flood: An optimal depression-filling and watershed-labeling algorithm. Computers & Geosciences 62.
- Whipple, K. & Tucker, G. (1999). Dynamics of the stream-power river incision model. J. Geophys. Res. 104.
- Braun, J. & Willett, S. (2013). A very efficient O(n), implicit and parallel method to solve the stream power equation. J. Geophys. Res. 118.
- Roe, G. (2005). Orographic precipitation. Annual Review of Earth and Planetary Sciences 33.
- Whittaker, R. (1975). Communities and Ecosystems. Macmillan.
- Lieth, H. (1972). Modeling the primary productivity of the world. Nature and Resources 8.
- Körner, C. (1998). A re-assessment of high elevation treeline positions. Oecologia 115.
- Harestad, A. & Bunnell, F. (1979). Home range and body weight — a reevaluation. Ecology 60.
- Jetz, W. et al. (2004). The day-range concept. Science 306.
- Lindeman, R. (1942). The trophic-dynamic aspect of ecology. Ecology 23.
- Elton, C. & Nicholson, M. (1942). The ten-year cycle in numbers of the lynx in Canada. J. Anim. Ecol. 11.
- Wischmeier, W. & Smith, D. (1978). Predicting Rainfall Erosion Losses. USDA Agriculture Handbook 537.
- Selby, M. (1993). Hillslope Materials and Processes. Oxford University Press.
- USDA (1986). Urban Hydrology for Small Watersheds, TR-55.
- Glaeser, E. & Kohlhase, J. (2004). Cities, regions and the decline of transport costs. Papers in Regional Science 83.
- Boserup, E. (1965). The Conditions of Agricultural Growth. Aldine.
- Christaller, W. (1933). Die zentralen Orte in Süddeutschland.
- Lanchester, F. (1916). Aircraft in Warfare: The Dawn of the Fourth Arm.
- Dupuy, T. (1987). Understanding War: History and Theory of Combat. / RAND (1992) の3:1ルールの検証
- Gutenberg, B. & Richter, C. (1942). Earthquake magnitude, energy, intensity, and duration. BSSA 32.
