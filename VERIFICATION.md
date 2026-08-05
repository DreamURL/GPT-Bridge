# 직접 검증해야 하는 항목

Phase 1~5 코드는 완료되었고 자동 테스트 **142개**가 통과합니다. 다만 자동 테스트는
**VS Code 확장 호스트가 없는 환경**에서 돌았기 때문에, 검증된 것은 순수 로직뿐입니다.

| 자동 테스트로 검증됨 | 직접 확인해야 함 |
|---|---|
| 경로 검증, 거부 목록, 인증, HTTP 계층 | `vscode` API를 실제로 호출하는 모든 경로 |
| ripgrep 실행, `.gitignore` 반영 | 버퍼 편집 · undo · 저장 동작 |
| 문자열 매칭(CRLF 포함), 승인 게이트 로직 | 모달 UI, 상태바, 패널 렌더링 |
| cloudflared 해시 테이블, tar 해제, URL 파싱 | 실제 터널 기동, ChatGPT 연동 |
| 감사 로그 JSONL 기록 | — |

**이 문서의 항목은 전부 직접 실행해 확인해야 합니다.** 특히 [D-1 ~ D-4](#d-핵심-안전성-이-확장의-존재-이유)는
이 확장이 존재하는 이유이므로 하나라도 실패하면 사용하지 마세요.

환경: **Windows**. `project.md` §10의 제약을 함께 참고하세요.

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

Inspector에서 Transport를 **Streamable HTTP**로, URL과 `Authorization: Bearer <토큰>` 헤더를 설정합니다.

| # | 확인할 것 | 방법 | 기대 결과 |
|---|---|---|---|
| B-1 | 툴 10개가 보인다 | Inspector → List Tools | 읽기 5 + 쓰기 5 |
| B-2 | `get_workspace_info` | 인자 없이 호출 | 폴더명·파일 수·주요 언어·열린 탭·활성 파일·진단 요약 |
| B-3 | `list_directory` | `path: "."` | 항목 목록. **`node_modules`가 없어야 함** |
| B-4 | **`.gitignore` 반영** | `.gitignore`에 `tmp/` 추가 후 `tmp/x.txt` 생성 → `list_directory` | `tmp/x.txt`가 **나오지 않아야 함** |
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
| DNS 리바인딩 보호 | `allowedHosts`를 켜면 Quick Tunnel의 바뀌는 도메인을 매번 등록해야 해 끄고 있습니다. 루프백 바인드 + Bearer + CORS 미적용으로 대응합니다 |

---

## 문제가 생기면

| 증상 | 확인할 것 |
|---|---|
| 툴 목록에 `search_text`·`list_directory`가 없다 | rg 바이너리 누락. 출력 패널의 `ripgrep:` 줄 확인 → E-8 |
| `edit_file`이 항상 "찾을 수 없음" | CRLF 문제. D-5로 재현되는지 확인 |
| ChatGPT가 툴을 안 부른다 | 커스텀 지침 미적용 (§10-3). `ChatGPT 지침 복사` 내용을 다시 넣기 |
| ChatGPT 연결이 안 된다 | `enableJsonResponse: true`로 전환 (C-ChatGPT 절 참고) |
| 서버가 안 뜬다 | 포트 충돌. 출력 패널 확인 후 `gptBridge.port` 변경 |
| 모달이 여러 개 뜬다 | 직렬 큐 결함. 재현 절차를 기록해 주세요 (자동 테스트는 통과 중) |
| 터널 URL이 매번 바뀐다 | Quick Tunnel의 정상 동작 (§10-5). Named Tunnel 사용 권장 |
