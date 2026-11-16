# M0 受入確認の手順

M0（足場）の確認手順。手元で次を順に実行する。

```bash
npm install            # 初回のみ。package-lock.json が生成される（コミットして固定する）
npm run typecheck
npm run lint
npm test
npm run validate:data  # python3 scripts/validate.py → 0 エラー / 0 警告
npm run build
npm run dev            # http://localhost:5173
```

## 自動で確かめること

| 項目 | テスト |
| --- | --- |
| 同じ seed でPRNG列が一致（ゴールデン値） | `tests/prng.test.ts` |
| ハッシュが既知のFNV-1a値と一致、量子化・NaN の扱い | `tests/hash.test.ts` |
| `data/` 全JSONを読み込め、エラー0・警告0 | `tests/data.test.ts` |
| 必須ファイル・必須キー・範囲・単位・enum の違反で `DataError` | `tests/data.test.ts` |
| JSON を書き換えると読み出す値が変わる | `tests/data.test.ts` |
| World が `scale.json` の値で確保され、同じ入力から同じハッシュ | `tests/world.test.ts` |
| バッファプールの貸出・返却（性質テスト） | `tests/worker.test.ts` |
| バックプレッシャー（返却されるまで poolSize 本以上送らない） | `tests/worker.test.ts` |
| 1x で 5 tick/秒、スナップショットは 10Hz 以下 | `tests/worker.test.ts` |
| 時間切れ（sliceMs）、一時停止、init 前のエラー | `tests/worker.test.ts` |
| 同じ seed・同じ操作列で一次状態のハッシュが一致 | `tests/worker.test.ts` |

## 画面で確かめること（`npm run dev`）

1. 画面上部に「TERRA CRAFT」、中央に3D表示（平面）、右に「統計」「レイヤー」、下に時間操作が出る。
2. 下部の状態が「シミュレーション起動中」から「シミュレーション稼働中」に変わる（Worker との往復が成功）。
3. 「再生」を押すと経過年が増える。1x で毎秒約5。4x・16x に切り替えると速くなる。「一時停止」で止まる。
4. 3D表示をドラッグすると視点が回り、ホイールで拡大縮小できる（地面の下には潜れない）。
5. 「レイヤー」は地形以外が無効（M1・M3 で有効化）。
6. `data/runtime.json` の `playback.ticksPerSecondAt1x` を書き換えて再読み込みすると、再生の速さが変わる。
7. `data/scale.json` の必須キーを消すと、画面にデータ検証エラーが出て止まる（壊れた世界を動かさない）。
8. キーボードだけで、再生・速度・レイヤーを操作できる（Tab / Enter / Space）。フォーカス枠が見える。

## 既知の制約

- 依存のバージョンは、レジストリに接続できない環境で書いたため**未検証**。`npm install` が解決できない版があれば、報告してほしい。
- 3D表示は M0 では空の平面。高さテクスチャの頂点変位は M1。
- `rewind` と `dryRunDam` は M3 で実装予定（現状は error を返す）。
