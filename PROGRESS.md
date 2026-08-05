# PROGRESS

기획안은 [`project.md`](./project.md). Phase 정의는 §8 참조.

---

## Phase 1 — 확장 골격 ✅

### 완료 항목

| 항목 | 파일 | 비고 |
|---|---|---|
| contributes 전체 | `package.json` | §3 명세 그대로. 설정 9종, 명령 8종, viewsContainer, view |
| TypeScript strict | `tsconfig.json` | `strict` + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noUnusedLocals/Parameters` |
| esbuild 번들 | `esbuild.mjs` | `external: ['vscode', '@vscode/ripgrep']` (§2.1) |
| vsix 제외 규칙 | `.vscodeignore` | `node_modules/**` 제외 + ripgrep만 negation으로 되살림 (§2.1) |
| activate / deactivate | `src/extension.ts` | 모든 Disposable을 `context.subscriptions`에 등록 |
| 상태 모델 | `src/state.ts` | `BridgeStateStore` — 상태 보관 + 변경 이벤트 |
| 설정 접근 | `src/config.ts` | enum 값이 깨지면 안전한 쪽(`always`)으로 폴백 |
| 토큰 저장 | `src/secrets.ts` | SecretStorage 사용. settings.json에 넣지 않음 (§3) |
| 상태바 | `src/ui/statusBar.ts` | 상태별 아이콘·툴팁, 클릭 시 패널 포커스 (§7.2) |
| LogOutputChannel | `src/ui/output.ts` | Phase 5 감사 로그의 출력 대상 |
| 사이드바 패널 | `src/ui/BridgeViewProvider.ts` | 자리표시 수준. CSP + nonce는 지금부터 적용 |
| 명령 등록 | `src/commands.ts` | 아래 표 참조 |
| F5 디버그 | `.vscode/launch.json`, `.vscode/tasks.json` | `watch` 태스크를 preLaunchTask로 연결 |

### 명령별 구현 수준

| 명령 | Phase 1 동작 |
|---|---|
| `gptBridge.start` / `stop` | **스텁.** 안내 메시지 + 로그만. 상태를 바꾸지 않는다 |
| `gptBridge.copyUrl` | 터널 URL이 없으므로 경고 안내 |
| `gptBridge.copyToken` | **실동작.** 없으면 생성 후 클립보드 복사 |
| `gptBridge.regenerateToken` | **실동작.** 확인 모달 → 재발급 → 복사 |
| `gptBridge.setTunnelToken` | **실동작.** `password: true` 입력, 빈 값이면 삭제 |
| `gptBridge.copyInstructions` | **실동작.** §4.4 지침 복사 |
| `gptBridge.showLog` | **실동작.** |

### 검증

```
npm run typecheck   → 통과 (오류 0)
npm run build       → dist/extension.js 19.8kb
npx vsce package    → gpt-bridge-0.1.0.vsix 생성 확인, project.md 제외 확인
npm audit           → 0 vulnerabilities
```

`require("vscode")`가 번들에 external로 남아 있는 것을 확인했다.

### 설계 판단 기록

- **`start`가 상태를 `running`으로 바꾸지 않는다.** 서버가 없는데 실행 중으로 표시하면
  상태바가 거짓말을 하게 된다. 파일시스템을 외부에 노출하는 확장에서 상태 표시가
  실제와 어긋나는 것은 그 자체로 보안 문제라고 보고, 스텁은 스텁으로 두었다.
- **패널 provider를 Phase 1에 등록했다.** Phase 3 항목이지만, `views`를 선언해 두고
  provider가 없으면 사이드바가 영구 로딩 상태로 남는다. 내용은 자리표시다.
- **확장 루트를 저장소 루트로 두었다.** 기획안 트리는 `gpt-bridge/`로 시작하지만
  이 저장소에 다른 구성요소가 없어 중첩 디렉터리의 이득이 없다.
- **esbuild `^0.24` → `^0.25`.** 0.24 이하는 dev server 관련 권고사항(GHSA-67mh-4wv8-2f99)이
  있다. 우리는 dev server를 쓰지 않지만 감사 결과를 깨끗하게 유지한다.

### 미해결 / 다음 Phase로 넘김

- **`any` 금지가 컴파일러로 강제되지 않는다.** `tsc`는 명시적 `any`를 잡지 못한다.
  현재 코드에는 `any`가 없지만, 강제하려면 ESLint + `@typescript-eslint/no-explicit-any`가
  필요하다. 의존성 추가 여부는 Phase 2에서 결정.
- **`@vscode/ripgrep`이 아직 의존성에 없다.** esbuild external과 `.vscodeignore` 규칙만
  먼저 넣어 두었다. Phase 2에서 패키지를 추가하고 `.vsix` 설치본에서 실제 rg 실행을 확인해야 한다.
- **F5 실측 미완.** 이 세션은 GUI가 없는 원격 컨테이너라 확장 개발 호스트를 띄울 수 없다.
  타입체크·번들·패키징까지는 확인했으나 상태바 렌더링과 명령 팔레트 노출은 로컬에서 확인 필요.
- 활동 로그 UI, URL·토큰 표시는 Phase 3 패널 작업에 포함.

---

## Phase 2 — 보안 기반 + 읽기 툴 ✅

### 완료 항목

| 항목 | 파일 | 비고 |
|---|---|---|
| glob 매처 | `src/workspace/glob.ts` | `*`, `**`, `?`만 지원. 대소문자 무시, 후행 부분경로도 매칭 |
| 거부 목록 | `src/workspace/denyList.ts` | 기본 14종 + 설정 추가. `node_modules`는 목록에서만 제외 |
| **PathGuard** | `src/workspace/PathGuard.ts` | vscode 비의존. §11 케이스 전부 차단 |
| ripgrep 래퍼 | `src/workspace/ripgrep.ts` | 목록·검색 공유. `--json` 파싱, 타임아웃, 배열 인자 |
| 문서 래퍼 | `src/workspace/documents.ts` | `openTextDocument`, 줄 번호 접두사, 범위 클램프 |
| Bearer 인증 | `src/mcp/auth.ts` | 길이 선체크 → `timingSafeEqual`. 실패 사유 미노출 |
| HTTP 서버 | `src/mcp/http.ts` | vscode 비의존. 127.0.0.1 바인드, 5MB, 120회/분 |
| 툴 등록 | `src/mcp/registry.ts` | 공통 에러 처리·차단 알림·활동 기록 |
| 생명주기 | `src/mcp/McpServer.ts` | 설정→PathGuard→rg→서버. EADDRINUSE 안내 |
| 읽기 툴 5종 | `src/mcp/tools/*.ts` | 아래 표 참조 |

### 툴

| 툴 | 구현 |
|---|---|
| `get_workspace_info` | 루트명, 파일 수, 주요 언어, 열린 탭, 활성 파일+선택, 진단 요약 |
| `list_directory` | rg `--files` 기반. `.gitignore` 반영. depth 1~3 |
| `read_file` | 미저장 버퍼 우선. 줄 번호 접두사, `dirty` 표시, `maxReadBytes` |
| `search_text` | rg `--json`, 앞뒤 2줄 컨텍스트, `-e`로 옵션 오인 방지 |
| `get_diagnostics` | `languages.getDiagnostics()`. 워크스페이스 밖·거부 경로 제외 |

### 테스트 — 51개 전부 통과

```
npm test   →  tests 51 / pass 51 / fail 0
```

| 파일 | 개수 | 범위 |
|---|---|---|
| `test/pathGuard.test.ts` | 20 | §11 경로 탈출·거부 목록 전부 + 오탐 방지 |
| `test/server.test.ts` | 14 | 401 4종, 405, 헬스체크, EADDRINUSE, 레이트리밋 |
| `test/ripgrep.test.ts` | 12 | `.gitignore` 반영, 컨텍스트, `-` 시작 질의, 상한 |
| `test/auth.test.ts` | 5 | Bearer 파싱, 길이 불일치 시 예외 없음 |

확장 호스트 없이 `node --test`로 돌아간다. PathGuard·auth·http·ripgrep을 vscode
비의존으로 설계했기 때문이다. esbuild가 테스트도 번들한다(`npm run build:tests`).

### 구현 중 발견한 사실 (기획안 정정)

1. **`@vscode/ripgrep` 1.18은 ESM 전용이고 바이너리 위치가 다르다.**
   메타 패키지는 경로 계산용 ESM 모듈이고, 실제 rg는 플랫폼별 optional 패키지
   (`@vscode/ripgrep-linux-x64/bin/rg`)에 있다. CJS 번들에서 `require`할 수 없으므로
   패키지를 import하지 않고 `require.resolve`로 경로만 구한다. `.vscodeignore`
   negation도 두 줄이 필요했다. → project.md §2.1 정정, §10-9 추가.

2. **rg의 `--glob`은 cwd 기준으로 매칭된다.**
   cwd를 지정하지 않고 실행하면 `!.git/**` 제외와 `include` 지정이 오류 없이
   조용히 무효가 된다. 실제로 `.git/config`가 검색 결과에 나왔고 테스트로 잡았다.
   cwd를 워크스페이스 루트로 고정해 해결. → project.md §4.1 정정.
   (거부 목록이 툴 계층에서 한 번 더 걸러 주고 있어 실제 유출은 없었다. 다층 방어가 작동한 사례.)

3. **`exactOptionalPropertyTypes`를 껐다.** MCP SDK의 `Transport` 인터페이스가
   `onclose?: () => void`로 선언되어 있는데 구현 클래스는 `(() => void) | undefined`라
   이 플래그와 충돌한다. 캐스팅으로 우회하는 대신 플래그를 뺐다.
   기획안이 요구하는 `strict: true`는 그대로다.

4. **무상태(stateless) 모드를 선택했다.** SDK가 무상태에서 transport 재사용을
   거부하므로 요청마다 `McpServer` + transport를 새로 만들고 응답 종료 시 정리한다.
   세션 맵이 없어 커넥터가 끊겨도 서버에 찌꺼기가 남지 않는다.

### 미해결 / 다음 Phase로 넘김

- **MCP Inspector 실측 미완.** GUI 없는 원격 컨테이너라 확장 호스트를 띄울 수 없다.
  HTTP·인증·transport 계층은 통합 테스트로 검증했지만, vscode API를 쓰는 툴 5종의
  실제 동작(진단 수집, 미저장 버퍼 읽기, 탭 목록)은 로컬 F5 확인이 필요하다.
- **SSE vs JSON 응답 형식.** 현재 SDK 기본값(SSE 스트림)을 쓴다. ChatGPT 커넥터가
  `enableJsonResponse: true`를 요구하면 Phase 3에서 조정한다.
- **DNS 리바인딩 보호 미적용.** `allowedHosts`를 켜면 터널 도메인을 화이트리스트에
  넣어야 하는데 Quick Tunnel은 URL이 매번 바뀐다. 루프백 바인드 + Bearer + CORS 미적용으로
  대응하고 Phase 3에서 Named Tunnel 고정 도메인이 생기면 재검토한다.
- **TOCTOU.** PathGuard가 경로를 검증한 뒤 툴이 파일을 여는 사이에 심볼릭 링크가
  바뀔 수 있다. 개인 사용 전제라 현재는 감수한다.
- `any` 금지 컴파일러 강제는 여전히 미적용(Phase 1에서 이월).

---

## Phase 3 — 터널 + 패널 ⚠️ 코드 완료, 실측 미완

### 완료 항목

| 항목 | 파일 | 비고 |
|---|---|---|
| cloudflared 확보 | `src/tunnel/binary.ts` | 버전 핀 `2026.7.3`, 플랫폼 5종 해시 테이블 |
| tar 리더 | `src/tunnel/tar.ts` | macOS `.tgz` 해제. 외부 `tar` 프로세스 없음 |
| 터널 관리 | `src/tunnel/TunnelManager.ts` | URL 파싱, 30초 헬스체크, 백오프 재시작, SIGTERM→SIGKILL |
| 서버 연동 | `src/mcp/McpServer.ts` | 서버 기동 후 터널 시작. 터널 실패해도 로컬은 유지 |
| 패널 | `src/ui/BridgeViewProvider.ts` | §7.1 전체. CSP+nonce, 활동 목록, 승인 모드·자동 저장 |
| 정리 | `src/extension.ts` | `deactivate()`가 Promise를 반환해 프로세스 종료를 기다린다 |

### 해시 테이블 — 실제 값으로 채움

`cloudflared 2026.7.3` 자산을 직접 내려받아 `sha256sum`으로 확인했다(2026-08-05).

| 플랫폼 | 자산 | 형식 |
|---|---|---|
| linux-x64 | `cloudflared-linux-amd64` | raw |
| linux-arm64 | `cloudflared-linux-arm64` | raw |
| darwin-x64 | `cloudflared-darwin-amd64.tgz` | 아카이브 |
| darwin-arm64 | `cloudflared-darwin-arm64.tgz` | 아카이브 |
| win32-x64 | `cloudflared-windows-amd64.exe` | raw |

플랫폼마다 **자산 해시와 실행 파일 해시를 따로** 기록한다. macOS는 `.tgz`라 둘이 다르고,
하나만 기록하면 재사용 검증이 "파일 존재 확인"으로 퇴화한다.

### 테스트 — 79개 전부 통과 (Phase 3에서 28개 추가)

```
npm test   →  tests 79 / pass 79 / fail 0
```

| 파일 | 개수 | 범위 |
|---|---|---|
| `test/tunnel.test.ts` | 28 | tar 리더 7, 호스트 화이트리스트 4, 해시 테이블 6, 해시 비교 3, URL 파싱 3, 백오프 2, 정규화 3 |

호스트 화이트리스트 테스트에 `github.com.evil.example.com` 케이스를 넣었다 —
접두사 비교로 구현하면 통과해 버린다.

### 구현 중 발견한 사실 (기획안 정정)

1. **macOS 자산은 raw 바이너리가 아니라 `.tgz`다.** 기획안은 모든 플랫폼이 단일
   실행 파일이라고 가정했다. 아카이브 해제 단계가 필요하고, 그 결과 해시를
   두 종류 관리해야 한다. → §6.1 정정.

2. **리다이렉트 대상 호스트가 바뀌었다.** 기획안이 적은 `objects.githubusercontent.com`이
   아니라 현재는 `release-assets.githubusercontent.com`으로 넘어간다. 둘 다
   화이트리스트에 두었다. → §6.1 정정.

3. **Named Tunnel은 공개 호스트명을 알려주지 않는다.** `tunnel run --token`은
   인그레스가 대시보드 쪽에 있어 URL을 stdout에 찍지 않는다. 토큰만으로 알아낼 수
   없으므로 `gptBridge.tunnel.hostname` 설정을 추가했다. → §6.2 신설, §10-10 추가.

4. **Windows arm64 자산이 없다.** 404를 확인했다. 미지원 플랫폼은 명확히 실패하되
   로컬 엔드포인트는 살려 둔다. → §10-11 추가.

5. **cloudflared 로그는 stderr로 나온다.** stdout만 훑으면 Quick Tunnel URL을 영영
   못 찾는다. 양쪽 모두 스캔한다.

### 설계 판단 기록

- **터널 실패는 서버 실패가 아니다.** 바이너리 확보·터널 연결 어느 단계에서 실패해도
  상태를 `running`으로 되돌리고 로컬 엔드포인트를 유지한다. MCP Inspector로는 계속 쓸 수 있다.
- **`deactivate()`를 async로 바꿨다.** `context.subscriptions`의 `dispose()`는 동기라
  자식 프로세스 종료를 기다리지 못한다. VS Code는 `deactivate()`가 돌려준 Promise를
  기다리므로 여기서 SIGTERM→5초→SIGKILL을 수행한다.
- **Webview는 `gptBridge.*` 명령만 실행할 수 있다.** 메시지 핸들러가 접두사를 검사한다.
  패널이 임의의 VS Code 명령을 실행할 수 있으면 XSS 한 번에 확장 권한이 넘어간다.
- **토큰 원문은 Webview로 보내지 않는다.** 마스킹된 문자열만 전달하고, 복사는 확장
  쪽 명령이 클립보드에 직접 쓴다.

### 미해결 / 다음 Phase로 넘김

- **실제 터널 기동 미검증.** 이 컨테이너에서는 cloudflared를 띄워 외부에서 접속할 수
  없다. 검증한 것은 순수 로직(해시 테이블, 호스트 검사, tar 해제, URL 파싱, 백오프)이고,
  프로세스 spawn → URL 파싱 → 헬스체크의 실제 흐름은 로컬 확인이 필요하다.
- **ChatGPT Developer Mode 연동 미확인.** Phase 3 완료 기준의 나머지 절반이다.
  SSE 응답 형식이 문제가 되면 `enableJsonResponse: true`로 전환한다(코드 한 줄).
- **다운로드가 프록시를 타지 않는다.** Node의 `fetch`는 `HTTPS_PROXY`를 자동으로
  쓰지 않는다. 사내 프록시 환경에서는 바이너리를 직접 배치하는 경로가 필요할 수 있다.
- **PATH의 기존 cloudflared를 쓰는 옵션 미구현.** §6.1이 언급하지만 해시 검증을
  건너뛰는 경로라 우선순위를 낮췄다.

---

## Windows 대응 (Phase 3 이후 추가)

대상 환경이 Windows임을 확인하고 점검한 결과, **실제 우회 경로 3개**를 찾아 막았다.
전부 Windows에서만 성립해 Linux 테스트로는 드러나지 않던 것들이다.

| 입력 | 이전 동작 | Windows에서 실제로 열리는 것 |
|---|---|---|
| `.env::$DATA` | 통과 — `.env` glob과 문자열 불일치 | `.env` 본문 |
| `.npmrc.` | 통과 — 후행 마침표 | `.npmrc` |
| `CON`, `COM1` | 통과 | 장치. `openTextDocument`가 멈출 수 있음 |

거부 목록은 문자열 매칭이라 목록을 늘려도 이 틈은 막히지 않는다. `PathGuard`
입력 단계에서 콜론·후행 마침표/공백·예약 장치명·드라이브 상대 경로를 차단한다.
**검사는 플랫폼과 무관하게 항상 동작한다** — 문제 상황이 "다른 데서 만든 저장소를
Windows에서 여는 것"이기 때문이다. → project.md §5.3.1 신설.

`path.isAbsolute('C:a.txt')`가 win32에서도 `false`라는 점도 확인했다. 드라이브 상대
경로는 절대 경로 검사로 잡히지 않아 별도 규칙이 필요하다.

그 외 반영:

- **프로세스 트리 종료.** Windows에는 시그널이 없다. Node의 `kill()`은
  `TerminateProcess`로 매핑되어 해당 프로세스만 죽이고 자식은 남는다.
  `taskkill /T /F`로 트리째 정리한다. §11의 "리로드 후 좀비 프로세스 없음"이
  Windows에서도 성립하게 하려면 필요하다.
- **심볼릭 링크 테스트.** Windows에서 파일 링크는 권한이 필요하다. 디렉터리는
  junction으로 대체하고, 만들지 못하면 `t.skip()`으로 건너뛴다 — 조용히 통과시키지 않는다.
- **패키징 위치.** `.vsix`는 Windows에서 만들어야 `rg.exe`가 들어간다. README에 명시.

테스트 86개 통과 (Windows 케이스 7개 추가).

### Phase 4에서 반드시 처리할 것 — CRLF

`TextDocument.getText()`는 문서의 EOL을 그대로 반환한다. CRLF 파일에서는 `\r\n`이
섞여 나오는데, GPT는 거의 항상 `\n`으로 `old_string`을 보낸다. 정규화 없이 비교하면
**Windows의 CRLF 파일에서 `edit_file`이 항상 0회 매치로 실패한다.** 주력 툴이
무력해지므로 Phase 4의 첫 작업으로 처리한다. → project.md §4.2 `edit_file`에 명시.

---

## Phase 4 — 쓰기 + 승인 ⚠️ 코드 완료, 실측 미완

### 완료 항목

| 항목 | 파일 | 비고 |
|---|---|---|
| 문자열 매칭 | `src/workspace/textEdit.ts` | CRLF 대응, 고유성 판정, 변경 규모 요약 |
| 승인 게이트 | `src/approval/ApprovalGate.ts` | 직렬 큐 + nonce 만료. vscode 비의존 |
| VS Code 어댑터 | `src/approval/vscodeGate.ts` | 모달 문구, 만료 알림 |
| Diff 미리보기 | `src/approval/DiffPreview.ts` | `gpt-bridge-preview:` 스킴 + `vscode.diff` |
| `edit_file` | `src/mcp/tools/editFile.ts` | 주력 툴. 버퍼 편집 |
| `write_file` | `src/mcp/tools/writeFile.ts` | 기존=버퍼 교체, 신규=디스크 즉시 |
| 나머지 3종 | `src/mcp/tools/fileOps.ts` | `create_directory` / `delete_path` / `save_file` |

### CRLF 처리 — Windows에서 가장 중요한 부분

`TextDocument.getText()`는 문서의 EOL을 그대로 돌려주고, GPT는 `\n`으로 보낸다.
두 가지 방향이 있었다.

- (a) 문서를 LF로 정규화해 찾고, 찾은 위치를 원본 오프셋으로 역매핑
- (b) **찾을 문자열을 문서의 EOL에 맞춰 바꾼 뒤 그대로 찾기** ← 채택

(b)는 오프셋 역매핑이 없어 경계 조건에서 틀릴 여지가 없고, 치환 문자열도 같은 EOL로
맞추면 파일의 줄바꿈 스타일이 보존된다. 줄바꿈이 섞인 파일을 위해 다른 EOL 후보로도
한 번 더 시도한다. CRLF 파일에서 LF로 보낸 여러 줄 문자열이 매칭되는지, 치환 후
줄바꿈이 깨지지 않는지 테스트로 확인했다.

### 테스트 — 131개 전부 통과 (Phase 4에서 45개 추가)

| 파일 | 개수 | 범위 |
|---|---|---|
| `test/textEdit.test.ts` | 22 | EOL 정규화, 0회·2회 매치, CRLF 매칭 7종, 변경 요약 |
| `test/approvalGate.test.ts` | 23 | 기본 흐름 5, 직렬 큐 3, 만료 4, 승인 모드 6, delete 4 |

직렬 큐 테스트는 동시 요청 중 프롬프트가 **동시에 두 개 이상 뜨지 않는지**를
카운터로 확인한다. 만료 테스트는 타임아웃 후 사용자가 '적용'을 눌러도 승인되지 않고
별도 알림이 나가는지를 확인한다 — §5.4.1의 핵심이다.

### 설계 판단 기록

- **`doc.version` 대조 대신 재검색을 쓴다.** 기획안 §5.4.1은 승인 시점의 문서 버전과
  대조하라고 하지만, 그러면 사용자가 파일의 **다른 부분**을 건드리기만 해도 편집이
  거부된다. 대신 승인 직후 `old_string`을 다시 찾아 여전히 고유한지 확인한다.
  대상 문자열이 사라졌거나 중복이 생겼으면 거부하고, 오프셋이 밀렸으면 새 위치를 쓴다.
  버전 대조보다 정확하고 오탐이 없다.
- **서버 중지 시 세션 승인을 해제한다.** 기획안은 확장 리로드 시 해제를 요구하지만,
  서버를 껐다 켠 것도 새 세션으로 보는 편이 안전하다.
- **삭제는 휴지통을 우선한다.** `workspace.fs.delete({useTrash: true})`를 먼저 쓰고,
  실패하는 환경에서만 영구 삭제하며 그 사실을 응답에 명시한다.
- **`save_file` description에 "기본적으로 부르지 말 것"을 넣었다.** 저장하지 않는 것이
  이 확장의 안전장치이므로 모델이 습관적으로 저장하면 안 된다.

### 미해결 / 다음 Phase로 넘김

- **vscode API 경로 실측 미완.** 검증한 것은 매칭 로직과 승인 게이트다.
  `applyEdit`이 실제로 버퍼에만 적용되는지, Ctrl+Z로 되돌아가는지, 승인 거부 시
  버퍼가 그대로인지는 F5 확인이 필요하다. Phase 4 완료 기준의 핵심이라 반드시 확인할 것.
- **`createFile`의 상위 디렉터리 자동 생성**을 문서로만 확인했다. 실측 필요.
- 감사 로그 영속화(§5.6)는 Phase 5 항목이다. 현재는 LogOutputChannel과 패널에만 남는다.

---

## Phase 5 — 마감 ⚠️ 코드 완료, 패키징 검증 미완

### 완료 항목

| 항목 | 파일 | 비고 |
|---|---|---|
| 감사 로그 | `src/audit/AuditLog.ts` | JSONL, 직렬 쓰기, 5MB 로테이션, vscode 비의존 |
| 경로 마스킹 | `src/workspace/redact.ts` | 오류 메시지의 절대 경로를 `<workspace>`로 |
| 감사 연동 | `src/mcp/McpServer.ts` | 툴 호출·차단·거부·만료·디스크쓰기·인증실패 |
| 만료 선택 기록 | `src/extension.ts` | 게이트 훅 → `expired_choice` |
| 종료 시 flush | `src/extension.ts` | `deactivate()`가 큐를 비울 때까지 대기 |

승인 모드 3종과 자동 저장 옵션은 Phase 4에서 이미 완료되었다.

### 기록하는 사건

툴 호출만이 아니라 **아무 일도 일어나지 않은 사건**을 함께 남긴다. 사용자가
나중에 "GPT가 뭘 시도했나"를 되짚을 수 있어야 하기 때문이다.

`tool_call` · `path_denied` · `approval_denied` · `approval_expired` ·
`expired_choice` · `disk_write` · `auth_failure` · `server`

`detail`은 500자에서 자른다. 자르지 않으면 `write_file`의 인자 요약에 파일 내용이
통째로 들어간다.

### 에러 처리 정리

- 예기치 못한 오류 메시지에서 워크스페이스 절대 경로를 걷어낸다. fs 오류에는
  절대 경로가 섞여 있어 그대로 돌려주면 워크스페이스 밖 디렉터리 구조가 노출된다.
- 감사 로그 쓰기 실패는 삼키고 `onError`로만 알린다. 로그 때문에 툴이 죽으면 안 된다.
  실패해도 큐가 끊기지 않는지 테스트로 확인했다.

### 테스트 — 142개 전부 통과 (Phase 5에서 11개 추가)

| 파일 | 개수 | 범위 |
|---|---|---|
| `test/auditLog.test.ts` | 11 | JSONL 형식, 직렬성 200건, 사건 종류, 절삭, 실패 내성, 경로 마스킹 |

### 구현 중 발견한 것

**`redactRoot`를 `registry.ts`에 두었더니 테스트가 통째로 실패했다.** `registry.ts`는
툴 모듈을 import하고 그 모듈들이 `vscode`를 끌어온다. 테스트 번들에서 `vscode`는
external이라 로드 시점에 터진다. 순수 모듈(`workspace/redact.ts`)로 분리했다.

→ 교훈: 테스트하려는 함수는 vscode를 import하는 모듈에 두지 말 것. Phase 2부터
지켜 온 원칙인데 한 번 어겼다가 바로 드러났다.

### 미해결

- **`.vsix` 패키징 검증이 Linux 기준이다.** 이 환경에서 만든 `.vsix`에는
  `ripgrep-linux-x64`가 들어간다. 대상 환경이 Windows이므로 **Windows에서 다시
  패키징해 `rg.exe` 포함과 검색 동작을 확인해야 한다.** VERIFICATION.md E-8~E-12.
- 로컬 설치(`code --install-extension`) 미검증.

---

## Windows 실측 (2026-08-05) ✅

Phase 1~5는 GUI 없는 Linux 컨테이너에서 작성했다. `vscode` API를 호출하는 경로는
전부 미검증 상태였고, VERIFICATION.md는 그 목록이었다. **Windows 11 + VS Code
1.131에서 실제로 확인했다.**

### 결과

| 구간 | 결과 |
|---|---|
| A-1 ~ A-7 확장 골격 | ✅ 전부 |
| B-2 ~ B-10 읽기 툴 | ✅ 전부 |
| B-S1 ~ B-S11 보안 | ✅ 전부 |
| B-P2 루프백 바인드 | ✅ (`netstat`로 `127.0.0.1:3737` 확인, LAN IP 접속 실패) |
| **D-1 ~ D-21 쓰기·승인** | ✅ **전부** |
| E-1 ~ E-6 감사 로그 | ✅ 전부 |
| C 터널·ChatGPT | ⬜ 미착수 |
| E-8 ~ E-12 패키징 | ⬜ 미착수 |

자동 테스트도 Windows에서 처음 돌렸다. 142개 중 141 통과, 1 skip —
파일 심볼릭 링크 케이스로, 관리자 권한이 없어 링크를 만들지 못했다(§10-13의
예고된 동작). 디렉터리 junction 케이스는 통과했다.

### Windows에서 처음 실증된 것

전부 Linux에서는 재현 자체가 불가능해 "이론상 이럴 것"으로 두었던 코드다.

- **CRLF `edit_file`** — LF로 보낸 여러 줄 `old_string`이 CRLF 파일에 매칭되고,
  수정 후에도 CRLF 4줄 / LF 단독 0줄로 줄바꿈이 보존됐다. 섞이지 않았다.
- **ADS 우회 차단** — `.env::$DATA`가 "경로에 콜론을 사용할 수 없습니다"로 막혔다.
  거부 규칙 `.env`가 아니라 **콜론 검사**가 잡았다. 의도한 층에서 걸린 것이다.
- **예약 장치명** — `CON`이 차단되고 VS Code가 멈추지 않았다.
- **버퍼 편집의 디스크 불변성** — 편집기에 `777`, 디스크 SHA256은 편집 전과
  한 비트도 다르지 않았다.
- **만료 승인 폐기** — 90.015초에 만료 응답이 나간 뒤, **4분 11초 뒤** 누른
  `적용`이 폐기되고 `expired_choice`가 기록됐다. 파일은 그대로였다.
- **직렬 큐** — 두 번째 요청의 `durationMs` 73,555 중 약 71초가 순수 대기였다.
  자기 모달이 뜬 뒤로는 2초 만에 끝났다.

`durationMs`가 뜻밖에 좋은 증거였다. 승인 모드 검증에서 `always`는 3902/4222/1559ms,
`session`은 6296 → **6 → 6ms**로 떨어진다. 사람을 거쳤는지가 숫자로 드러난다.
0회·2회 매치 실패는 0~8ms — 모달을 띄우기 전에 걸러냈다는 뜻이다.

### 문서와 실제가 달랐던 곳

- **§5.4 모달 버튼.** 초안 예시는 `적용`/`Diff 보기`/`거부`인데 구현은
  `적용`/`Diff 보기`이고 VS Code가 `취소`를 붙인다. Esc·취소·강제 종료가 모두
  `undefined`로 수렴해 거부가 되는 편이 안전하다. → §5.4 정정.
- **VERIFICATION.md B절.** MCP Inspector의 `Bearer Token` 칸이 프록시를 거치며
  전달되지 않았다. 감사 로그가 `auth_failure / missing`으로 알려 줬다.
  `Custom Headers`에 `Authorization: Bearer <토큰>`을 직접 넣어야 한다.
- **VERIFICATION.md B-4.** rg는 **git 저장소 안에서만** `.gitignore`를 적용한다
  (`--no-require-git`을 주지 않으므로). 테스트 폴더에 `git init`이 없으면
  B-4가 실패한 것처럼 보인다.

### 미확인으로 남긴 것

- **B-P1** 포트 충돌 처리. 3737을 점유한 상태를 만들지 않았다.
- **E-7** 감사 로그 `detail` 500자 절삭. 현재 `detail`에는 경로만 들어가서
  500자에 닿을 일이 없다. 도달 경로부터 다시 봐야 한다.

---

## Phase 6 — 컨텍스트 절약 ✅

실사용 계획(회사 코드를 저장소 경유 없이 직접 다루는 용도)을 두고 검토한 결과,
**컨텍스트가 실질적 한계**로 지목됐다. 모델은 수정할 때마다 같은 파일을 처음부터
다시 읽고, 그 내용이 대화에 계속 쌓인다.

### 설계 판단 — 막지 않고 알린다

처음에는 `read_file`에 줄 수 하드 상한(`maxReadLines`)을 두려 했다. **철회했다.**
파일 전체를 읽어야 하는 상황은 실제로 있고 — 처음 구조를 파악할 때가 그렇다 —
줄 수로 무조건 자르면 정당한 읽기까지 막힌다. 게다가 `start_line=1,
end_line=99999`로 우회할 수 있어 제한을 명시적 범위 요청에도 적용해야 하는데,
그러면 "필요한 만큼 읽는" 정상 사용까지 걸린다.

대신 **판단 근거를 주는 쪽**으로 갔다. 내용은 항상 그대로 돌려주고 조언만 덧붙인다.

### 완료 항목

| 항목 | 파일 | 비고 |
|---|---|---|
| 읽기 이력 추적 | `src/workspace/readTracker.ts` | 신규. vscode 비의존, SHA-1 앞 16자 지문 |
| 반복 읽기 안내 | `src/mcp/tools/readFile.ts` | `repeat-unchanged` / `repeat-changed` / 400줄 초과 |
| 세션 경계 | `src/mcp/McpServer.ts` | 서버 시작 시 `reads.reset()` — 승인 세션과 같은 경계 |
| `context_lines` | `src/workspace/ripgrep.ts`, `tools/searchText.ts` | 0~5, 기본 2. 음수·소수 보정 |
| 툴 description | `readFile.ts`, `searchText.ts` | 읽는 범위 원칙 명시 |
| 사용자 지침 | `src/instructions.ts` | 6~11번 추가 |

### 왜 description까지 고쳤나

사용자 지침(§4.4)은 ChatGPT 커스텀 지침에 붙여 넣는 것이라 사용자가 빠뜨리거나
모델이 무시할 수 있다. 툴 description은 **툴 목록과 함께 매번 전달**되므로 더
확실하다. 둘 다 같은 원칙을 담았다.

### 테스트 — 159개 전부 통과 (Phase 6에서 17개 추가)

| 파일 | 개수 | 범위 |
|---|---|---|
| `test/readTracker.test.ts` | 14 | 지문 3, 처음 읽기 3, 반복 4, 범위 읽기 3, 세션 경계 1 |
| `test/ripgrep.test.ts` | +3 | `contextLines` 0 / 1 vs 2 / 음수 보정 |

범위 읽기(`ranged`)에 참견하지 않는 것을 따로 테스트했다. 유도하려는 형태에
잔소리를 붙이면 조언이 잡음이 된다.

`SearchOptions.contextLines`는 선택이 아니라 **필수 필드**로 뒀다. 기본값을 숨기면
호출부가 컨텍스트 비용을 의식하지 않게 된다. 기존 호출부 7곳을 전부 고쳤다.

### 미해결

- **읽기 이력은 프로세스 메모리에만 있다.** 확장을 리로드하면 사라진다. 의도한
  동작이지만, 긴 작업 중 리로드하면 이미 읽은 파일을 다시 읽어도 조언이 안 나온다.
- **조언의 실효성 미측정.** 모델이 실제로 이 안내를 따르는지는 ChatGPT 연동
  (C단계) 이후에야 확인할 수 있다. 안 따르면 description 문구를 강화해야 한다.

---

## 남은 검증

[`VERIFICATION.md`](./VERIFICATION.md)의 **C단계(터널·ChatGPT 연동)** 와
**E-8~E-12(패키징)** 가 남았다. 그 외에 B-P1, E-7이 미확인이다.
