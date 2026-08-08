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

export const EDIT_FILE_DESCRIPTION = `Replace part of an existing file. This is the primary editing tool.

**To modify an existing file, always use this tool instead of write_file.**
write_file overwrites the whole file and destroys unrelated parts.

When to use: changing a specific part of a file that already exists.
When not to use: creating a new file - use write_file for that.

Call order: read_file to see current content -> edit_file -> get_diagnostics

Edits are applied to the **editor buffer**, not to disk. The user can undo them
with Ctrl+Z and disk stays unchanged until they save. Requires user approval.

Parameters
  path        Path relative to the workspace root. Example: "src/app.ts"
  old_string  The text to replace. **It must appear exactly once in the file.**
              Strip the line-number prefix that read_file adds before sending.
              If it appears more than once, include surrounding lines to make it unique.
  new_string  The replacement. An empty string deletes the matched text.

Line endings are converted to the file's own style (LF/CRLF) automatically, so
just send \n.`;

export const editFileSchema = {
  path: z.string().describe('Path relative to the workspace root. Example: "src/app.ts"'),
  old_string: z
    .string()
    .describe('Text to replace. Must appear exactly once in the file. Strip the line-number prefix'),
  new_string: z.string().describe('Replacement text. An empty string deletes the match')
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
      `Cannot open file: ${resolved.relative}. Use write_file if this is a new file.`
    );
  }

  const documentEol = document.eol === vscode.EndOfLine.CRLF ? CRLF : LF;
  const text = document.getText();
  const match = findUniqueOccurrence(text, args.old_string, documentEol);

  if (match.kind === 'empty') {
    return errorResult('old_string is empty. Specify the text to replace.');
  }
  if (match.kind === 'none') {
    return errorResult(
      `old_string was not found in ${resolved.relative}
` +
        `Call read_file to re-check the content, and do not include the line-number prefix.`
    );
  }
  if (match.kind === 'ambiguous') {
    return errorResult(
      `old_string is not unique (${match.count} or more matches) in ${resolved.relative}
` +
        `Include more surrounding lines so it matches exactly one place.`
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
        ? 'The approval window expired, so the edit was not applied. Ask again.'
        : 'The user rejected the edit.'
    );
  }

  // 승인을 기다리는 동안 사용자가 파일을 고쳤을 수 있다. 다시 확인한다
  // (project.md §5.4.1). 여기서 걸러내지 않으면 승인 시점과 다른 내용을 덮어쓴다.
  const current = await openDocument(uri);
  const currentText = current.getText();
  const recheck = findUniqueOccurrence(currentText, args.old_string, documentEol);
  if (recheck.kind !== 'found') {
    return errorResult(
      `The file changed while waiting for approval: ${resolved.relative}
` +
        `Call read_file to re-check the current content, then try again.`
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
    return errorResult(`Failed to apply the edit: ${resolved.relative}`);
  }

  const saved = await maybeAutoSave(ctx, uri);
  return textResult(
    `Edited ${resolved.relative} (+${summary.added} -${summary.removed}).
` +
      (saved
        ? 'Auto-save is on, so the change was written to disk.'
        : 'Applied to the editor buffer only. Disk stays unchanged until the user saves.') +
      '\nCall get_diagnostics to check for new errors.'
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
