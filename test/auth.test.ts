import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractBearerToken, timingSafeEqualString } from '../src/mcp/auth';

describe('Bearer 토큰 파싱', () => {
  it('정상 헤더에서 토큰을 꺼낸다', () => {
    assert.equal(extractBearerToken('Bearer abc123'), 'abc123');
    assert.equal(extractBearerToken('bearer abc123'), 'abc123');
    assert.equal(extractBearerToken('BEARER   abc123  '), 'abc123');
    assert.equal(extractBearerToken('  Bearer abc123'), 'abc123');
  });

  it('형식이 아니면 undefined', () => {
    assert.equal(extractBearerToken(undefined), undefined);
    assert.equal(extractBearerToken(''), undefined);
    assert.equal(extractBearerToken('abc123'), undefined);
    assert.equal(extractBearerToken('Basic abc123'), undefined);
    assert.equal(extractBearerToken('Bearer'), undefined);
    assert.equal(extractBearerToken('Bearer '), undefined);
  });
});

describe('상수 시간 비교', () => {
  it('같은 값은 true', () => {
    assert.equal(timingSafeEqualString('abc', 'abc'), true);
    assert.equal(timingSafeEqualString('', ''), true);
  });

  it('다른 값은 false', () => {
    assert.equal(timingSafeEqualString('abc', 'abd'), false);
  });

  it('길이가 다르면 예외 없이 false', () => {
    // timingSafeEqual은 길이가 다르면 던진다. 선체크가 빠지면 여기서 터진다.
    assert.equal(timingSafeEqualString('abc', 'abcd'), false);
    assert.equal(timingSafeEqualString('', 'a'), false);
  });

  it('멀티바이트 문자에서도 던지지 않는다', () => {
    assert.equal(timingSafeEqualString('토큰', '토큰'), true);
    assert.equal(timingSafeEqualString('토큰', 'ab'), false);
  });
});
