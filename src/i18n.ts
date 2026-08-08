/**
 * 사용자에게 보이는 문자열의 다국어 카탈로그.
 *
 * 범위를 좁게 잡았다. 여기 들어오는 것은 **사람이 읽는 UI 문자열**뿐이다.
 *
 *  - 로그와 오류 메시지는 영어로 고정한다. 검색·공유·이슈 보고가 목적이라
 *    언어가 바뀌면 오히려 찾기 어려워진다.
 *  - 툴 description과 툴 응답은 모델에게 가므로 영어로 고정한다. 번역해도
 *    이득이 없고, 모델은 영어 지시를 더 정확히 따른다.
 *  - package.json의 명령 제목·설정 설명은 VS Code가 에디터 표시 언어로만
 *    번역할 수 있어(package.nls) 이 설정으로 바꿀 수 없다. 영어로 둔다.
 *
 * 키가 빠진 언어는 영어로 폴백한다. 번역이 늦어도 UI가 비지 않는다.
 */

export const LANGUAGES = ['en', 'ko', 'ja', 'zh-cn', 'es'] as const;
export type Lang = (typeof LANGUAGES)[number];

/** 선택기에 그대로 노출한다 — 각 언어를 그 언어로 적는 것이 관례다. */
export const LANGUAGE_LABELS: Record<Lang, string> = {
  en: 'English',
  ko: '한국어',
  ja: '日本語',
  'zh-cn': '简体中文',
  es: 'Español'
};

const en = {
  'status.stopped': 'Stopped',
  'status.starting': 'Starting',
  'status.running': 'Running locally',
  'status.tunneled': 'Connected',
  'status.error': 'Error',
  'status.port': 'Port',
  'status.tunnel': 'Tunnel',
  'status.clickToOpen': 'Click to open the panel.',

  'panel.start': 'Start',
  'panel.stop': 'Stop',
  'panel.connector': 'Connector',
  'panel.connectorUrl': 'Connector URL',
  'panel.authToken': 'Auth token',
  'panel.copy': 'Copy',
  'panel.notRunning': 'Server is not running',
  'panel.noToken': 'Not issued yet',
  'panel.copyInstructions': 'Copy ChatGPT instructions',
  'panel.setupPath': 'ChatGPT setup path: {0}',
  'panel.behavior': 'Behavior',
  'panel.approvalMode': 'Approval mode',
  'panel.modeAlways': 'Always ask',
  'panel.modeSession': 'Auto-approve for session',
  'panel.modePattern': 'Auto-approve by pattern',
  'panel.autoSave': 'Auto-save after edits',
  'panel.autoSaveHint':
    'With auto-save off, nothing reaches disk until Ctrl+S (recommended). Creating and deleting files still hits disk as soon as you approve.',
  'panel.activity': 'Activity',
  'panel.noActivity': 'No tool calls yet.',
  'panel.language': 'Language',
  'panel.languageHint':
    'Applies to this panel, the status bar and dialogs. Logs and tool descriptions stay in English. Also available in Settings (Ctrl+,) as gptBridge.language.',
  'panel.localOnly':
    'No tunnel is connected, so only the local address works. ChatGPT on the web cannot reach it — use a local client such as MCP Inspector.',
  'panel.externalTunnel':
    'The extension is not creating a tunnel (<code>tunnel.provider = none</code>). The address above is the local endpoint. If you are running an external tunnel such as <b>OpenAI Secure MCP Tunnel</b>, ChatGPT can reach it. The extension cannot see the state of an external tunnel — check that tool instead.',
  'panel.quickTunnel':
    'A Quick Tunnel URL changes on every restart, so the ChatGPT connector has to be registered again each time. For regular use prefer a Named Tunnel — run <code>GPT Bridge: Set tunnel token</code>, then set the public hostname in <code>gptBridge.tunnel.hostname</code>.',

  'cmd.serverNotRunningInfo': 'GPT Bridge: No server is running.',
  'cmd.serverStopped': 'GPT Bridge: Server stopped.',
  'cmd.startFirst': 'GPT Bridge: The server is not running. Run "Start server" first.',
  'cmd.copiedLocal': 'GPT Bridge: Copied the local endpoint — {0}',
  'cmd.copiedConnector': 'GPT Bridge: Copied the connector URL — {0}',
  'cmd.tokenCopied':
    'GPT Bridge: Auth token copied. Paste it into the authorization header of your ChatGPT connector.',
  'cmd.regenConfirm':
    'Regenerating the auth token immediately locks out any ChatGPT connector using the old one. Continue?',
  'cmd.regenButton': 'Regenerate',
  'cmd.tokenRegenerated':
    'GPT Bridge: Token regenerated and copied to the clipboard. Update your ChatGPT connector settings.',
  'cmd.tunnelTokenTitle': 'Cloudflare Named Tunnel token',
  'cmd.tunnelTokenPrompt': 'Confirm with an empty box to delete the stored token.',
  'cmd.tunnelTokenPaste': 'Paste the token',
  'cmd.tunnelTokenStored': 'A token is already stored',
  'cmd.tunnelTokenDeleted': 'GPT Bridge: Tunnel token deleted.',
  'cmd.tunnelTokenSavedRunning':
    'GPT Bridge: Tunnel token saved. Restart the server to apply it.',
  'cmd.tunnelTokenSaved':
    'GPT Bridge: Tunnel token saved. Set the public hostname in gptBridge.tunnel.hostname.',
  'cmd.restart': 'Restart',
  'cmd.instructionsCopied': 'GPT Bridge: ChatGPT instructions copied. Setup path — {0}',
  'cmd.error': 'GPT Bridge: {0}',

  'approval.deleteRequest': 'GPT wants to delete {0}.',
  'approval.createDirRequest': 'GPT wants to create the directory {0}.',
  'approval.editRequest': 'GPT wants to modify {0} ({1}).',
  'approval.apply': 'Apply',
  'approval.viewDiff': 'View diff',
  'approval.detailBuffer':
    'Applied to the editor buffer only. You can undo with Ctrl+Z, and disk is unchanged until you save.',
  'approval.detailDisk':
    'This is written to disk as soon as you approve. Ctrl+Z will not fully undo it.',
  'approval.detailDiskTrash':
    'This is written to disk as soon as you approve (moved to the trash when possible). Ctrl+Z will not fully undo it.',
  'approval.previewMissing': 'GPT Bridge: Could not find the preview content.',
  'approval.expired':
    'GPT Bridge: The approval window for "{0}" had already expired, so the edit was not applied. Ask GPT again if you still want it.',

  'server.portInUse': 'Port {0} is already in use. Change the gptBridge.port setting.',
  'server.openSettings': 'Open settings',
  'server.startFailed': 'GPT Bridge: Failed to start the server — {0}',
  'server.tunnelFailed':
    'GPT Bridge: Could not start the tunnel — {0}. The local endpoint is still usable.',
  'server.blocked': 'GPT Bridge: Blocked access — {0}',
  'activity.blocked': 'BLOCK',
  'activity.detailHint': 'Click to see details in the log',
  'state.stopped': 'Stopped',
  'state.starting': 'Starting...',
  'state.running': 'Running locally (port {0})',
  'state.tunneled': 'Running - tunnel connected',
  'state.error': 'Error',
  'server.rgMissing':
    'GPT Bridge: ripgrep was not found, so file listing and search are disabled. Rebuild the .vsix on this machine.'
} as const;

type Key = keyof typeof en;

const ko: Record<Key, string> = {
  'status.stopped': '중지됨',
  'status.starting': '시작 중',
  'status.running': '로컬 실행 중',
  'status.tunneled': '연결됨',
  'status.error': '오류',
  'status.port': '포트',
  'status.tunnel': '터널',
  'status.clickToOpen': '클릭하면 패널이 열립니다.',

  'panel.start': '시작',
  'panel.stop': '중지',
  'panel.connector': '커넥터',
  'panel.connectorUrl': '커넥터 URL',
  'panel.authToken': '인증 토큰',
  'panel.copy': '복사',
  'panel.notRunning': '서버가 실행 중이 아닙니다',
  'panel.noToken': '아직 발급되지 않음',
  'panel.copyInstructions': 'ChatGPT 지침 복사',
  'panel.setupPath': 'ChatGPT 등록 경로: {0}',
  'panel.behavior': '동작',
  'panel.approvalMode': '승인 모드',
  'panel.modeAlways': '항상 확인',
  'panel.modeSession': '세션 자동 승인',
  'panel.modePattern': '패턴 자동 승인',
  'panel.autoSave': '수정 후 자동 저장',
  'panel.autoSaveHint':
    '자동 저장을 끄면 Ctrl+S 전까지 디스크에 반영되지 않습니다(권장). 단, 파일 생성·삭제는 승인 즉시 디스크에 반영됩니다.',
  'panel.activity': '활동',
  'panel.noActivity': '아직 호출된 툴이 없습니다.',
  'panel.language': '언어',
  'panel.languageHint':
    '이 패널과 상태바, 대화 상자에 적용됩니다. 로그와 툴 설명은 영어로 유지됩니다. 설정(Ctrl+,)의 gptBridge.language에서도 바꿀 수 있습니다.',
  'panel.localOnly':
    '터널이 연결되지 않아 로컬 주소만 사용할 수 있습니다. ChatGPT 웹에서는 접근할 수 없고, MCP Inspector 같은 로컬 도구로만 확인할 수 있습니다.',
  'panel.externalTunnel':
    '확장이 터널을 만들지 않는 구성입니다 (<code>tunnel.provider = none</code>). 위 주소는 로컬 엔드포인트이며, <b>OpenAI Secure MCP Tunnel</b> 같은 외부 터널을 따로 띄워 두었다면 ChatGPT에서 접근할 수 있습니다. 외부 터널의 연결 상태는 확장이 알 수 없으니 그쪽 도구에서 확인하세요.',
  'panel.quickTunnel':
    'Quick Tunnel은 재시작할 때마다 URL이 바뀌어 ChatGPT 커넥터를 매번 다시 등록해야 합니다. 실사용에는 Named Tunnel을 권장합니다 — <code>GPT Bridge: Set tunnel token</code> 실행 후 <code>gptBridge.tunnel.hostname</code>에 공개 호스트명을 지정하세요.',

  'cmd.serverNotRunningInfo': 'GPT Bridge: 실행 중인 서버가 없습니다.',
  'cmd.serverStopped': 'GPT Bridge: 서버를 중지했습니다.',
  'cmd.startFirst': 'GPT Bridge: 서버가 실행 중이 아닙니다. 먼저 "서버 시작"을 실행하세요.',
  'cmd.copiedLocal': 'GPT Bridge: 로컬 엔드포인트를 복사했습니다 — {0}',
  'cmd.copiedConnector': 'GPT Bridge: 커넥터 URL을 복사했습니다 — {0}',
  'cmd.tokenCopied':
    'GPT Bridge: 인증 토큰을 복사했습니다. ChatGPT 커넥터의 인증 헤더에 붙여 넣으세요.',
  'cmd.regenConfirm':
    '인증 토큰을 재발급하면 기존 토큰으로 연결된 ChatGPT 커넥터는 즉시 접근할 수 없게 됩니다. 계속할까요?',
  'cmd.regenButton': '재발급',
  'cmd.tokenRegenerated':
    'GPT Bridge: 토큰을 재발급하고 클립보드에 복사했습니다. ChatGPT 커넥터 설정을 갱신하세요.',
  'cmd.tunnelTokenTitle': 'Cloudflare Named Tunnel 토큰',
  'cmd.tunnelTokenPrompt': '비워 두고 확인하면 저장된 토큰을 삭제합니다.',
  'cmd.tunnelTokenPaste': '토큰 붙여넣기',
  'cmd.tunnelTokenStored': '저장된 토큰이 있습니다',
  'cmd.tunnelTokenDeleted': 'GPT Bridge: 터널 토큰을 삭제했습니다.',
  'cmd.tunnelTokenSavedRunning':
    'GPT Bridge: 터널 토큰을 저장했습니다. 적용하려면 서버를 다시 시작하세요.',
  'cmd.tunnelTokenSaved':
    'GPT Bridge: 터널 토큰을 저장했습니다. 공개 호스트명은 gptBridge.tunnel.hostname 설정에 지정하세요.',
  'cmd.restart': '다시 시작',
  'cmd.instructionsCopied': 'GPT Bridge: ChatGPT 지침을 복사했습니다. 등록 경로 — {0}',
  'cmd.error': 'GPT Bridge: {0}',

  'approval.deleteRequest': 'GPT가 {0} 삭제를 요청했습니다.',
  'approval.createDirRequest': 'GPT가 디렉터리 {0} 생성을 요청했습니다.',
  'approval.editRequest': 'GPT가 {0} 수정을 요청했습니다 ({1}).',
  'approval.apply': '적용',
  'approval.viewDiff': 'Diff 보기',
  'approval.detailBuffer':
    '에디터 버퍼에만 적용됩니다. Ctrl+Z로 되돌릴 수 있고, 저장 전까지 디스크는 변경되지 않습니다.',
  'approval.detailDisk':
    '이 작업은 승인 즉시 디스크에 반영됩니다. Ctrl+Z로 완전히 되돌아가지 않습니다.',
  'approval.detailDiskTrash':
    '이 작업은 승인 즉시 디스크에 반영됩니다(가능하면 휴지통으로 이동). Ctrl+Z로 완전히 되돌아가지 않습니다.',
  'approval.previewMissing': 'GPT Bridge: 미리보기 내용을 찾을 수 없습니다.',
  'approval.expired':
    'GPT Bridge: 승인 대기 시간이 지난 요청이라 "{0}" 수정을 적용하지 않았습니다. 필요하면 GPT에게 다시 요청하세요.',

  'server.portInUse': '포트 {0}이(가) 사용 중입니다. gptBridge.port 설정을 바꾸세요.',
  'server.openSettings': '설정 열기',
  'server.startFailed': 'GPT Bridge: 서버 시작 실패 — {0}',
  'server.tunnelFailed':
    'GPT Bridge: 터널을 시작하지 못했습니다 — {0}. 로컬 엔드포인트는 계속 사용할 수 있습니다.',
  'server.blocked': 'GPT Bridge: 접근이 차단되었습니다 — {0}',
  'activity.blocked': '차단',
  'activity.detailHint': '상세는 로그에서 확인',
  'state.stopped': '중지됨',
  'state.starting': '시작 중…',
  'state.running': '로컬 실행 중 (포트 {0})',
  'state.tunneled': '실행 중 · 터널 연결됨',
  'state.error': '오류',
  'server.rgMissing':
    'GPT Bridge: ripgrep을 찾지 못해 파일 목록·검색이 비활성화됩니다. 이 기기에서 .vsix를 다시 빌드하세요.'
};

const ja: Record<Key, string> = {
  'status.stopped': '停止中',
  'status.starting': '起動中',
  'status.running': 'ローカルで実行中',
  'status.tunneled': '接続済み',
  'status.error': 'エラー',
  'status.port': 'ポート',
  'status.tunnel': 'トンネル',
  'status.clickToOpen': 'クリックするとパネルが開きます。',

  'panel.start': '開始',
  'panel.stop': '停止',
  'panel.connector': 'コネクタ',
  'panel.connectorUrl': 'コネクタ URL',
  'panel.authToken': '認証トークン',
  'panel.copy': 'コピー',
  'panel.notRunning': 'サーバーは実行されていません',
  'panel.noToken': 'まだ発行されていません',
  'panel.copyInstructions': 'ChatGPT 指示をコピー',
  'panel.setupPath': 'ChatGPT の登録経路: {0}',
  'panel.behavior': '動作',
  'panel.approvalMode': '承認モード',
  'panel.modeAlways': '毎回確認',
  'panel.modeSession': 'セッション中は自動承認',
  'panel.modePattern': 'パターンで自動承認',
  'panel.autoSave': '編集後に自動保存',
  'panel.autoSaveHint':
    '自動保存を切っておくと Ctrl+S までディスクに反映されません（推奨）。ただしファイルの作成・削除は承認した時点でディスクに反映されます。',
  'panel.activity': 'アクティビティ',
  'panel.noActivity': 'まだツールは呼び出されていません。',
  'panel.language': '言語',
  'panel.languageHint':
    'このパネル・ステータスバー・ダイアログに適用されます。ログとツールの説明は英語のままです。設定（Ctrl+,）の gptBridge.language でも変更できます。',
  'panel.localOnly':
    'トンネルが接続されていないため、ローカルアドレスのみ利用できます。ChatGPT のウェブからは到達できず、MCP Inspector のようなローカルツールでのみ確認できます。',
  'panel.externalTunnel':
    '拡張機能がトンネルを作らない構成です（<code>tunnel.provider = none</code>）。上のアドレスはローカルエンドポイントです。<b>OpenAI Secure MCP Tunnel</b> のような外部トンネルを別途起動していれば ChatGPT から到達できます。外部トンネルの状態は拡張機能から分からないため、そちらのツールで確認してください。',
  'panel.quickTunnel':
    'Quick Tunnel は再起動のたびに URL が変わるため、ChatGPT のコネクタを毎回登録し直す必要があります。実運用では Named Tunnel を推奨します — <code>GPT Bridge: Set tunnel token</code> を実行し、<code>gptBridge.tunnel.hostname</code> に公開ホスト名を指定してください。',

  'cmd.serverNotRunningInfo': 'GPT Bridge: 実行中のサーバーはありません。',
  'cmd.serverStopped': 'GPT Bridge: サーバーを停止しました。',
  'cmd.startFirst': 'GPT Bridge: サーバーが実行されていません。先に「サーバー開始」を実行してください。',
  'cmd.copiedLocal': 'GPT Bridge: ローカルエンドポイントをコピーしました — {0}',
  'cmd.copiedConnector': 'GPT Bridge: コネクタ URL をコピーしました — {0}',
  'cmd.tokenCopied':
    'GPT Bridge: 認証トークンをコピーしました。ChatGPT コネクタの認証ヘッダーに貼り付けてください。',
  'cmd.regenConfirm':
    '認証トークンを再発行すると、既存のトークンで接続している ChatGPT コネクタは直ちにアクセスできなくなります。続けますか？',
  'cmd.regenButton': '再発行',
  'cmd.tokenRegenerated':
    'GPT Bridge: トークンを再発行してクリップボードにコピーしました。ChatGPT コネクタの設定を更新してください。',
  'cmd.tunnelTokenTitle': 'Cloudflare Named Tunnel のトークン',
  'cmd.tunnelTokenPrompt': '空のまま確定すると保存済みのトークンを削除します。',
  'cmd.tunnelTokenPaste': 'トークンを貼り付け',
  'cmd.tunnelTokenStored': '保存済みのトークンがあります',
  'cmd.tunnelTokenDeleted': 'GPT Bridge: トンネルトークンを削除しました。',
  'cmd.tunnelTokenSavedRunning':
    'GPT Bridge: トンネルトークンを保存しました。適用するにはサーバーを再起動してください。',
  'cmd.tunnelTokenSaved':
    'GPT Bridge: トンネルトークンを保存しました。公開ホスト名は gptBridge.tunnel.hostname 設定に指定してください。',
  'cmd.restart': '再起動',
  'cmd.instructionsCopied': 'GPT Bridge: ChatGPT 指示をコピーしました。登録経路 — {0}',
  'cmd.error': 'GPT Bridge: {0}',

  'approval.deleteRequest': 'GPT が {0} の削除を要求しています。',
  'approval.createDirRequest': 'GPT がディレクトリ {0} の作成を要求しています。',
  'approval.editRequest': 'GPT が {0} の変更を要求しています（{1}）。',
  'approval.apply': '適用',
  'approval.viewDiff': '差分を表示',
  'approval.detailBuffer':
    'エディタのバッファにのみ適用されます。Ctrl+Z で元に戻せ、保存するまでディスクは変更されません。',
  'approval.detailDisk':
    'この操作は承認した時点でディスクに反映されます。Ctrl+Z では完全に元に戻せません。',
  'approval.detailDiskTrash':
    'この操作は承認した時点でディスクに反映されます（可能な場合はごみ箱へ移動）。Ctrl+Z では完全に元に戻せません。',
  'approval.previewMissing': 'GPT Bridge: プレビューの内容が見つかりませんでした。',
  'approval.expired':
    'GPT Bridge: 承認の待ち時間が過ぎた要求のため、「{0}」の変更は適用しませんでした。必要なら GPT にもう一度依頼してください。',

  'server.portInUse': 'ポート {0} は使用中です。gptBridge.port 設定を変更してください。',
  'server.openSettings': '設定を開く',
  'server.startFailed': 'GPT Bridge: サーバーの起動に失敗しました — {0}',
  'server.tunnelFailed':
    'GPT Bridge: トンネルを開始できませんでした — {0}。ローカルエンドポイントは引き続き使えます。',
  'server.blocked': 'GPT Bridge: アクセスを遮断しました — {0}',
  'activity.blocked': '遮断',
  'activity.detailHint': '詳細はログで確認',
  'state.stopped': '停止中',
  'state.starting': '起動中…',
  'state.running': 'ローカルで実行中（ポート {0}）',
  'state.tunneled': '実行中・トンネル接続済み',
  'state.error': 'エラー',
  'server.rgMissing':
    'GPT Bridge: ripgrep が見つからないため、ファイル一覧と検索は無効です。この端末で .vsix を再ビルドしてください。'
};

const zh: Record<Key, string> = {
  'status.stopped': '已停止',
  'status.starting': '启动中',
  'status.running': '本地运行中',
  'status.tunneled': '已连接',
  'status.error': '错误',
  'status.port': '端口',
  'status.tunnel': '隧道',
  'status.clickToOpen': '点击可打开面板。',

  'panel.start': '启动',
  'panel.stop': '停止',
  'panel.connector': '连接器',
  'panel.connectorUrl': '连接器 URL',
  'panel.authToken': '认证令牌',
  'panel.copy': '复制',
  'panel.notRunning': '服务器未在运行',
  'panel.noToken': '尚未签发',
  'panel.copyInstructions': '复制 ChatGPT 指令',
  'panel.setupPath': 'ChatGPT 注册路径：{0}',
  'panel.behavior': '行为',
  'panel.approvalMode': '批准模式',
  'panel.modeAlways': '每次询问',
  'panel.modeSession': '本会话自动批准',
  'panel.modePattern': '按模式自动批准',
  'panel.autoSave': '修改后自动保存',
  'panel.autoSaveHint':
    '关闭自动保存后，在 Ctrl+S 之前不会写入磁盘（推荐）。但创建和删除文件在批准后会立即写入磁盘。',
  'panel.activity': '活动',
  'panel.noActivity': '还没有调用过工具。',
  'panel.language': '语言',
  'panel.languageHint':
    '适用于此面板、状态栏和对话框。日志与工具说明保持英文。也可在设置（Ctrl+,）的 gptBridge.language 中修改。',
  'panel.localOnly':
    '隧道未连接，只能使用本地地址。ChatGPT 网页端无法访问，只能用 MCP Inspector 这类本地工具验证。',
  'panel.externalTunnel':
    '当前配置下扩展不创建隧道（<code>tunnel.provider = none</code>）。上面的地址是本地端点。如果你另外运行了 <b>OpenAI Secure MCP Tunnel</b> 之类的外部隧道，ChatGPT 就能访问。扩展无法得知外部隧道的状态，请到那边的工具查看。',
  'panel.quickTunnel':
    'Quick Tunnel 每次重启 URL 都会变，ChatGPT 连接器需要反复重新注册。日常使用建议改用 Named Tunnel —— 执行 <code>GPT Bridge: Set tunnel token</code>，然后在 <code>gptBridge.tunnel.hostname</code> 中填写公开主机名。',

  'cmd.serverNotRunningInfo': 'GPT Bridge：没有正在运行的服务器。',
  'cmd.serverStopped': 'GPT Bridge：服务器已停止。',
  'cmd.startFirst': 'GPT Bridge：服务器未在运行。请先执行「启动服务器」。',
  'cmd.copiedLocal': 'GPT Bridge：已复制本地端点 — {0}',
  'cmd.copiedConnector': 'GPT Bridge：已复制连接器 URL — {0}',
  'cmd.tokenCopied': 'GPT Bridge：已复制认证令牌。请粘贴到 ChatGPT 连接器的认证头中。',
  'cmd.regenConfirm':
    '重新签发认证令牌后，使用旧令牌连接的 ChatGPT 连接器会立即无法访问。要继续吗？',
  'cmd.regenButton': '重新签发',
  'cmd.tokenRegenerated':
    'GPT Bridge：已重新签发令牌并复制到剪贴板。请更新 ChatGPT 连接器设置。',
  'cmd.tunnelTokenTitle': 'Cloudflare Named Tunnel 令牌',
  'cmd.tunnelTokenPrompt': '留空并确认将删除已保存的令牌。',
  'cmd.tunnelTokenPaste': '粘贴令牌',
  'cmd.tunnelTokenStored': '已有保存的令牌',
  'cmd.tunnelTokenDeleted': 'GPT Bridge：已删除隧道令牌。',
  'cmd.tunnelTokenSavedRunning': 'GPT Bridge：隧道令牌已保存。重启服务器后生效。',
  'cmd.tunnelTokenSaved':
    'GPT Bridge：隧道令牌已保存。请在 gptBridge.tunnel.hostname 设置中填写公开主机名。',
  'cmd.restart': '重启',
  'cmd.instructionsCopied': 'GPT Bridge：已复制 ChatGPT 指令。注册路径 — {0}',
  'cmd.error': 'GPT Bridge：{0}',

  'approval.deleteRequest': 'GPT 请求删除 {0}。',
  'approval.createDirRequest': 'GPT 请求创建目录 {0}。',
  'approval.editRequest': 'GPT 请求修改 {0}（{1}）。',
  'approval.apply': '应用',
  'approval.viewDiff': '查看差异',
  'approval.detailBuffer':
    '只应用到编辑器缓冲区。可以用 Ctrl+Z 撤销，保存之前磁盘不会改变。',
  'approval.detailDisk': '此操作一经批准就会写入磁盘。Ctrl+Z 无法完全撤销。',
  'approval.detailDiskTrash':
    '此操作一经批准就会写入磁盘（尽可能移入回收站）。Ctrl+Z 无法完全撤销。',
  'approval.previewMissing': 'GPT Bridge：找不到预览内容。',
  'approval.expired':
    'GPT Bridge：该请求已超过批准等待时间，因此没有应用对「{0}」的修改。如仍需要，请再次让 GPT 执行。',

  'server.portInUse': '端口 {0} 已被占用。请修改 gptBridge.port 设置。',
  'server.openSettings': '打开设置',
  'server.startFailed': 'GPT Bridge：服务器启动失败 — {0}',
  'server.tunnelFailed': 'GPT Bridge：隧道启动失败 — {0}。本地端点仍然可用。',
  'server.blocked': 'GPT Bridge：已阻止访问 — {0}',
  'activity.blocked': '已阻止',
  'activity.detailHint': '点击可在日志中查看详情',
  'state.stopped': '已停止',
  'state.starting': '启动中…',
  'state.running': '本地运行中（端口 {0}）',
  'state.tunneled': '运行中 · 隧道已连接',
  'state.error': '错误',
  'server.rgMissing':
    'GPT Bridge：找不到 ripgrep，文件列表与搜索已禁用。请在本机重新构建 .vsix。'
};

const es: Record<Key, string> = {
  'status.stopped': 'Detenido',
  'status.starting': 'Iniciando',
  'status.running': 'Ejecutándose en local',
  'status.tunneled': 'Conectado',
  'status.error': 'Error',
  'status.port': 'Puerto',
  'status.tunnel': 'Túnel',
  'status.clickToOpen': 'Haz clic para abrir el panel.',

  'panel.start': 'Iniciar',
  'panel.stop': 'Detener',
  'panel.connector': 'Conector',
  'panel.connectorUrl': 'URL del conector',
  'panel.authToken': 'Token de autenticación',
  'panel.copy': 'Copiar',
  'panel.notRunning': 'El servidor no está en ejecución',
  'panel.noToken': 'Aún no emitido',
  'panel.copyInstructions': 'Copiar instrucciones de ChatGPT',
  'panel.setupPath': 'Ruta de registro en ChatGPT: {0}',
  'panel.behavior': 'Comportamiento',
  'panel.approvalMode': 'Modo de aprobación',
  'panel.modeAlways': 'Preguntar siempre',
  'panel.modeSession': 'Aprobar automáticamente en la sesión',
  'panel.modePattern': 'Aprobar automáticamente por patrón',
  'panel.autoSave': 'Guardar automáticamente tras editar',
  'panel.autoSaveHint':
    'Con el guardado automático desactivado, nada llega al disco hasta pulsar Ctrl+S (recomendado). Crear y borrar archivos sí se escribe en disco en cuanto lo apruebas.',
  'panel.activity': 'Actividad',
  'panel.noActivity': 'Todavía no se ha llamado a ninguna herramienta.',
  'panel.language': 'Idioma',
  'panel.languageHint':
    'Se aplica a este panel, la barra de estado y los diálogos. Los registros y las descripciones de herramientas siguen en inglés. También está en Ajustes (Ctrl+,) como gptBridge.language.',
  'panel.localOnly':
    'No hay ningún túnel conectado, así que solo funciona la dirección local. ChatGPT en la web no puede alcanzarla; usa una herramienta local como MCP Inspector.',
  'panel.externalTunnel':
    'La extensión no crea ningún túnel (<code>tunnel.provider = none</code>). La dirección de arriba es el punto final local. Si tienes en marcha un túnel externo como <b>OpenAI Secure MCP Tunnel</b>, ChatGPT sí puede alcanzarlo. La extensión no conoce el estado de un túnel externo: compruébalo en esa herramienta.',
  'panel.quickTunnel':
    'La URL de un Quick Tunnel cambia en cada reinicio, así que hay que registrar el conector de ChatGPT cada vez. Para uso habitual conviene un Named Tunnel: ejecuta <code>GPT Bridge: Set tunnel token</code> y indica el nombre de host público en <code>gptBridge.tunnel.hostname</code>.',

  'cmd.serverNotRunningInfo': 'GPT Bridge: No hay ningún servidor en ejecución.',
  'cmd.serverStopped': 'GPT Bridge: Servidor detenido.',
  'cmd.startFirst': 'GPT Bridge: El servidor no está en ejecución. Ejecuta primero «Iniciar servidor».',
  'cmd.copiedLocal': 'GPT Bridge: Punto final local copiado — {0}',
  'cmd.copiedConnector': 'GPT Bridge: URL del conector copiada — {0}',
  'cmd.tokenCopied':
    'GPT Bridge: Token de autenticación copiado. Pégalo en la cabecera de autorización de tu conector de ChatGPT.',
  'cmd.regenConfirm':
    'Al regenerar el token, cualquier conector de ChatGPT que use el anterior perderá el acceso de inmediato. ¿Continuar?',
  'cmd.regenButton': 'Regenerar',
  'cmd.tokenRegenerated':
    'GPT Bridge: Token regenerado y copiado al portapapeles. Actualiza la configuración de tu conector de ChatGPT.',
  'cmd.tunnelTokenTitle': 'Token de Cloudflare Named Tunnel',
  'cmd.tunnelTokenPrompt': 'Confirma con el campo vacío para borrar el token guardado.',
  'cmd.tunnelTokenPaste': 'Pega el token',
  'cmd.tunnelTokenStored': 'Ya hay un token guardado',
  'cmd.tunnelTokenDeleted': 'GPT Bridge: Token del túnel borrado.',
  'cmd.tunnelTokenSavedRunning':
    'GPT Bridge: Token del túnel guardado. Reinicia el servidor para aplicarlo.',
  'cmd.tunnelTokenSaved':
    'GPT Bridge: Token del túnel guardado. Indica el nombre de host público en gptBridge.tunnel.hostname.',
  'cmd.restart': 'Reiniciar',
  'cmd.instructionsCopied': 'GPT Bridge: Instrucciones de ChatGPT copiadas. Ruta de registro — {0}',
  'cmd.error': 'GPT Bridge: {0}',

  'approval.deleteRequest': 'GPT quiere borrar {0}.',
  'approval.createDirRequest': 'GPT quiere crear el directorio {0}.',
  'approval.editRequest': 'GPT quiere modificar {0} ({1}).',
  'approval.apply': 'Aplicar',
  'approval.viewDiff': 'Ver diferencias',
  'approval.detailBuffer':
    'Se aplica solo al búfer del editor. Puedes deshacerlo con Ctrl+Z y el disco no cambia hasta que guardes.',
  'approval.detailDisk':
    'Esto se escribe en disco en cuanto lo apruebas. Ctrl+Z no lo deshará por completo.',
  'approval.detailDiskTrash':
    'Esto se escribe en disco en cuanto lo apruebas (se mueve a la papelera cuando es posible). Ctrl+Z no lo deshará por completo.',
  'approval.previewMissing': 'GPT Bridge: No se encontró el contenido de la vista previa.',
  'approval.expired':
    'GPT Bridge: La ventana de aprobación de «{0}» ya había expirado, así que no se aplicó el cambio. Pídeselo de nuevo a GPT si aún lo quieres.',

  'server.portInUse': 'El puerto {0} ya está en uso. Cambia el ajuste gptBridge.port.',
  'server.openSettings': 'Abrir ajustes',
  'server.startFailed': 'GPT Bridge: No se pudo iniciar el servidor — {0}',
  'server.tunnelFailed':
    'GPT Bridge: No se pudo iniciar el túnel — {0}. El punto final local sigue disponible.',
  'server.blocked': 'GPT Bridge: Acceso bloqueado — {0}',
  'activity.blocked': 'BLOQ',
  'activity.detailHint': 'Haz clic para ver los detalles en el registro',
  'state.stopped': 'Detenido',
  'state.starting': 'Iniciando...',
  'state.running': 'Ejecutándose en local (puerto {0})',
  'state.tunneled': 'En ejecución · túnel conectado',
  'state.error': 'Error',
  'server.rgMissing':
    'GPT Bridge: No se encontró ripgrep, así que el listado y la búsqueda de archivos están desactivados. Vuelve a compilar el .vsix en esta máquina.'
};

const CATALOG: Record<Lang, Record<Key, string>> = { en, ko, ja, 'zh-cn': zh, es };

export function isLang(value: string): value is Lang {
  return (LANGUAGES as readonly string[]).includes(value);
}

let current: Lang = 'en';

export function setLanguage(lang: Lang): void {
  current = lang;
}

export function getLanguage(): Lang {
  return current;
}

/**
 * 번역 조회. `{0}`, `{1}` 자리에 인자를 끼워 넣는다.
 *
 * 키가 없는 언어는 영어로 떨어진다 — 번역이 늦어도 UI가 비지 않는 편이 낫다.
 */
export function t(key: Key, ...args: readonly (string | number)[]): string {
  const template = CATALOG[current][key] ?? en[key];
  return template.replace(/\{(\d+)\}/g, (_match, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? '' : String(value);
  });
}
