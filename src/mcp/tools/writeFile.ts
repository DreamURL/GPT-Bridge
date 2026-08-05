import * as vscode from 'vscode';
import { z } from 'zod';
import { newRequestId } from '../../approval/vscodeGate';
import { openDocument } from '../../workspace/documents';
import { CRLF, LF, normalizeToEol, summarizeChange } from '../../workspace/textEdit';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';
import { maybeAutoSave } from './editFile';

export const WRITE_FILE_DESCRIPTION = `파일을 새로 만들거나 내용을 통째로 교체한다.

**신규 생성 전용으로 쓴다.** 기존 파일을 고칠 때는 edit_file을 사용한다.
이 툴은 파일 전체를 덮어쓰므로 관계없는 부분까지 사라진다.

언제 쓰나: 존재하지 않는 파일을 만들 때.
언제 쓰지 않나: 이미 있는 파일의 일부를 고칠 때 — edit_file을 쓴다.

주의: **신규 파일 생성은 승인 즉시 디스크에 반영된다.** 기존 파일을 교체하는
경우에만 에디터 버퍼에 적용되어 Ctrl+Z로 되돌릴 수 있다.

파라미터
  path     루트 기준 상대 경로. 예: "src/new-module.ts"
  content  파일 전체 내용`;

export const writeFileSchema = {
  path: z.string().describe('루트 기준 상대 경로. 예: "src/new-module.ts"'),
  content: z.string().describe('파일 전체 내용')
};

export interface WriteFileArgs {
  path: string;
  content: string;
}

export async function writeFileTool(ctx: ToolContext, args: WriteFileArgs): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);
  const uri = vscode.Uri.file(resolved.absolute);

  let exists = true;
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type === vscode.FileType.Directory) {
      return errorResult(`${resolved.relative}은(는) 디렉터리입니다.`);
    }
  } catch {
    exists = false;
  }

  return exists ? replaceExisting(ctx, uri, resolved.relative, args.content) : createNew(ctx, uri, resolved.relative, args.content);
}

/**
 * 기존 파일 교체 — 문서를 열어 전체 범위를 replace한다.
 * 버퍼 편집이므로 undo가 되고 저장 전까지 디스크는 그대로다.
 */
async function replaceExisting(
  ctx: ToolContext,
  uri: vscode.Uri,
  relPath: string,
  content: string
): Promise<ToolResult> {
  const document = await openDocument(uri);
  const eol = document.eol === vscode.EndOfLine.CRLF ? CRLF : LF;
  const text = document.getText();
  const proposed = normalizeToEol(content, eol);

  if (proposed === text) {
    return textResult(`${relPath}의 내용이 이미 동일합니다. 변경하지 않았습니다.`);
  }

  const summary = summarizeChange(text, proposed);

  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'write_file',
      relPath,
      summary: `전체 교체 +${summary.added} -${summary.removed}`,
      diskImmediate: false,
      alwaysConfirm: false
    },
    { original: uri, proposed }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? '승인 대기 시간이 지나 적용하지 않았습니다.'
        : '사용자가 전체 교체를 거부했습니다.'
    );
  }

  const current = await openDocument(uri);
  const whole = new vscode.Range(
    current.positionAt(0),
    current.positionAt(current.getText().length)
  );

  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, whole, proposed);
  if (!(await vscode.workspace.applyEdit(edit))) {
    return errorResult(`교체를 적용하지 못했습니다: ${relPath}`);
  }

  const saved = await maybeAutoSave(ctx, uri);
  return textResult(
    `${relPath} 전체를 교체했습니다 (+${summary.added} -${summary.removed}).\n` +
      '경고: 기존 파일 수정에는 edit_file 사용을 권장합니다. 전체 교체는 관계없는 부분까지 바꿉니다.\n' +
      (saved
        ? '자동 저장되어 디스크에 반영되었습니다.'
        : '에디터 버퍼에만 적용되었습니다. 저장 전까지 디스크는 변경되지 않습니다.')
  );
}

/**
 * 신규 생성 — WorkspaceEdit.createFile은 **즉시 디스크에 반영된다**
 * (project.md §4.2.1). 텍스트 편집과 달리 저장을 기다리지 않는다.
 */
async function createNew(
  ctx: ToolContext,
  uri: vscode.Uri,
  relPath: string,
  content: string
): Promise<ToolResult> {
  const lineCount = content.length === 0 ? 0 : content.split('\n').length;

  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'write_file',
      relPath,
      summary: `새 파일 ${lineCount}줄`,
      diskImmediate: true,
      alwaysConfirm: false
    },
    { original: undefined, proposed: content }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? '승인 대기 시간이 지나 파일을 만들지 않았습니다.'
        : '사용자가 파일 생성을 거부했습니다.'
    );
  }

  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false, contents: Buffer.from(content, 'utf8') });
  if (!(await vscode.workspace.applyEdit(edit))) {
    return errorResult(`파일을 만들지 못했습니다: ${relPath}`);
  }

  return textResult(
    `${relPath}을(를) 만들었습니다 (${lineCount}줄).\n` +
      '신규 파일 생성은 디스크에 즉시 반영됩니다.'
  );
}
