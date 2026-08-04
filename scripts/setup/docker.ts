import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SetupError } from './errors.ts'
import { waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

const INSTALL_HINTS = [
  'install Docker Desktop: https://docker.com/products/docker-desktop',
  `or OrbStack (lighter on macOS): ${theme.command('brew install orbstack')}`,
]

/** macOS GUI docker providers we know how to launch via `open -a`. */
const ORBSTACK_APP = { name: 'OrbStack', bundle: 'OrbStack.app' } as const
const DOCKER_DESKTOP_APP = { name: 'Docker', bundle: 'Docker.app' } as const

type DockerApp = typeof ORBSTACK_APP | typeof DOCKER_DESKTOP_APP

/** Homebrew casks honour `--appdir`, so a user-local install is not unusual. */
const APP_DIRS = ['/Applications', join(homedir(), 'Applications')]

function daemonUp(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

function installed(): boolean {
  // Bun.which resolves PATH cross-platform (incl. PATHEXT on Windows); `which`
  // is not a standard Windows command.
  return Bun.which('docker') !== null
}

/**
 * Whether the docker CLI is currently pointed at OrbStack. `DOCKER_HOST` wins
 * over the active context when set, so it is the only signal worth reading in
 * that case; otherwise the active context is authoritative, since OrbStack
 * registers and selects a context named `orbstack`.
 */
function orbstackSelected(): boolean {
  const host = process.env.DOCKER_HOST
  if (host) return host.includes('.orbstack/')
  const result = spawnSync('docker', ['context', 'show'], { encoding: 'utf8' })
  return result.status === 0 && result.stdout.trim() === 'orbstack'
}

/**
 * Whether macOS can launch this app. The well-known directories cover every
 * normal install without spawning anything; LaunchServices is the authority
 * for the rest, since a Homebrew `--appdir` can put the bundle anywhere and
 * `open -a` would still find it there.
 */
function appInstalled(app: DockerApp): boolean {
  if (APP_DIRS.some((dir) => existsSync(join(dir, app.bundle)))) return true
  const lookup = spawnSync('osascript', ['-e', `path to application "${app.name}"`], {
    stdio: 'ignore',
  })
  return lookup.status === 0
}

/**
 * Which GUI app owns the `docker` CLI on this Mac. Both apps install a `docker`
 * binary, so CLI presence alone doesn't say which one to launch. An explicit
 * OrbStack selection wins, but only when OrbStack is still installed — a
 * context or `DOCKER_HOST` left behind by an uninstall would otherwise pick an
 * app that can never come up. Otherwise fall back to whichever app is present,
 * which also covers CLIs too old for `docker context show`.
 */
function macDockerApp(): DockerApp {
  if (orbstackSelected() && appInstalled(ORBSTACK_APP)) return ORBSTACK_APP
  if (appInstalled(DOCKER_DESKTOP_APP)) return DOCKER_DESKTOP_APP
  return appInstalled(ORBSTACK_APP) ? ORBSTACK_APP : DOCKER_DESKTOP_APP
}

/**
 * Returns whether the Docker daemon is available, offering to launch the
 * installed docker app (macOS) when it's stopped. Never installs anything.
 * With required=true, unavailability is a SetupError instead of false.
 */
export async function ensureDocker(required: boolean): Promise<boolean> {
  if (daemonUp()) return true

  if (!installed()) {
    if (required) throw new SetupError('Docker is not installed.', INSTALL_HINTS)
    return false
  }

  if (process.platform !== 'darwin') {
    if (required) {
      throw new SetupError('Docker is installed but the daemon is not running.', [
        `start it: ${theme.command('sudo systemctl start docker')} (Linux)`,
      ])
    }
    return false
  }

  const app = macDockerApp()

  const launch = await p.confirm({
    message: `Docker is installed but not running — start ${app.name} now?`,
    initialValue: true,
  })
  if (!launch) {
    if (required) {
      throw new SetupError('Docker is required for this mode.', [
        `start ${app.name}, then re-run the wizard`,
      ])
    }
    return false
  }

  spawnSync('open', ['-a', app.name], { stdio: 'ignore' })
  const spin = p.spinner()
  spin.start(`Waiting for the Docker daemon (${app.name})…`)
  const up = await waitFor(async () => daemonUp(), 90_000, 2000)
  spin.stop(up ? 'Docker is running' : `${glyph.fail} daemon did not come up`)
  if (!up) {
    throw new SetupError(`${app.name} did not start within 90s.`, [
      app === ORBSTACK_APP
        ? 'open OrbStack manually once to finish its first-run setup, then re-run'
        : 'first-ever launch needs a GUI license acceptance — open Docker Desktop manually once, then re-run',
    ])
  }
  return true
}
