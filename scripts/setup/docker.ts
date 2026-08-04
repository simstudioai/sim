import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { SetupError } from './errors.ts'
import { waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

const INSTALL_HINTS = [
  'install Docker Desktop: https://docker.com/products/docker-desktop',
  `or OrbStack (lighter on macOS): ${theme.command('brew install orbstack')}`,
]

/** macOS GUI docker providers we know how to launch via `open -a`. */
const ORBSTACK_APP = { name: 'OrbStack', path: '/Applications/OrbStack.app' } as const
const DOCKER_DESKTOP_APP = { name: 'Docker', path: '/Applications/Docker.app' } as const

function daemonUp(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

function installed(): boolean {
  // Bun.which resolves PATH cross-platform (incl. PATHEXT on Windows); `which`
  // is not a standard Windows command.
  return Bun.which('docker') !== null
}

function currentDockerContext(): string | null {
  const result = spawnSync('docker', ['context', 'show'], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : null
}

/**
 * Which GUI app owns the `docker` CLI on this Mac. Docker Desktop and OrbStack
 * both install a `docker` binary, so presence of the CLI alone doesn't tell us
 * which app to relaunch. Prefer the docker CLI's own active context — it's
 * accurate regardless of where the app bundle lives, and authoritative when
 * both apps are installed but only one is the active context. Only fall back
 * to checking the well-known `.app` install path when the context command
 * gives no answer at all.
 */
function macDockerApp(): typeof ORBSTACK_APP | typeof DOCKER_DESKTOP_APP {
  const context = currentDockerContext()
  if (context !== null) return context === 'orbstack' ? ORBSTACK_APP : DOCKER_DESKTOP_APP
  return existsSync(ORBSTACK_APP.path) ? ORBSTACK_APP : DOCKER_DESKTOP_APP
}

/**
 * Returns whether the Docker daemon is available, offering to launch Docker
 * Desktop (macOS) when it's installed but stopped. Never installs anything.
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
