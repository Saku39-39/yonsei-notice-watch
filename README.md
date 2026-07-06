# 연세 공지 Watcher

연세대학교の複数の공지사항(お知らせ)ページを GitHub Actions で定期巡回して集約し、GitHub Pages 上のダッシュボードで新着をひと目で確認できるようにするツールです。

## 構成

```
├── docs/
│   ├── index.html          # ダッシュボード (GitHub Pagesで公開)
│   ├── sites.config.json   # 監視対象サイトの一覧
│   └── data/notices.json   # 取得結果 (Pages配信用コピー。自動生成)
├── data/notices.json       # 取得結果の正本 (自動生成)
├── scripts/
│   ├── scrape.js           # メインのスクレイパー
│   └── parsers/            # CMSタイプ別パーサー (jwxe / kboard / generic)
├── test/fixtures/          # パーサーテスト用のサンプルHTML
└── .github/workflows/scrape.yml  # 6時間ごと + 手動実行のワークフロー
```

対象サイト(初期設定):

| site_id | サイト | type |
|---|---|---|
| graduate | 대학원 교내공지 | jwxe |
| socsci | 사회과학대학 공지사항 | jwxe |
| glc | 글로벌인재대학(GLC) 전체공지 | kboard |

## ローカルでの実行方法

Node.js 18以上が必要です。

```bash
npm install

# 実際にHTTPリクエストを送って取得 → data/notices.json を生成
npm run scrape

# ネットワークを使わず、test/fixtures/ のサンプルHTMLでパーサーを検証
npm test
```

生成された `data/notices.json`(および `docs/data/notices.json`)をブラウザで確認したい場合は、
`docs/` を静的サーバーで配信します:

```bash
npx serve docs
# → http://localhost:3000 を開く
```

> `docs/index.html` を `file://` で直接開くと fetch がブロックされるため、必ずHTTPサーバー経由で開いてください。

## GitHub でのセットアップ

### 1. リポジトリの作成とpush

```bash
git init
git add .
git commit -m "initial commit"
git remote add origin https://github.com/<あなたのユーザー名>/yonsei-notice-watch.git
git push -u origin main
```

pushすると `.github/workflows/scrape.yml` が有効になり、6時間ごとに自動でスクレイプが実行されます。すぐに動かしたい場合は、リポジトリの **Actions → scrape → Run workflow** から手動実行できます。

### 2. GitHub Pages の有効化

1. リポジトリの **Settings → Pages** を開く
2. **Source**: `Deploy from a branch` を選択
3. **Branch**: `main` / フォルダ: `/docs` を選択して **Save**
4. 数分後、`https://<ユーザー名>.github.io/<リポジトリ名>/` でダッシュボードが公開されます

> **privateリポジトリについての注意**: 後述のとおりリポジトリはprivateを推奨しますが、GitHub Freeプランではprivateリポジトリで GitHub Pages を使えません(GitHub Pro以上が必要)。Freeプランの場合は、(a) publicのまま運用する(コードと公지データのみが公開され、トークンは各自のブラウザにしか保存されないため、リスクは限定的です)、(b) Proにアップグレードしてprivate + Pagesにする、のどちらかを選んでください。

### 3. Personal Access Token (PAT) の発行

ダッシュボードの「サイト追加」「今すぐ取得」ボタンは、ブラウザからGitHub APIを直接呼び出すため、PATが必要です。**このリポジトリ限定・最小権限のfine-grained tokenを推奨します。**

1. GitHub右上のアイコン → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Token name**: 例 `yonsei-notice-watch`
3. **Expiration**: 任意(90日など。失効したら再発行して設定し直せばOK)
4. **Repository access**: **Only select repositories** → このリポジトリだけを選択
5. **Permissions → Repository permissions** で以下の2つだけ付与:
   - **Contents**: Read and write (sites.config.json のコミット用)
   - **Actions**: Read and write (workflow_dispatch の起動用)
6. **Generate token** を押し、表示されたトークン(`github_pat_...`)をコピー

### 4. ダッシュボードへのトークン設定

1. 公開されたダッシュボードを開き、右上の **⚙ 設定** をクリック
2. オーナー(ユーザー名)・リポジトリ名(URLから自動推測されます)・ブランチ(通常 `main`)を確認
3. トークンを貼り付けて **保存**

トークンは**このブラウザのlocalStorageにのみ保存**され、画面に再表示されることはなく、`api.github.com` 以外には一切送信されません。共用PCでは使用後に「トークンを削除」を押してください。

## ブラウザからのサイト追加手順

1. ダッシュボードの **＋ 新しいサイトを追加** をクリック
2. 表示名・一覧ページのURL・CMSタイプを入力
   - 記事の詳細URLが `?mode=view&articleNo=...` → **jwxe型**(연세대の学科サイトの多く)
   - 詳細URLが `?mod=document&uid=...` → **KBoard型**(WordPress系)
   - わからない場合 → **generic**(自動判定。取得漏れの可能性がある旨のバッジ⚠が付きます)
3. **追加してコミット** を押すと、GitHub API経由で `docs/sites.config.json` が直接更新・コミットされます
4. 続けて **⟳ 今すぐ取得** を押すと、次回の定期実行を待たずに新サイトを含めて再取得します

## セキュリティ上の推奨事項

- **リポジトリはprivateにすることを推奨します**(Pagesとの兼ね合いは上記の注意を参照)。取得データには公開情報しか含まれませんが、あなたがどの掲示板を監視しているかも含めて外部に見せる必要はありません。
- PATは必ず**対象リポジトリ限定のfine-grained token**にし、権限は `Contents: Read and write` と `Actions: Read and write` の2つに絞ってください。classic tokenの `repo` スコープは全リポジトリに及ぶため使わないでください。
- トークンをコード・コミット・Issueに書かないでください。ダッシュボードはlocalStorage以外にトークンを保持しません。

## 運用メモ

- 更新頻度は `.github/workflows/scrape.yml` の `cron: "0 */6 * * *"` を書き換えれば変更できます(GitHub Actionsのcron はUTC基準)。
- 1つのサイトの取得に失敗しても他のサイトの処理は継続され、失敗したサイトは `status: "error"` としてダッシュボードに表示されます。
- 対象ページのHTML構造が変わって取得件数が0件になった場合は、Actionsのログに警告が出ます。パーサー(`scripts/parsers/`)の調整が必要になることがあります。
- 巡回間隔は6時間に設定してあり、相手サーバーへの負荷はごく軽微ですが、間隔を極端に短くする(数分おき等)のは避けてください。
