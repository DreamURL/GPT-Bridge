<div align="right">
  <a href="README.md">한국어</a> ·
  <b>English</b> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</div>

# GPT Bridge

A VS Code extension that exposes your current workspace as an MCP server so
**ChatGPT can read and edit your code directly.**

> **Core principle — GPT's text edits go to the editor buffer, not to disk.**
> You can undo them with `Ctrl+Z`, and nothing touches disk until `Ctrl+S`.
> Creating, deleting, and renaming files are the exception: those hit disk
> as soon as you approve them.

## What it can do

| Read | Write (requires approval) |
|---|---|
| `get_workspace_info` workspace summary | `edit_file` targeted edit ← primary |
| `list_directory` file listing | `write_file` create or replace |
| `read_file` read a file | `create_directory` create a folder |
| `search_text` text search | `delete_path` delete (always confirms) |
| `get_diagnostics` type & lint errors | `save_file` save |

`get_diagnostics` is what sets this apart — GPT reads your type errors and fixes
them itself. Listing and search respect `.gitignore`.

---

## Install

Requirements: [Git](https://git-scm.com/downloads),
[Node.js](https://nodejs.org/) (LTS), [VS Code](https://code.visualstudio.com/) 1.90+.

```bash
git clone https://github.com/DreamURL/GPT-Bridge.git
cd GPT-Bridge
npm install
npm run setup
```

`npm run setup` builds the `.vsix` and installs it in one step. When it finishes,
run `Ctrl+Shift+P` → **`Developer: Reload Window`** in VS Code. The GPT Bridge
icon appears in the left activity bar.

> Why `cd GPT-Bridge`? `git clone` **creates a new folder** named after the
> repository and puts the files inside it. You stay in the parent directory when
> it finishes, so you have to step into that folder for `npm install` to work.

**To update:** `git pull && npm install && npm run setup`.

### If it says the `code` command was not found

The build succeeded; only the install step failed. Add it from the VS Code UI:

1. **Extensions** icon → `...` at the top right → **Install from VSIX**
2. Pick `gpt-bridge-0.1.0.vsix` in the repository folder

To enable the `code` command, run `Ctrl+Shift+P` →
`Shell Command: Install 'code' command in PATH`.

> ⚠️ **Do not copy a `.vsix` from another machine.** The ripgrep binary used for
> file search ships per OS and CPU, so a `.vsix` built elsewhere makes search and
> listing **fail silently.** Build it on each machine with the four lines above.

---

## Connecting ChatGPT

ChatGPT lives on the internet and your code lives on your PC. Nothing can reach
in from the outside, so we do the **opposite** — your PC places a call to OpenAI
and keeps the line open.

```
ChatGPT ──(auth: none)──▶ OpenAI tunnel ◀──(outbound)── tunnel-client (your PC)
                                                            │ injects Authorization
                                                            ▼
                                                 127.0.0.1:3737  GPT Bridge
```

No public address is created and **the token never leaves your machine.**

What follows is a summary. Screen-by-screen steps and troubleshooting live in
[`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md).

### 1. Create a tunnel

[platform.openai.com → Tunnels](https://platform.openai.com/settings/organization/tunnels)
→ **Create tunnel**. Name and description are both required.
Note down the ID that starts with `tunnel_`.

### 2. Create an API key

[API keys](https://platform.openai.com/settings/organization/api-keys) →
**Create new secret key**. If a **Tunnels** permission is offered, enable
**Read + Use**. Copy the `sk-` value — **it is shown only once.**

### 3. Download tunnel-client

Grab the single zip for your OS from the
[releases page](https://github.com/openai/tunnel-client/releases)
(`windows-amd64` for most Windows PCs).

**Before extracting**, hash the **zip file itself** and compare it against
`SHA256SUMS.txt` on the same page.

```cmd
:: Windows — the path must end in .zip
certutil -hashfile "C:\...\tunnel-client-v0.0.11-windows-amd64.zip" SHA256
```
```bash
# macOS / Linux
shasum -a 256 "~/Downloads/tunnel-client-v0.0.11-windows-amd64.zip"
```

> `ERROR_FILE_NOT_FOUND` means you pointed at a **folder**. This command hashes a
> single file, so it must point at the **zip**, not the extracted directory — and
> the values in `SHA256SUMS.txt` are for the zip, so extracted files will never match.
>
> To locate the zip: `dir /s /b "%USERPROFILE%\*tunnel-client*.zip"`.

Stop if the values differ. If they match, extract anywhere **outside the repository**.

### 4. Write the config file

`%APPDATA%\tunnel-client\gpt-bridge.yaml`
(on macOS/Linux: `~/.config/tunnel-client/gpt-bridge.yaml`)

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "YOUR_TUNNEL_ID"
  api_key: "YOUR_OPENAI_KEY"

health:
  listen_addr: "127.0.0.1:8080"

log:
  level: warn

mcp:
  server_urls:
    - channel: main
      url: "http://127.0.0.1:3737/mcp"

  # GPT Bridge requires an Authorization header on every request.
  # ChatGPT has no way to send one, so we attach it here instead.
  extra_headers:
    Authorization: "Bearer YOUR_64_CHAR_TOKEN"
```

> YAML derives structure from indentation. Use **spaces, not tabs**, and leave
> the leading whitespace alone. On Windows Notepad, set the file type to
> **All Files** or you will end up with `gpt-bridge.yaml.txt`.

### 5. Get the token and fill it in

Open your working folder in VS Code, then:

1. `Ctrl+,` → `gptBridge.tunnel.provider` → **`none`**
   (stops the extension from starting a tunnel of its own)
2. `Ctrl+Shift+P` → **`GPT Bridge: 서버 시작`** (Start server)
3. `Ctrl+Shift+P` → **`GPT Bridge: 인증 토큰 복사`** (Copy auth token)

Paste the 64-character value **after** `Bearer` in the config above —
`Bearer`, one space, then the token.

### 6. Run the tunnel

```bash
tunnel-client doctor --profile gpt-bridge --explain   # check the config
tunnel-client run --profile gpt-bridge                # run (keep the window open)
```

Status page: <http://127.0.0.1:8080/ui>

### 7. Register the connector in ChatGPT

Do this **while the tunnel is running.**

1. ChatGPT → Settings → **Apps & Connectors** → **Advanced** → enable **Developer Mode**
2. Add a connector → `Connection`: **Tunnel** → pick the tunnel you created
3. `Authentication`: **None** ← **this one, definitely**

> **Why "None"?** Headers forwarded by the connector are applied last and
> **override** static headers. Choosing `OAuth` or `Mixed` makes ChatGPT's own
> `Authorization` push out the Bearer token we injected, and the server returns 401.

### 8. Add the instructions

`Ctrl+Shift+P` → **`GPT Bridge: ChatGPT 지침 복사`** (Copy ChatGPT instructions),
then paste into ChatGPT.

**This is effectively mandatory.** GPT rarely calls custom tools unless told to.
There are three places to put it, with different scope:

| Where | Scope |
|---|---|
| **Project instructions** ← recommended | Conversations in that project only |
| Global custom instructions | Every conversation — it will reach for the tools in unrelated chats too |
| First message of a chat | That chat only |

### Everyday startup

1. VS Code → `GPT Bridge: 서버 시작`
2. `tunnel-client run --profile gpt-bridge`

---

## Security

This tool opens your local filesystem to an external AI. These are the defenses.

- **Path gate** — every file access passes a single validation. It blocks escapes
  outside the workspace, symlink tricks, and Windows-specific bypasses: alternate
  data streams (`.env::$DATA`), reserved device names (`CON`), and drive-relative
  paths. Only `/` is accepted as a separator.
- **Deny list** — `.git/**`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.ssh/**`,
  `.aws/**`, `.npmrc`, `.netrc` and more. You can add entries but not remove them.
- **Approval gate** — writes prompt for confirmation. Concurrent requests are
  serialized so prompts never overlap; 90 seconds of silence counts as a denial,
  and **a choice made after expiry is discarded.** `delete_path` always confirms,
  in every mode.
- **Authentication** — 32-byte random Bearer token, bound to `127.0.0.1`, CORS off.
- **Audit log** — JSONL covering not just tool calls but blocks, denials,
  expiries, and auth failures.

If the token leaks, the whole workspace is exposed. That is an accepted trade-off;
the response is `GPT Bridge: 토큰 재발급` (regenerate token). After regenerating,
update `Authorization` in the config file too.

## Settings

| Key | Default | Description |
|---|---|---|
| `gptBridge.port` | `3737` | Server port |
| `gptBridge.autoStart` | `false` | Start automatically with VS Code |
| `gptBridge.tunnel.provider` | `cloudflare` | Set to `none` when using an external tunnel |
| `gptBridge.approval.mode` | `always` | `always` / `session` / `pattern` |
| `gptBridge.autoSave` | `false` | Leave off to keep disk safe until `Ctrl+S` |
| `gptBridge.maxReadBytes` | `1048576` | Max bytes per read |

## Known limitations

1. Works only while your PC and the tunnel are up.
2. Writes are confirmed on both the ChatGPT side and the extension side — **two steps**.
3. A `.vsix` contains **ripgrep only for the platform that built it.**
4. If the workspace is not a git repository, `.gitignore` is not applied.
5. Multi-root workspaces use the first folder only.
6. No terminal-execution or Git-manipulation tools are provided.
7. **"Safe until you save" applies to text edits only.**

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/extension.js
npm run watch       # watch mode
npm run package     # build the .vsix only
```

Launching the Extension Development Host with `F5` needs a `.vscode/launch.json`.
That is personal editor configuration and is not committed, so create it yourself:

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

Start `npm run watch` first, then press `F5`.

## License

MIT
