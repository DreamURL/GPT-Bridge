import * as crypto from 'node:crypto';
import type * as vscode from 'vscode';

/**
 * 토큰은 settings.json이 아니라 SecretStorage에 둔다 (project.md §3).
 * settings.json은 평문이고 Settings Sync·git 커밋으로 새어 나간다.
 */
const AUTH_TOKEN_KEY = 'gptBridge.authToken';
const TUNNEL_TOKEN_KEY = 'gptBridge.tunnelToken';

export class SecretStore {
  constructor(private readonly secrets: vscode.SecretStorage) {}

  async getAuthToken(): Promise<string | undefined> {
    return this.secrets.get(AUTH_TOKEN_KEY);
  }

  /** 없으면 생성해서 저장한다. 이미 있으면 그대로 돌려준다. */
  async ensureAuthToken(): Promise<string> {
    const existing = await this.getAuthToken();
    if (existing !== undefined && existing.length > 0) {
      return existing;
    }
    return this.regenerateAuthToken();
  }

  /** 새 토큰으로 교체한다. 기존 토큰은 즉시 무효가 된다. */
  async regenerateAuthToken(): Promise<string> {
    const token = crypto.randomBytes(32).toString('hex');
    await this.secrets.store(AUTH_TOKEN_KEY, token);
    return token;
  }

  async getTunnelToken(): Promise<string | undefined> {
    return this.secrets.get(TUNNEL_TOKEN_KEY);
  }

  async setTunnelToken(token: string): Promise<void> {
    await this.secrets.store(TUNNEL_TOKEN_KEY, token);
  }

  async clearTunnelToken(): Promise<void> {
    await this.secrets.delete(TUNNEL_TOKEN_KEY);
  }
}

/** 로그·UI 표시용. 원문 토큰을 그대로 출력하지 않는다. */
export function maskToken(token: string): string {
  if (token.length <= 8) {
    return '•'.repeat(token.length);
  }
  return `${token.slice(0, 4)}${'•'.repeat(8)}${token.slice(-4)}`;
}
