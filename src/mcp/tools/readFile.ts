import * as vscode from 'vscode';
import { z } from 'zod';
import { clampLineRange, openDocument, withLineNumbers } from '../../workspace/documents';
import { fingerprintOf } from '../../workspace/readTracker';
import { errorResult, textResult, wrapFileContent, type ToolContext, type ToolResult } from './types';

/**
 * 이 줄 수를 넘는 전체 읽기에는 안내를 덧붙인다. 막지는 않는다 —
 * 처음 구조를 파악할 때는 전체를 읽는 게 맞다. 낭비가 시작되는 건
 * 그 다음, 수정할 때마다 같은 파일을 다시 통째로 읽는 단계다.
 */
const LARGE_FILE_LINES = 400;

export const READ_FILE_DESCRIPTION = `워크스페이스의 파일 내용을 읽는다.

언제 쓰나: 파일을 수정하기 전에 항상. edit_file의 old_string은 현재 내용과 정확히
일치해야 하므로, 기억이나 추측이 아니라 이 툴이 반환한 내용을 근거로 삼아야 한다.

언제 쓰지 않나: 파일 이름만 알고 싶을 때는 list_directory를, 특정 문자열의 위치를
찾을 때는 search_text를 쓴다. 파일 전체를 읽고 눈으로 찾지 말 것.

호출 순서: read_file → edit_file → get_diagnostics

읽는 범위: 파일을 처음 볼 때는 전체를 읽어 구조를 파악해도 된다. 그러나 **한 번
전체를 읽은 파일을 수정할 때 다시 전체를 읽지 않는다.** 이미 받은 내용에서 고칠
지점을 찾고, 확신이 서지 않으면 search_text로 위치를 특정한 뒤 start_line /
end_line으로 그 주변만 읽는다. 같은 내용을 반복해서 받으면 대화가 길어질수록
앞부분을 잃는다.

파라미터
  path       워크스페이스 루트 기준 상대 경로. 예: "src/app.ts"
             절대 경로, "..", 역슬래시는 거부된다.
  start_line 1부터 시작하는 시작 줄(포함). 생략하면 처음부터.
  end_line   1부터 시작하는 끝 줄(포함). 생략하면 끝까지.
             예: search_text가 120행을 가리키면 start_line 100, end_line 140.

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

  const kind = ctx.reads.record(
    resolved.relative,
    wantsWholeFile,
    fingerprintOf(document.getText())
  );

  const content = wrapFileContent(
    resolved.relative,
    withLineNumbers(body, range.start),
    attributes
  );
  const advice = readAdvice(kind, wantsWholeFile, document.lineCount);

  return textResult(advice === undefined ? content : `${content}\n\n${advice}`);
}

/**
 * 컨텍스트 절약 조언. 내용은 항상 그대로 돌려주고 판단 근거만 덧붙인다.
 *
 * 모델은 근거를 확보하려는 성향이 있어서, 수정할 때마다 파일을 처음부터
 * 다시 읽는다. 같은 내용이 대화에 몇 번씩 쌓이면 정작 필요할 때 앞을 잊는다.
 * 이미 읽었고 바뀌지도 않았다는 사실을 알려 주면 스스로 줄인다.
 */
function readAdvice(
  kind: ReturnType<ToolContext['reads']['record']>,
  wholeFile: boolean,
  totalLines: number
): string | undefined {
  if (kind === 'repeat-unchanged') {
    return (
      '참고: 이 파일은 이번 세션에서 이미 전체를 읽었고 그 뒤로 내용이 바뀌지 않았습니다. ' +
      '앞서 받은 내용을 그대로 쓰면 됩니다. 특정 부분만 다시 확인하려면 ' +
      'search_text로 위치를 찾은 뒤 start_line / end_line으로 그 범위만 읽으세요.'
    );
  }

  if (kind === 'repeat-changed') {
    return '참고: 이전에 읽은 뒤 내용이 바뀌어 다시 읽었습니다. 이전 내용은 버리고 이쪽을 기준으로 삼으세요.';
  }

  if (wholeFile && totalLines > LARGE_FILE_LINES) {
    return (
      `참고: ${totalLines}줄 전체를 읽었습니다. 구조 파악에는 이걸로 충분합니다. ` +
      '이후 수정 단계에서는 다시 전체를 읽지 말고, search_text로 위치를 특정한 뒤 ' +
      'start_line / end_line으로 필요한 범위만 읽으세요.'
    );
  }

  return undefined;
}
