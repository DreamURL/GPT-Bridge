import * as path from 'node:path';
import * as vscode from 'vscode';
import { isListingExcluded } from '../../workspace/denyList';
import { textResult, type ToolContext, type ToolResult } from './types';

const FILE_SCAN_LIMIT = 20_000;
const TOP_LANGUAGES = 6;
const MAX_OPEN_TABS = 20;

export const GET_WORKSPACE_INFO_DESCRIPTION = `현재 열려 있는 워크스페이스의 개요를 반환한다.
루트 폴더명, 파일 수, 주요 언어, 열린 편집기 목록, 활성 파일과 선택 영역,
진단 요약(에러/경고 개수)을 한 번에 준다.

**코드 작업을 시작할 때 가장 먼저 호출할 것.** 어떤 프로젝트인지, 사용자가 지금
어떤 파일을 보고 있는지 모른 채 파일을 뒤지지 말 것. 인자는 없다.

언제 쓰지 않나: 이미 개요를 알고 있는 후속 턴에서 반복 호출할 필요는 없다.

호출 순서: get_workspace_info → list_directory / search_text → read_file → edit_file`;

const EXTENSION_LANGUAGES: Readonly<Record<string, string>> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.mjs': 'JavaScript',
  '.cjs': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.rb': 'Ruby',
  '.php': 'PHP',
  '.cs': 'C#',
  '.c': 'C',
  '.h': 'C/C++ 헤더',
  '.cpp': 'C++',
  '.swift': 'Swift',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.html': 'HTML',
  '.vue': 'Vue',
  '.svelte': 'Svelte',
  '.json': 'JSON',
  '.md': 'Markdown',
  '.yml': 'YAML',
  '.yaml': 'YAML',
  '.sql': 'SQL',
  '.sh': 'Shell'
};

export async function getWorkspaceInfoTool(ctx: ToolContext): Promise<ToolResult> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (folder === undefined) {
    return textResult('열린 워크스페이스 폴더가 없습니다. VS Code에서 폴더를 먼저 여세요.');
  }

  const sections: string[] = [`워크스페이스: ${folder.name}`];

  // ── 파일 수 / 주요 언어 ──────────────────────────────────────────
  if (ctx.rg === undefined) {
    sections.push('파일 통계: ripgrep 바이너리를 찾지 못해 사용할 수 없습니다.');
  } else {
    const outcome = await ctx.rg.listFiles(ctx.root, { relativeDir: '', limit: FILE_SCAN_LIMIT });
    const counted = outcome.files.filter(
      (file) => !isListingExcluded(file) && !ctx.guard.deny.isDenied(file)
    );

    const byLanguage = new Map<string, number>();
    for (const file of counted) {
      const language = EXTENSION_LANGUAGES[path.extname(file).toLowerCase()];
      if (language !== undefined) {
        byLanguage.set(language, (byLanguage.get(language) ?? 0) + 1);
      }
    }

    const top = [...byLanguage.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_LANGUAGES)
      .map(([language, count]) => `${language} ${count}`);

    const suffix = outcome.truncated ? '+' : '';
    sections.push(`파일 수: ${counted.length}${suffix}개 (.gitignore·node_modules 제외)`);
    sections.push(`주요 언어: ${top.length > 0 ? top.join(', ') : '판별 불가'}`);
  }

  // ── 열린 편집기 ─────────────────────────────────────────────────
  const openPaths: string[] = [];
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input: unknown = tab.input;
      if (
        typeof input === 'object' &&
        input !== null &&
        'uri' in input &&
        (input as { uri: vscode.Uri }).uri.scheme === 'file'
      ) {
        const relative = toRelative(ctx.root, (input as { uri: vscode.Uri }).uri.fsPath);
        if (relative !== undefined && !ctx.guard.deny.isDenied(relative)) {
          openPaths.push(tab.isDirty ? `${relative} (미저장)` : relative);
        }
      }
    }
  }

  sections.push(
    openPaths.length > 0
      ? `열린 편집기 (${openPaths.length}개):\n${openPaths
          .slice(0, MAX_OPEN_TABS)
          .map((entry) => `  - ${entry}`)
          .join('\n')}`
      : '열린 편집기: 없음'
  );

  // ── 활성 파일과 선택 영역 ────────────────────────────────────────
  const editor = vscode.window.activeTextEditor;
  if (editor === undefined) {
    sections.push('활성 파일: 없음');
  } else {
    const relative = toRelative(ctx.root, editor.document.uri.fsPath);
    if (relative === undefined || ctx.guard.deny.isDenied(relative)) {
      sections.push('활성 파일: 워크스페이스 외부이거나 접근이 차단된 파일');
    } else {
      const selection = editor.selection;
      const position = selection.isEmpty
        ? `커서 ${selection.active.line + 1}행`
        : `선택 ${selection.start.line + 1}–${selection.end.line + 1}행`;
      const dirty = editor.document.isDirty ? ', 미저장' : '';
      sections.push(`활성 파일: ${relative} (${position}${dirty})`);
    }
  }

  // ── 진단 요약 ───────────────────────────────────────────────────
  let errors = 0;
  let warnings = 0;
  for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
    if (uri.scheme !== 'file' || toRelative(ctx.root, uri.fsPath) === undefined) {
      continue;
    }
    for (const diagnostic of diagnostics) {
      if (diagnostic.severity === vscode.DiagnosticSeverity.Error) {
        errors += 1;
      } else if (diagnostic.severity === vscode.DiagnosticSeverity.Warning) {
        warnings += 1;
      }
    }
  }
  sections.push(`진단: 에러 ${errors}개, 경고 ${warnings}개 (자세히는 get_diagnostics)`);

  return textResult(sections.join('\n'));
}

/** 워크스페이스 밖이면 undefined. */
function toRelative(root: string, fsPath: string): string | undefined {
  const relative = path.relative(root, fsPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.split(path.sep).join('/');
}
