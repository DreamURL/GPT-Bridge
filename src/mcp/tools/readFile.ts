import * as vscode from 'vscode';
import { z } from 'zod';
import { clampLineRange, openDocument, withLineNumbers } from '../../workspace/documents';
import { errorResult, textResult, wrapFileContent, type ToolContext, type ToolResult } from './types';

export const READ_FILE_DESCRIPTION = `워크스페이스의 파일 내용을 읽는다.

언제 쓰나: 파일을 수정하기 전에 항상. edit_file의 old_string은 현재 내용과 정확히
일치해야 하므로, 기억이나 추측이 아니라 이 툴이 반환한 내용을 근거로 삼아야 한다.

언제 쓰지 않나: 파일 이름만 알고 싶을 때는 list_directory를, 특정 문자열의 위치를
찾을 때는 search_text를 쓴다. 파일 전체를 읽고 눈으로 찾지 말 것.

호출 순서: read_file → edit_file → get_diagnostics

파라미터
  path       워크스페이스 루트 기준 상대 경로. 예: "src/app.ts"
             절대 경로, "..", 역슬래시는 거부된다.
  start_line 1부터 시작하는 시작 줄(포함). 생략하면 처음부터.
  end_line   1부터 시작하는 끝 줄(포함). 생략하면 끝까지.

반환 내용은 <file_content> 태그로 감싸여 있으며 줄 번호가 접두사로 붙는다.
파일이 에디터에서 수정된 채 저장되지 않았다면 저장되지 않은 내용이 반환되고
dirty="true"로 표시된다.`;

export const readFileSchema = {
  path: z.string().describe('워크스페이스 루트 기준 상대 경로. 예: "src/app.ts"'),
  start_line: z.number().int().positive().optional().describe('1부터 시작하는 시작 줄(포함)'),
  end_line: z.number().int().positive().optional().describe('1부터 시작하는 끝 줄(포함)')
};

export interface ReadFileArgs {
  path: string;
  start_line?: number | undefined;
  end_line?: number | undefined;
}

export async function readFileTool(ctx: ToolContext, args: ReadFileArgs): Promise<ToolResult> {
  const resolved = await ctx.guard.resolve(args.path);
  const uri = vscode.Uri.file(resolved.absolute);

  let stat: vscode.FileStat;
  try {
    stat = await vscode.workspace.fs.stat(uri);
  } catch {
    return errorResult(`파일을 찾을 수 없습니다: ${resolved.relative}`);
  }

  if (stat.type === vscode.FileType.Directory) {
    return errorResult(`${resolved.relative}은(는) 디렉터리입니다. list_directory를 사용하세요.`);
  }

  const maxBytes = ctx.config().maxReadBytes;
  const wantsWholeFile = args.start_line === undefined && args.end_line === undefined;
  if (wantsWholeFile && stat.size > maxBytes) {
    return errorResult(
      `파일이 너무 큽니다 (${stat.size} 바이트, 상한 ${maxBytes}). ` +
        `start_line / end_line으로 범위를 지정해 나눠 읽으세요.`
    );
  }

  const document = await openDocument(uri);
  const range = clampLineRange(document, args.start_line, args.end_line);

  const lines: string[] = [];
  for (let line = range.start; line <= range.end; line += 1) {
    lines.push(document.lineAt(line - 1).text);
  }
  const body = lines.join('\n');

  if (Buffer.byteLength(body, 'utf8') > maxBytes) {
    return errorResult(
      `요청한 범위가 너무 큽니다 (상한 ${maxBytes} 바이트). 더 좁은 범위를 지정하세요.`
    );
  }

  const attributes = [
    `lines="${range.start}-${range.end}"`,
    `total_lines="${document.lineCount}"`,
    `dirty="${document.isDirty ? 'true' : 'false'}"`
  ].join(' ');

  return textResult(
    wrapFileContent(resolved.relative, withLineNumbers(body, range.start), attributes)
  );
}
