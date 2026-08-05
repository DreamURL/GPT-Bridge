/**
 * 오류 메시지에서 워크스페이스 절대 경로를 걷어낸다.
 *
 * 예기치 못한 오류(주로 fs 오류)의 메시지에는 절대 경로가 섞여 있다.
 * 그대로 돌려주면 워크스페이스 밖의 디렉터리 구조가 모델에게 노출된다.
 * 남는 것은 루트 기준 상대 경로라 모델이 필요한 정보는 잃지 않는다.
 *
 * vscode에 의존하지 않는 별도 모듈로 둔다 — 툴 등록부(registry)에 두면
 * 테스트가 vscode를 끌어오게 된다.
 */
export function redactRoot(message: string, root: string): string {
  if (root.length === 0) {
    return message;
  }

  // 경로 구분자가 어느 쪽이든 걸리게 두 형태 모두 치환한다.
  const variants = new Set([root, root.split('\\').join('/'), root.split('/').join('\\')]);

  let out = message;
  for (const variant of variants) {
    out = out.split(variant).join('<workspace>');
  }
  return out;
}
