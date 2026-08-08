import * as path from 'node:path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { severityName } from '../../workspace/documents';
import { textResult, type ToolContext, type ToolResult } from './types';

const MAX_ITEMS = 200;

export const GET_DIAGNOSTICS_DESCRIPTION = `Read type errors and lint warnings for the workspace.

**Call this after every edit** to confirm you did not introduce new errors.
This is what makes editing here different from editing blind: the language
server has already checked the code, so you can fix problems immediately.

When to use: right after edit_file or write_file, and when the user asks what
is broken.

Call order: edit_file -> get_diagnostics -> fix anything new

Parameters
  path      Limit to one file. Omit for the whole workspace.
  severity  "error" | "warning" | "all". Default "all"`;

export const getDiagnosticsSchema = {
  path: z.string().optional().describe('Limit to one file. Omit for the whole workspace'),
  severity: z
    .enum(['error', 'warning', 'all'])
    .optional()
    .describe('"error" for errors only, "warning" for warnings and above, "all" for everything. Default "all"')
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

  const scope = args.path ?? 'the whole workspace';
  const summary = `${scope} - ${errorCount} error(s), ${warningCount} warning(s)`;

  if (lines.length === 0) {
    return textResult(`${summary}\nNo diagnostics to report.`);
  }

  const notes = truncated ? [`\nOnly the first ${MAX_ITEMS} are shown. Narrow the scope with path.`] : [];
  return textResult([summary, '', ...lines, ...notes].join('\n'));
}
