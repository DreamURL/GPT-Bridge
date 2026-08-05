import * as crypto from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * 길이를 먼저 확인한 뒤 timingSafeEqual로 비교한다 (project.md §5.1).
 *
 * timingSafeEqual은 길이가 다르면 예외를 던지므로 선체크가 필요하다.
 * 길이 자체는 노출되지만 토큰 길이는 고정이라 정보량이 없다.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/** `Authorization: Bearer <token>`에서 토큰만 꺼낸다. 형식이 아니면 undefined. */
export function extractBearerToken(header: string | undefined): string | undefined {
  if (typeof header !== 'string') {
    return undefined;
  }
  const match = /^Bearer[ \t]+(.+)$/i.exec(header.trim());
  if (match === null) {
    return undefined;
  }
  const token = match[1]?.trim();
  return token === undefined || token.length === 0 ? undefined : token;
}

export type AuthFailureReason = 'missing' | 'malformed' | 'mismatch' | 'no-token-configured';

export interface AuthOptions {
  /** 현재 유효한 토큰. 서버가 아직 토큰을 못 만들었으면 undefined. */
  readonly getToken: () => string | undefined;
  /** 실패를 감사 로그·UI로 흘려보내기 위한 훅. */
  readonly onFailure?: (reason: AuthFailureReason, remoteAddress: string | undefined) => void;
}

/**
 * Bearer 인증 미들웨어.
 *
 * 실패는 전부 동일한 401 본문을 반환한다. 사유를 구분해서 알려주면
 * 토큰 존재 여부를 탐색할 수 있는 단서가 된다.
 */
export function createBearerAuth(options: AuthOptions): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const expected = options.getToken();
    const presented = extractBearerToken(req.headers.authorization);

    let reason: AuthFailureReason | undefined;
    if (expected === undefined || expected.length === 0) {
      reason = 'no-token-configured';
    } else if (req.headers.authorization === undefined) {
      reason = 'missing';
    } else if (presented === undefined) {
      reason = 'malformed';
    } else if (!timingSafeEqualString(presented, expected)) {
      reason = 'mismatch';
    }

    if (reason !== undefined) {
      options.onFailure?.(reason, req.socket.remoteAddress ?? undefined);
      res.status(401).set('WWW-Authenticate', 'Bearer').json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized' },
        id: null
      });
      return;
    }

    next();
  };
}
