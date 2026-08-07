# ChatGPT 연동 설치 가이드 (OpenAI Secure MCP Tunnel)

GPT Bridge를 ChatGPT에 연결하는 전체 절차입니다.
**아무 PC에서나 이 문서만 보고 처음부터 끝까지** 할 수 있게 썼습니다.

대부분 마우스로 합니다. 명령 프롬프트가 필요한 곳은 딱 두 군데뿐이고,
각 단계 제목에 무엇으로 하는지 표시해 두었습니다.

| 표시 | 뜻 |
|---|---|
| 🌐 | 웹 브라우저 |
| 📁 | 탐색기 (마우스) |
| 📝 | 메모장 |
| 💻 | 명령 프롬프트 |
| 🧩 | VS Code |

- 설계 배경: [`project.md`](./project.md)
- 검증 항목: [`VERIFICATION.md`](./VERIFICATION.md) C-T 절

---

## 0. 무슨 구조인가

ChatGPT는 인터넷에 있고 코드는 내 PC에 있습니다. 인터넷에서 내 PC로 그냥 들어올
수는 없습니다 — 초인종이 없으니까요.

그래서 **반대로** 합니다. 내 PC가 OpenAI로 전화를 걸어 놓고 끊지 않습니다.
ChatGPT가 뭔가 필요하면 이미 열린 그 선으로 얘기합니다.

```
ChatGPT
   │  ① 인증 "없음"으로 등록 (ChatGPT는 비밀번호를 보내지 않는다)
   ▼
OpenAI 터널 (전화 교환소)
   ▲
   │  ② tunnel-client가 여기로 전화를 걸어 놓는다 (나가는 방향)
tunnel-client  ← 내 PC에서 실행
   │  ③ 여기서 Authorization: Bearer 를 붙여 준다
   ▼
http://127.0.0.1:3737/mcp
GPT Bridge 확장 (코드를 읽고 고치는 본체)
```

**핵심은 ③입니다.** GPT Bridge는 모든 요청에 비밀번호(Bearer 토큰)를 요구하는데,
ChatGPT의 커넥터 등록 화면에는 인증 선택지가 `OAuth` / `인증없음` / `혼합` 셋뿐이라
비밀번호를 보낼 방법이 없습니다. 그래서 `tunnel-client`가 **로컬로 넘길 때 대신
붙여 줍니다.** 확장 코드는 고칠 필요가 없습니다.

부수 효과가 좋습니다. **토큰이 PC를 벗어나지 않고**, 공개 주소도 생기지 않습니다.

### 준비하면서 모으게 되는 값 세 개

나중에 설정 파일 한 곳에 몰아 넣습니다. 메모장에 적어 두세요.

| 값 | 어디서 나오나 |
|---|---|
| 터널 ID (`tunnel_...`) | 2단계 |
| OpenAI API 키 (`sk-...`) | 3단계 |
| GPT Bridge 토큰 (64자) | 6단계 |

---

## 1단계 💻 — GPT Bridge 확장 설치

터널을 붙일 대상이 먼저 있어야 합니다. **명령 네 줄이면 끝납니다.**

필요한 것: [Git](https://git-scm.com/downloads),
[Node.js](https://nodejs.org/) (LTS), VS Code.

```cmd
git clone https://github.com/DreamURL/vscodeconnector.git
cd vscodeconnector
npm install
npm run setup
```

`npm run setup` 이 빌드(`.vsix` 생성)와 설치를 한 번에 합니다.
끝나면 VS Code에서 `Ctrl+Shift+P` → **`Developer: Reload Window`**.

왼쪽 활동 표시줄에 GPT Bridge 아이콘이 생기면 설치된 것입니다.

> ⚠️ **`.vsix`를 다른 PC에서 복사해 오지 마세요.** 파일 검색에 쓰는 ripgrep이
> OS·CPU별로 다른 파일이고 `npm install`은 설치하는 기기의 것만 받습니다. 다른
> 데서 만든 `.vsix`를 가져오면 검색·목록 기능이 조용히 죽습니다(`project.md` §2.1).
> 그래서 저장소에 `.vsix`를 넣지 않고 각 기기에서 빌드하게 되어 있습니다.

### `code` 명령을 못 찾는다고 나오면

빌드는 됐고 설치만 실패한 것입니다. VS Code 화면에서 직접 넣으면 됩니다.

1. 왼쪽 **확장** 아이콘 클릭
2. 확장 패널 오른쪽 위 **`...`** → **VSIX에서 설치**
3. 저장소 폴더의 `gpt-bridge-0.1.0.vsix` 선택

`code` 명령을 쓰고 싶으면 `Ctrl+Shift+P` →
`Shell Command: Install 'code' command in PATH` 를 실행해 두세요.

### 나중에 최신으로 갱신할 때

```cmd
git pull
npm install
npm run setup
```

---

## 2단계 🌐 — OpenAI에 터널 만들기

1. https://platform.openai.com/settings/organization/tunnels 접속
2. 오른쪽 위 **Create tunnel**
3. `Name`과 `Description` 입력 — **둘 다 필수**입니다
4. `Organizations`는 기본값 그대로
5. **Create**

`tunnel_` 로 시작하는 32자리 ID가 나옵니다. **메모장에 적어 두세요.**

```
모양: tunnel_0123456789abcdef0123456789abcdef
```

> **PC마다 터널을 따로 만드는 것을 권합니다.** 하나의 터널에 여러 PC가 동시에
> 붙으면 어느 쪽으로 요청이 갈지 예측하기 어렵습니다. 이름을 구분해 두면
> (`gpt bridge - 집`, `gpt bridge - 회사`) 나중에 헷갈리지 않습니다.

## 3단계 🌐 — API 키 발급

`tunnel-client`가 OpenAI에 "저 맞습니다"라고 보여 줄 신분증입니다.

1. https://platform.openai.com/settings/organization/api-keys 접속
2. **Create new secret key**
3. 이름은 아무거나 (예: `gpt-bridge-tunnel`)
4. 권한 항목에 **Tunnels** 가 있으면 **Read + Use** 를 켭니다
5. **`sk-` 로 시작하는 긴 문자열**이 나옵니다 → **메모장에 적어 두세요**

> 이 값은 **한 번만 보입니다.** 창을 닫으면 다시 못 봅니다. 잃어버리면 새로
> 만들면 되니 큰일은 아닙니다. 채팅·이슈·커밋에 붙여넣지 마세요.

> **관리자 키(Admin key)와 다릅니다.** 관리자 키는 터널을 만들고 지우는 용도이고
> 오래 떠 있는 프로그램에는 주지 않습니다. 여기서 필요한 건 **런타임 키**입니다.

---

## 4단계 🌐📁💻 — tunnel-client 내려받기

### 받기 (브라우저)

1. https://github.com/openai/tunnel-client/releases 접속
2. 최신 릴리스에서 **자기 PC에 맞는 것 하나만** 받습니다

| 내 PC | 받을 파일 |
|---|---|
| Windows 일반 (대부분) | `tunnel-client-vX.Y.Z-windows-amd64.zip` |
| Windows ARM (Surface 등) | `...-windows-arm64.zip` |
| Mac (M1 이상) | `...-darwin-arm64.zip` |
| Mac (인텔) | `...-darwin-amd64.zip` |

`all.zip`(150MB)은 전 플랫폼 묶음이라 받을 필요 없습니다.

3. 같은 페이지의 **`SHA256SUMS.txt`** 를 클릭해 열어 둡니다

### 해시 확인 (명령 프롬프트 — 한 줄)

받은 파일이 중간에 바뀌지 않았는지 확인합니다. 남이 만든 실행 파일을 그냥 돌리지
않는다는 원칙이고, 이 확장이 cloudflared에 대해 하는 것과 같은 절차입니다(§6.1).

명령 프롬프트에서 (파일명은 받은 버전에 맞게):

```cmd
certutil -hashfile "%USERPROFILE%\Downloads\tunnel-client-v0.0.11-windows-amd64.zip" SHA256
```

출력된 값이 `SHA256SUMS.txt`의 해당 파일 줄과 **글자 하나까지 같아야** 합니다.

> ❌ **다르면 멈추세요.** 다시 받지 말고 파일을 지운 뒤 원인부터 확인합니다.
> 재시도로 넘기지 않습니다.

### 압축 풀기 (탐색기)

zip 파일 **우클릭 → 압축 풀기**. 폴더는 어디든 상관없습니다.

> ⚠️ **저장소 폴더 안에는 풀지 마세요.** 83MB짜리 외부 도구라 git에 딸려 들어가면
> 저장소가 무거워집니다.

안에 이런 것들이 들어 있습니다.

| 파일 | |
|---|---|
| `tunnel-client.exe` | 본체 |
| `cloudflared.exe` | 실제 터널을 만드는 프로그램 (OpenAI가 내장해 배포) |
| `cloudflared-manifest.json` | 내장된 cloudflared 버전 정보 |

> OpenAI 터널은 내부적으로 **Cloudflare Tunnel**을 씁니다. 버전 관리와 보안 패치는
> OpenAI가 맡는다고 매니페스트에 적혀 있어 우리가 신경 쓸 부분은 없습니다.

---

## 5단계 📝 — 설정 파일 만들기

`tunnel-client`가 읽을 설정 파일입니다. 메모장으로 직접 만듭니다.

### 폴더 열기

`Win + R` → 아래를 붙여넣고 확인:

```
%APPDATA%
```

탐색기가 열리면 그 안에 **`tunnel-client`** 라는 폴더를 만듭니다.
(우클릭 → 새로 만들기 → 폴더)

### 파일 만들기

메모장을 열고 아래를 통째로 붙여넣습니다. **아직 값은 안 채워도 됩니다.**

```yaml
config_version: 1

control_plane:
  base_url: "https://api.openai.com"
  tunnel_id: "여기에_터널ID"
  api_key: "여기에_OpenAI키"

health:
  listen_addr: "127.0.0.1:8080"

admin_ui:
  open_browser: false

log:
  level: info
  format: json

mcp:
  server_urls:
    - channel: main
      url: "http://127.0.0.1:3737/mcp"

  # GPT Bridge는 모든 요청에 Authorization 헤더를 요구한다(없으면 401).
  # ChatGPT는 이 헤더를 보낼 수단이 없으므로 여기서 대신 붙인다.
  extra_headers:
    Authorization: "Bearer 여기에_64자토큰"
```

**파일 → 다른 이름으로 저장**:

- 위치: 방금 만든 `tunnel-client` 폴더
- 파일 이름: **`gpt-bridge.yaml`**
- 파일 형식: **모든 파일** ← 이걸 바꾸지 않으면 `gpt-bridge.yaml.txt` 로 저장됩니다
- 인코딩: `UTF-8`

최종 경로가 이렇게 됩니다.

```
%APPDATA%\tunnel-client\gpt-bridge.yaml
```

> **들여쓰기가 중요합니다.** YAML은 왼쪽 여백으로 구조를 판단합니다.
> 붙여넣은 그대로 두시고, 값을 채울 때 앞 공백을 건드리지 마세요.
> **탭이 아니라 스페이스**를 씁니다.

> **`tunnel_id`와 `api_key`에 2·3단계에서 적어 둔 값을 지금 넣으셔도 됩니다.**
> 토큰(`Authorization`)만 6단계에서 나옵니다.

---

## 6단계 🧩 — GPT Bridge 서버 켜고 토큰 얻기

VS Code에서 **작업할 폴더를 연 창**에서 합니다.

1. `Ctrl + ,` → `gptBridge.tunnel.provider` 검색 → **`none`** 으로 변경

   > 기본값 `cloudflare`로 두면 확장이 자기 터널을 또 띄웁니다. OpenAI 터널을
   > 쓸 때는 필요 없고, 공개 주소가 생겨 버려 오히려 손해입니다.

2. `Ctrl + Shift + P` → **`GPT Bridge: 서버 시작`**
3. `Ctrl + Shift + P` → **`GPT Bridge: 인증 토큰 복사`**

64자짜리 문자열이 클립보드에 들어갑니다.

## 7단계 📝 — 설정 파일에 값 채우기

`Win + R` → 붙여넣고 확인:

```
notepad %APPDATA%\tunnel-client\gpt-bridge.yaml
```

세 자리를 채웁니다. **따옴표는 그대로 두세요.**

```yaml
  tunnel_id: "tunnel_0123456789abcdef0123456789abcdef"
  api_key: "sk-..."
...
    Authorization: "Bearer 64자토큰"
```

> ⚠️ **`Bearer` 를 지우지 마세요.** `Bearer` + 공백 1칸 + 토큰입니다.
> 빠지면 감사 로그에 `auth_failure / malformed` 로 찍힙니다.

저장하고 닫습니다.

> **비밀값이 파일에 평문으로 남습니다.** 이 파일은 `%APPDATA%` 안에 있어 git에
> 올라가지도, 다른 기기로 동기화되지도 않으므로 개인 PC에서는 무난한 선택입니다.
> 더 조이고 싶으면 값 대신 `"env:변수명"` 이라고 쓰고 환경변수로 넘길 수 있습니다.

---

## 8단계 📁 — 실행

`tunnel-client.exe` 가 있는 폴더에 메모장으로 아래 내용을 만들고
**`터널 시작.bat`** 으로 저장합니다. (파일 형식 = 모든 파일)

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

> ⚠️ **배치 파일 안에는 한글을 쓰지 마세요.** cmd는 `.bat`을 UTF-8이 아니라 시스템
> 기본 인코딩으로 읽습니다. 메모장이 UTF-8로 저장하면 한글이 깨지고, 깨진 글자를
> 명령어로 해석하려다 `'...'은(는) 내부 또는 외부 명령이 아닙니다` 오류가 쏟아집니다.
> 안내 문구를 영문으로 두면 인코딩과 무관하게 항상 동작합니다.

**더블클릭하면 실행됩니다.**

먼저 설정을 점검하고, 통과해야 연결로 넘어갑니다. 실패하면 이유를 보여 주고
창이 멈춰 있어 읽을 수 있습니다.

> **이 창은 켜 둔 채로 둡니다.** 전화를 걸어 놓은 상태라 닫으면 끊깁니다.

바탕화면에 두고 쓰려면 파일 우클릭 → 보내기 → **바탕 화면에 바로 가기 만들기**.

상태 확인은 브라우저에서:

- http://127.0.0.1:8080/healthz — 살아 있는지
- http://127.0.0.1:8080/readyz — 연결이 준비됐는지
- http://127.0.0.1:8080/ui — 상태 화면

---

## 9단계 🌐 — ChatGPT에 등록

**터널이 돌아가는 동안** 해야 합니다. 꺼져 있으면 ChatGPT가 툴 목록을 못 가져옵니다.

1. ChatGPT → 설정 → **Apps & Connectors** → **Advanced** → **Developer Mode** 켜기
2. 새 커넥터(플러그인) 추가
3. `이름`: 아무거나
4. `연결`: **터널** 선택 → 목록에서 만든 터널 고르기
5. `인증`: **`인증없음`** ← **반드시 이것**
6. 위험 안내 체크박스에 동의 → **만들기**

> ### 왜 `인증없음`인가
>
> 공식 문서에 이런 규칙이 있습니다 — **"커넥터가 전달한 요청 헤더가 마지막에
> 적용되어 정적 헤더를 덮어쓴다."**
>
> `OAuth`나 `혼합`을 고르면 ChatGPT가 자기 `Authorization` 헤더를 보내고, 그게
> 설정 파일에 넣은 Bearer를 **밀어냅니다.** 그러면 GPT Bridge는 모르는 값을 받아
> 401을 냅니다.
>
> `인증없음`을 골라야 ChatGPT가 아무 헤더도 안 보내고 우리 비밀번호가 살아남습니다.
> 오른쪽 `고급 OAuth 설정` 패널은 전혀 건드리지 않습니다.

### 마지막으로 지침 넣기

VS Code에서 `Ctrl+Shift+P` → **`GPT Bridge: ChatGPT 지침 복사`** 로 지침을 복사한 뒤
ChatGPT에 붙여넣습니다. **커넥터 등록 화면에는 지침 칸이 없습니다.** 아래 세 곳
중 하나에 넣으세요 — 적용 범위가 다릅니다.

| 방법 | 적용 범위 | 위치 |
|---|---|---|
| **프로젝트 지침** ← 권장 | 그 프로젝트 안의 대화만 | 왼쪽 사이드바 → 프로젝트 만들기 → 지침 |
| 전역 커스텀 지침 | **모든 대화** | 설정 → 개인 맞춤 설정 → 맞춤 설정 |
| 대화창에 붙여넣기 | 그 대화 하나만 | 새 대화의 첫 메시지 |

> **전역은 권하지 않습니다.** 관계없는 대화에서도 ChatGPT가 GPT Bridge 툴을
> 부르려 합니다. 평소엔 터널이 꺼져 있으니 매번 실패하고 답변 품질만 나빠집니다.
>
> 프로젝트 기능이 안 보이면 **대화창에 붙여넣는 방법**을 쓰세요. 번거롭지만
> 지침이 대화 맨 앞에 있는 형태라 모델이 가장 잘 따릅니다.

**선택이 아니라 사실상 필수입니다.** GPT는 명시적으로 시키지 않으면 커스텀 툴을
잘 부르지 않습니다(`project.md` §10-3). 지침에는 `edit_file` 우선 사용, 수정 후
`get_diagnostics` 확인, 같은 파일 반복 읽기 금지(6~11번) 같은 내용도 들어 있어
빠뜨리면 토큰이 훨씬 빨리 소진됩니다.

### 동작 확인

새 대화에서: **"이 프로젝트 구조를 설명하고 타입 에러를 알려줘"**

- GPT가 `get_workspace_info` 를 먼저 부르면 정상입니다
- VS Code 사이드바의 GPT Bridge 패널에 호출 기록이 실시간으로 쌓입니다

---

## 매번 쓰는 순서

설치는 한 번이고, 이후에는 이것만 반복합니다.

1. 🧩 VS Code → `Ctrl+Shift+P` → `GPT Bridge: 서버 시작`
2. 📁 `터널 시작.bat` 더블클릭

끝입니다.

---

## 문제가 생기면

먼저 **감사 로그**를 보세요. 원인이 거의 바로 드러납니다.
`Win + R` 에 붙여넣기:

```
notepad %APPDATA%\Code\User\globalStorage\local.gpt-bridge\audit\audit.jsonl
```

한 줄이 한 사건이고 맨 아래가 최신입니다.

| 증상 | 로그 | 원인 |
|---|---|---|
| ChatGPT가 연결 실패 | **아무것도 없음** | 요청이 도달을 못 함 → 터널이 꺼졌거나 `url` 이 틀림 |
| 연결은 되는데 전부 실패 | `auth_failure` / `missing` | `extra_headers` 를 안 넣었거나 들여쓰기가 틀림 |
| 〃 | `auth_failure` / `malformed` | `Bearer ` 접두사 누락 |
| 〃 | `auth_failure` / `mismatch` | 토큰 값이 틀림. **재발급 후 설정 파일을 안 고쳤을 때** 가장 흔함 |
| 툴 목록에 검색이 없음 | — | ripgrep 누락. 그 PC에서 `.vsix`를 다시 만들어야 함 (§2.1) |
| GPT가 툴을 아예 안 부름 | 아무것도 없음 | 커스텀 지침 미적용 (§10-3) |
| `doctor` 가 API 키 오류 | — | 키 권한에 Tunnels Read+Use 가 없거나 관리자 키를 잘못 넣음 |
| 설정 파일을 못 읽는다 | — | `gpt-bridge.yaml.txt` 로 저장됐을 가능성. 탐색기에서 확장자 표시를 켜고 확인 |
| `.bat` 실행 시 `'...'은(는) 내부 또는 외부 명령이 아닙니다` 가 쏟아짐 | — | 배치 파일에 한글이 들어갔고 UTF-8로 저장됨. **안내 문구를 영문으로** 바꾸세요 (8단계 경고) |

### 정상인데 오류처럼 보이는 것들

**첫 연결 때 아래 셋이 나오는 것은 정상입니다.** 무시하세요.

| 어디에 | 무엇이 | 왜 |
|---|---|---|
| tunnel-client 로그 | `OAuth discovery failed` — `invalid character '<'` | tunnel-client가 `/.well-known/oauth-protected-resource` 를 찔러 보는데 우리는 OAuth 서버가 아니라 그 주소가 없다. Express가 HTML 404를 주니 JSON 파서가 `<!DOCTYPE` 의 `<` 에서 걸린다 |
| 감사 로그 | `auth_failure` / `missing` 2~3건 | 위와 같은 사건. 그 탐색 요청에는 Bearer가 붙지 않는다. **시작 직후에만** 나오면 정상 |
| tunnel-client 로그 | `server/discover` 400 | MCP 표준이 아닌 OpenAI 확장 메서드라 우리 서버가 모른다. ChatGPT는 곧바로 표준 방식으로 되돌아간다 |

구분법은 간단합니다 — **툴을 실제로 부른 뒤에도 `auth_failure` 가 계속 쌓이면** 진짜 문제이고,
시작할 때만 몇 건 찍히고 그 뒤로 `tool_call` 이 정상적으로 이어지면 정상입니다.

### 로그가 너무 많으면

`gpt-bridge.yaml` 에서 한 줄만 바꾸세요.

```yaml
log:
  level: warn      # info → warn. 문제가 있을 때만 찍힌다
```

기타 확인 지점:

- `url` 이 `http://127.0.0.1:3737/mcp` — **경로 `/mcp` 까지** 있는지
- `gptBridge.port` 를 바꿨다면 설정 파일의 `url` 도 같이 고쳐야 합니다
- VS Code에서 **폴더를 열지 않았으면** 파일 툴이 동작하지 않습니다

---

## 알아 둘 것

**토큰을 재발급하면 설정 파일도 같이 고쳐야 합니다.**
`GPT Bridge: 토큰 재발급`을 하면 확장은 옛 토큰을 즉시 무효화하는데 터널은 계속
옛 값을 보내서 모든 요청이 401이 됩니다. 로그에 `mismatch`가 쌓이면 이걸 의심하세요.

**tunnel-client 버전을 함부로 올리지 마세요.**
1.0 이전이라 설정 키 이름이나 동작이 바뀔 수 있습니다. 잘 되는 버전을 그대로 두고,
갑자기 안 되면 버전이 올라간 것을 먼저 의심하세요. 이 확장이 cloudflared를
`2026.7.3`으로 고정해 둔 것과 같은 이유입니다.

**비용은 확인되지 않았습니다.**
OpenAI 공식 가격표에 tunnel 항목이 없고 가이드 문서에도 언급이 없습니다. 터널
생성과 클라이언트 다운로드 단계에서는 과금 요청이 없었습니다. 나중에 청구가
붙는다면 `gptBridge.tunnel.provider` 를 `cloudflare` 로 되돌리는 경로가 살아 있습니다.

**이 방식이 Cloudflare 경로보다 안전합니다.**
Cloudflare로 하면 워크스페이스가 공개 HTTPS 주소로 열리고 토큰을 ChatGPT 설정에
붙여넣어야 합니다. 이 방식은 공개 주소가 생기지 않고 **토큰이 PC를 벗어나지
않습니다.** `project.md` §5.7이 감수 사항으로 적어 둔 "토큰 유출 = 전체 노출"의
노출면이 그만큼 줄어듭니다.

---

## 다른 PC에 설치할 때 체크리스트

```
[ ] git clone → npm install → npm run setup   (그 PC에서 직접. ripgrep 때문)
[ ] OpenAI에 터널 만들기 → 터널ID 확보      (PC마다 따로 권장)
[ ] API 키 발급 (Tunnels Read + Use)
[ ] tunnel-client 내려받기 + 해시 확인
[ ] 탐색기로 압축 풀기 (저장소 밖)
[ ] %APPDATA%\tunnel-client\gpt-bridge.yaml 작성
[ ] VS Code: tunnel.provider=none → 서버 시작 → 토큰 복사
[ ] 설정 파일에 값 3개 채우기
[ ] 터널 시작.bat 만들고 더블클릭
[ ] ChatGPT 커넥터 등록 (연결=터널, 인증=인증없음)
[ ] 커스텀 지침 붙여넣기
[ ] "프로젝트 구조 설명해줘" 로 동작 확인
```
