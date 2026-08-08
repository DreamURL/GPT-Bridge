/**
 * 빌드된 .vsix를 로컬 VS Code에 설치한다.
 *
 * `npm run setup` 이 package → 이 스크립트 순으로 부른다. 새 PC에서
 * `git clone` 다음에 두 줄이면 끝나게 하려는 것이 목적이다.
 *
 * .vsix를 저장소에 커밋하거나 릴리스로 배포하지 않는 이유는 §2.1이다.
 * ripgrep 바이너리가 플랫폼별 패키지로 갈라져 있고 npm은 설치하는 기기의 것만
 * 내려받으므로, .vsix는 만든 OS/아키텍처에서만 검색이 동작한다. 그래서 각
 * 기기에서 직접 빌드하는 경로만 지원한다.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const vsix = join(root, `${pkg.name}-${pkg.version}.vsix`);

if (!existsSync(vsix)) {
  console.error(`\n  Could not find ${pkg.name}-${pkg.version}.vsix`);
  console.error('  Build it first:  npm run package\n');
  process.exit(1);
}

// Windows에서 code는 code.cmd라 shell 경유가 필요하다.
const shell = process.platform === 'win32';

try {
  execFileSync('code', ['--install-extension', vsix, '--force'], {
    stdio: 'inherit',
    shell,
    cwd: root
  });
} catch {
  // `code`가 PATH에 없는 것이 대부분이다. 설치 자체는 GUI로도 되므로
  // 실패를 막다른 길로 만들지 않는다.
  console.error('\n  ------------------------------------------------------------');
  console.error('  Automatic install failed. The "code" command was probably not found.');
  console.error('');
  console.error('  You can install it from the VS Code UI instead:');
  console.error('    Extensions panel -> ... (top right) -> Install from VSIX ->');
  console.error(`    ${vsix}`);
  console.error('');
  console.error('  To enable the "code" command, run Ctrl+Shift+P in VS Code:');
  console.error("    \"Shell Command: Install 'code' command in PATH\"");
  console.error('  (On Windows it is already available if you enabled the PATH option at install time.)');
  console.error('  ------------------------------------------------------------\n');
  process.exit(1);
}

console.log(`\n  Installed: ${pkg.name}@${pkg.version}`);
console.log('  Run "Developer: Reload Window" in VS Code once to activate it.\n');
