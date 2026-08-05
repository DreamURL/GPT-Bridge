import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');

/**
 * @type {import('esbuild').BuildOptions}
 *
 * external 규칙은 project.md §2.1 참조.
 *  - 'vscode'          : 확장 호스트가 런타임에 주입한다. 번들할 수 없다.
 *  - '@vscode/ripgrep' : rgPath는 node_modules 안의 실제 바이너리를 가리키는
 *                        경로 문자열이다. 번들하면 바이너리가 따라오지 않아
 *                        .vsix 설치본에서만 rg를 찾지 못하는 형태로 깨진다.
 *                        require를 런타임에 남기고 .vscodeignore로 패키지를
 *                        통째로 포함시킨다.
 */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  external: ['vscode', '@vscode/ripgrep'],
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  logLevel: 'info'
};

/**
 * 테스트 번들.
 *
 * PathGuard·거부 목록·인증 미들웨어는 vscode에 의존하지 않게 만들어 두었다.
 * 덕분에 확장 개발 호스트 없이 `node --test`로 §11 케이스를 그대로 돌릴 수 있다.
 */
async function buildTests() {
  const testDir = path.resolve('test');
  const entryPoints = fs
    .readdirSync(testDir)
    .filter((name) => name.endsWith('.test.ts'))
    .map((name) => path.join(testDir, name));

  if (entryPoints.length === 0) {
    throw new Error('테스트 파일을 찾지 못했습니다.');
  }

  await esbuild.build({
    entryPoints,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    outdir: 'out-test',
    external: ['vscode'],
    sourcemap: 'inline',
    sourcesContent: false,
    logLevel: 'warning'
  });
}

if (tests) {
  await buildTests();
} else if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
