# 직접 검증해야 하는 항목

자동 테스트 **159개**가 통과합니다(Windows 기준 158 통과 / 1 skip — 파일 심볼릭
링크는 관리자 권한이 필요해 건너뜁니다). 다만 자동 테스트는 **VS Code 확장 호스트
없이** 돌기 때문에, 검증되는 것은 순수 로직뿐입니다.

| 자동 테스트로 검증됨 | 직접 확인해야 함 |
|---|---|
| 경로 검증, 거부 목록, 인증, HTTP 계층 | `vscode` API를 실제로 호출하는 모든 경로 |
| ripgrep 실행, `.gitignore` 반영 | 버퍼 편집 · undo · 저장 동작 |
| 문자열 매칭(CRLF 포함), 승인 게이트 로직 | 모달 UI, 상태바, 패널 렌더링 |
| cloudflared 해시 테이블, tar 해제, URL 파싱 | 실제 터널 기동, ChatGPT 연동 |
| 감사 로그 JSONL, 읽기 이력 추적 | — |

환경: **Windows**. `project.md` §10의 제약을 함께 참고하세요.

## 진행 상황 (2026-08-05 · 08-07 실측)

| 구간 | 상태 |
|---|---|
| A 확장 골격 (A-1~7) | ✅ 완료 (08-05) |
| B 읽기 툴 (B-2~10) | ✅ 완료 (08-05) |
| B-보안 (B-S1~S11) | ✅ 완료 (08-05) |
| B-포트 | ✅ B-P2 / ⬜ B-P1 |
| **D 핵심 안전성 (D-1~4)** | ✅ **완료** (08-05) |
| D 쓰기·승인 (D-5~21) | ✅ 완료 (08-05) |
| E 감사 로그 (E-1~6) | ✅ 완료 / ⬜ E-7 |
| **E 패키징 (E-8~12)** | ✅ **완료** (08-07) |
| G 컨텍스트 절약 (Phase 6) | ✅ G-1~G-9 (08-07) / ⬜ G-10~G-11 |
| **C 터널·ChatGPT** | ✅ **완료** — C-T 경로 (08-07~08) |

### 2026-08-07 패키징 실측

Windows에서 `npm run package` → `code --install-extension`까지 확인했다.

- **E-8** `extension/node_modules/@vscode/ripgrep-win32-x64/bin/rg.exe` 5.18MB 포함.
  설치본 경로에서 직접 실행해 `ripgrep 15.0.0` 응답까지 확인했다. §2.1이 경고한
  지점이 실제로 막혀 있다.
- **E-9** `project.md` · `PROGRESS.md` · `src/` · `test/` 제외 확인. 다만 **`VERIFICATION.md`가
  들어가고 있었다.** Phase 5에서 이 문서를 만들 때 `.vscodeignore` 갱신을 빠뜨린 것이다.
  규칙을 추가하고 재패키징해 15개 파일 2.72MB로 정리했다.
- **E-10** `local.gpt-bridge@0.1.0` 설치 성공.
- **E-11** 설치본에서 `search_text` `query: "export"` → 5개 파일 9건 매치. §2.1이
  경고한 "개발 중엔 되다가 설치본에서만 죽는" 상황이 일어나지 않았다.
- **E-12** 설치본에서 `list_directory` → 8개 항목. `node_modules`와 `.env`가
  "2개 항목이 제외 규칙으로 숨겨졌습니다"로 집계되고, `.gitignore`에 걸린
  `tmp/x.txt`도 나오지 않았다(B-4가 설치본에서도 성립).

E-11 응답에 `"1개 파일은 접근이 차단되어 제외했습니다"`가 붙었다 — 검색 단계에서도
거부 목록이 적용된다는 뜻이고, rg 결과를 그대로 흘리지 않는다는 증거다.

같은 응답이 **G-8**(`context_lines` 기본값 2)도 함께 만족했다. `context_lines`를
주지 않은 검색에서 매치 줄 앞뒤 2줄이 함께 나왔다.

되돌리려면 `code --uninstall-extension local.gpt-bridge`.

### 2026-08-07 G 구간 실측

G-1~G-9 전부 통과. 판정 근거는 **육안 확인**이고, 감사 로그는 절차를 밟은 순서를
뒷받침한다(11:53:00 `sample.ts` → 11:53:14부터 `bigmodule.ts` 반복 → 11:55:23
서버 재시작 → 11:55:39 재읽기 → 11:56:04 `search_text`).

> **감사 로그로는 G의 합격을 증명할 수 없다.** `detail`에 경로와 질의만 들어가고
> 안내 문구·`start_line`·`context_lines`는 남지 않는다. 로그가 말해 주는 것은
> "언제 무엇을 호출했는가"까지다. 이 구간은 앞으로도 사람이 봐야 한다.

`durationMs`가 정황을 보탠다. `bigmodule.ts` 첫 읽기가 11ms, 이후가 1~2ms다.
첫 호출에서 파일을 열고 지문을 뜨는 비용이 드러난다.

### 로그에서 발견한 것 2건

- **`gptBridge.stop`이 감사 기록을 남기지 않았다.** 짝이 맞지 않는 `started`로
  드러났다. `stopped`를 추가했다(PROGRESS.md 참조). 실제로 떠 있었을 때만
  기록하므로 시작 실패 정리에서는 찍히지 않는다.
- **`auth_failure`에 `malformed`가 있다.** B절이 설명하는 `missing`·`mismatch`
  외의 세 번째 값으로, 헤더는 왔으나 `Bearer ` 형식이 아닐 때 나온다. 08-07
  Inspector 연결에서 4회 관측됐다. **B절 표 반영은 보류**(미조치).

[D-1 ~ D-4](#d-핵심-안전성-이-확장의-존재-이유)는 이 확장이 존재하는 이유입니다.
코드를 고친 뒤에는 이 넷을 **다시** 확인하세요.

> **C단계는 D가 통과한 뒤에 하세요.** C에서 터널을 켜면 워크스페이스가 공개
> HTTPS 주소로 노출됩니다. 문을 지키는 것은 Bearer 토큰이고 그 수준으로 충분하다고
> 판단했습니다(`project.md` §5.7) — 대신 **문 안에서 무엇을 할 수 있는지**를 막는
> 것이 D 구간입니다. 그쪽이 도는 것을 먼저 확인하고 노출하는 순서가 맞습니다.

---

## 사전 준비

```powershell
npm install
npm run compile     # typecheck + build + test 142개
```

VS Code에서 이 폴더를 열고 **F5**를 누르면 확장 개발 호스트 창이 뜹니다.
그 창에서 **테스트용 폴더를 하나 열어** 아래 항목을 진행하세요.
(실제 작업 저장소로 하지 마세요 — 파일이 수정·삭제됩니다.)

로그는 `GPT Bridge: 로그 열기` 명령으로 출력 패널에서 봅니다.

---

## A. Phase 1 — 확장 골격

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| A-1 | 확장이 활성화된다 | F5 후 새 창 | 상태바 오른쪽에 `$(circle-slash) GPT Bridge` |
| A-2 | 명령이 전부 노출된다 | `Ctrl+Shift+P` → `GPT Bridge` | 명령 **8개**가 모두 보임 |
| A-3 | 사이드바가 열린다 | 활동 표시줄의 GPT Bridge 아이콘 | 패널이 뜨고 **무한 로딩이 아님** |
| A-4 | 상태바 클릭 | 상태바 항목 클릭 | 사이드바 패널로 포커스 이동 |
| A-5 | 설정이 보인다 | 설정에서 `gptBridge` 검색 | 항목 **10개** (port, autoStart, tunnel.provider, tunnel.hostname, approval.mode, approval.autoApprovePatterns, approval.timeoutSeconds, autoSave, deny.extraPatterns, maxReadBytes) |
| A-6 | 토큰이 SecretStorage에 저장된다 | `GPT Bridge: 인증 토큰 복사` → 붙여넣기 | 64자 16진수. **`settings.json`에는 나타나지 않아야 함** |
| A-7 | 지침 복사 | `GPT Bridge: ChatGPT 지침 복사` | 5단계 작업 순서 텍스트가 클립보드에 |

---

## B. Phase 2 — 보안 기반 + 읽기 툴

서버를 띄우고 **MCP Inspector**로 확인합니다.

```powershell
# 확장 개발 호스트 창에서: "GPT Bridge: 서버 시작"
# 이어서 "GPT Bridge: 커넥터 URL 복사" (터널 전이면 http://127.0.0.1:3737/mcp)
#        "GPT Bridge: 인증 토큰 복사"

npx @modelcontextprotocol/inspector
```

Inspector 왼쪽 연결 패널을 이 순서로 채웁니다. **순서가 중요합니다** — Transport
Type을 정해야 인증 항목이 나타납니다.

1. **Transport Type**: `Streamable HTTP`
2. **Connection Type**: `Via Proxy`
   `Direct`는 실패합니다. 브라우저가 `localhost:6274`에서 `127.0.0.1:3737`로 직접
   요청하는 형태가 되는데, 우리 서버는 **CORS를 켜지 않습니다**(§5.2). 프록시는
   브라우저가 아니라 Node 프로세스라 이 제약을 받지 않습니다.
3. **URL**: `http://127.0.0.1:3737/mcp`
4. **인증**: `Custom Headers`에 `Authorization` = `Bearer <토큰>`을 **직접** 넣으세요.

> **`Bearer Token` 칸을 쓰지 마세요.** 프록시를 거치며 헤더가 전달되지 않아
> 401이 납니다. 그러면 Inspector는 "이 서버는 OAuth를 쓰는구나" 하고 `POST /register`를
> 시도하고, 없는 엔드포인트라 Express가 HTML 404를 돌려주면서
> `Invalid OAuth error response` 오류로 이어집니다.
>
> 증상이 헷갈릴 때는 감사 로그를 보세요. `"kind":"auth_failure"`의 `message`가
> `missing`이면 **헤더가 안 온 것**이고, `mismatch`면 토큰 값이 틀린 것입니다.
> 이 구분이 원인을 바로 짚어 줍니다.

### 테스트용 파일 준비

빈 폴더로는 B 항목 대부분을 확인할 수 없습니다. 최소한 이 정도는 만들어 두세요.

| 파일 | 용도 |
|---|---|
| `package.json`, `src/app.ts` | B-5 읽기, B-7 검색(`export`) |
| `sample.ts` | D-1~D-4 |
| `crlf.ts` (**CRLF 줄바꿈**) | D-5 |
| `dup.ts` (같은 줄이 정확히 2회) | D-7 |
| `broken.ts` (타입 에러) | B-9 |
| `.gitignore`(`tmp/`) + `tmp/x.txt` | B-4 |
| `node_modules/아무거나/index.js` | B-3 |
| `.env` | B-S2 |
| 1MB 넘는 파일 | B-10 |
| 빈 디렉터리 | D-14 |

**그리고 테스트 폴더에서 `git init`을 실행하세요.** ripgrep은 `--no-require-git`을
주지 않는 한 **git 저장소 안에서만** `.gitignore`를 적용합니다. 저장소가 아니면
`tmp/x.txt`가 목록에 나와 B-4가 실패한 것처럼 보입니다. `.git/config`는 B-S3의
대상이기도 합니다.

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| B-1 | 툴 10개가 보인다 | Inspector → List Tools | 읽기 5 + 쓰기 5 |
| B-2 | `get_workspace_info` | 인자 없이 호출 | 폴더명·파일 수·주요 언어·열린 탭·활성 파일·진단 요약 |
| B-3 | `list_directory` | `path: "."` | 항목 목록. **`node_modules`가 없어야 함** |
| B-4 | **`.gitignore` 반영** | `.gitignore`에 `tmp/` 추가 후 `tmp/x.txt` 생성 → `list_directory`. **`git init`이 되어 있어야 함** | `tmp/x.txt`가 **나오지 않아야 함** |
| B-5 | `read_file` | `path: "package.json"` | `<file_content ...>` 태그, 줄 번호 접두사 `  12│ ` |
| B-6 | **미저장 버퍼가 읽힌다** | 파일을 열어 수정만 하고 저장 안 함 → `read_file` | **수정된 내용**이 반환되고 `dirty="true"` |
| B-7 | `search_text` | `query: "export"` | 매치 줄에 `>` 표시, 앞뒤 2줄 컨텍스트 |
| B-8 | `-`로 시작하는 검색어 | `query: "--version"` | 오류 없이 "매치 없음" (rg 옵션으로 해석되면 안 됨) |
| B-9 | `get_diagnostics` | 일부러 타입 에러를 만든 뒤 호출 | 파일:줄:열, 심각도, 소스(ts/eslint) |
| B-10 | 큰 파일 거부 | 1MB 넘는 파일에 `read_file` | 거부 + 라인 범위 안내 |

### B-보안. 이건 반드시 확인하세요

| # | 입력 | 기대 결과 |
|---|---|---|
| B-S1 | `read_file` `path: "../../../Windows/System32/drivers/etc/hosts"` | **거부** + 우측 하단에 노란 경고 알림 |
| B-S2 | `read_file` `path: ".env"` (파일을 만들어 두고) | **거부**. 거부 규칙 이름이 메시지에 포함 |
| B-S3 | `read_file` `path: ".git/config"` | **거부** |
| B-S4 | `read_file` `path: ".env::$DATA"` | **거부** (Windows ADS) |
| B-S5 | `read_file` `path: "CON"` | **거부** — VS Code가 멈추면 안 됨 |
| B-S6 | `read_file` `path: "C:/Windows/win.ini"` | **거부** |
| B-S7 | `read_file` `path: "src\\app.ts"` (역슬래시) | **거부** — `/`를 쓰라는 안내 |
| B-S8 | 토큰 없이 요청 | `401` |
| B-S9 | 잘못된 토큰으로 요청 | `401` |
| B-S10 | 토큰 재발급 후 옛 토큰으로 요청 | `401` — `GPT Bridge: 토큰 재발급` 실행 후 Inspector에서 옛 토큰 유지 |
| B-S11 | 차단 시도가 눈에 보인다 | B-S1~S7 수행 후 사이드바 패널 확인 | 활동 목록에 **빨간 배경** 항목 |

> B-S11이 안 보이면 §5.5(조용한 실패 금지)가 깨진 것입니다.

### B-포트

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| B-P1 | 포트 충돌 처리 | 다른 프로그램이 3737을 쓰는 상태에서 서버 시작 | 오류 알림 + `설정 열기` 버튼 |
| B-P2 | 외부에서 접근 불가 | 다른 기기에서 `http://<PC의 IP>:3737/health` | **연결 실패** (127.0.0.1 바인드) |

---

## C. Phase 3 — 터널 + 패널

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| C-1 | cloudflared 다운로드 | 서버 시작 후 출력 패널 | 다운로드 로그 → **`SHA256 검증 통과`** |
| C-2 | 바이너리 위치 | `%APPDATA%\Code\User\globalStorage\local.gpt-bridge\` | `cloudflared-2026.7.3-win32-x64.exe` |
| C-3 | 재시작 시 재사용 | 서버 중지 → 시작 | `재사용` 로그, 다시 받지 않음 |
| C-4 | **해시 불일치 차단** | C-2의 파일 끝에 아무 바이트나 덧붙인 뒤 서버 재시작 | **다시 받는다.** 파일을 지우고 네트워크를 끊으면 터널 실패하되 **로컬 엔드포인트는 살아 있어야 함** |
| C-5 | 터널 URL 획득 | 서버 시작 후 패널 | `https://....trycloudflare.com/mcp` 표시 |
| C-6 | 상태바 색 변화 | 중지 → 시작 → 터널 연결 | 아이콘·색이 단계별로 바뀜 |
| C-7 | Quick Tunnel 경고 | 패널 확인 | 재시작 시 URL이 바뀐다는 경고 표시 |
| C-8 | 패널 동작 | 승인 모드 드롭다운 변경 | `settings.json`의 `gptBridge.approval.mode`가 바뀜 |
| C-9 | 자동 저장 체크박스 | 체크 | `gptBridge.autoSave`가 `true`로 |
| C-10 | 토큰 마스킹 | 패널의 인증 토큰란 | `abcd••••••••wxyz` 형태. **원문이 보이면 안 됨** |
| C-11 | **좀비 프로세스 없음** | 서버 시작 → 터널 연결 확인 → `Ctrl+Shift+P` → `Developer: Reload Window` → 작업 관리자 | `cloudflared.exe`가 **남아 있지 않아야 함** |
| C-12 | 종료 시 정리 | 확장 개발 호스트 창을 닫고 작업 관리자 확인 | `cloudflared.exe` 없음 |

> **C-11이 §11의 필수 항목입니다.** Windows에는 시그널이 없어 `taskkill /T /F`로 트리째
> 정리하도록 구현했습니다. 여기서 프로세스가 남으면 포트가 계속 물립니다.

### C-T. OpenAI Secure MCP Tunnel 경로 (2026-08-07 추가, 미검증)

cloudflared 대신 **OpenAI가 제공하는 터널**을 쓰는 경로다. ChatGPT 커넥터 등록
화면의 `연결: 터널`이 이것이다. 이 경로를 쓰면 **C-1~C-4·C-11·C-12는 해당 없음**이
된다(cloudflared를 아예 띄우지 않는다).

```
ChatGPT ──(인증없음)──▶ OpenAI 터널 ──▶ tunnel-client (로컬)
                                          │ ← Authorization: Bearer 주입
                                          ▼  http://127.0.0.1:3737/mcp
```

**ChatGPT 인증 드롭다운은 `OAuth` / `인증없음` / `혼합` 셋뿐이다.** `API key`나
커스텀 헤더 항목이 없어 ChatGPT가 우리 Bearer를 보낼 방법이 없다. 대신
`tunnel-client`가 로컬로 넘길 때 정적 헤더를 붙여 준다.

```yaml
mcp:
  server_urls:
    - channel: main
      url: http://127.0.0.1:3737/mcp      # 경로 /mcp까지 반드시
  extra_headers:
    Authorization: "env:GPT_BRIDGE_TOKEN"  # env: / file: 지원. 평문 금지
```

> **반드시 `인증없음`을 고른다.** 커넥터가 전달한 헤더가 마지막에 적용되어 정적
> 헤더를 덮어쓴다. `OAuth`·`혼합`을 고르면 ChatGPT의 `Authorization`이 우리가
> 주입한 Bearer를 밀어내고 서버가 401을 낸다.

| # | 확인할 것 | 기대 결과 |
|---|---|---|
| C-T1 | `gptBridge.tunnel.provider`를 `none`으로 두고 서버 시작 | cloudflared를 받지 않는다. 로컬 엔드포인트만 뜬다 |
| C-T2 | `tunnel-client` 기동 후 `/healthz` | 정상 |
| C-T3 | ChatGPT에서 터널 선택 + `인증없음`으로 커넥터 생성 | 툴 목록 10개가 잡힌다 |
| C-T4 | 툴 호출 | 감사 로그에 `tool_call`. **`auth_failure`가 없어야 함** |
| C-T5 | 토큰 재발급 후 그대로 호출 | `auth_failure / mismatch` — 터널 설정도 고쳐야 한다는 확인 |

토큰이 **ChatGPT 쪽에 저장되지 않는다.** Cloudflare 경로는 커넥터 설정에 토큰을
붙여넣어야 하지만 이 경로는 토큰이 로컬을 벗어나지 않고, 공개 URL도 생기지 않는다.
§5.7이 감수 사항으로 적은 "토큰 유출 = 전체 노출"의 노출면이 그만큼 줄어든다.

비용은 **미확인**이다. OpenAI 공식 가격표에 tunnel 항목이 없고 가이드 문서에도
언급이 없다. 터널 생성·클라이언트 다운로드·실제 연결까지 과금 요청이 없었다
(무료 ChatGPT 계정, 2026-08-07).

#### 2026-08-07 실측 — 연결 성공 ✅

`tunnel-client v0.0.11` + 무료 ChatGPT 계정 + Developer Mode로 **C-T1~C-T4 통과.**

| # | 결과 |
|---|---|
| C-T1 | ✅ `provider: none` 으로 cloudflared 미사용. 로컬 엔드포인트만 기동 |
| C-T2 | ✅ `tunnel-client` 기동, `🟢 tunnel-client started` |
| C-T3 | ✅ ChatGPT에서 `연결=터널` + `인증=인증없음` 으로 커넥터 생성 |
| C-T4 | ✅ `get_workspace_info` · `list_directory` 정상. **툴 호출 구간에 `auth_failure` 없음** |
| C-T5 | ✅ 토큰·API 키를 새로 발급하고 옛 것을 폐기한 뒤, 설정 파일을 갱신하고 재시작하니 정상 동작 (08-08) |

C-T5는 보안 사고 대응 절차이기도 하다. **비밀값이 노출됐을 때 밟을 경로가
실제로 동작한다는 확인**이다 — 새 값 발급 → 옛 값 폐기 → 설정 파일 갱신 →
터널 재시작. §5.7이 "유출 시 `regenerateToken` 한 번이 유일하고 충분한 대응"이라고
적은 것이 실측으로 뒷받침됐다.

> **설정 파일을 편집기에 열어 두지 말 것.** 이 파일에는 API 키와 Bearer 토큰이
> 평문으로 들어 있다. IDE 통합이 열린 파일 내용을 외부 도구에 전달할 수 있어,
> 키를 갈아 끼워도 파일이 열려 있으면 같은 노출이 반복된다. 편집이 필요할 때만
> 메모장으로 열고 닫는다. 비밀값을 별도 파일로 빼고 `api_key: "file:<경로>"` 로
> 참조하면 이 파일 자체에는 비밀값이 남지 않는다.

**Bearer 주입이 동작한다는 결정적 증거**는 tunnel-client 로그의 이 줄이다.

```
"msg":"mcp session initialized","server_name":"gpt-bridge","server_version":"0.1.0"
```

인증이 실패했다면 세션 자체가 성립하지 않는다. ChatGPT 쪽 인증을 `인증없음`으로
두고도 우리 서버의 Bearer 검사가 그대로 살아 있는 구성이 실제로 성립했다.

`"tunnel_url":"https://api.openai.com/v1/tunnel/tunnel_..."` — 공개 도메인이 아니라
OpenAI API 내부 경로다. 설계 의도대로 **워크스페이스가 인터넷에 노출되지 않았다.**

##### 정상인데 오류처럼 보이는 것 3종

첫 연결 때만 나오고 동작에 영향이 없다. TUNNEL_SETUP.md 문제 해결 절에도 넣었다.

- `OAuth discovery failed` / `invalid character '<'` — tunnel-client가
  `/.well-known/oauth-protected-resource` 를 탐색하는데 우리는 OAuth 서버가 아니다.
  Express의 HTML 404를 JSON으로 파싱하다 `<!DOCTYPE` 의 `<` 에서 걸린다.
  §10-15가 MCP Inspector에서 기록한 것과 같은 현상이다.
- 감사 로그 `auth_failure` / `missing` 3건 — 위 탐색 요청들. Bearer가 붙지 않는다.
  **시작 직후에만** 나오면 정상이다.
- `server/discover` 400 — MCP 표준이 아닌 OpenAI 확장 메서드. 우리 서버가 모르면
  ChatGPT가 표준 방식으로 되돌아간다. 구현하지 않아도 무방하다.

### C-ChatGPT 연동 (Phase 3 완료 기준)

1. ChatGPT 웹 → **설정 → Apps & Connectors → Advanced → Developer Mode** 활성화
2. 커넥터 추가 → URL에 패널의 커넥터 URL, 인증에 Bearer 토큰
3. `GPT Bridge: ChatGPT 지침 복사`로 받은 텍스트를 커스텀 지침에 붙여넣기
4. 새 대화에서: **"이 프로젝트 구조를 설명하고 타입 에러를 알려줘"**

| # | 기대 결과 |
|---|---|
| C-G1 | GPT가 `get_workspace_info`를 먼저 호출한다 |
| C-G2 | `list_directory` / `get_diagnostics`가 이어서 호출된다 |
| C-G3 | 패널 활동 목록에 호출 기록이 실시간으로 쌓인다 |

> **툴이 호출되지 않으면** 커스텀 지침이 적용됐는지 먼저 확인하세요(§10-3).
> **연결 자체가 실패하면** `src/mcp/http.ts`의 `new StreamableHTTPServerTransport({})`를
> `({ enableJsonResponse: true })`로 바꿔 보세요. SSE 대신 일반 JSON으로 응답합니다.

---

## D. 핵심 안전성 — 이 확장의 존재 이유

**여기서 하나라도 실패하면 이 확장을 쓰지 마세요.**

준비: 테스트 폴더에 `sample.ts`를 만들고 아무 내용이나 넣은 뒤 **저장**합니다.
탐색기(파일 관리자)로 같은 파일을 열어 두면 디스크 상태를 바로 확인할 수 있습니다.

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| **D-1** | **수정이 버퍼에만 적용된다** | Inspector에서 `edit_file` 호출 → 모달에서 `적용` | VS Code 탭에 **● (미저장)** 표시. **디스크의 파일은 그대로** |
| **D-2** | **Ctrl+Z로 되돌아간다** | D-1 직후 편집기에서 `Ctrl+Z` | 원래 내용으로 복구됨 |
| **D-3** | **거부 시 아무 일도 없다** | `edit_file` 호출 → 모달에서 `취소` | 버퍼·디스크 **둘 다 변화 없음**. 툴은 "거부되었습니다" 반환 |
| **D-4** | **만료 후 적용이 무시된다** | `edit_file` 호출 → 모달을 **90초 이상 방치** → 그 다음 `적용` 클릭 | 파일이 **바뀌지 않고** "승인 대기 시간이 지난 요청" 경고가 뜸 |

### D-쓰기 툴

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| D-5 | **CRLF 파일에서 edit_file** | 줄바꿈이 **CRLF**인 파일에 여러 줄짜리 `old_string`(`\n` 사용)으로 `edit_file` | **매칭 성공**. 수정 후에도 파일이 CRLF 유지 |
| D-6 | 0회 매치 | 없는 문자열로 `edit_file` | "찾을 수 없음 + read_file로 확인" 안내 |
| D-7 | 2회 매치 | 두 번 나오는 문자열로 `edit_file` | "고유하지 않음 + 컨텍스트 추가" 안내 |
| D-8 | 줄 번호 접두사 실수 | `old_string`에 `  12│ ` 포함해 호출 | 실패하되 접두사를 빼라는 안내가 있음 |
| D-9 | Diff 보기 | 모달에서 `Diff 보기` | 좌우 비교 창이 뜨고, **닫으면 다시 승인을 물음** |
| D-10 | **신규 생성은 디스크 즉시** | `write_file`로 새 파일 생성 → `적용` | 모달에 "**승인 즉시 디스크에 반영**" 문구. 저장 안 해도 디스크에 파일 생김 |
| D-11 | 기존 파일 전체 교체 | 있는 파일에 `write_file` | 버퍼에만 적용 + "edit_file 사용 권장" 경고 |
| D-12 | **삭제는 항상 확인** | 승인 모드를 `session`으로 두고 먼저 `edit_file`을 승인 → 이어서 `delete_path` | **다시 물어봐야 함** (자동 승인되면 안 됨) |
| D-13 | 삭제는 휴지통으로 | `delete_path` 승인 | 휴지통에서 복구 가능 |
| D-14 | 디렉터리 보호 | 빈 디렉터리에 `delete_path` (recursive 없이) | 거부 + `recursive: true` 안내 |
| D-15 | 자동 저장 옵션 | 패널에서 자동 저장 체크 → `edit_file` | 수정이 **바로 디스크에 반영**됨 |
| D-16 | `save_file` | 미저장 상태에서 호출 | 저장됨. 변경이 없으면 "저장할 변경사항 없음" |

### D-승인 모드

| # | 모드 | 방법 | 기대 결과 |
|---|---|---|---|
| D-17 | `always` | `edit_file` 3회 | **매번** 물어봄 |
| D-18 | `session` | `edit_file` 3회 | **첫 번째만** 물어봄 |
| D-19 | `session` 해제 | 서버 중지 → 시작 → `edit_file` | 다시 물어봄 |
| D-20 | `pattern` | `autoApprovePatterns: ["src/**"]` 설정 후 `src/a.ts`와 `docs/b.md` 수정 | `src`는 자동, `docs`는 물어봄 |
| D-21 | 동시 요청 | ChatGPT에게 파일 3개를 한 번에 고치라고 요청 | 모달이 **하나씩** 뜸 (겹치지 않음) |

---

## E. Phase 5 — 감사 로그 · 패키징

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| E-1 | 감사 로그 위치 | 출력 패널의 `감사 로그: ...` 줄 | `...\globalStorage\local.gpt-bridge\audit\audit.jsonl` |
| E-2 | 툴 호출 기록 | 몇 번 호출 후 파일 열기 | 한 줄에 한 건, `ts`/`kind`/`tool`/`detail`/`ok`/`durationMs` |
| E-3 | 차단 기록 | B-S1 수행 후 확인 | `"kind":"path_denied"` |
| E-4 | 거부·만료 기록 | D-3, D-4 수행 후 확인 | `approval_denied`, `approval_expired`, `expired_choice` |
| E-5 | 디스크 쓰기 기록 | D-10, D-13 수행 후 확인 | `"kind":"disk_write"` |
| E-6 | 인증 실패 기록 | B-S8 수행 후 확인 | `"kind":"auth_failure"` |
| E-7 | 파일 내용이 안 새어나감 | 큰 `write_file` 후 확인 | `detail`이 500자에서 잘림 |

### E-패키징 (Windows에서 해야 함)

```powershell
npm run package        # gpt-bridge-0.1.0.vsix 생성
```

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| E-8 | **rg.exe가 들어갔다** | `.vsix`를 zip으로 풀어 확인 | `extension\node_modules\@vscode\ripgrep-win32-x64\bin\rg.exe` |
| E-9 | `project.md`가 빠졌다 | 같은 방법 | `project.md`, `src\`, `test\`가 **없어야 함** |
| E-10 | 로컬 설치 | `code --install-extension gpt-bridge-0.1.0.vsix` | 설치 성공 |
| E-11 | **설치본에서 검색 동작** | 일반 VS Code 창에서 서버 시작 → `search_text` | **정상 동작**. 실패하면 E-8을 다시 확인 |
| E-12 | 설치본에서 목록 동작 | `list_directory` | 정상 동작 |

> E-8/E-11이 §2.1에서 경고한 지점입니다. **Linux나 macOS에서 만든 `.vsix`에는
> `rg.exe`가 없어** 개발 중에는 되다가 설치본에서만 검색이 죽습니다.

---

## G. 컨텍스트 절약 (Phase 6)

`project.md` §4.5의 동작입니다. **막는 기능이 아니라 조언하는 기능**이므로,
확인할 것은 "안내가 나오는가"와 **"정당한 읽기를 방해하지 않는가"** 둘 다입니다.

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| G-1 | 처음 읽기에는 잔소리 없음 | 400줄 미만 파일에 `read_file` | 내용만. 참고 문구 **없음** |
| G-2 | 큰 파일 전체 읽기 안내 | 400줄 넘는 파일을 범위 없이 `read_file` | 내용 **전부** + "이후 수정 단계에서는 search_text로…" |
| G-3 | **반복 읽기 감지** | G-2와 같은 파일을 파일 수정 없이 다시 전체 읽기 | 내용 + "이미 전체를 읽었고 그 뒤로 내용이 바뀌지 않았습니다" |
| G-4 | **내용이 바뀌면 다르게 안내** | 편집기에서 그 파일을 고친 뒤(저장 불필요) 다시 전체 읽기 | "내용이 바뀌어 다시 읽었습니다. 이전 내용은 버리고…" |
| G-5 | **범위 읽기에는 참견 없음** | 같은 파일을 `start_line`/`end_line`으로 읽기 | 내용만. 참고 문구 **없음** |
| G-6 | 세션 경계 | 서버 중지 → 시작 → 같은 파일 전체 읽기 | 이력이 초기화되어 참고 문구 **없음** |
| G-7 | `context_lines: 0` | `search_text` `query`: `export`, `context_lines`: `0` | 매치 줄만. 앞뒤 줄 **없음** |
| G-8 | `context_lines` 기본값 | 같은 검색에서 `context_lines` 생략 | 앞뒤 2줄이 함께 나옴 |
| G-9 | 지침이 갱신됐다 | `GPT Bridge: ChatGPT 지침 복사` | **11개 항목**. 6~11이 읽기 최소화 |
| **G-10** | **잘렸을 때 분모가 보인다** | `search_text` `query`: `export`, `max_results`: `10` | 머리글이 `전체 N건 중 10건 표시` 형태. 안내에 **남은 건수**가 숫자로 나옴 |
| G-11 | 상한을 올리면 다 나온다 | 같은 검색에 `max_results`: `500` | 절단 안내가 **사라지고** 전체 건수가 그대로 표시됨 |

G-10이 2026-08-07에 고친 부분입니다(project.md §4.1.1). 예전에는
`"결과가 상한에 걸려 잘렸습니다"`만 나오고 **몇 건을 못 봤는지 알 수 없었습니다.**
모델이 "범위를 좁혀야겠다"고 판단하려면 분모가 필요합니다.

> `bigmodule.ts`(721줄, `export` 90건)를 테스트 폴더에 두면 `export` 검색이
> 100건 가까이 나와 절단 상황을 쉽게 만들 수 있습니다.

> **G-3과 G-5가 핵심입니다.** G-3이 안 나오면 반복 읽기를 못 잡는 것이고,
> G-5에서 문구가 나오면 유도하려던 형태에 잔소리를 붙이는 것이라 오히려 해롭습니다.

G-4는 **저장하지 않아도** 동작해야 합니다. 지문은 `openTextDocument`가 돌려주는
버퍼 내용 기준이라, 미저장 수정도 "바뀐 것"으로 잡힙니다.

### G-실전. 실제로 효과가 있는지

위 항목들은 안내가 나오는지만 봅니다. **모델이 실제로 이 안내를 따르는지는
C단계(ChatGPT 연동) 이후에야 알 수 있습니다.**

C-ChatGPT 연동 후 파일 몇 개를 연달아 수정시키면서 감사 로그를 보세요.
같은 파일에 `read_file`이 몇 번 찍히는지, 범위 지정 호출이 섞여 나오는지가
지표입니다. 계속 전체만 읽는다면 툴 description 문구를 더 강하게 써야 합니다.

---

## F. 알려진 미구현 · 제약

확인이 아니라 **알고 계셔야 할 것**들입니다.

| 항목 | 내용 |
|---|---|
| Named Tunnel 호스트명 | 토큰만으로는 알 수 없어 `gptBridge.tunnel.hostname`에 직접 지정해야 합니다 (§6.2) |
| Windows arm64 | cloudflared 자산이 없어 터널을 쓸 수 없습니다. 로컬은 정상 (§10-11) |
| 프록시 환경 | Node의 `fetch`가 `HTTPS_PROXY`를 자동으로 쓰지 않습니다. 사내 프록시 뒤에서는 cloudflared 다운로드가 실패할 수 있습니다 |
| PATH의 cloudflared | 이미 설치된 cloudflared를 쓰는 옵션은 미구현입니다 (해시 검증을 건너뛰는 경로라 우선순위를 낮췄습니다) |
| TOCTOU | 경로 검증과 파일 열기 사이에 심볼릭 링크가 바뀔 수 있습니다. 개인 사용 전제로 감수합니다 |
| `any` 금지 강제 | `tsc`는 명시적 `any`를 잡지 못합니다. 현재 코드에는 없지만 ESLint는 도입하지 않았습니다 |
| **인증 수준** | Bearer 토큰 + 루프백 바인드 + CORS 미적용에서 **닫았습니다**. 더 쌓지 않기로 확정한 것이지 미구현이 아닙니다 (§5.7) |
| DNS 리바인딩 보호 · mTLS · IP 제한 | **도입하지 않습니다.** 이유는 §5.7의 표에 있습니다. 리바인딩은 브라우저 경유 공격인데 CORS를 켜지 않아 이미 막혀 있습니다 |
| 토큰 유출 시 | 워크스페이스가 통째로 열립니다. 감수한 전제입니다 — `GPT Bridge: 토큰 재발급` 한 번이 유일하고 충분한 대응입니다 |

---

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| Inspector가 `Invalid OAuth error response` / `Cannot POST /register` | 토큰이 서버에 도달하지 않은 것. `Bearer Token` 칸 대신 **Custom Headers** 사용 (B절) |
| Inspector 연결이 CORS로 막힌다 | Connection Type을 `Via Proxy`로 (B절) |
| `.gitignore`가 무시된다 | 테스트 폴더에서 `git init` 실행 (B-4) |
| 툴 목록에 `search_text`·`list_directory`가 없다 | rg 바이너리 누락. 출력 패널의 `ripgrep:` 줄 확인 → E-8 |
| `edit_file`이 항상 "찾을 수 없음" | CRLF 문제. D-5로 재현되는지 확인 |
| ChatGPT가 툴을 안 부른다 | 커스텀 지침 미적용 (§10-3). `ChatGPT 지침 복사` 내용을 다시 넣기 |
| ChatGPT 연결이 안 된다 | `enableJsonResponse: true`로 전환 (C-ChatGPT 절 참고) |
| 서버가 안 뜬다 | 포트 충돌. 출력 패널 확인 후 `gptBridge.port` 변경 |
| 모달이 여러 개 뜬다 | 직렬 큐 결함. 재현 절차를 기록해 주세요 (자동 테스트는 통과 중) |
| 터널 URL이 매번 바뀐다 | Quick Tunnel의 정상 동작 (§10-5). Named Tunnel 사용 권장 |
