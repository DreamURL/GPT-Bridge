import * as vscode from 'vscode';
import { z } from 'zod';
import { newRequestId } from '../../approval/vscodeGate';
import { openDocument } from '../../workspace/documents';
import { CRLF, LF, normalizeToEol, summarizeChange } from '../../workspace/textEdit';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';
import { maybeAutoSave } from './editFile';

export const WRITE_FILE_DESCRIPTION = `Create a new file or replace its entire contents.

**Use this for creating new files.** To modify an existing file, use edit_file.
This tool overwrites the whole file, so unrelated parts are lost.

When to use: creating a file that does not exist yet.
When not to use: changing part of an existing file - use edit_file.

Note: **creating a new file is written to disk as soon as it is approved.**
Only replacing an existing file goes to the editor buffer, where Ctrl+Z can undo it.

Parameters
  path     Path relative to the workspace root. Example: "src/new-module.ts"
  content  The full contents of the file`;

export const writeFileSchema = {
  path: z.string().describe('Path relative to the workspace root. Example: "src/new-module.ts"'),
  content: z.string().describe('The full contents of the file')
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
      return errorResult(`${resolved.relative} is a directory.`);
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
    return textResult(`${relPath} already has this exact content. Nothing changed.`);
  }

  const summary = summarizeChange(text, proposed);

  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'write_file',
      relPath,
      summary: `full replace +${summary.added} -${summary.removed}`,
      diskImmediate: false,
      alwaysConfirm: false
    },
    { original: uri, proposed }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? 'The approval window expired, so nothing was applied.'
        : 'The user rejected the full replacement.'
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
    return errorResult(`Failed to apply the replacement: ${relPath}`);
  }

  const saved = await maybeAutoSave(ctx, uri);
  return textResult(
    `Replaced all of ${relPath} (+${summary.added} -${summary.removed}).\n` +
      'Warning: prefer edit_file for modifying existing files. A full replace also changes unrelated parts.\n' +
      (saved
        ? 'Auto-save is on, so the change was written to disk.'
        : 'Applied to the editor buffer only. Disk stays unchanged until saved.')
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
      summary: `new file, ${lineCount} lines`,
      diskImmediate: true,
      alwaysConfirm: false
    },
    { original: undefined, proposed: content }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? 'The approval window expired, so the file was not created.'
        : 'The user rejected creating the file.'
    );
  }

  const edit = new vscode.WorkspaceEdit();
  edit.createFile(uri, { overwrite: false, ignoreIfExists: false, contents: Buffer.from(content, 'utf8') });
  if (!(await vscode.workspace.applyEdit(edit))) {
    return errorResult(`Failed to create the file: ${relPath}`);
  }

  return textResult(
    `Created ${relPath} (${lineCount} lines).\n` +
      'Creating a new file is written to disk immediately.'
  );
}
