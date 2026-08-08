# Connecting ChatGPT (OpenAI Secure MCP Tunnel)

The full procedure for connecting GPT Bridge to ChatGPT.
Written so that **any machine can be set up from scratch with only this document.**

Most of it is done with the mouse. Only two steps need a command prompt, and
every step title says which tool you need.

| Mark | Means |
|---|---|
| 🌐 | Web browser |
| 📁 | File Explorer (mouse) |
| 📝 | Notepad |
| 💻 | Command prompt |
| 🧩 | VS Code |

For an overview of the extension itself, its security model and settings, see
[`README.md`](./README.md).

---

## 0. How this works

ChatGPT lives on the internet and your code lives on your PC. Nothing can reach
in from the outside — there is no doorbell.

So we do the **opposite**. Your PC places a call to OpenAI and never hangs up.
When ChatGPT needs something, it speaks over that already-open line.

```
ChatGPT
   |  (1) registered with authentication "none" (ChatGPT sends no password)
   v
OpenAI tunnel (the switchboard)
   ^
   |  (2) tunnel-client dials out to here and holds the line
tunnel-client  <- runs on your PC
   |  (3) this is where Authorization: Bearer gets attached
   v
http://127.0.0.1:3737/mcp
GPT Bridge extension (the part that reads and edits code)
```

**Step (3) is the crux.** GPT Bridge requires a password (a Bearer token) on
every request, but the ChatGPT connector screen only offers `OAuth` /
`None` / `Mixed` for authentication — there is no way to send one. So
`tunnel-client` **attaches it on the way to the local server instead.** No change
to the extension is needed.

The side effects are good: **the token never leaves your PC**, and no public
address is created.

### The three values you will collect

They all go into one config file later. Keep them in a scratch file.

| Value | Where it comes from |
|---|---|
| Tunnel ID (`tunnel_...`) | Step 2 |
| OpenAI API key (`sk-...`) | Step 3 |
| GPT Bridge token (64 chars) | Step 4 |

---

## Step 1 💻 — Install the GPT Bridge extension

You need something for the tunnel to point at. **Four commands.**

Requirements: [Git](https://git-scm.com/downloads),
[Node.js](https://nodejs.org/) (LTS), VS Code.

```cmd
git clone https://github.com/DreamURL/GPT-Bridge.git
cd GPT-Bridge
npm install
npm run setup
```

`npm run setup` builds the `.vsix` and installs it in one go.
When it finishes, run `Ctrl+Shift+P` → **`Developer: Reload Window`** in VS Code.

The GPT Bridge icon appears in the left activity bar once it is installed.

> ⚠️ **Do not copy a `.vsix` from another machine.** The ripgrep binary used for
> file search ships per OS and CPU, and `npm install` only fetches the one for
> the machine doing the install. A `.vsix` built elsewhere makes search and
> listing **fail silently.** That is why the repository does not contain a
> `.vsix` and every machine builds its own.

### If it says the `code` command was not found

The build succeeded; only the install step failed. Add it from the VS Code UI:

1. Click the **Extensions** icon on the left
2. `...` at the top right of the panel → **Install from VSIX**
3. Pick `gpt-bridge-0.1.0.vsix` in the repository folder

To enable the `code` command, run `Ctrl+Shift+P` →
`Shell Command: Install 'code' command in PATH`.

### Updating later

```cmd
git pull
npm install
npm run setup
```

---

## Step 2 🌐 — Create a tunnel on OpenAI

1. Go to https://platform.openai.com/settings/organization/tunnels
2. **Create tunnel** at the top right
3. Fill in `Name` and `Description` — **both are required**
4. Leave `Organizations` at its default
5. **Create**

You get a 32-character ID starting with `tunnel_`. **Write it down.**

```
Shape: tunnel_0123456789abcdef0123456789abcdef
```

> **Create a separate tunnel per machine.** If several PCs attach to the same
> tunnel it is hard to predict which one a request reaches. Naming them
> distinctly (`gpt bridge - home`, `gpt bridge - work`) saves confusion later.

## Step 3 🌐 — Create an API key

This is the ID card `tunnel-client` shows OpenAI to prove who it is.

1. Go to https://platform.openai.com/settings/organization/api-keys
2. **Create new secret key**
3. Any name (for example `gpt-bridge-tunnel`)
4. Leave permissions at **All** — there is no tunnel-specific scope
5. A long string starting with **`sk-`** appears → **write it down**

> This value is **shown only once.** Close the window and it is gone. Losing it
> is not a big deal — just create another. Do not paste it into a chat, an issue
> or a commit.

> **This is not the Admin key.** Admin keys are for creating and deleting
> tunnels and should never be handed to a long-running process. What you need
> here is a **runtime key**.

> This key is stored in plain text in a config file and used by a resident
> process. **Issue a key dedicated to this purpose.** Reusing a key from
> somewhere else means revoking it later breaks that other thing too.

---

## Step 4 🧩 — Start GPT Bridge and copy the token

Do this in the VS Code window that has **your working folder open**.

1. `Ctrl + ,` → search `gptBridge.tunnel.provider` → confirm it is **`none`**

   > `none` is the default, so normally there is nothing to change. Set to
   > `cloudflare`, the extension would start a tunnel of its own — unnecessary
   > alongside the OpenAI tunnel, and it creates a public address, which is worse.

2. `Ctrl + Shift + P` → **`GPT Bridge: Start server`**
3. `Ctrl + Shift + P` → **`GPT Bridge: Copy auth token`**

A 64-character string lands on your clipboard.

That is all three values.

---

## Step 5 🌐📁💻 — Download tunnel-client

### Download (browser)

1. Go to https://github.com/openai/tunnel-client/releases
2. From the latest release, download **only the one that matches your PC**

| My PC | File to download |
|---|---|
| Windows, typical | `tunnel-client-vX.Y.Z-windows-amd64.zip` |
| Windows ARM (Surface etc.) | `...-windows-arm64.zip` |
| Mac (M1 or later) | `...-darwin-arm64.zip` |
| Mac (Intel) | `...-darwin-amd64.zip` |

`all.zip` (150 MB) bundles every platform and is not needed.

3. Open **`SHA256SUMS.txt`** from the same page and keep it handy

### Verify the hash (command prompt — one line)

This checks that the file you received was not altered in transit. The rule is
not to run someone else's executable unverified, and it is the same procedure
this extension applies to cloudflared.

In a command prompt (adjust the filename to the version you downloaded):

```cmd
certutil -hashfile "%USERPROFILE%\Downloads\tunnel-client-v0.0.11-windows-amd64.zip" SHA256
```

The output must match the line for that file in `SHA256SUMS.txt` **character for
character**.

> `ERROR_FILE_NOT_FOUND` means you pointed at a **folder**. This command hashes
> a single file, so it must point at the **zip**, not an extracted directory —
> and the values in `SHA256SUMS.txt` are for the zip, so extracted files will
> never match. To locate the zip:
> `dir /s /b "%USERPROFILE%\*tunnel-client*.zip"`

> ❌ **If they differ, stop.** Do not download again — delete the file and find
> out why first. Never paper over it with a retry.

### Extract (File Explorer)

**Right-click the zip → Extract All.** Any folder is fine.

> ⚠️ **Do not extract into the repository folder.** It is an 83 MB external tool
> and dragging it into git makes the repository unusable.

Inside you will find:

| File | |
|---|---|
| `tunnel-client.exe` | The client itself |
| `cloudflared.exe` | The program that actually creates the tunnel (bundled by OpenAI) |
| `cloudflared-manifest.json` | Which cloudflared version is bundled |

> The OpenAI tunnel uses **Cloudflare Tunnel** underneath. The manifest states
> that OpenAI owns its version management and security patches, so it is not
> something you have to track.

---

## Step 6 📝 — Write the config file

This is the file `tunnel-client` reads. Create it by hand in Notepad.

### Open the folder

`Win + R` → paste this and confirm:

```
%APPDATA%
```

This folder opens:

```
C:\Users\<username>\AppData\Roaming
```

> ⚠️ **`%APPDATA%` is not the `AppData` folder — it points at `Roaming` inside
> it.** The path is `AppData\Roaming\tunnel-client`, not `AppData\tunnel-client`.
> Opening it the way above already puts you in the right place.

In that folder, create a folder named **`tunnel-client`**.
(Right-click → New → Folder)

### Create the file

Open Notepad, paste the whole block below, then **fill in all three values now.**

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"

  # Tunnel ID from step 2. Paste it whole, including the "tunnel_" prefix.
  tunnel_id: "tunnel_0123456789abcdef0123456789abcdef"

  # API key from step 3. The entire string starting with "sk-".
  api_key: "sk-proj-AbCdEf0123456789...(truncated)...WxYz"

health:
  listen_addr: "127.0.0.1:8080"

admin_ui:
  open_browser: false

log:
  level: warn

mcp:
  server_urls:
    - channel: main
      url: "http://127.0.0.1:3737/mcp"

  # GPT Bridge requires an Authorization header on every request (401 without it).
  # ChatGPT has no way to send one, so it is attached here instead.
  extra_headers:
    # 64-char token from step 4. Keep "Bearer" and the single space; replace only what follows.
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
> Drop it and the audit log records `auth_failure / malformed`.

> **Indentation matters.** YAML derives structure from leading whitespace.
> Leave the block exactly as pasted and do not touch the indentation while
> filling in values. Use **spaces, not tabs**.

### Saving

**File → Save As**:

- Location: the `tunnel-client` folder you just created
- File name: **`gpt-bridge.yaml`**
- Save as type: **All Files** ← without this it is saved as `gpt-bridge.yaml.txt`
- Encoding: `UTF-8`

The final path looks like this:

```
C:\Users\<username>\AppData\Roaming\tunnel-client\gpt-bridge.yaml
```

> **Secrets live in this file in plain text.** It sits under `%APPDATA%`, so it
> is not committed to git and is not synced to other machines — a reasonable
> trade-off on a personal PC. To tighten it further, write `"env:VARNAME"`
> instead of the value and pass it through an environment variable.
>
> Do not keep this file open in an editor with AI integrations; open it in
> Notepad only while editing, then close it.

---

## Step 7 📁 — Run it

In the folder containing `tunnel-client.exe`, create the file below with Notepad
and save it as **`start-tunnel.bat`** (Save as type = All Files).

```bat
@echo off
title GPT Bridge - OpenAI Tunnel
cd /d "%~dp0"

echo.
echo  [1/2] Checking configuration...
echo.
tunnel-client.exe doctor --profile gpt-bridge --explain
if errorlevel 1 goto failed

echo.
echo  [2/2] Connecting. KEEP THIS WINDOW OPEN.
echo        Status page: http://127.0.0.1:8080/ui
echo.
tunnel-client.exe run --profile gpt-bridge

echo.
echo  Tunnel stopped.
pause
exit /b 0

:failed
echo.
echo  ---------------------------------------------------------
echo   Check FAILED. Read the message above.
echo   Usually a wrong value in:
echo   %APPDATA%\tunnel-client\gpt-bridge.yaml
echo  ---------------------------------------------------------
echo.
pause
exit /b 1
```

> ⚠️ **Do not put non-ASCII text in a batch file.** cmd reads `.bat` files using
> the system codepage, not UTF-8. Notepad saves as UTF-8, so accented or
> non-Latin characters get mangled and cmd tries to run the garbage as commands,
> producing a flood of `'...' is not recognized as an internal or external command`.
> Keeping the messages in plain ASCII always works.

**Double-click to run.**

It checks the configuration first and only proceeds if that passes. On failure
it prints the reason and waits so you can read it.

> **Leave this window open.** It is holding the call; closing it drops the tunnel.

To keep it handy, right-click the file → Send to → **Desktop (create shortcut)**.

Status pages:

- http://127.0.0.1:8080/healthz — is it alive
- http://127.0.0.1:8080/readyz — is the connection ready
- http://127.0.0.1:8080/ui — status dashboard

---

## Step 8 🌐 — Register the connector in ChatGPT

Do this **while the tunnel is running.** With it stopped, ChatGPT cannot fetch
the tool list.

1. ChatGPT → Settings → **Apps & Connectors** → **Advanced** → enable **Developer Mode**
2. Add a connector → `Connection`: **Tunnel** → pick the tunnel you created
3. `Authentication`: **None** ← **this one, definitely**

> ### Why "None"?
>
> The official documentation states that **headers forwarded by the connector
> are applied last and override static headers.**
>
> Pick `OAuth` or `Mixed` and ChatGPT sends its own `Authorization`, which
> **pushes out** the Bearer token added in step 6. GPT Bridge then receives a
> value it does not recognise and returns 401.
>
> With `None`, ChatGPT sends no header at all and the password `tunnel-client`
> attached survives. Leave the `Advanced OAuth settings` panel on the right
> completely alone.

### Finally, add the instructions

In VS Code, `Ctrl+Shift+P` → **`GPT Bridge: Copy ChatGPT instructions`**, then
paste into ChatGPT. **The connector screen has no field for instructions** — put
them in one of these three places, which differ in scope.

| Where | Scope |
|---|---|
| **Project instructions** ← recommended | Conversations in that project only |
| Global custom instructions | Every conversation |
| First message of a chat | That chat only |

> **Global is not recommended.** ChatGPT will reach for GPT Bridge tools in
> unrelated conversations, where the tunnel is usually down, so every attempt
> fails and answers get worse for no reason.
>
> If you cannot find the project feature, paste them as the **first message of a
> chat**. It is tedious but works best — instructions at the very start of a
> conversation are what the model follows most reliably.

**This is effectively mandatory.** GPT rarely calls custom tools unless told to.
The instructions also cover preferring `edit_file`, calling `get_diagnostics`
after edits, and not re-reading whole files (items 6-11) — skip them and you
burn through context far faster.

### Checking that it works

In a new conversation: **"Explain the structure of this project and tell me about any type errors."**

- GPT calling `get_workspace_info` first means it is working
- The GPT Bridge panel in VS Code fills with call records in real time

---

## Daily routine

Installation is a one-time thing. After that, only this:

1. 🧩 VS Code → `Ctrl+Shift+P` → `GPT Bridge: Start server`
2. 📁 Double-click `start-tunnel.bat`

That is all.

---

## When something goes wrong

Check the **audit log** first. It almost always points straight at the cause.
Paste this into `Win + R`:

```
notepad %APPDATA%\Code\User\globalStorage\local.gpt-bridge\audit\audit.jsonl
```

One line is one event; the newest is at the bottom.

| Symptom | In the log | Cause |
|---|---|---|
| ChatGPT cannot connect | **nothing at all** | The request never arrived — the tunnel is down or `url` is wrong |
| Connects but everything fails | `auth_failure` / `missing` | `extra_headers` is absent or its indentation is wrong |
| 〃 | `auth_failure` / `malformed` | The `Bearer ` prefix is missing |
| 〃 | `auth_failure` / `mismatch` | Wrong token value. Most often **after regenerating the token without updating the config file** |
| No search tool in the list | — | ripgrep is missing. Rebuild the `.vsix` on this machine |
| GPT never calls any tool | nothing at all | The custom instructions were not applied |
| `doctor` reports an API key error | — | The key was revoked, or an Admin key was used by mistake |
| The config file is not found | — | It may have been saved as `gpt-bridge.yaml.txt`. Turn on file extensions in Explorer and check |
| `.bat` floods with `'...' is not recognized...` | — | The batch file contains non-ASCII text saved as UTF-8. **Keep its messages in plain ASCII** |

### Things that look like errors but are not

**All three of these appear on the first connection and are normal.** Ignore them.

| Where | What | Why |
|---|---|---|
| tunnel-client log | `OAuth discovery failed` — `invalid character '<'` | tunnel-client probes `/.well-known/oauth-protected-resource`, but we are not an OAuth server so that path does not exist. Express returns an HTML 404 and the JSON parser trips on the `<` of `<!DOCTYPE` |
| Audit log | 2-3 × `auth_failure` / `missing` | The same probes. They carry no Bearer header. **Normal if they only appear right after startup** |
| tunnel-client log | `server/discover` 400 | An OpenAI extension method, not part of the MCP standard, so our server does not know it. ChatGPT falls back to the standard path immediately |

Telling them apart is simple: **if `auth_failure` keeps accumulating after tools
have actually been called**, that is a real problem. A few at startup followed
by normal `tool_call` entries is fine.

### If the logs are too noisy

One line in `gpt-bridge.yaml`:

```yaml
log:
  level: warn      # info -> warn. Only prints when something is wrong.
```

### Other things to check

- Does `url` end in **`/mcp`** — `http://127.0.0.1:3737/mcp`, not just the port
- If you changed `gptBridge.port`, update `url` in the config file to match
- File tools do nothing unless **a folder is open** in VS Code

---

## Things to know

**Regenerating the token means updating the config file too.**
`GPT Bridge: Regenerate token` invalidates the old token immediately, but the
tunnel keeps sending the old value, so every request returns 401. If `mismatch`
entries pile up in the log, this is why.

**Do not upgrade tunnel-client casually.**
It is pre-1.0, so config key names and behaviour can change. Stay on a version
that works, and if things suddenly break, suspect a version bump first. This is
the same reason the extension pins cloudflared to `2026.7.3`.

**Cost is unconfirmed.**
The tunnel does not appear in OpenAI's published pricing and the guides do not
mention it. Creating a tunnel, downloading the client and connecting produced no
billing prompt. If charges do appear later, switching
`gptBridge.tunnel.provider` back to `cloudflare` remains available.

**This is safer than the Cloudflare route.**
With Cloudflare, the workspace is exposed at a public HTTPS address and the
token has to be pasted into the ChatGPT connector settings. This way no public
address exists and **the token never leaves the PC.** The exposure that the
README's security section accepts as a trade-off — "token leak means full
exposure" — shrinks accordingly.

---

## Checklist for installing on another PC

```
[ ] git clone -> npm install -> npm run setup   (on that machine; ripgrep)
[ ] Create a tunnel on OpenAI -> note the tunnel ID   (one per machine)
[ ] Create an API key (dedicated to this use)
[ ] Download tunnel-client + verify the hash
[ ] Extract it outside the repository
[ ] Write %APPDATA%\tunnel-client\gpt-bridge.yaml with all three values
[ ] VS Code: tunnel.provider=none -> Start server -> Copy auth token
[ ] Create start-tunnel.bat and double-click it
[ ] Register the connector in ChatGPT (Connection=Tunnel, Auth=None)
[ ] Paste the custom instructions
[ ] Verify with "Explain the structure of this project"
```
