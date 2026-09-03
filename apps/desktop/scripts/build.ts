import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'
import { identityForOrigin } from './channels'

const watch = process.argv.includes('--watch')

// Optional build-time default server origin (pre-release shares pointed at a
// non-prod environment): SIM_DESKTOP_DEFAULT_ORIGIN=https://www.dev.sim.ai.
// Baked into the bundle so it applies to fresh installs with no settings —
// unlike the SIM_DESKTOP_ORIGIN env var, which only affects terminal-launched
// processes. Official builds leave it unset (default https://www.sim.ai).
const bakedDefaultOrigin = process.env.SIM_DESKTOP_DEFAULT_ORIGIN ?? ''
if (
  bakedDefaultOrigin &&
  !/^https:\/\/[^\s/]+$/.test(bakedDefaultOrigin) &&
  !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(bakedDefaultOrigin)
) {
  console.error(
    `SIM_DESKTOP_DEFAULT_ORIGIN must be a bare https origin or http://localhost (got "${bakedDefaultOrigin}")`
  )
  process.exit(1)
}
if (bakedDefaultOrigin) {
  console.log(`• Baking default server origin: ${bakedDefaultOrigin}`)
}

const appIcon = identityForOrigin(bakedDefaultOrigin).icon
const generatedIcon = 'build/generated-icon.icon'
rmSync(generatedIcon, { force: true, recursive: true })
cpSync(appIcon, generatedIcon, { recursive: true })
console.log(`• Selecting desktop icon: ${appIcon}`)

// The bundled pages load their font from static/ over the shell's own scheme.
// electron-builder copies it there for packaged builds; this does the same for
// unpackaged runs and the e2e suite, so both serve it from one place.
const brandFont = join('..', 'sim', 'public', 'brand', 'fonts', 'SeasonSansUprightsVF.woff2')
cpSync(brandFont, join('static', 'SeasonSansUprightsVF.woff2'))
console.log('• Copied the Season Sans font for the bundled pages')

function compileNativeHelpSearch(): void {
  const outputDirectory = 'dist/native'
  rmSync(outputDirectory, { force: true, recursive: true })
  if (process.platform !== 'darwin') return

  const nodeExecutable = execFileSync('node', ['-p', 'process.execPath'], {
    encoding: 'utf8',
  }).trim()
  const nodeIncludeDirectory = join(dirname(nodeExecutable), '..', 'include', 'node')
  const nodeApiHeader = join(nodeIncludeDirectory, 'node_api.h')
  if (!existsSync(nodeApiHeader)) {
    throw new Error(`Could not find Node-API headers at ${nodeApiHeader}`)
  }

  mkdirSync(outputDirectory, { recursive: true })
  execFileSync(
    'xcrun',
    [
      'clang++',
      '-std=c++17',
      '-DNAPI_VERSION=8',
      '-fobjc-arc',
      '-fblocks',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-mmacosx-version-min=12.0',
      '-arch',
      'arm64',
      '-arch',
      'x86_64',
      '-I',
      nodeIncludeDirectory,
      '-framework',
      'AppKit',
      '-framework',
      'Foundation',
      '-o',
      join(outputDirectory, 'help-search.node'),
      'native/help-search.mm',
    ],
    { stdio: 'inherit' }
  )
  console.log('• Compiled native macOS documentation Help search')
}

const common = {
  bundle: true,
  platform: 'node' as const,
  format: 'cjs' as const,
  target: 'node22',
  sourcemap: true,
  // node-pty resolves a prebuilt .node binary at runtime, so it must stay
  // external and be loaded from node_modules rather than inlined here.
  external: ['electron', '@lydell/node-pty'],
  tsconfig: 'tsconfig.json',
  logLevel: 'info' as const,
  define: {
    'process.env.SIM_DESKTOP_DEFAULT_ORIGIN': JSON.stringify(bakedDefaultOrigin),
  },
}

async function run(): Promise<void> {
  compileNativeHelpSearch()
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
    // Separate from the main-window preload: this one is injected into
    // untrusted pages in the built-in browser and must stay minimal.
    const browserPreloadCtx = await context({
      ...common,
      entryPoints: ['src/preload/browser/index.ts'],
      outfile: 'dist/browser-preload.cjs',
    })
    await Promise.all([mainCtx.watch(), preloadCtx.watch(), browserPreloadCtx.watch()])
    return
  }
  await Promise.all([
    build({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist/main.cjs' }),
    build({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist/preload.cjs' }),
    build({
      ...common,
      entryPoints: ['src/preload/browser/index.ts'],
      outfile: 'dist/browser-preload.cjs',
    }),
  ])
}

run().catch((error) => {
  console.error(error)
  process.exit(1)
})
