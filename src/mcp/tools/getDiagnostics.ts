import * as path from 'node:path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { severityName } from '../../workspace/documents';
import { textResult, type ToolContext, type ToolResult } from './types';

const MAX_ITEMS = 200;

export const GET_DIAGNOSTICS_DESCRIPTION = `현재 워크스페이스의 타입 에러·린트 경고를 읽는다.
VS Code의 언어 서버(TypeScript, ESLint 등)가 실제로 보고하고 있는 내용이다.

언제 쓰나: 파일을 수정한 직후에 **반드시**. 수정이 새 에러를 만들지 않았는지
여기서 확인한다. 확인 없이 작업을 끝내지 말 것.
작업을 시작할 때 기존 문제를 파악하는 용도로도 쓴다.

언제 쓰지 않나: 코드를 실행해 봐야 아는 런타임 오류는 여기 나오지 않는다.

호출 순서: edit_file → get_diagnostics → (에러가 있으면) read_file → edit_file

진단 정보는 언어 서버가 갱신하는 데 잠깐 시간이 걸린다. 수정 직후 결과가
비어 있으면 한 번 더 호출해 볼 것.

파라미터
  path      특정 파일만 볼 때 지정. 생략하면 워크스페이스 전체
  severity  "error" | "warning" | "all". 기본 "all"`;

export const getDiagnosticsSchema = {
  path: z.string().optional().describe('특정 파일만 볼 때 지정. 생략하면 워크스페이스 전체'),
  severity: z
    .enum(['error', 'warning', 'all'])
    .optional()
    .describe('"error"는 에러만, "warning"은 경고 이상, "all"은 전부. 기본 "all"')
};

export interface GetDiagnosticsArgs {
  path?: string | undefined;
  severity?: 'error' | 'warning' | 'all' | undefined;
}

function includeSeverity(
  severity: vscode.DiagnosticSeverity,
  filter: 'error' | 'warning' | 'all'
): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'error') {
    return severity === vscode.DiagnosticSeverity.Error;
  }
  return (
    severity === vscode.DiagnosticSeverity.Error || severity === vscode.DiagnosticSeverity.Warning
  );
}

export async function getDiagnosticsTool(
  ctx: ToolContext,
  args: GetDiagnosticsArgs
): Promise<ToolResult> {
  const filter = args.severity ?? 'all';

  let entries: Array<[vscode.Uri, readonly vscode.Diagnostic[]]>;
  if (args.path !== undefined) {
    const resolved = await ctx.guard.resolve(args.path);
    const uri = vscode.Uri.file(resolved.absolute);
    entries = [[uri, vscode.languages.getDiagnostics(uri)]];
  } else {
    entries = vscode.languages.getDiagnostics();
  }

  const lines: string[] = [];
  let errorCount = 0;
  let warningCount = 0;
  let shown = 0;
  let truncated = false;

  for (const [uri, diagnostics] of entries) {
    if (uri.scheme !== 'file') {
      continue;
    }

    const relative = path.relative(ctx.root, uri.fsPath).split(path.sep).join('/');
    // 워크스페이스 밖 파일이나 거부 목록 파일의 진단은 내보내지 않는다.
    if (relative.startsWith('..') || path.isAbsolute(relative) || ctx.guard.deny.isDenied(relative)) {
      continue;
    }

    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
        errorCount += 1;
      } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
        warningCount += 1;
      }

      if (!includeSeverity(diagnostic.severity, filter)) {
        continue;
      }
      if (shown >= MAX_ITEMS) {
        truncated = true;
        continue;
      }
      shown += 1;

      const line = diagnostic.range.start.line + 1;
      const column = diagnostic.range.start.character + 1;
      const source = diagnostic.source ?? '?';
      const code =
        typeof diagnostic.code === 'object' && diagnostic.code !== null
          ? String(diagnostic.code.value)
          : diagnostic.code !== undefined
            ? String(diagnostic.code)
            : '';
      const codePart = code.length > 0 ? ` ${code}` : '';

      lines.push(
        `${relative}:${line}:${column}  ${severityName(diagnostic.severity)}  [${source}${codePart}]  ${diagnostic.message}`
      );
    }
  }

  const scope = args.path ?? '워크스페이스 전체';
  const summary = `${scope} — 에러 ${errorCount}개, 경고 ${warningCount}개`;

  if (lines.length === 0) {
    return textResult(`${summary}\n표시할 진단이 없습니다.`);
  }

  const notes = truncated ? [`\n${MAX_ITEMS}개까지만 표시했습니다. path로 범위를 좁히세요.`] : [];
  return textResult([summary, '', ...lines, ...notes].join('\n'));
}
