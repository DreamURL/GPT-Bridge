<div align="right">
  <b>English</b> ·
  <a href="README.kr.md">한국어</a> ·
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

**Collect three values first, then fill them into the config file in one pass
at step 5.** Keep them in a scratch file.

| Value | Comes from |
|---|---|
| Tunnel ID (`tunnel_...`) | Step 1 |
| OpenAI API key (`sk-...`) | Step 2 |
| GPT Bridge token (64 chars) | Step 3 |

### 1. Create a tunnel

[platform.openai.com → Tunnels](https://platform.openai.com/settings/organization/tunnels)
→ **Create tunnel**. Name and description are both required.
Note down the ID that starts with `tunnel_`.

### 2. Create an API key

[API keys](https://platform.openai.com/settings/organization/api-keys) →
**Create new secret key**. Leave the permissions at **All** — there is no
tunnel-specific scope. Copy the `sk-` value — **it is shown only once.**

> This key is stored in plain text in a config file and used by a long-running
> process. **Issue a key dedicated to this purpose.** Reusing a key from
> somewhere else means revoking it later breaks that other thing too.

### 3. Copy the GPT Bridge token

In VS Code, **open the folder you want to work in**, then:

1. `Ctrl+,` → search `gptBridge.tunnel.provider` → set it to **`none`**
   (stops the extension from starting a tunnel of its own)
2. `Ctrl+Shift+P` → **`GPT Bridge: Start server`**
3. `Ctrl+Shift+P` → **`GPT Bridge: Copy auth token`**

A 64-character string lands on your clipboard. **Write it down.**

That is all three values.

### 4. Download tunnel-client

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

### 5. Write the config file

**Fill in all three values you collected, here, in one pass.** Do it now so you
never have to reopen this file.

**Create the folder yourself first.** `tunnel-client` has never run, so nothing
exists yet.

`Win + R` → type `%APPDATA%` → this folder opens:

```
C:\Users\<username>\AppData\Roaming
```

> ⚠️ **`%APPDATA%` is not the `AppData` folder — it points at `Roaming` inside it.**
> The path is `AppData\Roaming\tunnel-client`, not `AppData\tunnel-client`.
> Opening it the way above already puts you in the right place.

In that folder, **right-click → New → Folder** → name it **`tunnel-client`**.
Save the content below inside it as `gpt-bridge.yaml`. The final path:

```
Windows       C:\Users\<username>\AppData\Roaming\tunnel-client\gpt-bridge.yaml
macOS/Linux   ~/.config/tunnel-client/gpt-bridge.yaml
```

> When saving from Notepad, set **Save as type to `All Files`**. Otherwise you
> get `gpt-bridge.yaml.txt` and `tunnel-client` will not find it.

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"

  # Tunnel ID from step 1. Paste it whole, including the "tunnel_" prefix.
  tunnel_id: "tunnel_0123456789abcdef0123456789abcdef"

  # API key from step 2. The entire string starting with "sk-".
  api_key: "sk-proj-AbCdEf0123456789...(truncated)...WxYz"

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
    # 64-char token from step 3. Keep "Bearer" and the single space; replace only what follows.
    Authorization: "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

> The three values above are **shape examples**. Left as-is, nothing will work.

Replace them with what you collected. **Keep the quotation marks.**

| Field | Shape | Watch out |
|---|---|---|
| `tunnel_id` | `tunnel_` + 32 hex chars | Include the **`tunnel_` prefix** — not just the digits |
| `api_key` | starts with `sk-` or `sk-proj-` | The **entire** string shown at creation |
| `Authorization` | `Bearer ` + 64 hex chars | Keep **`Bearer` and the single space**; replace only what follows |

> ⚠️ **Do not delete `Bearer`.** It is `Bearer`, one space, then the token.
> Drop it and the tunnel connects but every request is rejected with 401.
>
> YAML derives structure from indentation. Use **spaces, not tabs**, and leave
> the leading whitespace alone.

### 6. Run the tunnel

`tunnel-client` is not on your PATH — run it **from the folder you extracted in
step 4**, so open a terminal there first.

```cmd
:: Windows
cd /d "<the folder you extracted to>"
tunnel-client.exe doctor --profile gpt-bridge --explain
tunnel-client.exe run --profile gpt-bridge
```
```bash
# macOS / Linux
cd "<the folder you extracted to>"
./tunnel-client doctor --profile gpt-bridge --explain
./tunnel-client run --profile gpt-bridge
```

`doctor` only validates the config and connects to nothing, so run it first and
fix whatever it reports. `run` opens the connection.

> **Leave that window open.** It is holding the call; closing it drops the tunnel.

Tired of typing this every time? Put a small `start-tunnel.bat` next to the
executable and double-click it instead — see [`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md).

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

`Ctrl+Shift+P` → **`GPT Bridge: Copy ChatGPT instructions`**,
then paste into ChatGPT.

**This is effectively mandatory.** GPT rarely calls custom tools unless told to.
There are three places to put it, with different scope:

| Where | Scope |
|---|---|
| **Project instructions** ← recommended | Conversations in that project only |
| Global custom instructions | Every conversation — it will reach for the tools in unrelated chats too |
| First message of a chat | That chat only |

### Everyday startup

1. VS Code → `GPT Bridge: Start server`
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
the response is `GPT Bridge: Regenerate token`. After regenerating,
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
