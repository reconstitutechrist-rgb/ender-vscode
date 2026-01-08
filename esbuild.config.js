const esbuild = require('esbuild');
const path = require('path');

const isWatch = process.argv.includes('--watch');

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode', 'better-sqlite3'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: true,
  minify: !isWatch,
  treeShaking: true,
  define: {
    'process.env.NODE_ENV': isWatch ? '"development"' : '"production"'
  },
  alias: {
    '@': path.resolve(__dirname, 'src'),
    '@agents': path.resolve(__dirname, 'src/agents'),
    '@validators': path.resolve(__dirname, 'src/validators'),
    '@memory': path.resolve(__dirname, 'src/memory'),
    '@storage': path.resolve(__dirname, 'src/storage'),
    '@api': path.resolve(__dirname, 'src/api'),
    '@ui': path.resolve(__dirname, 'src/ui'),
    '@context': path.resolve(__dirname, 'src/context'),
    '@plans': path.resolve(__dirname, 'src/plans'),
    '@security': path.resolve(__dirname, 'src/security'),
    '@types': path.resolve(__dirname, 'src/types'),
    '@utils': path.resolve(__dirname, 'src/utils'),
    '@sanity': path.resolve(__dirname, 'src/sanity')
  },
  logLevel: 'info'
};

async function build() {
  try {
    if (isWatch) {
      const ctx = await esbuild.context(buildOptions);
      await ctx.watch();
      console.log('Watching for changes...');
    } else {
      await esbuild.build(buildOptions);
      console.log('Build complete');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
