# Cloudflare Pages へのデプロイ

静的サイトです（サーバーは不要）。ビルド成果物は `dist/`。`base: './'` なので、どのパスに置いても動きます。URL 共有は `#w=...`（ハッシュ）なので、リダイレクト設定（`_redirects`）も要りません。

## 方法 A: Git 連携（いちばん簡単）

Cloudflare ダッシュボード → Workers & Pages → Create → Pages → Connect to Git → `socratesyama/TERRACRAFT` を選び、次を設定します。

| 項目 | 値 |
| --- | --- |
| Production branch | `main` |
| Framework preset | None（Vite でも可） |
| Build command | `npm install && npm run build` |
| Build output directory | `dist` |
| 環境変数 `NODE_VERSION` | `22`（`.node-version` があるので省略可） |

`package-lock.json` を後でコミットしたら、Build command を `npm ci && npm run build` にすると再現性が上がります。

## 方法 B: GitHub Actions（`.github/workflows/deploy.yml`）

1. Cloudflare でプロジェクトを作る（初回だけ）: `npx wrangler pages project create terracraft --production-branch=main`
2. API トークン（権限 Account / Cloudflare Pages / Edit）とアカウント ID を、リポジトリの Secrets に `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` として登録する。
3. `main` への push で本番、プルリクエストでプレビューが公開されます。Secrets が無いときはデプロイを飛ばします。

## 手元から直接

```bash
npm run build
npx wrangler pages deploy dist --project-name=terracraft
```

## 含まれる設定

- `public/_headers`: セキュリティヘッダー、`/assets/*` の長期キャッシュ（ハッシュ付きファイル名）、`index.html` の再確認。
- `wrangler.toml`: 出力ディレクトリ（Direct Upload 用）。
- `.node-version`: Node 22。

## 注意（未検証）

- このリポジトリを書いた環境には npm のネットワークが無く、`npm run build` と実際のデプロイは**一度も実行していません**。初回のビルドで型エラーや依存の不足が出る可能性があります。出たら、まずそれを直してください。
- Pages の 1 ファイル 25 MiB 制限に対し、`sourcemap: true` のマップが大きくなる場合があります。超えたら `vite.config.ts` の `sourcemap` を `'hidden'` か `false` にしてください。
- Content-Security-Policy は、実機で動作を確認できないので入れていません。公開後にブラウザで確認してから足すことを勧めます（Worker は同一オリジン、スタイルは React のインライン style を使います）。
