import * as path from 'node:path';
import * as vscode from 'vscode';
import { z } from 'zod';
import { isListingExcluded } from '../../workspace/denyList';
import { errorResult, textResult, type ToolContext, type ToolResult } from './types';

const MAX_ENTRIES = 1000;

export const LIST_DIRECTORY_DESCRIPTION = `List files and directories in the workspace.

When to use: to see the project layout, or to find a file by name.
When not to use: to find where a string occurs, use search_text. To read a
file's contents, use read_file.

Start with depth 1 and drill into the subtrees you actually need. Listing
everything at once wastes context.

Files ignored by .gitignore and node_modules are excluded.

Parameters
  path   Path relative to the workspace root. Default "." (the root)
  depth  How deep to descend (1-3, default 1)`;

export const listDirectorySchema = {
  path: z.string().optional().describe('Path relative to the workspace root. Default "."'),
  depth: z.number().int().min(1).max(3).optional().describe('How deep to descend (1-3, default 1)')
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
      'The ripgrep binary was not found, so listing is unavailable. Rebuild and reinstall the extension.'
    );
  }

  const resolved = await ctx.guard.resolve(args.path ?? '.');
  const depth = args.depth ?? 1;

  const uri = vscode.Uri.file(resolved.absolute);
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.Directory) {
      return errorResult(`${resolved.relative} is not a directory. Use read_file instead.`);
    }
  } catch {
    return errorResult(`Directory not found: ${resolved.relative || '.'}`);
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
    return textResult(`${base || '.'} - nothing to show.`);
  }

  const lines = withSizes.map((entry) =>
    entry.isDirectory
      ? `  dir   ${entry.name}/  (${entry.childCount} item(s))`
      : `  file  ${entry.name}  ${entry.size ?? '?'}B`
  );

  const notes: string[] = [];
  if (outcome.truncated || directChildren.size > MAX_ENTRIES) {
    notes.push(`Too many entries - only the first ${MAX_ENTRIES} are shown.`);
  }
  if (hiddenByRules > 0) {
    notes.push(`${hiddenByRules} item(s) hidden by exclusion rules (node_modules / deny list).`);
  }

  const header = `${base || '.'} (depth=${depth}, ${withSizes.length} item(s))`;
  return textResult([header, ...lines, ...notes.map((note) => `\n${note}`)].join('\n'));
}
