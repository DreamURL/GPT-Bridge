<div align="right">
  <a href="README.md">English</a> ·
  <a href="README.kr.md">한국어</a> ·
  <b>日本語</b> ·
  <a href="README.zh-CN.md">简体中文</a>
</div>

# GPT Bridge

現在の VS Code ワークスペースを MCP サーバーとして公開し、
**ChatGPT が自分のコードを直接読み書きできるようにする**拡張機能です。

> **中核となる原則 — GPT のテキスト編集はディスクではなくエディタのバッファに適用されます。**
> `Ctrl+Z` で取り消せますし、`Ctrl+S` を押すまでディスクは変わりません。
> ただしファイルの作成・削除・リネームは例外で、承認した時点でディスクに反映されます。

## できること

| 読み取り | 書き込み（承認が必要） |
|---|---|
| `get_workspace_info` ワークスペース概要 | `edit_file` 部分編集 ← 主力 |
| `list_directory` ファイル一覧 | `write_file` 新規作成・全体置換 |
| `read_file` ファイル読み取り | `create_directory` フォルダ作成 |
| `search_text` テキスト検索 | `delete_path` 削除（常に確認） |
| `get_diagnostics` 型・Lint エラー | `save_file` 保存 |

`get_diagnostics` がこの拡張機能の差別化点です。GPT が型エラーを自分で読んで
修正できます。一覧と検索は `.gitignore` を尊重します。

---

## インストール

必要なもの: [Git](https://git-scm.com/downloads)、
[Node.js](https://nodejs.org/)（LTS）、[VS Code](https://code.visualstudio.com/) 1.90 以上。

```bash
git clone https://github.com/DreamURL/GPT-Bridge.git
cd GPT-Bridge
npm install
npm run setup
```

`npm run setup` が `.vsix` のビルドと VS Code へのインストールをまとめて行います。
完了したら VS Code で `Ctrl+Shift+P` → **`Developer: Reload Window`** を実行してください。
左のアクティビティバーに GPT Bridge のアイコンが現れます。

> `cd GPT-Bridge` が必要な理由 — `git clone` はリポジトリ名の
> **フォルダを新しく作り**、その中にファイルを配置します。コマンドが終わっても
> 自分がいる場所は外側なので、そのフォルダに入らないと `npm install` が正しく動きません。

**更新するとき**は `git pull && npm install && npm run setup`。
**削除するとき**はこのファイル下部の *アンインストール* を参照してください。

### `code` コマンドが見つからないと表示されたら

ビルドは成功しており、インストールだけが失敗した状態です。VS Code の画面から
直接追加できます。

1. 左の**拡張機能**アイコン → 右上の `...` → **VSIX からのインストール**
2. リポジトリフォルダの `gpt-bridge-0.1.0.vsix` を選択

`code` コマンドを使いたい場合は `Ctrl+Shift+P` →
`Shell Command: Install 'code' command in PATH` を実行しておいてください。

> ⚠️ **他の PC から `.vsix` をコピーして持ち込まないでください。** ファイル検索に使う
> ripgrep は OS・CPU ごとに別のファイルなので、別の環境でビルドした `.vsix` では
> 検索と一覧が**何のエラーも出さずに機能しなくなります。** 各マシンで上記 4 行を
> 実行してビルドしてください。

---

## ChatGPT との接続

ChatGPT はインターネット上にあり、コードは自分の PC の中にあります。外から入って
くることはできないので、**逆に**します — 自分の PC から OpenAI に電話をかけ、
その回線をつないだままにしておくのです。

```
ChatGPT ──(認証: なし)──▶ OpenAI トンネル ◀──(外向き接続)── tunnel-client（自分の PC）
                                                                │ Authorization を付与
                                                                ▼
                                                     127.0.0.1:3737  GPT Bridge
```

公開アドレスは作られず、**トークンが PC の外に出ることもありません。**

以下は要約です。画面ごとの詳しい手順とトラブルシューティングは
[`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)（英語）にあります。

**まず 3 つの値を集め、5 のステップで設定ファイルに一度でまとめて記入します。**
メモ帳などに控えておいてください。

| 値 | どこで手に入るか |
|---|---|
| トンネル ID（`tunnel_...`） | 1 |
| OpenAI API キー（`sk-...`） | 2 |
| GPT Bridge トークン（64 文字） | 3 |

### 1. トンネルを作る

[platform.openai.com → Tunnels](https://platform.openai.com/settings/organization/tunnels)
→ **Create tunnel**。名前と説明はどちらも必須です。
`tunnel_` で始まる ID を控えておいてください。

### 2. API キーを発行する

[API keys](https://platform.openai.com/settings/organization/api-keys) →
**Create new secret key**。権限は **All** のままにします — トンネル専用の権限項目は
ありません。`sk-` で始まる値を控えてください — **表示されるのは一度きりです。**

> このキーは設定ファイルに平文で保存され、常駐プロセスが使用します。
> **この用途専用のキーを発行してください。** 他で使っているキーを流用すると、
> 後で破棄する際にそちらまで一緒に止まります。

### 3. GPT Bridge のトークンをコピーする

VS Code で**作業するフォルダを開いてから**:

1. `Ctrl+,` → `gptBridge.tunnel.provider` を検索 → **`none`** であることを確認
   （既定値です。拡張機能が独自のトンネルを起動しないようにします）
2. `Ctrl+Shift+P` → **`GPT Bridge: Start server`**
3. `Ctrl+Shift+P` → **`GPT Bridge: Copy auth token`**

64 文字の文字列がクリップボードに入ります。**控えておいてください。**

これで 3 つの値がそろいました。

### 4. tunnel-client をダウンロードする

[リリースページ](https://github.com/openai/tunnel-client/releases)から自分の OS 用の
zip を 1 つだけ取得します（Windows なら多くの場合 `windows-amd64`）。

**展開する前に**、受け取った **zip ファイルそのもの**のハッシュを確認し、同じ
ページの `SHA256SUMS.txt` と照合します。

```cmd
:: Windows — パスの末尾は .zip である必要があります
certutil -hashfile "C:\...\tunnel-client-v0.0.11-windows-amd64.zip" SHA256
```
```bash
# macOS / Linux
shasum -a 256 "~/Downloads/tunnel-client-v0.0.11-windows-amd64.zip"
```

> `ERROR_FILE_NOT_FOUND` が出たら、**フォルダを指定している**ということです。この
> コマンドはファイル 1 つのハッシュを求めるので、展開したフォルダではなく **zip**
> を指す必要があります。`SHA256SUMS.txt` の値も zip 基準なので、展開後の中身とは
> 照合できません。
>
> zip を探すには `dir /s /b "%USERPROFILE%\*tunnel-client*.zip"`。

値が違ったら中断してください。一致したら**リポジトリの外**の任意のフォルダに展開します。

### 5. 設定ファイルを作る

**先に集めた 3 つの値を、ここで一度にすべて記入します。** 後で開き直さずに済むよう
今すべて入れてください。

**まずフォルダを自分で作成します。** `tunnel-client` をまだ一度も実行していないため、
何も用意されていません。

`Win + R` → `%APPDATA%` と入力 → このフォルダが開きます。

```
C:\Users\<ユーザー名>\AppData\Roaming
```

> ⚠️ **`%APPDATA%` は `AppData` フォルダではなく、その下の `Roaming` を指します。**
> `AppData\tunnel-client` ではなく `AppData\Roaming\tunnel-client` です。
> 上の方法で開けばすでに正しい場所なので、そこで作成してください。

開いたフォルダ内で**右クリック → 新規作成 → フォルダー** → 名前を
**`tunnel-client`** に。その中に下記の内容を `gpt-bridge.yaml` として保存します。
最終的なパスはこうなります。

```
Windows       C:\Users\<ユーザー名>\AppData\Roaming\tunnel-client\gpt-bridge.yaml
macOS/Linux   ~/.config/tunnel-client/gpt-bridge.yaml
```

> メモ帳で保存する際は**ファイルの種類を「すべてのファイル」に**してください。
> そのままだと `gpt-bridge.yaml.txt` になり、`tunnel-client` が見つけられません。

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"

  # 1 のトンネル ID。"tunnel_" の接頭辞ごとそのまま貼り付けます。
  tunnel_id: "tunnel_0123456789abcdef0123456789abcdef"

  # 2 の API キー。"sk-" で始まる文字列すべてです。
  api_key: "sk-proj-AbCdEf0123456789...(中略)...WxYz"

health:
  listen_addr: "127.0.0.1:8080"

log:
  # level と format はセットです。format を省くと tunnel-client が
  # "log level requires 'struct-text' or 'json' log format" で起動を拒否します。
  level: warn
  format: json

mcp:
  server_urls:
    - channel: main
      url: "http://127.0.0.1:3737/mcp"

  # GPT Bridge はすべてのリクエストに Authorization ヘッダーを要求する。
  # ChatGPT にはこれを送る手段がないため、ここで代わりに付与する。
  extra_headers:
    # 3 の 64 文字トークン。"Bearer" と半角スペース 1 つは残し、その後ろだけ置き換えます。
    Authorization: "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

> 上の 3 つの値は**形を示すための例**です。そのままでは動きません。

集めた値に置き換えてください。**引用符はそのまま残します。**

| 項目 | 形式 | 注意 |
|---|---|---|
| `tunnel_id` | `tunnel_` + 16 進数 32 文字 | **`tunnel_` を含めて**丸ごと。数字だけではいけません |
| `api_key` | `sk-` または `sk-proj-` で始まる | 発行画面に出た文字列**すべて** |
| `Authorization` | `Bearer ` + 16 進数 64 文字 | **`Bearer` と半角スペース 1 つは残し**、その後ろだけ置換 |

> ⚠️ **`Bearer` を消さないでください。** `Bearer` + 半角スペース 1 つ + トークンです。
> 抜けると接続はできても全リクエストが 401 で拒否されます。
>
> YAML はインデントで構造を判断します。**タブではなくスペース**を使い、行頭の
> 空白は変更しないでください。

### 6. トンネルを起動する

`tunnel-client` は PATH に入っていません。**4 で展開したフォルダ**で実行する
必要があるので、そのフォルダでターミナルを開いてください。

```cmd
:: Windows
cd /d "<展開したフォルダ>"
tunnel-client.exe doctor --profile gpt-bridge --explain
tunnel-client.exe run --profile gpt-bridge
```
```bash
# macOS / Linux
cd "<展開したフォルダ>"
./tunnel-client doctor --profile gpt-bridge --explain
./tunnel-client run --profile gpt-bridge
```

`doctor` は設定を検査するだけでどこにも接続しません。先に実行して指摘を直してから
`run` に進んでください。実際に接続を開くのは `run` です。

> **そのウィンドウは開いたままにします。** 電話をつないだ状態なので、閉じると切れます。

毎回入力するのが面倒なら、実行ファイルの隣に `start-tunnel.bat` を置いて
ダブルクリックできます — [`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md) を参照。

状態確認: <http://127.0.0.1:8080/ui>

### 7. ChatGPT にコネクタを登録する

**トンネルが動いている間に**行ってください。

1. ChatGPT → 設定 → **Apps & Connectors** → **Advanced** → **Developer Mode** を有効化
2. コネクタを追加 → `接続`: **トンネル** → 作成したトンネルを選択
3. `認証`: **なし** ← **必ずこれを選んでください**

> **なぜ「なし」なのか** — コネクタが転送するヘッダーは最後に適用され、静的な
> ヘッダーを**上書きします。** `OAuth` や `混合` を選ぶと ChatGPT 側の
> `Authorization` が、こちらで注入した Bearer を押しのけて 401 になります。

### 8. 指示文を設定する

`Ctrl+Shift+P` → **`GPT Bridge: Copy ChatGPT instructions`**を実行し、
ChatGPT に貼り付けます。

**事実上必須です。** GPT は明示的に指示されない限り、カスタムツールをあまり
呼び出しません。貼り付け先は 3 か所あり、適用範囲が異なります。

| 場所 | 範囲 |
|---|---|
| **プロジェクトの指示** ← 推奨 | そのプロジェクト内の会話のみ |
| グローバルのカスタム指示 | すべての会話 — 無関係な会話でもツールを呼ぼうとします |
| 会話の最初のメッセージ | その会話のみ |

### 毎回の起動手順

1. VS Code → `GPT Bridge: Start server`
2. `tunnel-client run --profile gpt-bridge`

---

## セキュリティ

ローカルのファイルシステムを外部の AI に開く道具です。防御は次のとおりです。

- **パスの関門** — すべてのファイルアクセスが単一の検証を通過します。ワークスペース
  外への脱出、シンボリックリンクによる迂回、そして Windows 固有の回避手段
  （代替データストリーム `.env::$DATA`、予約デバイス名 `CON`、ドライブ相対パス）を
  遮断します。区切り文字は `/` のみ受け付けます。
- **拒否リスト** — `.git/**`、`.env*`、`*.pem`、`*.key`、`id_rsa*`、`.ssh/**`、
  `.aws/**`、`.npmrc`、`.netrc` など。追加はできますが削除はできません。
- **承認ゲート** — 書き込みは確認を求めます。同時リクエストは直列化されるため
  プロンプトが重なることはありません。90 秒無応答は拒否として扱われ、
  **期限切れ後に押した選択は破棄されます。** `delete_path` はどのモードでも常に確認します。
- **認証** — 32 バイトのランダムな Bearer トークン、`127.0.0.1` にバインド、CORS 無効。
- **監査ログ** — ツール呼び出しだけでなく、遮断・拒否・期限切れ・認証失敗も
  JSONL で記録します。

トークンが漏れればワークスペース全体が開きます。これは受け入れた前提であり、
対応は `GPT Bridge: Regenerate token`です。再発行したら設定ファイルの
`Authorization` も併せて更新してください。

## 設定

| 項目 | 既定値 | 説明 |
|---|---|---|
| `gptBridge.port` | `3737` | サーバーのポート |
| `gptBridge.autoStart` | `false` | VS Code 起動時に自動実行 |
| `gptBridge.tunnel.provider` | `none` | `none` なら拡張機能はトンネルを作りません（既定）。`cloudflare` なら cloudflared で公開 URL を取得します |
| `gptBridge.approval.mode` | `always` | `always` / `session` / `pattern` |
| `gptBridge.autoSave` | `false` | 無効のままなら `Ctrl+S` までディスクは安全 |
| `gptBridge.maxReadBytes` | `1048576` | 一度に読む最大バイト数 |

## 既知の制約

1. PC とトンネルが動いている間だけ機能します。
2. 書き込みは ChatGPT 側と拡張機能側の両方で確認され、**2 段階**になります。
3. `.vsix` には**ビルドしたマシンのプラットフォーム用 ripgrep のみ**が含まれます。
4. ワークスペースが git リポジトリでない場合、`.gitignore` は適用されません。
5. マルチルートワークスペースは最初のフォルダのみが対象です。
6. ターミナル実行や Git 操作のツールは提供しません。
7. **「保存するまでディスクは安全」はテキスト編集のみに当てはまります。**

## アンインストール

拡張機能の ID は `local.gpt-bridge` です。

```bash
code --uninstall-extension local.gpt-bridge
```

そのあと `Ctrl+Shift+P` → **`Developer: Reload Window`**。

UI から行う場合は、拡張機能パネル（`Ctrl+Shift+X`）で
**`@installed gpt bridge`** を検索 → 項目の歯車 → **Uninstall**。

> `@installed` を付けずに検索するとマーケットプレイスの結果が先に並び、
> 見つけにくくなります。publisher が `local` なので、マーケットプレイスには
> 掲載されていません。

### 残るもの

削除されるのは拡張機能の本体だけです。

| 対象 | 自動で消えるか |
|---|---|
| 拡張機能の本体（`~/.vscode/extensions/local.gpt-bridge-<バージョン>`） | ✅ |
| VS Code グローバルストレージ内の監査ログとダウンロード済み `cloudflared` | ❌ |
| VS Code SecretStorage 内の認証トークンとトンネルトークン | ❌ |
| `settings.json` の `gptBridge.*` の項目 | ❌ |

監査ログには GPT が読み書きしたファイルがすべて残ります。その履歴が機微なら
フォルダごと削除してください。

```powershell
# Windows
Remove-Item -Recurse -Force "$env:APPDATA\Code\User\globalStorage\local.gpt-bridge"
```
```bash
# macOS
rm -rf ~/Library/Application\ Support/Code/User/globalStorage/local.gpt-bridge
# Linux
rm -rf ~/.config/Code/User/globalStorage/local.gpt-bridge
```

残った Bearer トークン自体は無害です。`127.0.0.1` の GPT Bridge サーバーにしか
使われない値で、拡張機能を消せばそこで応答するものはありません。

### トンネル側は拡張機能と一緒には消えません

**ChatGPT との接続**で用意したものは、アンインストールしても残ります。
別途片付けてください。

1. **`tunnel-client` を停止** — 接続を保持しているウィンドウを閉じます。
2. **`gpt-bridge.yaml` を削除** — **OpenAI API キーが平文で**入っています。
   Windows は `%APPDATA%\tunnel-client\`、それ以外は `~/.config/tunnel-client/`。
3. **その API キーを失効させる** —
   [platform.openai.com](https://platform.openai.com/settings/organization/api-keys)。
   ローカルのファイルを消してもキーは無効になりません。失効させて初めて無効です。
4. **トンネルを削除** —
   [platform.openai.com](https://platform.openai.com/settings/organization/tunnels)。
   続けて ChatGPT → 設定 → アプリとコネクタ からコネクタも削除します。

## 開発

```bash
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/extension.js
npm run watch       # 変更監視
npm run package     # .vsix の生成のみ
```

`F5` で拡張機能開発ホストを起動するには `.vscode/launch.json` が必要です。
エディタの個人設定なのでリポジトリには含めていません。自分で作成してください。

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "拡張機能を実行",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

先に `npm run watch` を起動してから `F5` を押してください。

## ライセンス

MIT
