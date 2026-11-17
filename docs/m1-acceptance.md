# M1 受け入れ手順（地形と水）

## 自動確認（`npm test` / `tests/m1.test.ts`）
- 3プリセット（island / mountainRange / basin）で、同じ seed を2回作ると World と派生配列のハッシュが一致する。
- seed が違えば地形が変わる。標高は [0,1]、降水は有限で非負。
- 流量累積は流下方向に単調非減少。描画パックは size²×4 float。
- mountainRange で風上斜面の平均降水 > 風下斜面（雨陰）。
- Worker の init で描画パックのスナップショットが届く。未知のシナリオは error。

## サンドボックスでの数値確認（npm なしのため vitest は未実行）
192² / seed = scenarios.comparison.defaultSeed、Node で直接実行:
| シナリオ | 生成 ms | 決定性 | 風上平均 mm | 風下平均 mm |
|---|---|---|---|---|
| island | 199 | 一致 | 188 | 120 |
| mountainRange | 124 | 一致 | 176 | 135 |
| basin | 122 | 一致 | 1883 | 1229 |

## 目視手順（ブラウザ）
1. `npm run dev` → 右の「地形プリセット」で3種を切り替える。
2. レイヤー「降水」で、風上側が青く、山脈の風下が砂色（雨陰）になることを確認。
3. basin に湖、川（青線）が谷に沿って見えること。

## 未検証
- 実ブラウザでの描画（このサンドボックスにはブラウザ検証の経路がなく未確認）。
- npm install / vite build / vitest（レジストリ不達。依存のバージョンは記憶に基づく）。
