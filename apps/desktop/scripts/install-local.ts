/**
 * Local dev-install: packages the app from the current checkout and installs
 * it into /Applications — the "run it like a real Mac app" loop before
 * official distribution. Signing/notarization are not involved; the locally
 * built app never carries a quarantine flag, so Gatekeeper doesn't mind.
 *
 *   bun run install:local              # plain Sim.app (origin unchanged)
 *   bun run install:local --local      # Sim Local.app  → http://localhost:3000
 *   bun run install:local --dev        # Sim Dev.app    → https://www.dev.sim.ai
 *   bun run install:local --staging    # Sim Staging.app → https://www.staging.sim.ai
 *   bun run install:local --prod       # Sim.app        → https://www.sim.ai
 *   bun run install:local --no-open    # build → install only
 *
 * Each environment is a separate app (name, bundle id, install path, userData,
 * single-instance lock, update feed), so all four can be installed and run
 * side by side. The flag both bakes the default server origin into the build
 * and writes the app's persisted settings (same as changing the server URL in
 * Settings). A running installed copy of the SAME channel is quit before
 * replacing; other channels keep running.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

interface ChannelIdentity {
  /** Display + bundle name; also the userData directory name. */
  name: string
  appId: string
  /** Baked default origin + persisted settings origin. Unset = leave as-is. */
  origin?: string
}

/** Must stay in sync with APP_NAME_FOR_CHANNEL in src/main/config.ts. */
const CHANNEL_FLAGS: Record<string, ChannelIdentity> = {
  '--local': { name: 'Sim Local', appId: 'ai.sim.desktop.local', origin: 'http://localhost:3000' },
  '--dev': { name: 'Sim Dev', appId: 'ai.sim.desktop.dev', origin: 'https://www.dev.sim.ai' },
  '--staging': {
    name: 'Sim Staging',
    appId: 'ai.sim.desktop.staging',
    origin: 'https://www.staging.sim.ai',
  },
  '--prod': { name: 'Sim', appId: 'ai.sim.desktop', origin: 'https://www.sim.ai' },
}

const DEFAULT_IDENTITY: ChannelIdentity = { name: 'Sim', appId: 'ai.sim.desktop' }

const channelFlags = process.argv.filter((arg) => arg in CHANNEL_FLAGS)
if (channelFlags.length > 1) {
  console.error(`✖ Pass at most one of ${Object.keys(CHANNEL_FLAGS).join(', ')}`)
  process.exit(1)
}
const identity = channelFlags.length === 1 ? CHANNEL_FLAGS[channelFlags[0]] : DEFAULT_IDENTITY

const APP_NAME = `${identity.name}.app`
const INSTALL_PATH = `/Applications/${APP_NAME}`
const RELEASE_DIRS = ['release/mac-universal', 'release/mac-arm64', 'release/mac']
/** Matches the app's userData path (app.setName(...) in src/main/index.ts). */
const SETTINGS_PATH = join(homedir(), `Library/Application Support/${identity.name}/settings.json`)

function run(command: string, args: string[], env?: Record<string, string>): void {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  })
  if (result.status !== 0) {
    console.error(`\n✖ ${command} ${args.join(' ')} failed`)
    process.exit(result.status ?? 1)
  }
}

function localBuildStamp(): string {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim()
    const dirty = execFileSync('git', ['status', '--porcelain']).toString().trim() ? '+dirty' : ''
    return `${sha}${dirty}`
  } catch {
    return 'unknown'
  }
}

function quitInstalledApp(): void {
  // Match only processes launched from this channel's installed bundle —
  // never the dev instance running out of node_modules/electron, and never
  // another channel's install.
  const running = spawnSync('pgrep', ['-f', `${INSTALL_PATH}/Contents/MacOS/`]).status === 0
  if (!running) return
  console.log('• Quitting the running installed app…')
  spawnSync('osascript', ['-e', `tell application "${identity.name}" to quit`])
  // Poll briefly; fall back to a hard kill so the install never half-replaces
  // a live bundle.
  for (let i = 0; i < 20; i++) {
    if (spawnSync('pgrep', ['-f', `${INSTALL_PATH}/Contents/MacOS/`]).status !== 0) return
    execFileSync('sleep', ['0.25'])
  }
  spawnSync('pkill', ['-f', `${INSTALL_PATH}/Contents/MacOS/`])
}

/**
 * Points the installed app at an environment by writing its persisted
 * settings — the same field the in-app Settings window edits. Merges into the
 * existing file so window bounds, shortcuts, etc. survive.
 */
function applyOrigin(origin: string): void {
  let settings: Record<string, unknown> = {}
  try {
    settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Record<string, unknown>
  } catch {
    // Missing or corrupt settings file — start fresh; the app validates on load.
  }
  settings.origin = origin
  mkdirSync(dirname(SETTINGS_PATH), { recursive: true })
  writeFileSync(SETTINGS_PATH, `${JSON.stringify(settings, null, 2)}\n`)
  console.log(`• Server origin set to ${origin}`)
  if (origin.startsWith('http://localhost')) {
    console.log('  (make sure the sim dev server is running on :3000)')
  }
}

console.log(`• Packaging ${identity.name} from the current checkout…`)
run(
  'bun',
  ['run', 'build'],
  identity.origin ? { SIM_DESKTOP_DEFAULT_ORIGIN: identity.origin } : undefined
)
// electron-builder only writes the output dir for the CURRENT target/arch
// (e.g. mac-arm64); other release dirs from older runs (a universal dmg
// build, an Intel machine) would survive and win the pick below. Remove all
// candidates first so the only app found is the one just built.
for (const dir of RELEASE_DIRS) {
  rmSync(dir, { recursive: true, force: true })
}
// Same as package:dir, minus trusted timestamps: codesign's --timestamp does
// a network round trip to Apple PER FILE (hundreds inside the Electron
// framework), which turns local signing into a multi-minute stall. Local
// installs don't need timestamped signatures — only notarized distribution
// builds do.
run('bunx', [
  'electron-builder',
  '--mac',
  'dir',
  '--publish',
  'never',
  '-c.mac.timestamp=none',
  `-c.productName=${identity.name}`,
  `-c.appId=${identity.appId}`,
])

const builtApp = RELEASE_DIRS.map((dir) => join(dir, APP_NAME)).find(existsSync)
if (!builtApp) {
  console.error(`✖ No built app found under ${RELEASE_DIRS.join(', ')}`)
  process.exit(1)
}

// Without a Developer ID identity electron-builder skips signing entirely,
// and its fuse-flip step invalidates Electron's shipped ad-hoc seal — Apple
// silicon then SIGKILLs the binary at launch (Code Signature Invalid).
// Re-seal the whole bundle ad-hoc; ditto below preserves the signature.
console.log('• Ad-hoc signing the bundle…')
run('codesign', ['--force', '--deep', '--sign', '-', builtApp])

quitInstalledApp()

console.log(`• Installing ${builtApp} → ${INSTALL_PATH}`)
rmSync(INSTALL_PATH, { recursive: true, force: true })
// ditto preserves the code signature and extended attributes, unlike cp.
run('ditto', [builtApp, INSTALL_PATH])

if (identity.origin) {
  applyOrigin(identity.origin)
}

console.log(`✔ Installed ${identity.name} (${localBuildStamp()}) to ${INSTALL_PATH}`)

if (!process.argv.includes('--no-open')) {
  run('open', [INSTALL_PATH])
} else {
  console.log(`  Launch it with: open ${INSTALL_PATH}`)
}
