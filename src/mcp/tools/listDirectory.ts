import * as path from 'node:path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { isListingExcluded } from '../../workspace/denyList';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';

const MAX_ENTRIES = 1000;

export const LIST_DIRECTORY_DESCRIPTION = `워크스페이스의 파일·디렉터리 목록을 본다.

언제 쓰나: 프로젝트 구조를 파악할 때, 파일 이름을 정확히 모를 때.

언제 쓰지 않나: 파일 내용이 필요하면 read_file, 특정 문자열을 찾으려면
search_text를 쓴다. 목록을 훑어 내용을 추측하지 말 것.

.gitignore에 등재된 파일과 node_modules는 결과에서 제외된다.
자격증명 파일(.env, id_rsa 등)도 노출되지 않는다.

파라미터
  path   루트 기준 상대 경로. 기본값 "." (루트)
  depth  하위 몇 단계까지 볼지. 1~3, 기본 1`;

export const listDirectorySchema = {
  path: z.string().optional().describe('루트 기준 상대 경로. 기본 "."'),
  depth: z.number().int().min(1).max(3).optional().describe('하위 탐색 깊이 (1~3, 기본 1)')
};

export interface ListDirectoryArgs {
  path?: string | undefined;
  depth?: number | undefined;
}

interface Entry {
  readonly name: string;
  readonly isDirectory: boolean;
  readonly size: number | undefined;
  readonly childCount: number;
}

export async function listDirectoryTool(
  ctx: ToolContext,
  args: ListDirectoryArgs
): Promise<ToolResult> {
  if (ctx.rg === undefined) {
    return errorResult(
      'ripgrep 바이너리를 찾을 수 없어 목록 기능을 사용할 수 없습니다. 확장을 다시 설치하세요.'
    );
  }

  const resolved = await ctx.guard.resolve(args.path ?? '.');
  const depth = args.depth ?? 1;

  const uri = vscode.Uri.file(resolved.absolute);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.Directory) {
      return errorResult(`${resolved.relative}은(는) 디렉터리가 아닙니다. read_file을 사용하세요.`);
    }
  } catch {
    return errorResult(`디렉터리를 찾을 수 없습니다: ${resolved.relative || '.'}`);
  }

  // rg --files는 .gitignore를 존중한다. workspace.findFiles는 존중하지 않는다.
  const outcome = await ctx.rg.listFiles(ctx.root, {
    relativeDir: resolved.relative,
    limit: MAX_ENTRIES * 20
  });

  const base = resolved.relative;
  const directChildren = new Map<string, Entry>();
  let hiddenByRules = 0;

  for (const file of outcome.files) {
    const relToBase = base === '' ? file : file.slice(base.length + 1);
    if (relToBase.length === 0) {
      continue;
    }

    if (isListingExcluded(file) || ctx.guard.deny.isDenied(file)) {
      hiddenByRules += 1;
      continue;
    }

    const segments = relToBase.split('/');
    const visible = segments.slice(0, depth);
    const isDirectory = segments.length > depth;
    const key = visible.join('/');

    const existing = directChildren.get(key);
    if (existing !== undefined) {
      directChildren.set(key, { ...existing, childCount: existing.childCount + 1 });
      continue;
    }

    directChildren.set(key, {
      name: key,
      isDirectory,
      size: undefined,
      childCount: isDirectory ? 1 : 0
    });
  }

  const entries = [...directChildren.values()]
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    })
    .slice(0, MAX_ENTRIES);

  const withSizes = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory) {
        return entry;
      }
      try {
        const stat = await vscode.workspace.fs.stat(
          vscode.Uri.file(path.join(ctx.root, base === '' ? entry.name : `${base}/${entry.name}`))
        );
        return { ...entry, size: stat.size };
      } catch {
        return entry;
      }
    })
  );

  if (withSizes.length === 0) {
    return textResult(`${base || '.'} — 표시할 항목이 없습니다.`);
  }

  const lines = withSizes.map((entry) =>
    entry.isDirectory
      ? `  dir   ${entry.name}/  (${entry.childCount}개 항목)`
      : `  file  ${entry.name}  ${entry.size ?? '?'}B`
  );

  const notes: string[] = [];
  if (outcome.truncated || directChildren.size > MAX_ENTRIES) {
    notes.push(`항목이 많아 ${MAX_ENTRIES}개까지만 표시했습니다.`);
  }
  if (hiddenByRules > 0) {
    notes.push(`${hiddenByRules}개 항목이 제외 규칙(node_modules·거부 목록)으로 숨겨졌습니다.`);
  }

  const header = `${base || '.'} (depth=${depth}, ${withSizes.length}개 항목)`;
  return textResult([header, ...lines, ...notes.map((note) => `\n${note}`)].join('\n'));
}
