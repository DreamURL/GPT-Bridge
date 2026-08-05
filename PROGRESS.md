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

## Phase 2 — 보안 기반 + 읽기 툴 (예정)

PathGuard와 거부 목록을 먼저 구현하고 §11 테스트를 통과시킨 뒤 MCP 서버·Bearer 인증·
읽기 툴 5종을 붙인다. `workspace/ripgrep.ts`를 만들어 `list_directory`와 `search_text`가 공유한다.
