import * as vscode from 'vscode';

/**
 * openTextDocument / applyEdit 래퍼.
 *
 * 읽기는 반드시 이 경로를 거친다. 문서가 에디터에 열려 있고 저장되지 않았다면
 * `openTextDocument`가 **미저장 버퍼 내용**을 그대로 돌려준다. 디스크를 직접
 * 읽으면 사용자가 보고 있는 것과 다른 내용을 GPT에게 주게 된다.
 */
export async function openDocument(uri: vscode.Uri): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument(uri);
}

export interface LineRange {
  /** 1-based, 포함. */
  readonly start: number;
  /** 1-based, 포함. */
  readonly end: number;
}

/** 줄 번호를 접두사로 붙인다. edit_file이 참조할 위치를 정확히 잡게 해 준다. */
export function withLineNumbers(text: string, firstLineNumber: number): string {
  const lines = text.split('\n');
  const lastNumber = firstLineNumber + lines.length - 1;
  const width = String(lastNumber).length;

  return lines
    .map((line, index) => `${String(firstLineNumber + index).padStart(width, ' ')}│ ${line}`)
    .join('\n');
}

/** 요청한 라인 범위를 문서 길이에 맞게 잘라 낸다. */
export function clampLineRange(
  document: vscode.TextDocument,
  start: number | undefined,
  end: number | undefined
): LineRange {
  const lastLine = document.lineCount;
  const from = Math.max(1, Math.min(start ?? 1, lastLine));
  const to = Math.max(from, Math.min(end ?? lastLine, lastLine));
  return { start: from, end: to };
}

export function rangeOfLines(document: vscode.TextDocument, range: LineRange): vscode.Range {
  const startPos = new vscode.Position(range.start - 1, 0);
  const endLine = document.lineAt(range.end - 1);
  return new vscode.Range(startPos, endLine.range.end);
}

/** VS Code 진단 심각도를 문자열로. */
export function severityName(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
  }
}
