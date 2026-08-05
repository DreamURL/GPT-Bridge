import * as esbuild from 'esbuild';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

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

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
