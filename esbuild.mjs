import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: { extension: 'src/extension.ts', browserServer: 'src/mcp/browserMain.ts', routerServer: 'src/mcp/routerMain.ts' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: 'dist',
  external: ['vscode'],
  sourcemap: watch,
  metafile: true,
  logLevel: 'info'
};

if (watch) {
  const context = await esbuild.context(options);
  await context.watch();
  console.log('REA extension build watcher started.');
} else {
  const result = await esbuild.build(options);
  const { generateNotices } = await import('./scripts/notices.mjs');
  await generateNotices(result.metafile);
  console.log('REA extension build completed.');
}
