# GPT Bridge

현재 VS Code 워크스페이스를 MCP 서버로 노출해, ChatGPT 웹(Developer Mode 커스텀 커넥터)이
코드를 직접 읽고 수정할 수 있게 하는 확장입니다. 개인 사용 목적이며 마켓플레이스에
배포하지 않고 `.vsix`로 로컬 설치합니다.

**핵심 원칙 — GPT의 텍스트 수정은 디스크가 아니라 에디터 버퍼에 적용됩니다.**
Ctrl+Z로 되돌릴 수 있고, Ctrl+S 전까지 디스크는 그대로입니다.
단, 파일 생성·삭제·이름변경은 승인 즉시 디스크에 반영됩니다([`project.md`](./project.md) §4.2.1).

- 설계 문서: [`project.md`](./project.md)
- 진행 상황: [`PROGRESS.md`](./PROGRESS.md)
- **직접 확인할 항목: [`VERIFICATION.md`](./VERIFICATION.md)**
- **ChatGPT 연동 설치: [`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)** — 다른 PC에서 재현할 때

Phase 1~6 코드가 모두 구현되어 있고 자동 테스트 159개가 통과합니다.

Windows에서 전 구간을 직접 검증했습니다 — 버퍼 편집, Ctrl+Z 복구, 승인 거부·만료,
CRLF 매칭, 경로 차단, `.vsix` 패키징, 그리고 **ChatGPT 실연동**까지 통과했습니다.

연동은 기획안의 cloudflare 대신 **OpenAI Secure MCP Tunnel**로 했습니다. 공개
URL이 생기지 않고 토큰이 PC를 벗어나지 않아 더 안전합니다. 확장 코드는 그대로이고
`gptBridge.tunnel.provider`를 `none`으로 두면 됩니다. 절차는
[`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)에 있습니다.

자세한 현황은 [`VERIFICATION.md`](./VERIFICATION.md)에 있습니다.

## 설치

```bash
git clone https://github.com/DreamURL/vscodeconnector.git
cd vscodeconnector
npm install
npm run setup       # .vsix 빌드 + VS Code에 설치
```

이후 VS Code에서 `Developer: Reload Window`. 왼쪽 활동 표시줄에 GPT Bridge
아이콘이 생깁니다. 갱신할 때는 `git pull && npm install && npm run setup`.

**`.vsix`는 저장소에 넣지 않고 각 기기에서 빌드합니다.** ripgrep 바이너리가
플랫폼별로 갈라져 있어 다른 기기에서 만든 `.vsix`는 검색이 동작하지 않습니다(§2.1).

ChatGPT까지 연결하려면 [`TUNNEL_SETUP.md`](./TUNNEL_SETUP.md)를 이어서 보세요.

## 개발

```bash
npm run typecheck   # tsc --noEmit
npm run build       # esbuild → dist/extension.js
npm run watch       # 변경 감시
npm run compile     # typecheck + build + test
npm run package     # .vsix 생성만
```

VS Code에서 이 폴더를 열고 F5를 누르면 확장 개발 호스트가 뜹니다.
`watch` 태스크가 preLaunchTask로 연결되어 있습니다.

## Windows에서 쓸 때

- **`.vsix`는 반드시 Windows에서 패키징하세요.** ripgrep 바이너리는 플랫폼별 패키지로
  배포되고, `npm install`은 설치하는 기기의 것만 내려받습니다. Linux에서 만든 `.vsix`에는
  `rg.exe`가 들어 있지 않아 파일 목록·검색이 비활성화됩니다.
- **경로는 `/`로 구분하세요.** 역슬래시는 거부됩니다(설계 문서 §10-12).
- 파일 심볼릭 링크 테스트는 관리자 권한이나 개발자 모드가 없으면 건너뜁니다.
- Windows arm64에서는 터널을 쓸 수 없습니다. 로컬 엔드포인트는 정상 동작합니다.
- 처음 터널을 켤 때 `cloudflared.exe`를 내려받습니다. SmartScreen이나 백신이
  경고할 수 있습니다 — SHA256을 코드에 박아 검증한 뒤에만 실행합니다(§6.1).

## 알려진 제약

`project.md` §10에 정리되어 있습니다. 요약하면:

1. ChatGPT Developer Mode는 Plus/Pro/Business 이상의 베타 기능입니다.
2. 쓰기 작업은 ChatGPT 쪽과 확장 쪽에서 각각 확인을 받아 2단계가 됩니다.
3. GPT는 명시적 지침 없이는 커스텀 툴을 잘 호출하지 않습니다(§4.4 지침 필요).
4. PC와 터널이 살아 있는 동안만 동작하며, Quick Tunnel URL은 재시작 시 바뀝니다.
5. "저장 전까지 디스크 안전"은 텍스트 수정에만 해당합니다.
