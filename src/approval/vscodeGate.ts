import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import { ApprovalGate, type ApprovalRequest, type PromptChoice } from './ApprovalGate';
import { DiffPreview } from './DiffPreview';
import { readConfig } from '../config';
import { t } from '../i18n';

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
  diffPreview: DiffPreview,
  /** 만료 후 선택을 감사 로그에 남기기 위한 훅. */
  onExpiredChoiceAudit: (request: ApprovalRequest, choice: PromptChoice) => void
): ApprovalGate {
  return new ApprovalGate({
    timeoutMs: () => readConfig().approvalTimeoutSeconds * 1000,
    mode: () => readConfig().approvalMode,
    autoApprovePatterns: () => readConfig().autoApprovePatterns,

    prompt: async (request): Promise<PromptChoice | undefined> => {
      const choice = await vscode.window.showInformationMessage(
        promptText(request),
        { modal: true, detail: promptDetail(request) },
        t('approval.apply'),
        t('approval.viewDiff')
      );

      if (choice === t('approval.apply')) {
        return 'apply';
      }
      if (choice === t('approval.viewDiff')) {
        return 'diff';
      }
      // 모달의 '취소'와 Esc는 모두 undefined로 온다. 거부로 취급한다.
      return 'deny';
    },

    showDiff: async (request): Promise<void> => {
      const preview = previews.get(request.id);
      if (preview === undefined) {
        void vscode.window.showWarningMessage(t('approval.previewMissing'));
        return;
      }
      const original = preview.original ?? diffPreview.emptyUri(request.id, request.relPath);
      await diffPreview.show(request.id, request.relPath, original, preview.proposed);
    },

    onExpiredChoice: (request, choice): void => {
      log.warn(`Ignored a choice on an expired approval request (id=${request.id}, choice=${choice})`);
      onExpiredChoiceAudit(request, choice);
      void vscode.window.showWarningMessage(t('approval.expired', request.relPath));
    },

    log: {
      info: (message) => log.info(message),
      warn: (message) => log.warn(message)
    }
  });
}

function promptText(request: ApprovalRequest): string {
  if (request.tool === 'delete_path') {
    return t('approval.deleteRequest', request.relPath);
  }
  if (request.tool === 'create_directory') {
    return t('approval.createDirRequest', request.relPath);
  }
  return t('approval.editRequest', request.relPath, request.summary);
}

/**
 * 디스크에 즉시 반영되는 작업은 문구를 구분한다 (project.md §4.2.1).
 * 텍스트 수정과 같은 문구를 쓰면 "어차피 저장 안 하면 되지"로 오해한다.
 */
function promptDetail(request: ApprovalRequest): string {
  if (request.diskImmediate) {
    return request.tool === 'delete_path'
      ? t('approval.detailDiskTrash')
      : t('approval.detailDisk');
  }
  return t('approval.detailBuffer');
}
