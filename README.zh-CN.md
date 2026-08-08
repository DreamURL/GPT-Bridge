<div align="right">
  <a href="README.md">English</a> ·
  <a href="README.kr.md">한국어</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>简体中文</b>
</div>

# GPT Bridge

一个 VS Code 扩展，把当前工作区暴露为 MCP 服务器，让
**ChatGPT 能够直接读取和修改你的代码。**

> **核心原则 — GPT 的文本修改写入编辑器缓冲区，而不是磁盘。**
> 你可以用 `Ctrl+Z` 撤销，在按下 `Ctrl+S` 之前磁盘不会有任何变化。
> 例外是创建、删除和重命名文件：这些操作一经批准就会立即写入磁盘。

## 能做什么

| 读取 | 写入（需要批准） |
|---|---|
| `get_workspace_info` 工作区概览 | `edit_file` 局部修改 ← 主力 |
| `list_directory` 文件列表 | `write_file` 新建或整体替换 |
| `read_file` 读取文件 | `create_directory` 创建目录 |
| `search_text` 文本搜索 | `delete_path` 删除（始终确认） |
| `get_diagnostics` 类型与 Lint 错误 | `save_file` 保存 |

`get_diagnostics` 是本扩展的差异所在 —— GPT 能自己读取类型错误并修复。
列表和搜索都遵循 `.gitignore`。

---

## 安装

需要：[Git](https://git-scm.com/downloads)、
[Node.js](https://nodejs.org/)（LTS）、[VS Code](https://code.visualstudio.com/) 1.90 以上。

```bash
git clone https://github.com/DreamURL/GPT-Bridge.git
cd GPT-Bridge
npm install
npm run setup
```

`npm run setup` 会一次完成 `.vsix` 构建和安装。完成后在 VS Code 中执行
`Ctrl+Shift+P` → **`Developer: Reload Window`**。左侧活动栏会出现 GPT Bridge 图标。

> 为什么需要 `cd GPT-Bridge`？`git clone` 会在当前位置**新建一个**以仓库
> 命名的文件夹并把文件放进去。命令结束时你仍然在外层目录，必须进入该文件夹
> `npm install` 才能正常工作。

**更新时**执行 `git pull && npm install && npm run setup`。

### 如果提示找不到 `code` 命令

说明构建成功，只是安装步骤失败了。可以在 VS Code 界面里手动安装：

1. 左侧**扩展**图标 → 右上角 `...` → **从 VSIX 安装**
2. 选择仓库文件夹中的 `gpt-bridge-0.1.0.vsix`

想使用 `code` 命令，请执行 `Ctrl+Shift+P` →
`Shell Command: Install 'code' command in PATH`。

> ⚠️ **不要从其他电脑复制 `.vsix` 过来。** 文件搜索所用的 ripgrep 按操作系统和
> CPU 分别发布，在别的机器上构建的 `.vsix` 会让搜索和列表功能**悄无声息地失效。**
> 请在每台机器上用上面四行重新构建。

---

## 连接 ChatGPT

ChatGPT 在互联网上，代码在你的电脑里。外部无法主动连进来，所以我们**反过来** ——
让你的电脑向 OpenAI 拨号并保持这条线路不挂断。

```
ChatGPT ──(认证：无)──▶ OpenAI 隧道 ◀──(出站连接)── tunnel-client（你的电脑）
                                                        │ 注入 Authorization
                                                        ▼
                                             127.0.0.1:3737  GPT Bridge
```

不会产生任何公开地址，**令牌也不会离开你的电脑。**

以下是摘要。逐屏的详细步骤和故障排查见
[`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)（英文）。

**先收集三个值，然后在第 5 步一次性填进配置文件。** 请先记在记事本里。

| 值 | 来自 |
|---|---|
| 隧道 ID（`tunnel_...`） | 第 1 步 |
| OpenAI API 密钥（`sk-...`） | 第 2 步 |
| GPT Bridge 令牌（64 位） | 第 3 步 |

### 1. 创建隧道

[platform.openai.com → Tunnels](https://platform.openai.com/settings/organization/tunnels)
→ **Create tunnel**。名称和描述都是必填项。
记下以 `tunnel_` 开头的 ID。

### 2. 创建 API 密钥

[API keys](https://platform.openai.com/settings/organization/api-keys) →
**Create new secret key**。权限保持 **All** 即可 —— 没有隧道专用的权限项。
复制以 `sk-` 开头的值 —— **它只显示一次。**

> 这个密钥会以明文保存在配置文件里，并由常驻进程使用。
> **请单独签发一个专用于此的密钥。** 复用其他地方的密钥，日后吊销时会把那边一起弄停。

### 3. 复制 GPT Bridge 令牌

在 VS Code 中**打开要工作的文件夹**，然后：

1. `Ctrl+,` → 搜索 `gptBridge.tunnel.provider` → 确认为 **`none`**
   （这是默认值，让扩展不再自行启动隧道）
2. `Ctrl+Shift+P` → **`GPT Bridge: Start server`**
3. `Ctrl+Shift+P` → **`GPT Bridge: Copy auth token`**

剪贴板里会得到一个 64 位字符串。**请记下来。**

至此三个值都齐了。

### 4. 下载 tunnel-client

在[发布页面](https://github.com/openai/tunnel-client/releases)只下载对应自己
操作系统的那一个 zip（Windows 大多是 `windows-amd64`）。

**解压之前**，先对下载到的 **zip 文件本身**求哈希，并与同一页面上的
`SHA256SUMS.txt` 比对。

```cmd
:: Windows —— 路径必须以 .zip 结尾
certutil -hashfile "C:\...\tunnel-client-v0.0.11-windows-amd64.zip" SHA256
```
```bash
# macOS / Linux
shasum -a 256 "~/Downloads/tunnel-client-v0.0.11-windows-amd64.zip"
```

> 出现 `ERROR_FILE_NOT_FOUND` 说明你指向的是**文件夹**。这个命令只对单个文件求
> 哈希，因此必须指向 **zip**，而不是解压后的目录 —— `SHA256SUMS.txt` 里的值也是
> 针对 zip 的，解压出来的文件永远对不上。
>
> 查找 zip：`dir /s /b "%USERPROFILE%\*tunnel-client*.zip"`。

数值不一致就停下。一致的话，解压到**仓库之外**的任意文件夹即可。

### 5. 编写配置文件

**把前面收集的三个值在这里一次性填完。** 现在就填好，之后不必再打开这个文件。

**先自己创建文件夹。** `tunnel-client` 还从未运行过，所以什么都还不存在。

`Win + R` → 输入 `%APPDATA%` → 会打开这个文件夹：

```
C:\Users\<用户名>\AppData\Roaming
```

> ⚠️ **`%APPDATA%` 指的不是 `AppData` 文件夹，而是它下面的 `Roaming`。**
> 路径是 `AppData\Roaming\tunnel-client`，不是 `AppData\tunnel-client`。
> 用上面的方式打开时你已经在正确的位置了。

在打开的文件夹里**右键 → 新建 → 文件夹** → 命名为 **`tunnel-client`**。
把下面的内容保存到其中，文件名为 `gpt-bridge.yaml`。最终路径如下：

```
Windows       C:\Users\<用户名>\AppData\Roaming\tunnel-client\gpt-bridge.yaml
macOS/Linux   ~/.config/tunnel-client/gpt-bridge.yaml
```

> 用记事本保存时，请把**保存类型改为「所有文件」**。否则会变成
> `gpt-bridge.yaml.txt`，`tunnel-client` 找不到它。

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"

  # 第 1 步的隧道 ID。连同 "tunnel_" 前缀整体粘贴。
  tunnel_id: "tunnel_0123456789abcdef0123456789abcdef"

  # 第 2 步的 API 密钥。以 "sk-" 开头的完整字符串。
  api_key: "sk-proj-AbCdEf0123456789...(略)...WxYz"

health:
  listen_addr: "127.0.0.1:8080"

log:
  level: warn

mcp:
  server_urls:
    - channel: main
      url: "http://127.0.0.1:3737/mcp"

  # GPT Bridge 要求每个请求都带 Authorization 头。
  # ChatGPT 没有办法发送这个头，因此在这里代为附加。
  extra_headers:
    # 第 3 步的 64 位令牌。保留 "Bearer" 和一个空格，只替换后面的部分。
    Authorization: "Bearer 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
```

> 上面三个值只是**用来展示格式的示例**，原样保留是无法运行的。

请替换成你收集到的值。**引号请保留。**

| 字段 | 格式 | 注意 |
|---|---|---|
| `tunnel_id` | `tunnel_` + 32 位十六进制 | 要**连 `tunnel_` 前缀一起**填，不能只填数字 |
| `api_key` | 以 `sk-` 或 `sk-proj-` 开头 | 创建时显示的**完整**字符串 |
| `Authorization` | `Bearer ` + 64 位十六进制 | **保留 `Bearer` 和一个空格**，只替换后面的部分 |

> ⚠️ **不要删掉 `Bearer`。** 格式是 `Bearer` + 一个空格 + 令牌。
> 少了它虽然能连上，但每个请求都会被 401 拒绝。
>
> YAML 依靠缩进判断结构。请使用**空格而非制表符**，不要改动行首的空白。

### 6. 运行隧道

`tunnel-client` 不在 PATH 中，必须在**第 4 步解压出来的文件夹**里运行，
所以请先在该文件夹打开终端。

```cmd
:: Windows
cd /d "<解压到的文件夹>"
tunnel-client.exe doctor --profile gpt-bridge --explain
tunnel-client.exe run --profile gpt-bridge
```
```bash
# macOS / Linux
cd "<解压到的文件夹>"
./tunnel-client doctor --profile gpt-bridge --explain
./tunnel-client run --profile gpt-bridge
```

`doctor` 只检查配置，不会连接任何地方。先运行它，把它指出的问题改掉，再执行 `run`。
真正建立连接的是 `run`。

> **请保持该窗口开着。** 它维持着这条线路，关掉隧道就断了。

不想每次都敲命令的话，可以在可执行文件旁放一个 `start-tunnel.bat` 双击运行 ——
参见 [`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)。

状态页面：<http://127.0.0.1:8080/ui>

### 7. 在 ChatGPT 注册连接器

请在**隧道运行期间**进行。

1. ChatGPT → 设置 → **Apps & Connectors** → **Advanced** → 开启 **Developer Mode**
2. 添加连接器 → `连接`：**隧道** → 选择刚创建的隧道
3. `认证`：**无** ← **务必选这个**

> **为什么选「无」？** 连接器转发的请求头会在最后生效并**覆盖**静态请求头。
> 选择 `OAuth` 或 `混合` 时，ChatGPT 自己的 `Authorization` 会挤掉我们注入的
> Bearer 令牌，服务器就会返回 401。

### 8. 设置指令

`Ctrl+Shift+P` → **`GPT Bridge: Copy ChatGPT instructions`**，
然后粘贴到 ChatGPT。

**这实际上是必需的。** 如果没有明确要求，GPT 很少会调用自定义工具。
可以粘贴到三个位置，作用范围各不相同：

| 位置 | 范围 |
|---|---|
| **项目指令** ← 推荐 | 仅该项目内的对话 |
| 全局自定义指令 | 所有对话 —— 在无关的对话里也会尝试调用工具 |
| 对话的第一条消息 | 仅该对话 |

### 日常启动顺序

1. VS Code → `GPT Bridge: Start server`
2. `tunnel-client run --profile gpt-bridge`

---

## 安全性

这是一个把本地文件系统向外部 AI 开放的工具。防线如下。

- **路径关卡** —— 所有文件访问都要通过同一处校验。它拦截越出工作区的访问、
  符号链接绕过，以及 Windows 特有的手法：备用数据流（`.env::$DATA`）、
  保留设备名（`CON`）和驱动器相对路径。分隔符只接受 `/`。
- **拒绝清单** —— `.git/**`、`.env*`、`*.pem`、`*.key`、`id_rsa*`、`.ssh/**`、
  `.aws/**`、`.npmrc`、`.netrc` 等。可以添加条目，但不能移除。
- **批准闸门** —— 写操作会弹出确认。并发请求被串行处理，弹窗不会重叠；
  90 秒无响应视为拒绝，**过期后再点击的选择会被丢弃。**
  `delete_path` 在任何模式下都始终确认。
- **认证** —— 32 字节随机 Bearer 令牌，绑定 `127.0.0.1`，不启用 CORS。
- **审计日志** —— 以 JSONL 记录，不只是工具调用，还包括拦截、拒绝、过期和认证失败。

一旦令牌泄露，整个工作区都会暴露。这是已接受的取舍，应对方式是
`GPT Bridge: Regenerate token`。重新签发后，也要同步更新配置文件里的
`Authorization`。

## 设置项

| 键 | 默认值 | 说明 |
|---|---|---|
| `gptBridge.port` | `3737` | 服务器端口 |
| `gptBridge.autoStart` | `false` | 随 VS Code 自动启动 |
| `gptBridge.tunnel.provider` | `none` | `none` 表示扩展不创建隧道（默认）。`cloudflare` 则运行 cloudflared 获取公开 URL |
| `gptBridge.approval.mode` | `always` | `always` / `session` / `pattern` |
| `gptBridge.autoSave` | `false` | 保持关闭可确保 `Ctrl+S` 前磁盘安全 |
| `gptBridge.maxReadBytes` | `1048576` | 单次读取的最大字节数 |

## 已知限制

1. 只在电脑和隧道都运行时可用。
2. 写操作需要在 ChatGPT 侧和扩展侧分别确认，共**两步**。
3. `.vsix` 只包含**构建它的那个平台的 ripgrep**。
4. 若工作区不是 git 仓库，`.gitignore` 不会生效。
5. 多根工作区只处理第一个文件夹。
6. 不提供终端执行和 Git 操作类工具。
7. **「保存前磁盘安全」只适用于文本修改。**

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/extension.js
npm run watch       # 监听变更
npm run package     # 仅生成 .vsix
```

用 `F5` 启动扩展开发宿主需要 `.vscode/launch.json`。
它属于编辑器的个人配置，没有提交到仓库，请自行创建：

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "运行扩展",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

请先启动 `npm run watch`，再按 `F5`。

## 许可证

MIT
