<div align="right">
  <b>한국어</b> ·
  <a href="README.en.md">English</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.zh-CN.md">简体中文</a>
</div>

# GPT Bridge

현재 VS Code 워크스페이스를 MCP 서버로 노출해, **ChatGPT가 내 코드를 직접 읽고
고칠 수 있게** 하는 확장입니다.

> **핵심 원칙 — GPT의 텍스트 수정은 디스크가 아니라 에디터 버퍼에 적용됩니다.**
> `Ctrl+Z`로 되돌릴 수 있고, `Ctrl+S` 전까지 디스크는 그대로입니다.
> 단, 파일 생성·삭제·이름변경은 승인 즉시 디스크에 반영됩니다.

## 무엇을 할 수 있나

| 읽기 | 쓰기 (승인 필요) |
|---|---|
| `get_workspace_info` 워크스페이스 요약 | `edit_file` 부분 수정 ← 주력 |
| `list_directory` 파일 목록 | `write_file` 신규 생성·전체 교체 |
| `read_file` 파일 읽기 | `create_directory` 폴더 생성 |
| `search_text` 텍스트 검색 | `delete_path` 삭제 (항상 확인) |
| `get_diagnostics` 타입·린트 에러 | `save_file` 저장 |

`get_diagnostics`가 이 확장의 차별점입니다. GPT가 타입 에러를 직접 읽고 고칠 수
있습니다. 목록·검색은 `.gitignore`를 존중합니다.

---

## 설치

필요한 것: [Git](https://git-scm.com/downloads),
[Node.js](https://nodejs.org/) (LTS), [VS Code](https://code.visualstudio.com/) 1.90 이상.

```bash
git clone https://github.com/DreamURL/GPT-Bridge.git
cd GPT-Bridge
npm install
npm run setup
```

`npm run setup`이 `.vsix` 빌드와 VS Code 설치를 한 번에 합니다.
끝나면 VS Code에서 `Ctrl+Shift+P` → **`Developer: Reload Window`**.
왼쪽 활동 표시줄에 GPT Bridge 아이콘이 생기면 설치된 것입니다.

> `cd GPT-Bridge`가 필요한 이유 — `git clone`은 현재 위치에 저장소 이름으로
> **폴더를 새로 만들고** 그 안에 파일을 넣습니다. 명령이 끝나도 내 위치는 바깥이라
> 그 폴더로 들어가야 `npm install`이 제대로 돕니다.

**갱신할 때**는 `git pull && npm install && npm run setup`.

### `code` 명령을 찾지 못한다고 나오면

빌드는 됐고 설치만 실패한 것입니다. VS Code 화면에서 직접 넣으면 됩니다.

1. 왼쪽 **확장** 아이콘 → 오른쪽 위 `...` → **VSIX에서 설치**
2. 저장소 폴더의 `gpt-bridge-0.1.0.vsix` 선택

`code` 명령을 쓰려면 `Ctrl+Shift+P` →
`Shell Command: Install 'code' command in PATH`를 실행해 두세요.

> ⚠️ **`.vsix`를 다른 PC에서 복사해 오지 마세요.** 파일 검색에 쓰는 ripgrep이
> OS·CPU별로 다른 파일이라, 다른 기기에서 만든 `.vsix`는 검색·목록 기능이 **조용히
> 죽습니다.** 기기마다 위 네 줄로 빌드하세요.

---

## ChatGPT 연결

ChatGPT는 인터넷에 있고 코드는 내 PC에 있습니다. 인터넷에서 내 PC로 들어올 수는
없으니 **반대로** 합니다 — 내 PC가 OpenAI로 전화를 걸어 놓고 끊지 않습니다.

```
ChatGPT ──(인증: 없음)──▶ OpenAI 터널 ◀──(나가는 연결)── tunnel-client (내 PC)
                                                             │ Authorization 주입
                                                             ▼
                                                  127.0.0.1:3737  GPT Bridge
```

공개 주소가 생기지 않고 **토큰이 PC를 벗어나지 않습니다.**

아래는 요약입니다. 화면별 자세한 절차와 문제 해결은
[`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)에 있습니다.

### 1. 터널 만들기

[platform.openai.com → Tunnels](https://platform.openai.com/settings/organization/tunnels)
→ **Create tunnel**. 이름과 설명은 필수입니다.
`tunnel_`로 시작하는 ID를 적어 두세요.

### 2. API 키 발급

[API keys](https://platform.openai.com/settings/organization/api-keys) →
**Create new secret key**. 권한은 **All**로 두세요 — 터널 전용 권한 항목은 없습니다.
`sk-`로 시작하는 값을 적어 두세요 — **한 번만 보입니다.**

> 이 키는 설정 파일에 평문으로 저장되고 오래 떠 있는 프로세스가 씁니다.
> **이 용도로만 쓰는 키를 따로 발급**하세요. 다른 데 쓰던 키를 재사용하면
> 나중에 폐기할 때 그쪽까지 같이 끊깁니다.

### 3. tunnel-client 내려받기

[릴리스 페이지](https://github.com/openai/tunnel-client/releases)에서 자기 OS용
zip 하나만 받습니다 (Windows 대부분 `windows-amd64`).

**압축을 풀기 전에**, 받은 **zip 파일 자체**의 해시를 확인하고 같은 페이지의
`SHA256SUMS.txt`와 대조합니다.

```cmd
:: Windows — 경로 끝이 .zip 이어야 합니다
certutil -hashfile "C:\...\tunnel-client-v0.0.11-windows-amd64.zip" SHA256
```
```bash
# macOS / Linux
shasum -a 256 "~/Downloads/tunnel-client-v0.0.11-windows-amd64.zip"
```

> `ERROR_FILE_NOT_FOUND`가 나오면 **폴더 경로를 넣은 것**입니다. 이 명령은 파일
> 하나의 해시를 구하므로 압축을 푼 폴더가 아니라 **zip 파일**을 가리켜야 합니다.
> `SHA256SUMS.txt`의 값도 zip 기준이라 내용물과는 대조할 수 없습니다.
>
> zip을 찾으려면 `dir /s /b "%USERPROFILE%\*tunnel-client*.zip"`.

값이 다르면 멈추세요. 같으면 **저장소 밖** 아무 폴더에나 압축을 풉니다.

### 4. 설정 파일 만들기

`%APPDATA%\tunnel-client\gpt-bridge.yaml`
(macOS·Linux는 `~/.config/tunnel-client/gpt-bridge.yaml`)

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "여기에_터널ID"
  api_key: "여기에_OpenAI키"

health:
  listen_addr: "127.0.0.1:8080"

log:
  level: warn

mcp:
  server_urls:
    - channel: main
      url: "http://127.0.0.1:3737/mcp"

  # GPT Bridge는 모든 요청에 Authorization 헤더를 요구한다.
  # ChatGPT는 이 헤더를 보낼 수단이 없으므로 여기서 대신 붙인다.
  extra_headers:
    Authorization: "Bearer 여기에_64자토큰"
```

> YAML은 들여쓰기로 구조를 판단합니다. **탭이 아니라 스페이스**를 쓰고 여백을
> 건드리지 마세요. 메모장으로 저장할 때 파일 형식을 **모든 파일**로 바꾸지 않으면
> `gpt-bridge.yaml.txt`가 됩니다.

### 5. 토큰 얻어 채우기

VS Code에서 작업할 폴더를 열고:

1. `Ctrl+,` → `gptBridge.tunnel.provider` → **`none`**
   (확장이 자체 터널을 띄우지 않게 합니다)
2. `Ctrl+Shift+P` → **`GPT Bridge: 서버 시작`**
3. `Ctrl+Shift+P` → **`GPT Bridge: 인증 토큰 복사`**

복사된 64자를 위 설정의 `Bearer` **뒤에** 붙입니다. `Bearer` + 공백 1칸 + 토큰.

### 6. 터널 실행

```bash
tunnel-client doctor --profile gpt-bridge --explain   # 설정 점검
tunnel-client run --profile gpt-bridge                # 실행 (창을 켜 둡니다)
```

상태 확인: <http://127.0.0.1:8080/ui>

### 7. ChatGPT에 커넥터 등록

터널이 **돌아가는 동안** 해야 합니다.

1. ChatGPT → 설정 → **Apps & Connectors** → **Advanced** → **Developer Mode** 켜기
2. 커넥터 추가 → `연결`: **터널** → 만든 터널 선택
3. `인증`: **`인증없음`** ← **반드시 이것**

> **왜 `인증없음`인가** — 커넥터가 보낸 헤더가 마지막에 적용되어 정적 헤더를
> **덮어씁니다.** `OAuth`나 `혼합`을 고르면 ChatGPT의 `Authorization`이 우리가
> 주입한 Bearer를 밀어내고 401이 납니다.

### 8. 지침 넣기

`Ctrl+Shift+P` → **`GPT Bridge: ChatGPT 지침 복사`** → ChatGPT에 붙여넣기.

**사실상 필수입니다.** GPT는 명시적으로 시키지 않으면 커스텀 툴을 잘 부르지
않습니다. 넣는 곳은 세 군데이고 적용 범위가 다릅니다.

| 위치 | 범위 |
|---|---|
| **프로젝트 지침** ← 권장 | 그 프로젝트의 대화만 |
| 전역 맞춤 설정 | 모든 대화 (관계없는 대화에서도 툴을 부르려 합니다) |
| 대화 첫 메시지 | 그 대화만 |

### 매번 쓰는 순서

1. VS Code → `GPT Bridge: 서버 시작`
2. `tunnel-client run --profile gpt-bridge`

---

## 보안

로컬 파일시스템을 외부 AI에 여는 도구입니다. 다음이 방어선입니다.

- **경로 관문** — 모든 파일 접근이 단일 검증을 통과합니다. 워크스페이스 밖,
  심볼릭 링크 우회, Windows의 ADS(`.env::$DATA`)·예약 장치명(`CON`)·드라이브
  상대 경로까지 막습니다. 경로 구분자는 `/`만 받습니다.
- **거부 목록** — `.git/**`, `.env*`, `*.pem`, `*.key`, `id_rsa*`, `.ssh/**`,
  `.aws/**`, `.npmrc`, `.netrc` 등. 설정으로 추가만 가능하고 제거는 불가합니다.
- **승인 게이트** — 쓰기는 모달로 확인받습니다. 동시 요청은 직렬 큐로 하나씩
  처리하고, 90초 무응답은 거부이며 **만료 후 누른 선택은 폐기**됩니다.
  `delete_path`는 어떤 모드에서도 항상 확인합니다.
- **인증** — 32바이트 난수 Bearer 토큰, `127.0.0.1` 바인드, CORS 미적용.
- **감사 로그** — 툴 호출뿐 아니라 차단·거부·만료·인증 실패까지 JSONL로 남깁니다.

토큰이 유출되면 워크스페이스가 통째로 열립니다. 감수한 전제이며, 대응은
`GPT Bridge: 토큰 재발급` 하나입니다. 재발급하면 설정 파일의 `Authorization`도
같이 고쳐야 합니다.

## 설정

| 항목 | 기본값 | 설명 |
|---|---|---|
| `gptBridge.port` | `3737` | 서버 포트 |
| `gptBridge.autoStart` | `false` | VS Code 시작 시 자동 실행 |
| `gptBridge.tunnel.provider` | `cloudflare` | 외부 터널 사용 시 `none` |
| `gptBridge.approval.mode` | `always` | `always` / `session` / `pattern` |
| `gptBridge.autoSave` | `false` | 끄면 `Ctrl+S` 전까지 디스크 안전 |
| `gptBridge.maxReadBytes` | `1048576` | 한 번에 읽을 최대 바이트 |

## 알려진 제약

1. PC와 터널이 살아 있는 동안만 동작합니다.
2. 쓰기는 ChatGPT 쪽과 확장 쪽에서 각각 확인을 받아 **2단계**가 됩니다.
3. `.vsix`에는 **빌드한 기기의 플랫폼용 ripgrep만** 들어갑니다.
4. 워크스페이스가 git 저장소가 아니면 `.gitignore`가 반영되지 않습니다.
5. 멀티 루트 워크스페이스는 첫 번째 폴더만 대상입니다.
6. 터미널 명령 실행과 Git 조작 툴은 제공하지 않습니다.
7. **"저장 전까지 디스크 안전"은 텍스트 수정에만 해당합니다.**

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/extension.js
npm run watch       # 변경 감시
npm run package     # .vsix 생성만
```

`F5`로 확장 개발 호스트를 띄우려면 `.vscode/launch.json`이 필요합니다.
에디터 개인 설정이라 저장소에 넣지 않았으니 직접 만드세요.

```jsonc
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "확장 실행",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}"],
      "outFiles": ["${workspaceFolder}/dist/**/*.js"]
    }
  ]
}
```

먼저 `npm run watch`를 띄워 두고 `F5`를 누르면 됩니다.

## 라이선스

MIT
