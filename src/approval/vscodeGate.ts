import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { ApprovalGate, type ApprovalRequest, type PromptChoice } from './ApprovalGate';
import { DiffPreview } from './DiffPreview';
import { readConfig } from '../config';

/** 승인 요청 1건에 필요한, 미리보기에 쓸 내용. */
export interface PendingPreview {
  readonly original: vscode.Uri | undefined;
  readonly proposed: string;
}

export function newRequestId(): string {
  return crypto.randomBytes(9).toString('hex');
}

/**
 * ApprovalGate를 VS Code UI에 연결한다.
 *
 * 모달은 프로그램적으로 닫을 수 없다. 타임아웃이 지나도 화면의 창은 남고,
 * 사용자가 뒤늦게 '적용'을 누를 수 있다. 그 선택은 게이트가 버리고
 * 여기서 별도 알림을 띄운다 (project.md §5.4.1).
 */
export function createVscodeApprovalGate(
  log: vscode.LogOutputChannel,
  previews: Map<string, PendingPreview>,
  diffPreview: DiffPreview
): ApprovalGate {
  return new ApprovalGate({
    timeoutMs: () => readConfig().approvalTimeoutSeconds * 1000,
    mode: () => readConfig().approvalMode,
    autoApprovePatterns: () => readConfig().autoApprovePatterns,

    prompt: async (request): Promise<PromptChoice | undefined> => {
      const choice = await vscode.window.showInformationMessage(
        promptText(request),
        { modal: true, detail: promptDetail(request) },
        '적용',
        'Diff 보기'
      );

      if (choice === '적용') {
        return 'apply';
      }
      if (choice === 'Diff 보기') {
        return 'diff';
      }
      // 모달의 '취소'와 Esc는 모두 undefined로 온다. 거부로 취급한다.
      return 'deny';
    },

    showDiff: async (request): Promise<void> => {
      const preview = previews.get(request.id);
      if (preview === undefined) {
        void vscode.window.showWarningMessage('GPT Bridge: 미리보기 내용을 찾을 수 없습니다.');
        return;
      }
      const original = preview.original ?? diffPreview.emptyUri(request.id, request.relPath);
      await diffPreview.show(request.id, request.relPath, original, preview.proposed);
    },

    onExpiredChoice: (request, choice): void => {
      log.warn(
        `만료된 승인 요청에 대한 선택을 무시했습니다 (id=${request.id}, choice=${choice})`
      );
      void vscode.window.showWarningMessage(
        `GPT Bridge: 승인 대기 시간이 지난 요청이라 "${request.relPath}" 수정을 적용하지 않았습니다. ` +
          `필요하면 GPT에게 다시 요청하세요.`
      );
    },

    log: {
      info: (message) => log.info(message),
      warn: (message) => log.warn(message)
    }
  });
}

function promptText(request: ApprovalRequest): string {
  if (request.tool === 'delete_path') {
    return `GPT가 ${request.relPath} 삭제를 요청했습니다.`;
  }
  if (request.tool === 'create_directory') {
    return `GPT가 디렉터리 ${request.relPath} 생성을 요청했습니다.`;
  }
  return `GPT가 ${request.relPath} 수정을 요청했습니다 (${request.summary}).`;
}

/**
 * 디스크에 즉시 반영되는 작업은 문구를 구분한다 (project.md §4.2.1).
 * 텍스트 수정과 같은 문구를 쓰면 "어차피 저장 안 하면 되지"로 오해한다.
 */
function promptDetail(request: ApprovalRequest): string {
  if (request.diskImmediate) {
    return request.tool === 'delete_path'
      ? '이 작업은 승인 즉시 디스크에 반영됩니다(가능하면 휴지통으로 이동). Ctrl+Z로 완전히 되돌아가지 않습니다.'
      : '이 작업은 승인 즉시 디스크에 반영됩니다. Ctrl+Z로 완전히 되돌아가지 않습니다.';
  }
  return '에디터 버퍼에만 적용됩니다. Ctrl+Z로 되돌릴 수 있고, 저장 전까지 디스크는 변경되지 않습니다.';
}
