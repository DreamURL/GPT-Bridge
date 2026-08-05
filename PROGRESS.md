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

## Phase 3 — 터널 + 패널 (예정)

TunnelManager, cloudflared 버전 핀 + SHA256 상수 테이블(§6.1), Webview 패널 실제 구현.
