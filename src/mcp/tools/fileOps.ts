import * as vscode from 'vscode';
import { z } from 'zod';
import { newRequestId } from '../../approval/vscodeGate';
import { openDocument } from '../../workspace/documents';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';

// ── create_directory ──────────────────────────────────────────────────

export const CREATE_DIRECTORY_DESCRIPTION = `디렉터리를 만든다. 중간 경로도 함께 만들어진다.

언제 쓰나: 새 파일을 넣을 폴더가 아직 없을 때.
언제 쓰지 않나: write_file은 상위 폴더를 알아서 만든다. 빈 폴더가 꼭 필요한
경우가 아니면 굳이 부를 필요가 없다.

이 작업은 승인 즉시 디스크에 반영된다.

파라미터
  path  루트 기준 상대 경로. 예: "src/components"`;

export const createDirectorySchema = {
  path: z.string().describe('루트 기준 상대 경로. 예: "src/components"')
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
      ? textResult(`${resolved.relative}은(는) 이미 있습니다.`)
      : errorResult(`${resolved.relative}은(는) 파일입니다. 디렉터리를 만들 수 없습니다.`);
  } catch {
    // 없으면 아래에서 만든다.
  }

  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'create_directory',
      relPath: resolved.relative,
      summary: '디렉터리 생성',
      diskImmediate: true,
      alwaysConfirm: false
    },
    { original: undefined, proposed: '' }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? '승인 대기 시간이 지나 디렉터리를 만들지 않았습니다.'
        : '사용자가 디렉터리 생성을 거부했습니다.'
    );
  }

  await vscode.workspace.fs.createDirectory(uri);
  return textResult(`${resolved.relative} 디렉터리를 만들었습니다. (디스크에 즉시 반영됨)`);
}

// ── delete_path ───────────────────────────────────────────────────────

export const DELETE_PATH_DESCRIPTION = `파일이나 디렉터리를 삭제한다.

**되돌리기 어려운 작업이다.** 승인 즉시 디스크에 반영되며, 가능하면 휴지통으로
옮기지만 Ctrl+Z로 되돌아가지 않는다. 사용자는 승인 모드와 무관하게 **항상**
확인을 요청받는다.

언제 쓰나: 사용자가 명시적으로 삭제를 요청했을 때만.
언제 쓰지 않나: 파일 내용을 비우려는 목적이라면 edit_file이나 write_file을 쓴다.
정리·리팩터링을 하다가 스스로 판단해 삭제하지 말 것.

파라미터
  path       루트 기준 상대 경로
  recursive  디렉터리를 하위 내용까지 지울지. 기본 false`;

export const deletePathSchema = {
  path: z.string().describe('루트 기준 상대 경로'),
  recursive: z.boolean().optional().describe('디렉터리를 하위 내용까지 삭제할지. 기본 false')
};

export interface DeletePathArgs {
  path: string;
  recursive?: boolean | undefined;
}

export async function deletePathTool(ctx: ToolContext, args: DeletePathArgs): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);

  if (resolved.relative === '') {
    return errorResult('워크스페이스 루트는 삭제할 수 없습니다.');
  }

  const uri = vscode.Uri.file(resolved.absolute);
  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return errorResult(`대상을 찾을 수 없습니다: ${resolved.relative}`);
  }

  const isDirectory = stat.type === vscode.FileType.Directory;
  const recursive = args.recursive ?? false;

  if (isDirectory && !recursive) {
    return errorResult(
      `${resolved.relative}은(는) 디렉터리입니다. 하위 내용까지 지우려면 recursive: true를 지정하세요.`
    );
  }

  // alwaysConfirm: 세 승인 모드 어디서도 자동 승인되지 않는다 (project.md §5.4).
  const decision = await ctx.approve(
    {
      id: newRequestId(),
      tool: 'delete_path',
      relPath: resolved.relative,
      summary: isDirectory ? `디렉터리 삭제${recursive ? ' (하위 포함)' : ''}` : '파일 삭제',
      diskImmediate: true,
      alwaysConfirm: true
    },
    { original: undefined, proposed: '' }
  );

  if (decision !== 'approved') {
    return errorResult(
      decision === 'expired'
        ? '승인 대기 시간이 지나 삭제하지 않았습니다.'
        : '사용자가 삭제를 거부했습니다.'
    );
  }

  // 휴지통으로 보낸다. deleteFile은 즉시 영구 삭제라 복구 가능성이 다르다
  // (project.md §4.2.1).
  try {
    await vscode.workspace.fs.delete(uri, { recursive, useTrash: true });
    return textResult(`${resolved.relative}을(를) 휴지통으로 옮겼습니다.`);
  } catch {
    // 휴지통을 쓸 수 없는 환경(원격, 일부 파일시스템)에서는 직접 삭제한다.
    await vscode.workspace.fs.delete(uri, { recursive, useTrash: false });
    return textResult(
      `${resolved.relative}을(를) 삭제했습니다. 이 환경에서는 휴지통을 쓸 수 없어 영구 삭제되었습니다.`
    );
  }
}

// ── save_file ─────────────────────────────────────────────────────────

export const SAVE_FILE_DESCRIPTION = `수정한 파일을 디스크에 저장한다.

언제 쓰나: 사용자가 저장을 명시적으로 요청했을 때.
언제 쓰지 않나: **기본적으로 부르지 않는다.** 저장하지 않으면 사용자가 변경을
검토하고 Ctrl+Z로 되돌릴 수 있다. 이것이 이 확장의 안전장치이므로 마음대로
저장하지 말 것.

파라미터
  path  루트 기준 상대 경로`;

export const saveFileSchema = {
  path: z.string().describe('루트 기준 상대 경로')
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
    return errorResult(`파일을 열 수 없습니다: ${resolved.relative}`);
  }

  if (!document.isDirty) {
    return textResult(`${resolved.relative}에 저장할 변경사항이 없습니다.`);
  }

  const saved = await document.save();
  return saved
    ? textResult(`${resolved.relative}을(를) 저장했습니다.`)
    : errorResult(`저장에 실패했습니다: ${resolved.relative}`);
}
