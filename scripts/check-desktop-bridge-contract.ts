/**
 * Desktop bridge contract audit.
 *
 * The desktop shell is an installed binary users update on their own
 * schedule, while the web app it loads is deployed continuously. The preload
 * bridge contract (`@sim/desktop-bridge`, which embeds `@sim/browser-protocol`
 * types) must therefore stay backward compatible: an already-installed shell
 * has to satisfy whatever the newest web deployment expects.
 *
 * This script keeps a frozen snapshot of the full bridge type surface
 * (`packages/desktop-bridge/contract-snapshot.ts`) and type-checks that a
 * shell built from the snapshot is still assignable to the current
 * `SimDesktopApi` — additive/optional changes pass, removals, renames, and
 * new required members fail.
 *
 * Modes:
 * - `--check` (default, CI): fails when the current types break
 *   compatibility with the snapshot, or when the snapshot's recorded floor
 *   drifts from `MIN_DESKTOP_VERSION`.
 * - `--update`: regenerates the snapshot from the current sources. A
 *   breaking regeneration is refused unless `MIN_DESKTOP_VERSION`
 *   (`apps/sim/lib/desktop/min-version.ts`) was raised above the previous
 *   snapshot's floor — bumping the floor is the deliberate escape hatch that
 *   makes outdated shells show the "update to continue" takeover.
 *
 * Known limitation: TypeScript checks method parameters bivariantly, so
 * widening a request union or callback payload is not flagged. Those changes
 * are additive for the shell (unknown requests fail soft), but semantic
 * changes to callback payloads still need review.
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatGeneratedSource } from './format-generated-source'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(SCRIPT_DIR, '..')
const BRIDGE_SOURCE_PATH = resolve(ROOT, 'packages/desktop-bridge/src/index.ts')
const PROTOCOL_SOURCE_PATH = resolve(ROOT, 'packages/browser-protocol/src/index.ts')
const SNAPSHOT_PATH = resolve(ROOT, 'packages/desktop-bridge/contract-snapshot.ts')
const MIN_VERSION_PATH = resolve(ROOT, 'apps/sim/lib/desktop/min-version.ts')

const FLOOR_PATTERN = /^ \* min-desktop-version: (\S+)$/m

async function readMinDesktopVersion(): Promise<string> {
  const source = await readFile(MIN_VERSION_PATH, 'utf8')
  const match = /export const MIN_DESKTOP_VERSION = '([^']+)'/.exec(source)
  if (!match) {
    throw new Error(`Could not find MIN_DESKTOP_VERSION in ${MIN_VERSION_PATH}`)
  }
  return match[1]
}

async function readSnapshot(): Promise<{ source: string; floor: string } | null> {
  let source: string
  try {
    source = await readFile(SNAPSHOT_PATH, 'utf8')
  } catch {
    return null
  }
  const floor = FLOOR_PATTERN.exec(source)?.[1]
  if (!floor) {
    throw new Error(`${SNAPSHOT_PATH} is missing its min-desktop-version header`)
  }
  return { source, floor }
}

/** Plain x.y.z ordering for floor versions; throws on anything else. */
function isFloorRaised(next: string, previous: string): boolean {
  const parse = (version: string): number[] => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
    if (!match) {
      throw new Error(`MIN_DESKTOP_VERSION must be a plain x.y.z version, got '${version}'`)
    }
    return [Number(match[1]), Number(match[2]), Number(match[3])]
  }
  const [nextParts, previousParts] = [parse(next), parse(previous)]
  for (let i = 0; i < 3; i++) {
    if (nextParts[i] !== previousParts[i]) {
      return nextParts[i] > previousParts[i]
    }
  }
  return false
}

async function buildSnapshot(floor: string): Promise<string> {
  const protocol = await readFile(PROTOCOL_SOURCE_PATH, 'utf8')
  const bridgeRaw = await readFile(BRIDGE_SOURCE_PATH, 'utf8')
  // The snapshot must be self-contained (a frozen dependency would defeat
  // it), so the browser-protocol module is inlined and the import dropped.
  const bridge = bridgeRaw.replace(/import type \{[^}]*\} from '@sim\/browser-protocol'\n/, '')
  if (bridge.includes('@sim/browser-protocol')) {
    throw new Error(
      'packages/desktop-bridge/src/index.ts references @sim/browser-protocol in an unexpected ' +
        'shape — update scripts/check-desktop-bridge-contract.ts to inline it.'
    )
  }
  const header = [
    '/**',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ' * Frozen snapshot of the desktop preload bridge type surface',
    ' * (@sim/browser-protocol inlined into @sim/desktop-bridge) as of the last',
    ' * accepted contract change. CI type-checks that a shell built from this',
    ' * snapshot still satisfies the current SimDesktopApi, so bridge changes',
    ' * stay backward compatible with already-installed shells.',
    ' *',
    ' * Regenerate with: bun run desktop-bridge-contract:update',
    ' * Full rules: scripts/check-desktop-bridge-contract.ts',
    ' *',
    ` * min-desktop-version: ${floor}`,
    ' */',
    '',
  ].join('\n')
  const source = `${header}${protocol}\n${bridge}`
  return formatGeneratedSource(source, SNAPSHOT_PATH, ROOT)
}

/**
 * Type-checks that an old shell (the committed snapshot) is assignable to
 * the current SimDesktopApi — i.e. new web code can run against it.
 */
function checkCompatibility(): { compatible: boolean; output: string } {
  const compatSource = [
    `import type { SimDesktopApi as CurrentApi } from '${BRIDGE_SOURCE_PATH}'`,
    `import type { SimDesktopApi as OldShellApi } from '${SNAPSHOT_PATH}'`,
    '',
    'declare const oldInstalledShell: OldShellApi',
    '// If this assignment fails, the current web app expects something an',
    '// already-installed shell cannot provide — a breaking bridge change.',
    'const currentWebAppExpectation: CurrentApi = oldInstalledShell',
    'void currentWebAppExpectation',
    '',
  ].join('\n')
  const tsconfig = {
    compilerOptions: {
      strict: true,
      noEmit: true,
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      skipLibCheck: true,
      types: [],
      paths: {
        '@sim/browser-protocol': [PROTOCOL_SOURCE_PATH],
      },
    },
    files: ['./compat.ts'],
  }

  const dir = mkdtempSync(join(tmpdir(), 'sim-desktop-bridge-contract-'))
  try {
    writeFileSync(join(dir, 'compat.ts'), compatSource)
    writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify(tsconfig, null, 2))
    const result = spawnSync('bunx', ['tsc', '-p', dir, '--pretty', 'false'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return {
      compatible: result.status === 0,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const BREAKING_GUIDANCE = `
A shell built from the committed contract snapshot no longer satisfies the
current SimDesktopApi — installed desktop apps would break against this web
deployment. Either:

  1. Make the change backward compatible: new fields, methods, and surfaces
     on the bridge must be optional so older shells (which lack them) still
     type-check. This is the default — prefer it.

  2. If the change is genuinely breaking: bump MIN_DESKTOP_VERSION in
     apps/sim/lib/desktop/min-version.ts to the desktop release your shell
     change ships in, then run:

       bun run desktop-bridge-contract:update

     Shells older than that floor will show a blocking "Update Sim to
     continue" screen until they update.
`

async function runCheck(): Promise<void> {
  const [minVersion, snapshot] = await Promise.all([readMinDesktopVersion(), readSnapshot()])
  if (!snapshot) {
    console.error(
      `Missing ${SNAPSHOT_PATH}.\nRun: bun run desktop-bridge-contract:update and commit the result.`
    )
    process.exit(1)
  }
  if (snapshot.floor !== minVersion) {
    console.error(
      `Contract snapshot floor (${snapshot.floor}) does not match MIN_DESKTOP_VERSION ` +
        `(${minVersion}).\nRun: bun run desktop-bridge-contract:update and commit the result.`
    )
    process.exit(1)
  }
  const { compatible, output } = checkCompatibility()
  if (!compatible) {
    console.error('Breaking desktop bridge change detected.\n')
    console.error(output)
    console.error(BREAKING_GUIDANCE)
    process.exit(1)
  }
  console.log('Desktop bridge contract audit passed: bridge types are backward compatible.')
}

async function runUpdate(): Promise<void> {
  const [minVersion, snapshot] = await Promise.all([readMinDesktopVersion(), readSnapshot()])
  if (snapshot) {
    const { compatible, output } = checkCompatibility()
    if (!compatible && !isFloorRaised(minVersion, snapshot.floor)) {
      console.error('Refusing to accept a breaking bridge change without a floor bump.\n')
      console.error(output)
      console.error(BREAKING_GUIDANCE)
      process.exit(1)
    }
  }
  await writeFile(SNAPSHOT_PATH, await buildSnapshot(minVersion))
  console.log(`Regenerated ${SNAPSHOT_PATH} (min-desktop-version: ${minVersion}).`)
}

const mode = process.argv.includes('--update') ? 'update' : 'check'
try {
  if (mode === 'update') {
    await runUpdate()
  } else {
    await runCheck()
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
}
