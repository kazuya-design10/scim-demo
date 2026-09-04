# Auth0 Outbound SCIM デモアプリ（App B）

Auth0 Event Streams の Outbound SCIM Action template から、SCIM 2.0形式のユーザー作成・検索・更新・削除を受信するデモ用Webアプリです。

## 実装済み

- `POST /scim/v2/Users`
- `GET /scim/v2/Users?filter=externalId eq "..."`
- `GET /scim/v2/Users?filter=userName eq "..."`
- `GET /scim/v2/Users/:id`
- `PUT /scim/v2/Users/:id`
- `PATCH /scim/v2/Users/:id`（簡易対応）
- `DELETE /scim/v2/Users/:id`
- Bearer token検証
- SQLite保存
- ユーザー一覧および同期履歴画面

## 起動

```bash
npm install

# macOS/Linux
export SCIM_BEARER_TOKEN='十分に長いランダム値'
npm start

# PowerShell
$env:SCIM_BEARER_TOKEN='十分に長いランダム値'
npm start
```

ブラウザーで `http://localhost:3000` を開きます。

## Auth0 Action Secrets

公開HTTPS環境へデプロイした後、Event Stream Actionに次を設定します。

```text
SCIM_BASE_URL=https://<公開ホスト名>/scim/v2
SCIM_BEARER_TOKEN=<アプリ側と同じ値>
```

任意設定：

```text
SCIM_TIMEOUT_MS=1500
SCIM_MAX_RETRIES=1
SCIM_CONNECTION_ALLOWLIST=Username-Password-Authentication
```

## ローカル疎通確認

```bash
curl -i -X POST http://localhost:3000/scim/v2/Users \
  -H 'Authorization: Bearer demo-secret-change-me' \
  -H 'Content-Type: application/scim+json' \
  -d '{
    "schemas":["urn:ietf:params:scim:schemas:core:2.0:User"],
    "externalId":"auth0|demo001",
    "active":true,
    "userName":"user1@example.com",
    "displayName":"Demo User",
    "emails":[{"value":"user1@example.com","type":"work","primary":true}]
  }'
```

## デモ時の流れ

1. App Bの一覧画面を表示
2. Auth0 Dashboardで対象ユーザーの標準属性または、Actionの `buildScimUser()` がマッピングしている属性を編集して保存
3. `user.updated` がEvent Streamへ配信
4. Actionが `externalId` でApp Bのユーザーを検索
5. Actionが `PUT /Users/:id` を送信
6. App Bの画面が自動更新

## 注意

- Auth0 Action template v0.6.0は、`a0purpose: "test"` のシミュレーターイベントを意図的にスキップします。実デモでは実ユーザーの作成・更新・削除を発生させてください。
- デフォルトトークンはデモ専用です。外部公開前に必ず変更してください。
- 本実装はデモ向けのSCIMサブセットです。商用利用には、完全なフィルター、ページング、ETag、監査、レート制限、トークンローテーションなどの追加検討が必要です。
