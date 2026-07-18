import { build } from 'esbuild'

const watch = process.argv.includes('--watch')

const common = {
  bundle: true,
  platform: 'node' as const,
  format: 'cjs' as const,
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  tsconfig: 'tsconfig.json',
  logLevel: 'info' as const,
}

async function run(): Promise<void> {
  if (watch) {
    const { context } = await import('esbuild')
    const mainCtx = await context({
      ...common,
      entryPoints: ['src/main/index.ts'],
      outfile: 'dist/main.cjs',
    })
    const preloadCtx = await context({
      ...common,
      entryPoints: ['src/preload/index.ts'],
      outfile: 'dist/preload.cjs',
    })
    await Promise.all([mainCtx.watch(), preloadCtx.watch()])
    return
  }
  await Promise.all([
    build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs' }),
    build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs' }),
  ])
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
