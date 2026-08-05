import * as vscode from 'vscode';
import { z } from 'zod';
import { newRequestId } from '../../approval/vscodeGate';
import { openDocument } from '../../workspace/documents';
import {
  CRLF,
  findUniqueOccurrence,
  LF,
  normalizeToEol,
  summarizeChange
} from '../../workspace/textEdit';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';

export const EDIT_FILE_DESCRIPTION = `기존 파일의 일부를 바꾼다. 파일 수정의 기본 도구다.

**기존 파일을 수정할 때는 write_file 대신 반드시 이 툴을 사용한다.**
write_file은 파일 전체를 덮어써서 관계없는 부분까지 날아간다.

언제 쓰나: 이미 있는 파일의 특정 부분을 고칠 때.
언제 쓰지 않나: 새 파일을 만들 때는 write_file을 쓴다.

호출 순서: read_file로 현재 내용 확인 → edit_file → get_diagnostics로 새 에러 확인

수정은 디스크가 아니라 **에디터 버퍼**에 적용된다. 사용자가 Ctrl+Z로 되돌릴 수
있고, 저장 전까지 디스크는 변경되지 않는다. 사용자 승인이 필요하다.

파라미터
  path        루트 기준 상대 경로. 예: "src/app.ts"
  old_string  바꿀 대상. **파일 안에서 정확히 1회만 등장해야 한다.**
              read_file이 붙여 준 줄 번호 접두사("  12│ ")는 빼고 보낼 것.
              여러 번 등장하면 앞뒤 줄을 더 포함해 고유하게 만든다.
  new_string  바꿀 내용. 빈 문자열이면 해당 부분이 삭제된다.

줄바꿈은 파일의 스타일(LF/CRLF)에 맞춰 자동으로 변환되므로 \\n으로 보내면 된다.`;

export const editFileSchema = {
  path: z.string().describe('루트 기준 상대 경로. 예: "src/app.ts"'),
  old_string: z
    .string()
    .describe('바꿀 대상. 파일 안에서 정확히 1회만 등장해야 한다. 줄 번호 접두사는 제외할 것'),
  new_string: z.string().describe('바꿀 내용. 빈 문자열이면 삭제된다')
};

export interface EditFileArgs {
  path: string;
  old_string: string;
  new_string: string;
}

export async function editFileTool(ctx: ToolContext, args: EditFileArgs): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);
  const uri = vscode.Uri.file(resolved.absolute);

  let document: vscode.TextDocument;
  try {
    document = await openDocument(uri);
  } catch {
    return errorResult(
      `파일을 열 수 없습니다: ${resolved.relative}. 새 파일이라면 write_file을 사용하세요.`
    );
  }

  const documentEol = document.eol === vscode.EndOfLine.CRLF ? CRLF : LF;
  const text = document.getText();
  const match = findUniqueOccurrence(text, args.old_string, documentEol);

  if (match.kind === 'empty') {
    return errorResult('old_string이 비어 있습니다. 바꿀 대상을 지정하세요.');
  }
  if (match.kind === 'none') {
    return errorResult(
      `old_string을 찾을 수 없습니다: ${resolved.relative}\n` +
        `read_file로 현재 내용을 다시 확인하세요. 줄 번호 접두사("  12│ ")를 포함해 보내지 않았는지도 확인하세요.`
    );
  }
  if (match.kind === 'ambiguous') {
    return errorResult(
      `old_string이 고유하지 않습니다 (${match.count}회 이상 등장): ${resolved.relative}\n` +
        `앞뒤 줄을 더 포함해 한 곳만 가리키도록 만드세요.`
    );
  }

  const replacement = normalizeToEol(args.new_string, match.eol);
  const proposed = text.slice(0, match.start) + replacement + text.slice(match.end);
  const summary = summarizeChange(text, proposed);

  const requestId = newRequestId();
  const decision = await ctx.approve(
    {
      id: requestId,
      tool: 'edit_file',
      relPath: resolved.relative,
      summary: `+${summary.added} -${summary.removed}`,
      diskImmediate: false,
      alwaysConfirm: false
    },
    { original: uri, proposed }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? '승인 대기 시간이 지나 수정을 적용하지 않았습니다. 다시 요청하세요.'
        : '사용자가 수정을 거부했습니다.'
    );
  }

  // 승인을 기다리는 동안 사용자가 파일을 고쳤을 수 있다. 다시 확인한다
  // (project.md §5.4.1). 여기서 걸러내지 않으면 승인 시점과 다른 내용을 덮어쓴다.
  const current = await openDocument(uri);
  const currentText = current.getText();
  const recheck = findUniqueOccurrence(currentText, args.old_string, documentEol);
  if (recheck.kind !== 'found') {
    return errorResult(
      `승인을 기다리는 동안 파일이 변경되었습니다: ${resolved.relative}\n` +
        `read_file로 현재 내용을 다시 확인한 뒤 재시도하세요.`
    );
  }

  const edit = new vscode.WorkspaceEdit();
  edit.replace(
    uri,
    new vscode.Range(current.positionAt(recheck.start), current.positionAt(recheck.end)),
    normalizeToEol(args.new_string, recheck.eol)
  );

  const applied = await vscode.workspace.applyEdit(edit);
  if (!applied) {
    return errorResult(`수정을 적용하지 못했습니다: ${resolved.relative}`);
  }

  const saved = await maybeAutoSave(ctx, uri);
  return textResult(
    `${resolved.relative} 수정 완료 (+${summary.added} -${summary.removed}).\n` +
      (saved
        ? '자동 저장되어 디스크에 반영되었습니다.'
        : '에디터 버퍼에만 적용되었습니다. 사용자가 저장하기 전까지 디스크는 변경되지 않습니다.') +
      '\nget_diagnostics를 호출해 새 에러가 없는지 확인하세요.'
  );
}

/** autoSave 설정이 켜져 있으면 저장한다. 기본값은 꺼짐(권장). */
export async function maybeAutoSave(ctx: ToolContext, uri: vscode.Uri): Promise<boolean> {
  if (!ctx.config().autoSave) {
    return false;
  }
  const document = await openDocument(uri);
  return document.save();
}
