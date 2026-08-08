import * as vscode from 'vscode';
import { z } from 'zod';
import { newRequestId } from '../../approval/vscodeGate';
import { openDocument } from '../../workspace/documents';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';

// ── create_directory ──────────────────────────────────────────────────

export const CREATE_DIRECTORY_DESCRIPTION = `Create a directory, including any missing parents.

When to use: the folder for a new file does not exist yet.
When not to use: write_file creates parent folders on its own. Unless you
specifically need an empty folder, you do not need to call this.

This is written to disk as soon as it is approved.

Parameters
  path  Path relative to the workspace root. Example: "src/components"`;

export const createDirectorySchema = {
  path: z.string().describe('Path relative to the workspace root. Example: "src/components"')
};

export interface CreateDirectoryArgs {
  path: string;
}

export async function createDirectoryTool(
  ctx: ToolContext,
  args: CreateDirectoryArgs
): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);
  const uri = vscode.Uri.file(resolved.absolute);

  try {
    const stat = await vscode.workspace.fs.stat(uri);
    return stat.type === vscode.FileType.Directory
      ? textResult(`${resolved.relative} already exists.`)
      : errorResult(`${resolved.relative} is a file, so a directory cannot be created there.`);
  } catch {
    // 없으면 아래에서 만든다.
  }

  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'create_directory',
      relPath: resolved.relative,
      summary: 'create directory',
      diskImmediate: true,
      alwaysConfirm: false
    },
    { original: undefined, proposed: '' }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? 'The approval window expired, so the directory was not created.'
        : 'The user rejected creating the directory.'
    );
  }

  await vscode.workspace.fs.createDirectory(uri);
  return textResult(`Created directory ${resolved.relative}. (written to disk immediately)`);
}

// ── delete_path ───────────────────────────────────────────────────────

export const DELETE_PATH_DESCRIPTION = `Delete a file or directory.

**This is hard to undo.** It is written to disk as soon as it is approved, and
although it moves to the trash when possible, Ctrl+Z will not bring it back.
The user is **always** asked to confirm, regardless of the approval mode.

When to use: only when the user explicitly asked for a deletion.
When not to use: to empty a file, use edit_file or write_file. Never decide to
delete something on your own while cleaning up or refactoring.

Parameters
  path       Path relative to the workspace root
  recursive  Whether to delete a directory with its contents. Default false`;

export const deletePathSchema = {
  path: z.string().describe('Path relative to the workspace root'),
  recursive: z.boolean().optional().describe('Delete a directory with its contents. Default false')
};

export interface DeletePathArgs {
  path: string;
  recursive?: boolean | undefined;
}

export async function deletePathTool(ctx: ToolContext, args: DeletePathArgs): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);

  if (resolved.relative === '') {
    return errorResult('The workspace root cannot be deleted.');
  }

  const uri = vscode.Uri.file(resolved.absolute);
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return errorResult(`Target not found: ${resolved.relative}`);
  }

  const isDirectory = stat.type === vscode.FileType.Directory;
  const recursive = args.recursive ?? false;

  if (isDirectory && !recursive) {
    return errorResult(
      `${resolved.relative} is a directory. Pass recursive: true to delete its contents as well.`
    );
  }

  // alwaysConfirm: 세 승인 모드 어디서도 자동 승인되지 않는다 (project.md §5.4).
  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'delete_path',
      relPath: resolved.relative,
      summary: isDirectory ? `delete directory${recursive ? ' (recursive)' : ''}` : 'delete file',
      diskImmediate: true,
      alwaysConfirm: true
    },
    { original: undefined, proposed: '' }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? 'The approval window expired, so nothing was deleted.'
        : 'The user rejected the deletion.'
    );
  }

  // 휴지통으로 보낸다. deleteFile은 즉시 영구 삭제라 복구 가능성이 다르다
  // (project.md §4.2.1).
  try {
    await vscode.workspace.fs.delete(uri, { recursive, useTrash: true });
    return textResult(`Moved ${resolved.relative} to the trash.`);
  } catch {
    // 휴지통을 쓸 수 없는 환경(원격, 일부 파일시스템)에서는 직접 삭제한다.
    await vscode.workspace.fs.delete(uri, { recursive, useTrash: false });
    return textResult(
      `Deleted ${resolved.relative}. The trash is unavailable here, so it was removed permanently.`
    );
  }
}

// ── save_file ─────────────────────────────────────────────────────────

export const SAVE_FILE_DESCRIPTION = `Save a modified file to disk.

When to use: the user explicitly asked to save.
When not to use: **do not call this by default.** Leaving changes unsaved is
what lets the user review them and undo with Ctrl+Z. That is the safety net of
this extension, so do not save on your own initiative.

Parameters
  path  Path relative to the workspace root`;

export const saveFileSchema = {
  path: z.string().describe('Path relative to the workspace root')
};

export interface SaveFileArgs {
  path: string;
}

export async function saveFileTool(ctx: ToolContext, args: SaveFileArgs): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);
  const uri = vscode.Uri.file(resolved.absolute);

  let document: vscode.TextDocument;
  try {
    document = await openDocument(uri);
  } catch {
    return errorResult(`Cannot open file: ${resolved.relative}`);
  }

  if (!document.isDirty) {
    return textResult(`${resolved.relative} has no unsaved changes.`);
  }

  const saved = await document.save();
  return saved
    ? textResult(`Saved ${resolved.relative}.`)
    : errorResult(`Failed to save: ${resolved.relative}`);
}
