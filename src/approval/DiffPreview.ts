import * as vscode from 'vscode';

export const PREVIEW_SCHEME = 'gpt-bridge-preview';

/**
 * 승인 전 diff 미리보기 (project.md §5.4).
 *
 * 제안된 내용을 가상 문서로 등록하고 `vscode.diff`로 좌우 비교를 띄운다.
 * 실제 파일은 건드리지 않는다 — 승인 전이므로 버퍼조차 수정하면 안 된다.
 */
export class DiffPreview implements vscode.Disposable {
  private readonly contents = new Map<string, string>();
  private readonly registration: vscode.Disposable;

  constructor() {
    const provider: vscode.TextDocumentContentProvider = {
      provideTextDocumentContent: (uri) => this.contents.get(uri.path) ?? ''
    };
    this.registration = vscode.workspace.registerTextDocumentContentProvider(
      PREVIEW_SCHEME,
      provider
    );
  }

  /**
   * 좌: 현재 파일, 우: 제안된 내용.
   * requestId를 경로에 넣어 동시 요청끼리 섞이지 않게 한다.
   */
  async show(
    requestId: string,
    relPath: string,
    original: vscode.Uri,
    proposed: string
  ): Promise<void> {
    const key = `/${requestId}/${relPath}`;
    this.contents.set(key, proposed);

    const previewUri = vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: key });

    try {
      await vscode.commands.executeCommand(
        'vscode.diff',
        original,
        previewUri,
        `${relPath} - GPT proposal (before applying)`,
        { preview: true }
      );
    } finally {
      // 문서 내용은 provider가 이미 읽어 갔다. 오래 들고 있을 이유가 없다.
      setTimeout(() => this.contents.delete(key), 60_000);
    }
  }

  /** 새 파일 제안처럼 원본이 없는 경우를 위한 빈 문서. */
  emptyUri(requestId: string, relPath: string): vscode.Uri {
    const key = `/${requestId}/empty/${relPath}`;
    this.contents.set(key, '');
    return vscode.Uri.from({ scheme: PREVIEW_SCHEME, path: key });
  }

  dispose(): void {
    this.contents.clear();
    this.registration.dispose();
  }
}
