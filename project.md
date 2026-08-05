# GPT Bridge — VS Code 확장 개발 기획안 (rev. 2)

현재 워크스페이스를 MCP 서버로 노출하여 ChatGPT 웹(Developer Mode 커스텀 커넥터)이 코드를 직접 읽고 수정할 수 있게 하는 VS Code 확장.

핵심 설계 원칙: **GPT의 텍스트 수정은 디스크가 아니라 에디터 버퍼에 적용된다.** 따라서 Ctrl+Z로 되돌릴 수 있고, Ctrl+S 전까지 디스크는 안전하다. 이것이 이 확장의 존재 이유이자 안전성의 근거다.

단, 이 보장은 **텍스트 편집에만** 성립한다. 파일 생성·삭제는 VS Code API 특성상 즉시 디스크에 반영된다(§4.2.1). 이 비대칭성은 설계 전반에 반영되어 있다.

개인 사용 목적. 마켓플레이스 배포 없이 `.vsix` 로컬 설치.

> rev. 2 변경 요약 — 초안 검토에서 확인된 5개 사항을 반영했다.
> 1. `workspace.findFiles`는 `.gitignore`를 반영하지 않는다 → 목록·검색 모두 ripgrep으로 통일 (§4.1)
> 2. 파일 생성/삭제는 버퍼가 아니라 디스크에 즉시 적용된다 → 안전성 서술 정정, 승인 규칙 강화 (§4.2.1)
> 3. 모달 다이얼로그는 타임아웃으로 닫을 수 없다 → nonce 기반 만료 승인 무시 (§5.4)
> 4. `@vscode/ripgrep` 네이티브 바이너리는 번들되지 않는다 → esbuild external + `.vscodeignore` 설계 (§2.1)
> 5. cloudflared 체크섬은 공식 목록에 의존할 수 없다 → 버전 핀 + 해시 상수 내장 (§6.1)

---

## 0. Claude Code 작업 지침

- **Phase 단위로 진행.** 각 Phase 완료 후 실제 동작을 확인하고 다음으로 넘어간다.
- **§5 보안 코드는 타협 불가.** 이 확장은 로컬 파일시스템을 공개 HTTPS 엔드포인트로 노출한다. "일단 동작하게" 우회 금지.
- TypeScript `strict: true`, `any` 금지.
- 모든 `Disposable`은 `context.subscriptions`에 등록한다. 확장 호스트는 리로드가 잦아 정리 누락 시 포트·프로세스가 누수된다.
- Phase 완료 시 `PROGRESS.md`에 완료 항목과 미해결 이슈 기록.

---

## 1. 왜 확장인가 (설계 배경)

Electron 독립 앱 대비 다음이 전부 불필요해진다:

- 에디터 셸(Monaco, 탭, 파일 트리) 구현
- 파일 감시 → 에디터 반영 파이프라인
- 자기 쓰기 에코 루프 억제
- 미저장 버퍼 vs 디스크 불일치 처리
- 충돌 해결 다이얼로그
- main/renderer IPC 설계

VS Code API가 대체한다:

```ts
// 읽기 — 열려 있으면 미저장 내용이 그대로 나온다
const doc = await vscode.workspace.openTextDocument(uri);
doc.getText();   doc.isDirty;

// 쓰기 — 디스크가 아니라 버퍼를 수정한다
const edit = new vscode.WorkspaceEdit();
edit.replace(uri, range, newText);
await vscode.workspace.applyEdit(edit);
```

`applyEdit`은 undo 스택에 편입되고 커서 위치를 보존한다.

추가로 확장에서만 가능한 것: **진단 정보 접근**(`languages.getDiagnostics`). GPT가 타입 에러와 린트 경고를 직접 읽고 고칠 수 있다. §4.1 참조.

---

## 2. 기술 스택 / 프로젝트 구조

| 영역 | 선택 |
|---|---|
| 언어 | TypeScript strict |
| 번들러 | esbuild |
| MCP | `@modelcontextprotocol/sdk` — Streamable HTTP |
| HTTP | `express` |
| 스키마 | `zod` |
| 파일 목록 · 텍스트 검색 | `@vscode/ripgrep` (§4.1, §2.1 참조) |
| 패키징 | `@vscode/vsce` |
| 최소 엔진 | `^1.90.0` |

```
gpt-bridge/
├─ package.json                 contributes 정의 (§3)
├─ .vscodeignore                ★ ripgrep 바이너리 포함 규칙 (§2.1)
├─ esbuild.mjs                  vscode / @vscode/ripgrep external
├─ src/
│  ├─ extension.ts              activate / deactivate
│  ├─ mcp/
│  │  ├─ McpServer.ts           서버 생명주기, 포트 관리
│  │  ├─ auth.ts                Bearer 미들웨어
│  │  ├─ registry.ts            툴 등록
│  │  └─ tools/                 툴 1개 = 파일 1개
│  ├─ workspace/
│  │  ├─ PathGuard.ts           ★ 경로 검증
│  │  ├─ denyList.ts
│  │  ├─ ripgrep.ts             ★ rg 실행 래퍼 (목록 + 검색)
│  │  └─ documents.ts           openTextDocument / applyEdit 래퍼
│  ├─ approval/
│  │  ├─ ApprovalGate.ts        직렬 큐 + nonce 만료 처리
│  │  └─ DiffPreview.ts         TextDocumentContentProvider
│  ├─ tunnel/
│  │  ├─ TunnelManager.ts
│  │  └─ binary.ts              cloudflared 다운로드/검증 (핀 고정)
│  ├─ ui/
│  │  ├─ BridgeViewProvider.ts  사이드바 Webview
│  │  ├─ statusBar.ts
│  │  └─ output.ts              LogOutputChannel
│  └─ audit/AuditLog.ts
└─ media/                       Webview 정적 자원
```

### 2.1 번들링 — ripgrep 네이티브 바이너리 (변경 4, Phase 2에서 실측 반영)

esbuild로 단일 번들을 만들 때 `@vscode/ripgrep`을 그냥 묶으면 **rg 실행 파일이 따라오지 않는다.** 실제 바이너리는 번들러가 알 수 없는 별도 파일이다. Phase 5 패키징에서 "개발 중엔 되는데 `.vsix` 설치본에서만 rg를 못 찾는" 형태로 터진다.

> **rev.2 초안의 전제 두 가지가 실제와 달랐다** (`@vscode/ripgrep` 1.18 실측):
>
> 1. **패키지가 ESM 전용이다** (`"type": "module"`). 확장 번들은 CJS이고 VS Code 1.90의 Electron은 Node 20이라 `require()`로 ESM을 불러올 수 없다. → 패키지를 import하지 않고 `rgPath` 계산 로직만 재현한다.
> 2. **바이너리가 `@vscode/ripgrep/bin/rg`에 없다.** 플랫폼별 optional 의존성(`@vscode/ripgrep-linux-x64/bin/rg` 등 12종)으로 분리되어 있고, 메타 패키지는 경로를 계산해 주는 ESM 모듈일 뿐이다. → `.vscodeignore` negation이 하나 더 필요하다.

규칙:

- esbuild `external: ['vscode', '@vscode/ripgrep']` — 런타임 `require`로 남긴다.
- `.vscodeignore`에서 `node_modules/**`를 제외하되 **두 줄**로 되살린다:
  ```
  !node_modules/@vscode/ripgrep/**
  !node_modules/@vscode/ripgrep-*/**
  ```
- rg 경로는 `require.resolve(`@vscode/ripgrep-${process.platform}-${process.arch}/bin/rg`)`로 구한다. 실패 시 확장 경로 기준 추정을 대비책으로 둔다.
- 못 찾으면 `list_directory`·`search_text`를 **아예 등록하지 않고** 사용자에게 알린다. 목록에 있는데 부르면 실패하는 것보다 없는 편이 모델에게 정확한 정보다(조용한 실패 금지).
- macOS·Linux에서 실행 권한(`0o755`)이 유지되는지 `.vsix` 설치본으로 실측한다.
- **npm은 패키징하는 기기의 플랫폼 패키지만 설치한다.** 따라서 `.vsix`는 만든 OS/아키텍처에서만 검색이 동작한다. 다른 기기에 설치하려면 그 기기에서 다시 패키징해야 한다 — §10에 명시.
- 대안(권장하지 않음): VS Code 내장 rg 경로(`process.execPath` 상대 경로) 추정 — 버전마다 위치가 달라 깨진다.

*Phase 5 완료 기준에 "`.vsix` 설치본에서 `search_text` 동작 확인"을 명시한다.*

---

## 3. package.json contributes

```jsonc
{
  "name": "gpt-bridge",
  "engines": { "vscode": "^1.90.0" },
  "extensionKind": ["workspace"],
  "capabilities": {
    "untrustedWorkspaces": {
      "supported": false,
      "description": "로컬 파일시스템을 외부에 노출하므로 신뢰된 워크스페이스에서만 동작합니다."
    }
  },
  "activationEvents": ["onStartupFinished"],
  "contributes": {
    "commands": [
      { "command": "gptBridge.start",           "title": "GPT Bridge: 서버 시작" },
      { "command": "gptBridge.stop",            "title": "GPT Bridge: 서버 중지" },
      { "command": "gptBridge.copyUrl",         "title": "GPT Bridge: 커넥터 URL 복사" },
      { "command": "gptBridge.copyToken",       "title": "GPT Bridge: 인증 토큰 복사" },
      { "command": "gptBridge.regenerateToken", "title": "GPT Bridge: 토큰 재발급" },
      { "command": "gptBridge.setTunnelToken",  "title": "GPT Bridge: 터널 토큰 설정" },
      { "command": "gptBridge.copyInstructions","title": "GPT Bridge: ChatGPT 지침 복사" },
      { "command": "gptBridge.showLog",         "title": "GPT Bridge: 로그 열기" }
    ],
    "viewsContainers": {
      "activitybar": [{
        "id": "gptBridge", "title": "GPT Bridge", "icon": "media/icon.svg"
      }]
    },
    "views": {
      "gptBridge": [{
        "id": "gptBridge.panel", "name": "브릿지", "type": "webview"
      }]
    },
    "configuration": {
      "title": "GPT Bridge",
      "properties": {
        "gptBridge.port":            { "type": "number",  "default": 3737 },
        "gptBridge.autoStart":       { "type": "boolean", "default": false },
        "gptBridge.tunnel.provider": { "type": "string",  "enum": ["cloudflare", "none"], "default": "cloudflare" },
        "gptBridge.tunnel.hostname": { "type": "string",  "default": "",
          "description": "Named Tunnel의 공개 호스트명. 토큰만으로는 알아낼 수 없어 직접 지정한다(§6.2)." },
        "gptBridge.approval.mode":   { "type": "string",  "enum": ["always", "session", "pattern"], "default": "always" },
        "gptBridge.approval.autoApprovePatterns": { "type": "array", "default": [], "items": { "type": "string" } },
        "gptBridge.approval.timeoutSeconds": { "type": "number", "default": 90,
          "description": "무응답 시 요청을 거부 처리합니다. 화면의 확인 창은 그대로 남으며, 만료 후 누른 선택은 무시됩니다." },
        "gptBridge.autoSave":        { "type": "boolean", "default": false,
          "description": "GPT 수정 후 자동 저장. 끄면 Ctrl+S 전까지 디스크에 반영되지 않습니다(권장)." },
        "gptBridge.deny.extraPatterns": { "type": "array", "default": [], "items": { "type": "string" } },
        "gptBridge.maxReadBytes":    { "type": "number",  "default": 1048576 }
      }
    }
  }
}
```

`onStartupFinished`로 활성화하되, `autoStart`가 false면 서버는 띄우지 않고 상태바만 표시한다.

**인증 토큰과 터널 토큰은 `configuration`에 넣지 않는다.** `context.secrets`(SecretStorage)에 저장한다. settings.json은 평문이고 Settings Sync·git 커밋 위험이 있다. 터널 토큰은 `gptBridge.setTunnelToken` 명령에서 `showInputBox({ password: true })`로 입력받는다.

---

## 4. MCP 툴 명세

모든 툴 입력은 `zod`로 검증하고, 모든 경로 인자는 예외 없이 `PathGuard.resolve()`를 통과시킨다. 실패 시 `isError: true`와 사람이 읽을 수 있는 이유를 반환한다.

### 4.1 읽기 계열

**`get_workspace_info`** — 인자 없음

루트 폴더명, 파일 수, 주요 언어, 현재 열린 에디터 목록, 활성 파일과 선택 영역, 진단 요약(에러 n개/경고 n개)을 반환.
→ description에 "코드 작업을 시작할 때 가장 먼저 호출할 것"을 명시.

**`list_directory`**

```
path?: string    루트 기준 상대 경로, 기본 "."
depth?: number   기본 1, 최대 3
```

**구현은 `workspace.findFiles`가 아니라 ripgrep(`rg --files`)이다.** (변경 1)

`workspace.findFiles`는 `.gitignore`를 반영하지 않는다. 반영되는 것은 `files.exclude`와 `search.exclude` 설정뿐이고, `.gitignore` 존중은 proposed API인 `findFiles2`의 `useIgnoreFiles` 옵션에서만 제공된다. 초안의 "`workspace.findFiles`로 구현, `.gitignore` 반영" 전제는 성립하지 않는다.

`rg`는 기본적으로 `.gitignore`·`.ignore`·`.rgignore`를 존중하므로 별도 파서가 필요 없고, `search_text`와 구현을 공유할 수 있다.

```
rg --files --hidden --no-messages --glob '!.git/**' -- <절대경로>     (cwd = 워크스페이스 루트)
```

- **rg는 반드시 cwd를 워크스페이스 루트로 고정해 실행한다.** `--glob` 패턴은 cwd 기준으로 매칭되므로, 임의의 cwd에서 실행하면 `!.git/**` 제외도 `include` 지정도 오류 없이 조용히 무효가 된다. Phase 2에서 실제로 이 상태였고 테스트로 잡았다.
- `--hidden`을 주되 `.git/**`는 명시적으로 제외한다(거부 목록과 중복 방어).
- 결과를 루트 상대 경로로 바꾼 뒤 `depth`로 잘라내고 디렉터리를 집계한다.
- 거부 목록(§5.3)을 추가 적용한다. rg가 무시하지 않는 항목(`.env` 등)이 여기서 걸린다.
- `node_modules/**`는 목록에서 제외한다(읽기는 허용).
- 항목별 `type`, `size` 포함. `size`는 `fs.stat`으로 채우되 항목 수 상한(기본 1000)을 두고 초과 시 잘라 표시한다.
- rg 부재 시(§2.1) 이 툴은 등록하지 않고 사유를 로그·패널에 남긴다.

**`read_file`**

```
path: string
start_line?: number
end_line?: number
```

- `workspace.openTextDocument`로 읽는다. **열려 있고 미저장이면 그 내용이 그대로 반환된다** — 별도 처리 불필요.
- `doc.isDirty`를 응답에 포함.
- 줄 번호를 접두사로 붙여 반환(`  12│ const x = 1`). `edit_file` 정확도가 올라간다.
- `maxReadBytes` 초과 시 거부하고 라인 범위 지정을 안내.
- 응답 본문은 `<file_content path="...">` 태그로 감싼다(§5.5).

**`search_text`**

```
query: string
is_regex?: boolean
include?: string       glob
max_results?: number   기본 50
```

`workspace.findTextInFiles`는 **proposed API라 일반 확장에서 사용할 수 없다.** `@vscode/ripgrep`의 `rgPath`로 rg 바이너리를 직접 실행할 것. 매치 줄 + 앞뒤 2줄 컨텍스트 반환.

- `--json` 출력을 파싱한다(줄 기반 파싱은 콜론·개행 포함 내용에서 깨진다).
- 인자는 `spawn`의 배열 인자로 전달한다. 셸 문자열 조합 금지.
- `-e <query>`로 패턴을 명시해 `-`로 시작하는 질의가 옵션으로 해석되는 것을 막는다.
- `is_regex`가 false면 `--fixed-strings`.
- 타임아웃 10초, 초과 시 프로세스 kill 후 부분 결과와 함께 잘렸음을 알린다.

**`get_diagnostics`**

```
path?: string    생략 시 워크스페이스 전체
severity?: "error" | "warning" | "all"
```

`vscode.languages.getDiagnostics()`. 파일·줄·컬럼·메시지·소스(ts, eslint 등) 반환.
→ 이 확장의 핵심 차별점. description에 "수정 후 반드시 호출하여 새 에러가 생겼는지 확인할 것"을 명시.

### 4.2 쓰기 계열

전부 §5.4 승인 게이트를 통과해야 한다.

#### 4.2.1 디스크 반영 시점 — 텍스트 편집과 파일 조작의 비대칭 (변경 2)

`WorkspaceEdit`은 두 종류의 연산을 담을 수 있고, 둘의 디스크 반영 시점이 다르다.

| 연산 | `applyEdit` 직후 디스크 | Ctrl+Z |
|---|---|---|
| `replace` / `insert` / `delete` (텍스트) | **변경되지 않음** (버퍼만 dirty) | 완전히 복구 |
| `createFile` | **즉시 생성됨** | 제한적 |
| `deleteFile` | **즉시 삭제됨** | 휴지통 이동 시에만 복구 가능 |
| `renameFile` | **즉시 반영됨** | 제한적 |

즉 "Ctrl+S 전까지 디스크는 안전하다"는 보장은 `edit_file`, 그리고 **기존 파일을 대상으로 한** `write_file`에만 성립한다. 신규 파일 생성과 삭제는 승인 즉시 디스크에 반영된다.

따라서:

- 신규 생성·삭제 계열은 승인 프롬프트 문구에서 **"디스크에 즉시 반영됩니다"**를 명시한다. 텍스트 편집 프롬프트와 문구를 구분한다.
- `delete_path`는 `edit.deleteFile(uri, { recursive, ignoreIfNotExists: false })`를 쓰되, **가능하면 `workspace.fs.delete(uri, { useTrash: true })`로 휴지통 이동**을 우선한다. 복구 가능성이 다르다.
- README §10과 Webview 패널 안내에 이 비대칭을 명시한다. 사용자가 "어차피 저장 안 하면 되지"로 오해한 채 `delete_path`를 자동 승인 대상에 넣는 상황을 막는다.
- `create_directory`도 즉시 반영이다. 다만 되돌림 비용이 낮아 별도 경고는 두지 않는다.

**`edit_file`** ← 주력 툴

```
path: string
old_string: string    파일 내 정확히 1회만 등장해야 함
new_string: string
```

- `WorkspaceEdit.replace()`로 **버퍼에 적용**. 디스크에 쓰지 않는다.
- 0회 매치 → 실패, "문자열을 찾을 수 없음. read_file로 현재 내용 확인 요망"
- 2회 이상 매치 → 실패, "고유하지 않음. 더 넓은 컨텍스트 포함 요망"
- **줄바꿈 정규화가 필수다(Windows).** `TextDocument.getText()`는 문서의 EOL을 그대로 반환하므로 CRLF 파일에서는 `\r\n`이 섞여 나온다. GPT는 거의 항상 `\n`으로 `old_string`을 보낸다. 정규화 없이 그대로 비교하면 **CRLF 파일에서 edit_file이 항상 0회 매치로 실패한다.** 양쪽을 `\n`으로 정규화해 매칭한 뒤, 찾은 위치를 원본 오프셋으로 되돌려 `Range`를 만들어야 한다.
- description에 **"기존 파일 수정에는 write_file 대신 반드시 이 툴을 사용"** 명시.

**`write_file`**

```
path: string
content: string
```

신규 생성 또는 전체 교체.

- 기존 파일이면 문서를 열어 전체 범위 `replace`로 처리한다(버퍼 편집 → undo 가능). 응답에 "edit_file 사용 권장" 경고를 포함.
- 신규 파일이면 `createFile` → 즉시 디스크 생성. 응답에 디스크 반영 사실을 명시한다(§4.2.1).

**`create_directory`** / **`delete_path`**

`delete_path`는 승인 모드와 무관하게 **항상 확인**한다. 자동 승인 대상에서 영구 제외. 기본은 휴지통 이동(§4.2.1).

**`save_file`**

```
path: string
```

`doc.save()`. `autoSave`가 켜져 있으면 쓰기 툴 내부에서 자동 호출된다.

### 4.3 툴 description 작성 원칙

ChatGPT는 명시적 지시 없이는 커스텀 툴을 잘 호출하지 않는다. 각 description에 반드시 포함:

1. 언제 쓰는지 **+ 언제 쓰지 않는지**
2. 다른 툴과의 호출 순서 (`read_file` → `edit_file` → `get_diagnostics`)
3. 파라미터별 설명과 짧은 예시

### 4.4 사용자용 ChatGPT 커스텀 지침

`gptBridge.copyInstructions` 명령과 Webview 패널의 복사 버튼으로 제공한다.

```
코드 작업 시 GPT Bridge 커넥터의 툴만 사용한다.
내장 브라우징, 코드 인터프리터, 캔버스는 사용하지 않는다.

작업 순서:
1. 첫 턴에 get_workspace_info를 호출한다.
2. 수정 전 반드시 read_file로 현재 내용을 확인한다.
3. 기존 파일 수정은 edit_file을 사용한다. write_file은 신규 생성 전용이다.
4. 수정 후 get_diagnostics를 호출해 새 에러가 없는지 확인한다.
5. 코드를 채팅창에 출력하지 말고 파일에 직접 반영한다.
```

---

## 5. 보안 (필수)

확장이라고 안전해지지 않는다. 공개 HTTPS 엔드포인트에 파일시스템 읽기·쓰기가 열린다.

### 5.1 인증

- 서버 시작 시 `crypto.randomBytes(32).toString('hex')` 생성, `context.secrets`에 저장
- 모든 요청에서 `Authorization: Bearer <token>` 검증. 불일치 시 401
- 비교는 길이 선체크 후 `crypto.timingSafeEqual` 사용
- 재발급 명령 제공, 재발급 시 기존 세션 즉시 무효화

### 5.2 바인딩

- `127.0.0.1`에만 바인드. `0.0.0.0` 금지
- CORS 비활성
- `express-rate-limit` 분당 120회
- 바디 상한 5MB
- 포트 충돌(EADDRINUSE) 시 에러 알림 + 포트 변경 안내

### 5.3 PathGuard

모든 파일 접근이 통과하는 단일 관문.

```ts
async function resolve(userPath: string): Promise<vscode.Uri> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new PathError('열린 워크스페이스가 없습니다');

  if (path.isAbsolute(userPath)) throw new PathError('상대 경로만 허용됩니다');
  if (userPath.includes('\0'))   throw new PathError('잘못된 경로');

  const resolved = path.resolve(root, userPath);
  const real     = await realpathOrParent(resolved);   // 심볼릭 링크 해석
  const realRoot = await fs.realpath(root);

  const rel = path.relative(realRoot, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new PathError('워크스페이스 외부 접근이 차단되었습니다');
  }
  if (isDenied(rel)) throw new PathError('접근이 차단된 경로입니다');

  return vscode.Uri.file(real);
}
```

`real.startsWith(realRoot)` 형태의 접두사 비교로 구현하지 말 것. 루트가 `/work`일 때 `/work-secret`이 통과한다. 반드시 `path.relative` 기반으로 판정한다.

#### 5.3.1 Windows 경로 정규화 우회 (Phase 3에서 추가)

Windows는 파일을 열 때 경로를 정규화한다. 그 결과 **거부 목록이 검사한 문자열과 실제로 열리는 파일이 달라질 수 있다.** 거부 목록은 문자열 매칭이므로 이 틈은 목록을 아무리 늘려도 막히지 않는다. `PathGuard`에서 입력 단계에 차단한다.

| 입력 | Windows가 실제로 여는 것 | 거부 목록 매칭 |
|---|---|---|
| `.env::$DATA` | `.env` 본문 (대체 데이터 스트림) | `.env`와 문자열이 달라 통과 |
| `.npmrc.` | `.npmrc` (후행 마침표 제거) | 통과 |
| `.npmrc ` | `.npmrc` (후행 공백 제거) | 통과 |
| `CON`, `COM1` | 파일이 아니라 장치 — 열면 멈출 수 있다 | 해당 없음 |
| `C:a.txt` | 드라이브 상대 경로. `path.isAbsolute`가 **false**를 반환한다 | 절대 경로 검사를 통과 |

따라서 다음을 거부한다:

- 콜론이 포함된 경로 (ADS)
- 마침표나 공백으로 끝나는 경로 구성요소
- 예약 장치명 `CON`, `PRN`, `AUX`, `NUL`, `COM0`–`COM9`, `LPT0`–`LPT9` (확장자가 붙어도 장치다)
- `^[A-Za-z]:` 로 시작하는 경로

**이 검사는 플랫폼과 무관하게 항상 동작한다.** 플랫폼별로 다르게 판정하면 어느 쪽이 안전한지 추론하기 어려워지고, 애초에 문제 상황은 "다른 곳에서 만든 저장소를 Windows에서 여는 것"이다. `console.ts`, `com.example.json` 같은 정상 파일명은 영향받지 않는다.

**거부 목록** (설정으로 추가만 가능, 기본 항목 제거 불가):

```
.git/**, .env, .env.*, *.pem, *.key, *.p12, *.pfx,
id_rsa*, id_ed25519*, .ssh/**, .aws/**, .npmrc, .netrc,
.vscode/settings.json
```

`node_modules/**`는 목록·검색에서 제외하되 읽기는 허용.

rg에 넘기는 경로도 예외 없이 `PathGuard.resolve()`를 거친 결과여야 한다. 검색 결과로 돌아온 경로 역시 루트 상대 경로로 환원해 응답한다(절대 경로 노출 금지).

### 5.4 승인 게이트

쓰기 계열 툴은 실행 전 승인을 받는다. **동시 요청은 직렬 큐로 처리**한다(모달이 겹치면 안 됨).

```ts
const choice = await vscode.window.showInformationMessage(
  `GPT가 ${relPath} 수정을 요청했습니다 (+${added} -${removed})`,
  { modal: true },
  '적용', 'Diff 보기', '거부'
);
```

파일 생성·삭제는 문구를 달리한다(§4.2.1):

```
GPT가 ${relPath} 삭제를 요청했습니다.
이 작업은 승인 즉시 디스크에 반영됩니다(휴지통으로 이동).
```

'Diff 보기' 선택 시 `TextDocumentContentProvider`로 `gpt-bridge-preview:` 스킴 가상 문서를 등록하고 `vscode.diff` 명령으로 좌우 비교를 띄운 뒤 다시 승인을 묻는다.

승인 모드:

- `always` — 항상 확인 (기본값)
- `session` — 첫 승인 후 해당 세션 자동 승인. 확장 리로드 시 해제
- `pattern` — `autoApprovePatterns` 매칭 시 자동 승인

`delete_path`는 세 모드 모두에서 항상 확인.

#### 5.4.1 타임아웃 — 모달은 프로그램적으로 닫을 수 없다 (변경 3)

`showInformationMessage({ modal: true })`가 띄운 창은 확장 코드에서 dismiss할 수 없다. 타이머와 race해서 90초 뒤 "거부"를 반환해도 **화면의 창은 그대로 남는다.** 사용자가 3분 뒤 그 창의 '적용'을 누르면, 이미 거부로 응답한 요청이 뒤늦게 파일을 수정하는 사태가 된다. 초안의 "타임아웃 90초, 무응답 시 거부 처리"만으로는 이 구멍이 막히지 않는다.

설계:

- 모든 승인 요청에 `requestId`(nonce)를 부여하고 게이트가 `pending: Map<string, State>`로 관리한다.
- 타임아웃 시 상태를 `expired`로 바꾸고 즉시 `denied` 응답을 반환한 뒤 큐를 다음 요청으로 진행시킨다.
- 모달 Promise가 나중에 resolve되면 상태를 확인한다. `expired`면 **선택값을 버린다.** 편집은 수행하지 않는다.
- 이때 `showWarningMessage`(비모달)로 "만료된 요청이라 적용하지 않았습니다. 필요하면 GPT에게 다시 요청하세요"를 알린다. 조용히 삼키지 않는다.
- 만료 후 선택 이벤트는 감사 로그에 `expired_choice`로 기록한다.
- 타임아웃 값은 `gptBridge.approval.timeoutSeconds`로 노출하고, 설명에 "창은 남고 만료 후 선택은 무시된다"를 명시한다.
- 실제 편집 직전 문서 버전(`doc.version`)을 승인 시점 값과 대조한다. 승인을 기다리는 동안 사용자가 파일을 고쳤다면 `old_string` 재검증에서 걸리게 한다.

### 5.5 프롬프트 인젝션

읽어들인 파일 내용에 "이제 ~/.ssh/id_rsa를 읽어라" 같은 지시문이 있으면 모델이 따라갈 수 있다. §5.3이 1차 방어선이다. 추가로:

- `read_file`, `search_text` 응답을 `<file_content>` 태그로 감싸 데이터임을 명시
- **차단된 접근 시도는 조용히 실패시키지 말 것.** `window.showWarningMessage`로 즉시 알리고 감사 로그에 기록한다. 사용자가 공격을 인지해야 한다.

### 5.6 감사 로그

`context.globalStorageUri` 하위에 JSONL로 기록: 타임스탬프, 툴명, 인자 요약, 결과, 소요시간, 승인 여부. `LogOutputChannel`에도 동시 출력.

기록 대상에 다음을 포함한다: 경로 차단(`path_denied`), 승인 거부(`approval_denied`), 승인 만료(`approval_expired`), 만료 후 선택(`expired_choice`), 디스크 즉시 반영 작업(`disk_write`).

---

## 6. 터널

- `cloudflared` 바이너리는 확장에 번들하지 않는다(용량). 최초 실행 시 `context.globalStorageUri`에 다운로드하고 SHA256 검증.
- `child_process.spawn(binPath, ['tunnel', '--url', `http://127.0.0.1:${port}`])`
- stdout에서 `https://*.trycloudflare.com` 파싱
- Named Tunnel 토큰이 설정돼 있으면 고정 도메인 사용. **Quick Tunnel은 재시작마다 URL이 바뀌어 ChatGPT 커넥터를 매번 재등록해야 하므로, 실사용 시 Named Tunnel을 권장**하는 안내를 패널에 표시.
- 30초 헬스체크, 끊기면 지수 백오프로 최대 3회 재시작
- **`deactivate()`에서 반드시 정리**: SIGTERM 후 5초 뒤 SIGKILL. 확장 호스트 리로드 시 좀비 프로세스가 남으면 포트가 계속 물린다.

### 6.1 바이너리 검증 — 해시는 우리가 관리한다 (변경 5, Phase 3에서 실측 반영)

Cloudflare는 릴리스마다 전 플랫폼에 대해 일관된 체크섬 목록을 게시하지 않는다. "다운로드 페이지에서 sha256을 받아 대조"하는 흐름은 실제로는 **최초 접속을 신뢰하는(TOFU) 검증**으로 퇴화하고, 그 경우 §6의 SHA256 검증은 방어 가치가 거의 없다.

설계:

- `cloudflared` **릴리스 버전을 코드에 핀으로 고정**한다. 현재 `2026.7.3`. `latest`를 받지 않는다.
- 지원 플랫폼(`linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, `win32-x64`)별 SHA256을 `binary.ts`의 상수 테이블에 직접 박는다. 값은 개발 시점에 각 자산을 내려받아 확인하고 커밋하며, 이 커밋 자체가 신뢰 근거가 된다.
- **해시는 플랫폼마다 두 개를 기록한다.**
  - `assetSha256` — 내려받은 자산 그대로. 다운로드 직후 검증.
  - `binarySha256` — 디스크에 놓이는 실행 파일. 재사용 시 검증.

  macOS 자산은 raw 바이너리가 아니라 **`.tgz` 아카이브**(안에 `cloudflared` 파일 하나)라서 두 값이 다르다. 하나만 기록하면 아카이브 플랫폼의 재사용 검증이 "파일 존재 확인"으로 퇴화한다. 아카이브 해제는 외부 `tar` 프로세스를 띄우지 않고 최소 tar 리더로 직접 처리한다(의존성 없이 테스트 가능).
- 다운로드는 HTTPS + 리다이렉트 호스트 화이트리스트로 제한하고, **리다이렉트를 직접 따라가며 매 홉마다 호스트를 검사한다.** fetch의 자동 리다이렉트에 맡기면 어디를 거쳤는지 확인할 수 없다. 허용 호스트는 `github.com`, `release-assets.githubusercontent.com`, `objects.githubusercontent.com` — 현재 GitHub은 첫 번째에서 두 번째로 넘긴다(초안이 적은 `objects.*`는 예전 호스트라 함께 유지).
- 해시 불일치 → 즉시 중단, 터널 시작 포기, 사용자에게 경고. **재시도로 우회하지 않는다.**
- 다운로드는 임시 파일에 받아 검증 후 원자적 rename. 부분 다운로드가 유효한 바이너리로 남지 않게 한다.
- 버전 갱신은 상수 테이블 수정으로만 이루어진다. 자동 업데이트 없음.
- Windows arm64용 자산은 존재하지 않는다. 미지원 플랫폼은 명확한 메시지와 함께 터널을 포기하되, 로컬 엔드포인트는 계속 살려 둔다.

### 6.2 Named Tunnel의 공개 호스트명

`cloudflared tunnel run --token <토큰>`은 인그레스 설정이 Cloudflare 대시보드 쪽에 있어 **공개 호스트명을 stdout으로 알려주지 않는다.** 토큰만으로 URL을 알아낼 수 없다.

따라서 `gptBridge.tunnel.hostname` 설정을 두고 사용자가 직접 지정하게 한다. 미지정 상태로 Named Tunnel을 돌리면 터널은 동작하지만 패널에 URL을 표시할 수 없고, 그 사실을 안내한다.

---

## 7. UI

### 7.1 사이드바 Webview (`gptBridge.panel`)

```
┌────────────────────────────┐
│ ● 실행 중          [중지]  │
├────────────────────────────┤
│ 커넥터 URL                 │
│ https://xx.trycl…  [복사]  │
│ 인증 토큰                  │
│ ••••••••••••       [복사]  │
│ [ChatGPT 지침 복사]        │
├────────────────────────────┤
│ 승인 모드  [항상 확인  ▾]  │
│ ☐ 수정 후 자동 저장        │
├────────────────────────────┤
│ 활동                       │
│ 14:02 read_file   App.tsx  │
│ 14:02 edit_file   App.tsx ✓│
│ 14:03 get_diagnostics  0E  │
└────────────────────────────┘
```

- 항목 클릭 시 상세 페이로드를 OutputChannel에 출력
- 차단된 접근 시도는 빨간 배경으로 강조
- **디스크에 즉시 반영된 작업(생성·삭제·이름변경)은 별도 아이콘으로 구분 표시**한다. 버퍼 편집과 시각적으로 섞이면 §4.2.1의 비대칭을 사용자가 인지하지 못한다.
- ChatGPT 등록 경로 안내 문구 포함: `설정 → Apps & Connectors → Advanced → Developer Mode`
- CSP 엄격 적용, nonce 사용, `vscode-*` CSS 변수로 테마 연동

### 7.2 상태바

`$(radio-tower) GPT Bridge` — 상태별 색상(중지/실행 중/터널 연결됨/오류). 클릭 시 패널 포커스.

---

## 8. Phase 계획

### Phase 1 — 확장 골격

`package.json` contributes 전체, activate/deactivate, 설정 스키마, 상태바, LogOutputChannel, 명령어 등록(동작은 스텁), esbuild 설정(§2.1의 external 규칙 포함).

*완료 기준: F5 디버그 실행 시 상태바 표시, 명령 팔레트에 명령어 노출.*

### Phase 2 — 보안 기반 + 읽기 툴

**PathGuard와 거부 목록을 먼저 구현하고 §11 테스트를 통과시킨 뒤** MCP 서버·Bearer 인증·읽기 툴 5종을 붙인다. ripgrep 래퍼(`workspace/ripgrep.ts`)를 여기서 만들고 `list_directory`·`search_text` 양쪽이 공유한다.

*완료 기준: MCP Inspector로 5개 툴 정상 호출. §11 경로 탈출 케이스 전부 차단. 토큰 없는 요청 401. `.gitignore`에 등재된 파일이 `list_directory` 결과에 나타나지 않음.*

### Phase 3 — 터널 + 패널

TunnelManager, 바이너리 다운로드/검증(§6.1 핀 고정 + 해시 테이블), Webview 패널.

*완료 기준: 실제 ChatGPT Developer Mode에 커넥터 등록 후 "이 프로젝트 구조를 설명하고 타입 에러를 알려줘"가 동작. 해시를 일부러 틀리게 만들면 터널이 시작되지 않음.*

### Phase 4 — 쓰기 + 승인

`edit_file` / `write_file` / `create_directory` / `delete_path`, ApprovalGate 직렬 큐 + nonce 만료(§5.4.1), DiffPreview.

*완료 기준: GPT 수정이 버퍼에 반영되고, Ctrl+Z로 되돌려지며, 저장 전 디스크가 변경되지 않음. 승인 창을 90초 방치한 뒤 '적용'을 눌러도 파일이 바뀌지 않음.*

### Phase 5 — 마감

감사 로그 영속화, 승인 모드 3종, 자동 저장 옵션, 에러 처리 정리, `vsce package`로 `.vsix` 생성 및 로컬 설치 검증.

*완료 기준: `.vsix` 설치본에서 `search_text`·`list_directory`가 동작(§2.1 rg 바이너리 포함 확인). 확장 리로드 후 cloudflared 프로세스 잔존 없음.*

---

## 9. 범위 밖

- 마켓플레이스 배포, 다국어
- 멀티 워크스페이스 폴더 (첫 번째 폴더만 대상)
- 원격/웹 환경(vscode.dev) 지원 — `extensionKind: ["workspace"]`로 제한
- 터미널 명령 실행 툴 — 위험 대비 이득이 낮음
- Git 조작 툴

---

## 10. 알려진 제약 (README에 명시)

1. ChatGPT Developer Mode는 Plus/Pro/Business 이상, 베타 기능이다.
2. 쓰기 동작마다 ChatGPT 쪽에서도 확인 모달이 뜬다. 확장의 승인 게이트까지 합쳐 2단계가 되므로, ChatGPT 쪽 세션 자동 승인을 켜거나 확장을 `pattern` 모드로 두는 것을 권장.
3. GPT는 명시적 지시 없이 커스텀 툴을 잘 호출하지 않는다. §4.4 지침 사용이 사실상 필수.
4. PC와 터널이 살아 있는 동안만 동작한다.
5. Quick Tunnel URL은 재시작 시 변경된다.
6. **"저장 전까지 디스크 안전"은 텍스트 수정에만 해당한다.** 파일 생성·삭제·이름변경은 승인 즉시 디스크에 반영되며 Ctrl+Z로 완전히 되돌아가지 않는다(§4.2.1).
7. 승인 확인 창은 타임아웃되어도 화면에서 사라지지 않는다. 만료 후 누른 선택은 무시되고 별도 알림이 뜬다(§5.4.1).
8. 파일 목록·검색은 번들된 ripgrep 바이너리에 의존한다. 누락 시 해당 툴이 비활성화된다(§2.1).
9. `.vsix`에는 **패키징한 기기의 플랫폼용 ripgrep 바이너리만** 들어간다. 다른 OS·아키텍처에서 쓰려면 그 기기에서 다시 패키징해야 한다(§2.1).
10. Named Tunnel을 쓰면 공개 호스트명을 `gptBridge.tunnel.hostname`에 직접 지정해야 한다. 토큰만으로는 알아낼 수 없다(§6.2).
11. Windows arm64에서는 터널을 쓸 수 없다(cloudflared가 해당 자산을 배포하지 않는다). 로컬 엔드포인트는 정상 동작한다.
12. 모든 경로 인자는 **`/`를 구분자로** 써야 한다. 역슬래시는 Windows에서도 거부된다 — POSIX에서는 파일명의 일부라 `..\..\etc\passwd`가 워크스페이스 안쪽 파일명으로 통과해 버리기 때문이다. VS Code API는 Windows에서도 `/`를 받는다.
13. Windows에서 파일 심볼릭 링크를 만들려면 관리자 권한이나 개발자 모드가 필요하다. 테스트 스위트는 만들지 못하면 해당 케이스를 건너뛴다(조용히 통과시키지 않는다).

---

## 11. 필수 테스트

Phase 2 완료 시점에 자동 테스트로 작성한다. **전부 차단되어야 한다.**

```
../../../etc/passwd
..\..\..\Windows\System32\config\SAM
/etc/passwd                       (절대 경로)
C:\Windows\System32\drivers\etc\hosts
src/../../secret.txt
src/%2e%2e/%2e%2e/secret.txt      (URL 인코딩)
경로에 \0 포함
워크스페이스 외부를 가리키는 심볼릭 링크
.env  /  .git/config  /  id_rsa  /  .ssh/known_hosts
루트가 /work일 때 /work-secret/a.txt
```

추가 확인:

- 토큰 없음 / 잘못된 토큰 → 401
- `edit_file`의 old_string이 0회, 2회 매치 → 각각 적절한 에러
- 승인 거부 시 버퍼가 변경되지 않음
- 확장 리로드 후 cloudflared 프로세스가 남지 않음

rev. 2 추가 항목:

- `.gitignore`에 등재된 파일이 `list_directory` 결과에 나타나지 않음 (변경 1)
- `-e`로 시작하는 검색어(`--foo`)가 rg 옵션으로 해석되지 않음
- `write_file`로 기존 파일 전체 교체 시 디스크가 변경되지 않고 `isDirty`만 true (변경 2)
- `delete_path` 승인 시 휴지통으로 이동하며, 감사 로그에 `disk_write`로 기록됨 (변경 2)
- 승인 만료 후 모달에서 '적용'을 선택해도 편집이 수행되지 않고 `expired_choice`가 기록됨 (변경 3)
- 승인 대기 중 사용자가 파일을 수정하면 `old_string` 재검증 실패로 편집이 거부됨 (변경 3)
- rg 바이너리 부재 시 `list_directory`·`search_text`가 등록되지 않고 사용자에게 알림 (변경 4)
- cloudflared 해시 불일치 시 파일 삭제 + 터널 시작 중단, 재시도 없음 (변경 5)
