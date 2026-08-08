import { z } from 'zod';
import { isListingExcluded } from '../../workspace/denyList';
import type { SearchTruncation } from '../../workspace/ripgrep';
import { errorResult, textResult, wrapFileContent, type ToolContext, type ToolResult } from './types';

export const SEARCH_TEXT_DESCRIPTION = `Search for text across the whole workspace.

When to use: when you do not know where a symbol, function or string lives.
Locate it with this instead of opening files one by one. **It is far cheaper to
find the spot with this tool than to re-read a whole file you already read.**

When not to use: if you already know the path, read_file is better. To find a
file by name, use list_directory.

Call order: search_text to locate -> read_file for that range -> edit_file

The search is case-sensitive. Files ignored by .gitignore and node_modules are excluded.

If the result hits a limit, the response tells you **how many matches there are
in total**. If what you were looking for is missing and the header says only
part of the total is shown, there are matches you have not seen: narrow the
search with include, or raise max_results and call again.

Parameters
  query          Text to find. Treated literally, not as a regex, by default.
  is_regex       true to interpret query as a regular expression. Default false
  include        Glob narrowing the search. Example: "src/**/*.ts"
  max_results    Maximum matches. Default 50, max 500.
                 For a common word, narrowing with include is cheaper than raising this.
  context_lines  Lines of context around each match. 0-5, default 2.
                 **Use 0 when you only need the location.** The difference grows
                 with the number of matches.`;

export const searchTextSchema = {
  query: z.string().min(1).describe('Text to find. Example: "createServer"'),
  is_regex: z.boolean().optional().describe('true to interpret query as a regular expression. Default false'),
  include: z.string().optional().describe('Glob narrowing the search. Example: "src/**/*.ts"'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('Maximum matches. Default 50, max 500'),
  context_lines: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe('Lines of context around each match. 0-5, default 2. Use 0 when you only need the location')
};

export interface SearchTextArgs {
  query: string;
  is_regex?: boolean | undefined;
  include?: string | undefined;
  max_results?: number | undefined;
  context_lines?: number | undefined;
}

export async function searchTextTool(ctx: ToolContext, args: SearchTextArgs): Promise<ToolResult> {
  if (ctx.rg === undefined) {
    return errorResult(
      'The ripgrep binary was not found, so search is unavailable. Rebuild and reinstall the extension.'
    );
  }

  const outcome = await ctx.rg.search(ctx.root, {
    query: args.query,
    isRegex: args.is_regex ?? false,
    include: args.include,
    maxResults: args.max_results ?? 50,
    contextLines: args.context_lines ?? 2
  });

  // 거부 목록·node_modules에 걸린 파일은 검색 결과에서도 제외한다.
  // rg가 읽을 수 있더라도 내용이 모델에게 넘어가면 안 된다.
  const visible = outcome.blocks.filter(
    (block) => !ctx.guard.deny.isDenied(block.path) && !isListingExcluded(block.path)
  );
  const suppressed = outcome.blocks.length - visible.length;

  if (visible.length === 0) {
    const parts = [`No matches for "${args.query}".`];
    if (suppressed > 0) {
      parts.push(`(${suppressed} file(s) excluded because access is blocked)`);
    }
    // 잘린 채로 0건이면 "없다"가 아니라 "여기까지는 없다"이다. 구분해야 한다.
    const cut = truncationNote(outcome.truncation, outcome.totalMatches, 0);
    if (cut !== undefined) {
      parts.push(cut);
    }
    return textResult(parts.join(' '));
  }

  const rendered = visible.map((block) => {
    const width = String(Math.max(...block.lines.map((line) => line.number))).length;
    const body = block.lines
      .map((line) => {
        const marker = line.isMatch ? '>' : ' ';
        return `${marker}${String(line.number).padStart(width, ' ')}│ ${line.text}`;
      })
      .join('\n');
    return wrapFileContent(block.path, body);
  });

  // 화면에 실제로 찍힌 매치 줄을 센다. outcome.matchCount는 차단된 파일의
  // 매치까지 포함하므로 그대로 쓰면 보이는 것보다 큰 수를 보고하게 된다.
  const shown = visible.reduce(
    (sum, block) => sum + block.lines.filter((line) => line.isMatch).length,
    0
  );

  const notes: string[] = [];
  const cut = truncationNote(outcome.truncation, outcome.totalMatches, shown);
  if (cut !== undefined) {
    notes.push(cut);
  }
  if (suppressed > 0) {
    notes.push(`${suppressed} file(s) excluded because access is blocked.`);
  }

  const scope =
    outcome.truncation === 'none'
      ? `${shown} match(es) in ${visible.length} file(s)`
      : `showing ${shown} of ${totalLabel(outcome.truncation, outcome.totalMatches)} match(es) across ${visible.length} file(s)`;

  const header = `"${args.query}" - ${scope} ('>' marks matching lines)`;
  return textResult([header, ...rendered, ...notes].join('\n\n'));
}

/** rg를 끊은 경우 전체 건수는 하한일 뿐이다. 확정된 값처럼 보이면 안 된다. */
function totalLabel(truncation: SearchTruncation, total: number): string {
  return truncation === 'limit' ? `${total}` : `${total}+`;
}

/**
 * 잘린 이유별 안내. **원인마다 해결책이 반대라서 문구를 나눈다.**
 * 상한은 max_results를 올리면 풀리지만, 타임아웃·출력 초과는 올릴수록 나빠진다.
 * 하나로 뭉쳐 "max_results로 조정하세요"라고 하면 틀린 조언이 된다.
 */
function truncationNote(
  truncation: SearchTruncation,
  total: number,
  shown: number
): string | undefined {
  switch (truncation) {
    case 'none':
      return undefined;
    case 'limit':
      return (
        `Showing ${shown} of ${total} matches. If what you wanted is missing, ` +
        `${total - shown} match(es) remain unseen. Narrow the search with include, ` +
        `or raise max_results (max 500).`
      );
    case 'timeout':
      return (
        'The search was stopped after 10 seconds. Results are incomplete and the remaining count is unknown. ' +
        'Narrow it with include and call again. Raising max_results will not help.'
      );
    case 'output':
      return (
        'The search was stopped because the output grew too large. Results are incomplete and the remaining count is unknown. ' +
        'Lower context_lines to 0, or narrow the search with include.'
      );
  }
}
