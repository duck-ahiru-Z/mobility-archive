# Mobility Archive

日本を中心とした公共交通オープンデータを、まずは和歌山バス・和歌山バス那賀から継続保存するデータ基盤です。v0.1はCloudflare WorkerのCron TriggerでGTFS-Realtimeを毎分取得し、Cloudflare R2を完全なraw archiveとして利用します。日次整理データはGitHub ActionsからR2を読み、Parquetとmanifestとして別リポジトリへ保存します。

## 状態

このリポジトリは実装の正本です。`sources/`がSource Registry、`wrangler.jsonc`がCloudflare設定の正本です。ライセンスは取得元の条件を優先し、現時点では公式ページで再配布条件を確認できていないため、Registryの`publish_daily_dataset`は安全側で`false`にしています。raw保存とGitHub公開は別の許諾判断です。

## Architecture

`Cron Trigger → Collector Worker → R2 raw/static archive → daily GitHub Action → Parquet + manifest`。内部時刻はUTC、利用者向け日次境界はAsia/Tokyoです。GTFS-Realtimeは観測ごとに保存し、同一contentでも観測時刻を失わない設計です。失敗はsource/feed単位で分離し、raw validationに失敗してもrawを捨てません。

## Cost guardrails

 R2 Standardの無料枠は月10 GB-month、Class A 100万回、Class B 1,000万回です。容量状態は8GB=warning、9GB=critical、9.5GB=emergency、10GB超=over_free_tierとして記録します。これらは警告状態であり、容量を理由にcollectorを停止しません。raw、Static GTFS、GitHub日次データの自動削除も行いません。超過時はCloudflareログと日次manifestに明示し、課金の可能性を人間が判断します。

 raw objectは保存時にSHA-256をmetadataへ記録し、0 byte・HTTP失敗・GTFS-RT decode失敗を検出します。rawはR2がauthoritative archive、private GitHubはParquet + manifestのprocessed archiveです。

## R2 layout

`raw/gtfs-rt/<source>/<feed>/YYYYMMDD/HHMMSS-hash.pb`、静的GTFSは`static/<source>/versions/<sha256>.zip`です。R2 metadataにはsource、時刻、HTTP情報、hash、collector version、validation結果を記録します。

## Local development

`npm install`、`npm test`、`npm run typecheck`、`npm run dev`。ローカルR2 bindingはWranglerのlocal simulationを利用します。本番設定にはR2 bucket作成後に`wrangler r2 bucket create mobility-archive-raw`を使い、必要なら`wrangler.jsonc`のbucket名を合わせます。

## Deployment

`npx wrangler login`後に`npm run deploy`。Cloudflare accountへのログイン、R2 bucket作成、Worker deployは環境ごとに実行してください。Cronは毎分です。Cloudflare CronはUTC基準です。

## Data repository

日次処理は`mobility-archive-data`側に配置する想定です。R2 read-only S3 credentialはGitHub Actions Secretsへ登録し、sourceの公開条件が確認できるまで実データを公開しません。Parquetの共通schema、日次manifest、欠損窓、成功率を保存します。

## Sources and attribution

和歌山バスは公式発表でGTFS/GTFS-Realtimeのオープンデータ公開を案内しています。取得元、利用条件、ライセンス、attributionはsource registryで管理します。これは非公式プロジェクトであり、データの完全性・可用性・正確性を保証しません。提供元へ過度な負荷をかけないよう、少数retryと20秒timeoutを採用しています。

## Roadmap

日次Parquet workflow、追加事業者、DuckDB/API、欠損監視、GBFS等はv0.1後に追加します。D1、Queues、Durable Objectsは現時点では使いません。
