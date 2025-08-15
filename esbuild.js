const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/**
 * Minimal watch-friendly build for VS Code extension
 */
async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    outfile: 'dist/extension.js',
    external: ['vscode'], // required so VS Code provides the module
    logLevel: 'info'
  });

  if (watch) {
    console.log('[watch] build started');
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
