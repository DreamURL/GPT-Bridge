import { z } from 'zod';
import { isListingExcluded } from '../../workspace/denyList';
import type { SearchTruncation } from '../../workspace/ripgrep';
import { errorResult, textResult, wrapFileContent, type ToolContext, type ToolResult } from './types';

export const SEARCH_TEXT_DESCRIPTION = `워크스페이스 전체에서 텍스트를 찾는다.

언제 쓰나: 심볼·함수·문자열이 어디에 있는지 모를 때. 파일을 하나씩 열어 보는
대신 이 툴로 위치를 먼저 특정한다. **이미 읽은 파일을 다시 통째로 읽는 대신
이 툴로 고칠 지점을 찾는 것이 훨씬 싸다.**

언제 쓰지 않나: 파일 경로를 이미 아는 경우에는 read_file이 낫다.
파일 이름 자체를 찾을 때는 list_directory를 쓴다.

호출 순서: search_text로 위치 확인 → read_file로 그 범위만 확인 → edit_file

검색은 대소문자를 구분한다. .gitignore 등재 파일과 node_modules는 제외된다.

결과가 상한에 걸리면 **전체 몇 건 중 몇 건인지** 함께 알려 준다. 찾던 것이
안 보이는데 "전체 N건 중 일부"라고 나왔다면 아직 못 본 매치가 있다는 뜻이다.
그때는 include로 좁히거나 max_results를 올려 다시 부른다.

파라미터
  query          찾을 문자열. 기본은 정규식이 아니라 그대로 매칭한다.
  is_regex       true면 정규식으로 해석한다. 기본 false
  include        대상을 좁히는 glob. 예: "src/**/*.ts"
  max_results    최대 매치 수. 기본 50, 최대 500.
                 흔한 단어를 찾을 때는 올리기 전에 include로 좁히는 편이 싸다.
  context_lines  매치 줄 앞뒤로 함께 볼 줄 수. 0~5, 기본 2.
                 **위치만 알면 될 때는 0을 쓴다.** 매치가 많을수록 차이가 크다.`;

export const searchTextSchema = {
  query: z.string().min(1).describe('찾을 문자열. 예: "createServer"'),
  is_regex: z.boolean().optional().describe('true면 정규식으로 해석한다. 기본 false'),
  include: z.string().optional().describe('대상을 좁히는 glob. 예: "src/**/*.ts"'),
  max_results: z
    .number()
    .int()
    .min(1)
    .max(500)
    .optional()
    .describe('최대 매치 수. 기본 50, 최대 500'),
  context_lines: z
    .number()
    .int()
    .min(0)
    .max(5)
    .optional()
    .describe('매치 줄 앞뒤 줄 수. 0~5, 기본 2. 위치만 알면 될 때는 0')
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
      'ripgrep 바이너리를 찾을 수 없어 검색 기능을 사용할 수 없습니다. 확장을 다시 설치하세요.'
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
    const parts = [`"${args.query}"에 대한 매치가 없습니다.`];
    if (suppressed > 0) {
      parts.push(`(${suppressed}개 파일은 접근이 차단되어 제외됨)`);
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
    notes.push(`${suppressed}개 파일은 접근이 차단되어 제외했습니다.`);
  }

  const scope =
    outcome.truncation === 'none'
      ? `${visible.length}개 파일에서 ${shown}건 매치`
      : `전체 ${totalLabel(outcome.truncation, outcome.totalMatches)} 중 ${shown}건 표시, ${visible.length}개 파일`;

  const header = `"${args.query}" — ${scope} ('>' 표시가 매치 줄)`;
  return textResult([header, ...rendered, ...notes].join('\n\n'));
}

/** rg를 끊은 경우 전체 건수는 하한일 뿐이다. 확정된 값처럼 보이면 안 된다. */
function totalLabel(truncation: SearchTruncation, total: number): string {
  return truncation === 'limit' ? `${total}건` : `${total}건 이상`;
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
        `전체 ${total}건 중 ${shown}건만 보여 줍니다. 찾던 것이 없다면 아직 못 본 ` +
        `매치가 ${total - shown}건 남아 있습니다. include로 대상을 좁히거나 ` +
        `max_results를 올리세요(최대 500).`
      );
    case 'timeout':
      return (
        '검색이 10초를 넘겨 중단했습니다. 결과가 불완전하며 남은 건수를 알 수 없습니다. ' +
        'include로 대상을 좁혀 다시 부르세요. max_results를 올려도 해결되지 않습니다.'
      );
    case 'output':
      return (
        '출력이 너무 커서 검색을 중단했습니다. 결과가 불완전하며 남은 건수를 알 수 없습니다. ' +
        'context_lines를 0으로 낮추거나 include로 대상을 좁히세요.'
      );
  }
}
