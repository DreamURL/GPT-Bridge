import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as vscode from 'vscode';
import type { ApprovalDecision, ApprovalRequest } from '../../approval/ApprovalGate';
import type { PendingPreview } from '../../approval/vscodeGate';
import type { BridgeConfig } from '../../config';
import type { PathGuard } from '../../workspace/PathGuard';
import type { ReadTracker } from '../../workspace/readTracker';
import type { Ripgrep } from '../../workspace/ripgrep';

/** 툴 호출 1건. 패널 활동 목록과 감사 로그가 함께 쓴다. */
export interface ActivityEntry {
  readonly tool: string;
  readonly detail: string;
  readonly ok: boolean;
  readonly blocked?: boolean;
  readonly durationMs: number;
}

export interface ToolContext {
  readonly guard: PathGuard;
  /** 심볼릭 링크를 해석한 워크스페이스 루트. */
  readonly root: string;
  readonly config: () => BridgeConfig;
  readonly log: vscode.LogOutputChannel;
  /** rg 바이너리를 찾지 못하면 undefined. 해당 툴은 등록되지 않는다. */
  readonly rg: Ripgrep | undefined;
  /**
   * 세션 동안의 읽기 이력. 같은 파일을 반복해서 통째로 읽는 낭비를
   * 모델에게 알려 주는 데 쓴다. 차단하지는 않는다.
   */
  readonly reads: ReadTracker;
  /** 차단된 접근 시도. 조용히 실패시키지 않고 사용자에게 알린다 (§5.5). */
  readonly onBlocked: (tool: string, reason: string, requestedPath: string) => void;
  readonly onActivity: (entry: ActivityEntry) => void;
  /**
   * 쓰기 작업 승인 (§5.4). 직렬 큐를 거치므로 모달이 겹치지 않는다.
   * preview는 'Diff 보기'를 눌렀을 때 보여 줄 내용이다.
   */
  readonly approve: (
    request: ApprovalRequest,
    preview: PendingPreview
  ) => Promise<ApprovalDecision>;
}

/**
 * SDK의 CallToolResult를 그대로 쓴다. 자체 타입을 만들면 registerTool의
 * 콜백 시그니처와 미묘하게 어긋나 캐스팅이 필요해진다.
 */
export type ToolResult = CallToolResult;

export function textResult(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

export function errorResult(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

/**
 * 파일에서 읽어 온 내용은 데이터이지 지시가 아니다.
 * 태그로 감싸 모델이 본문 속 명령문을 따라가지 않도록 한다 (project.md §5.5).
 */
export function wrapFileContent(relPath: string, body: string, attributes: string = ''): string {
  const attrs = attributes.length > 0 ? ` ${attributes}` : '';
  return `<file_content path="${escapeAttribute(relPath)}"${attrs}>\n${body}\n</file_content>`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
