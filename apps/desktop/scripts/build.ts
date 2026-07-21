import { build } from 'esbuild'

const watch = process.argv.includes('--watch')

// Optional build-time default server origin (pre-release shares pointed at a
// non-prod environment): SIM_DESKTOP_DEFAULT_ORIGIN=https://www.dev.sim.ai.
// Baked into the bundle so it applies to fresh installs with no settings —
// unlike the SIM_DESKTOP_ORIGIN env var, which only affects terminal-launched
// processes. Official builds leave it unset (default https://sim.ai).
const bakedDefaultOrigin = process.env.SIM_DESKTOP_DEFAULT_ORIGIN ?? ''
if (bakedDefaultOrigin && !/^https:\/\/[^\s/]+$/.test(bakedDefaultOrigin)) {
  console.error(
    `SIM_DESKTOP_DEFAULT_ORIGIN must be a bare https origin (got "${bakedDefaultOrigin}")`
  )
  process.exit(1)
}
if (bakedDefaultOrigin) {
  console.log(`• Baking default server origin: ${bakedDefaultOrigin}`)
}

const common = {
  bundle: true,
  platform: 'node' as const,
  format: 'cjs' as const,
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  tsconfig: 'tsconfig.json',
  logLevel: 'info' as const,
  define: {
    'process.env.SIM_DESKTOP_DEFAULT_ORIGIN': JSON.stringify(bakedDefaultOrigin),
  },
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
