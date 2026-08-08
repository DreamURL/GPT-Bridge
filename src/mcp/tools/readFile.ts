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

export const READ_FILE_DESCRIPTION = `Read the contents of a file in the workspace.

When to use: always, before modifying a file. edit_file's old_string must match
the current content exactly, so base it on what this tool returns - never on
memory or guesswork.

When not to use: to find file names use list_directory; to find where a string
occurs use search_text. Do not read a whole file and scan it by eye.

Call order: read_file -> edit_file -> get_diagnostics

How much to read: reading a file in full the first time is fine for
understanding its structure. But **do not read a file in full again when you
are about to modify it.** Work from what you already received, and if you are
unsure, locate the spot with search_text and read only around it using
start_line / end_line. Receiving the same content repeatedly is what makes you
lose the earlier part of a long conversation.

Parameters
  path       Path relative to the workspace root. Example: "src/app.ts"
             Absolute paths, "..", and backslashes are rejected.
  start_line 1-based first line, inclusive. Omit to start at the beginning.
  end_line   1-based last line, inclusive. Omit to read to the end.
             Example: if search_text points at line 120, use 100 and 140.

The result is wrapped in a <file_content> tag with line numbers prefixed. If the
file has unsaved edits in the editor, that unsaved content is returned and
marked with dirty="true".`;

export const readFileSchema = {
  path: z.string().describe('Path relative to the workspace root. Example: "src/app.ts"'),
  start_line: z.number().int().positive().optional().describe('1-based first line, inclusive'),
  end_line: z.number().int().positive().optional().describe('1-based last line, inclusive')
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
    return errorResult(`File not found: ${resolved.relative}`);
  }

  if (stat.type === vscode.FileType.Directory) {
    return errorResult(`${resolved.relative} is a directory. Use list_directory instead.`);
  }

  const maxBytes = ctx.config().maxReadBytes;
  const wantsWholeFile = args.start_line === undefined && args.end_line === undefined;
  if (wantsWholeFile && stat.size > maxBytes) {
    return errorResult(
      `File is too large (${stat.size} bytes, limit ${maxBytes}). ` +
        `Read it in chunks using start_line / end_line.`
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
      `The requested range is too large (limit ${maxBytes} bytes). Narrow it down.`
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
      'Note: you already read this file in full during this session and it has not changed since. ' +
      'Use the content you received earlier. To re-check one part, locate it with ' +
      'search_text and then read only that range with start_line / end_line.'
    );
  }

  if (kind === 'repeat-changed') {
    return 'Note: the content changed since you last read it, so this is a fresh read. Discard the earlier copy and use this one.';
  }

  if (wholeFile && totalLines > LARGE_FILE_LINES) {
    return (
      `Note: you read all ${totalLines} lines. That is enough to understand the structure. ` +
      'When you move on to editing, do not read it in full again - locate the spot with ' +
      'search_text and read only the range you need with start_line / end_line.'
    );
  }

  return undefined;
}
