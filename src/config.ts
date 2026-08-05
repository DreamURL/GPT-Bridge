import * as vscode from 'vscode';

export const CONFIG_SECTION = 'gptBridge';

export type ApprovalMode = 'always' | 'session' | 'pattern';
export type TunnelProvider = 'cloudflare' | 'none';

export interface BridgeConfig {
  readonly port: number;
  readonly autoStart: boolean;
  readonly tunnelProvider: TunnelProvider;
  readonly approvalMode: ApprovalMode;
  readonly autoApprovePatterns: readonly string[];
  readonly approvalTimeoutSeconds: number;
  readonly autoSave: boolean;
  readonly denyExtraPatterns: readonly string[];
  readonly maxReadBytes: number;
}

function isApprovalMode(value: string): value is ApprovalMode {
  return value === 'always' || value === 'session' || value === 'pattern';
}

function isTunnelProvider(value: string): value is TunnelProvider {
  return value === 'cloudflare' || value === 'none';
}

function stringArray(value: readonly unknown[]): string[] {
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/**
 * 설정을 읽어 타입이 확정된 형태로 반환한다.
 *
 * settings.json은 사용자가 직접 편집할 수 있어 enum 값이 스키마를 벗어날 수
 * 있다. 잘못된 값은 조용히 기본값으로 되돌린다 — 특히 approvalMode가 깨졌을 때
 * 자동 승인 쪽으로 넘어가면 안 되므로 always로 떨어뜨린다.
 */
export function readConfig(): BridgeConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);

  const rawApprovalMode = cfg.get<string>('approval.mode', 'always');
  const rawProvider = cfg.get<string>('tunnel.provider', 'cloudflare');

  return {
    port: cfg.get<number>('port', 3737),
    autoStart: cfg.get<boolean>('autoStart', false),
    tunnelProvider: isTunnelProvider(rawProvider) ? rawProvider : 'cloudflare',
    approvalMode: isApprovalMode(rawApprovalMode) ? rawApprovalMode : 'always',
    autoApprovePatterns: stringArray(cfg.get<unknown[]>('approval.autoApprovePatterns', [])),
    approvalTimeoutSeconds: cfg.get<number>('approval.timeoutSeconds', 90),
    autoSave: cfg.get<boolean>('autoSave', false),
    denyExtraPatterns: stringArray(cfg.get<unknown[]>('deny.extraPatterns', [])),
    maxReadBytes: cfg.get<number>('maxReadBytes', 1048576)
  };
}

/** gptBridge.* 설정이 바뀌었을 때만 콜백을 호출한다. */
export function onConfigChange(listener: (config: BridgeConfig) => void): vscode.Disposable {
  return vscode.workspace.onDidChangeConfiguration((event) => {
    if (event.affectsConfiguration(CONFIG_SECTION)) {
      listener(readConfig());
    }
  });
}
