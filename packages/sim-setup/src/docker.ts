import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { SetupError } from './errors'
import { executableExists } from './executables'
import { waitFor } from './probes'
import * as p from './prompter'
import { glyph, theme } from './theme'

const INSTALL_HINTS = [
  'install Docker Desktop: https://docker.com/products/docker-desktop',
  `or OrbStack (lighter on macOS): ${theme.command('brew install orbstack')}`,
]

/**
 * Reaching this means the docker CLI exists but neither GUI app does, which is
 * also what a colima or Rancher Desktop user looks like — telling them to
 * install Docker Desktop would be advice for a problem they don't have.
 */
const NO_APP_HINTS = [
  ...INSTALL_HINTS,
  `or start your existing runtime its own way, e.g. ${theme.command('colima start')}`,
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
  return executableExists('docker')
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

function appInstalled(app: DockerApp): boolean {
  return APP_DIRS.some((dir) => existsSync(join(dir, app.bundle)))
}

interface DockerChoice {
  app: DockerApp
  /** The CLI names this provider, so no other app can bring its daemon up. */
  explicit: boolean
}

/**
 * Which app to offer to start. Both providers install a `docker` binary, so CLI
 * presence alone doesn't say which one to launch. An OrbStack selection is
 * explicit; anything else is a guess the launch is allowed to correct, which is
 * why the install probe here doesn't have to be exhaustive.
 */
function macDockerApp(): DockerChoice {
  if (orbstackSelected()) return { app: ORBSTACK_APP, explicit: true }
  const orbstackOnly = appInstalled(ORBSTACK_APP) && !appInstalled(DOCKER_DESKTOP_APP)
  return { app: orbstackOnly ? ORBSTACK_APP : DOCKER_DESKTOP_APP, explicit: false }
}

/**
 * Starts a provider. `open` exits non-zero when macOS knows no such app, which
 * settles installation authoritatively and without a dialog — it resolves the
 * name the same way the launch does, so the two cannot disagree.
 */
function openApp(app: DockerApp): boolean {
  return spawnSync('open', ['-a', app.name], { stdio: 'ignore' }).status === 0
}

/**
 * Starts the chosen provider, retrying with the other one when the choice was
 * only a guess. An explicit OrbStack selection is never redirected: `docker
 * info` would still be addressing OrbStack's socket, so Docker Desktop cannot
 * satisfy it however successfully it starts.
 */
function startDockerApp({ app, explicit }: DockerChoice): DockerApp | null {
  if (openApp(app)) return app
  if (explicit) return null
  const other = app === ORBSTACK_APP ? DOCKER_DESKTOP_APP : ORBSTACK_APP
  return openApp(other) ? other : null
}

/**
 * A launch that failed after the user opted into it. Callers passing
 * required=false have a non-Docker path to offer, so the reason is worth
 * surfacing but must not abort the wizard.
 */
function launchFailed(required: boolean, message: string, hints: string[]): boolean {
  if (required) throw new SetupError(message, hints)
  p.log.warn([message, ...hints].join('\n'))
  return false
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

  const choice = macDockerApp()

  const launch = await p.confirm({
    message: `Docker is installed but not running — start ${choice.app.name} now?`,
    initialValue: true,
  })
  if (!launch) {
    if (required) {
      throw new SetupError('Docker is required for this mode.', [
        `start ${choice.app.name}, then re-run the wizard`,
      ])
    }
    return false
  }

  const app = startDockerApp(choice)
  if (!app) {
    return choice.explicit
      ? launchFailed(required, 'The docker CLI is pointed at OrbStack, which is not installed.', [
          `reinstall it: ${theme.command('brew install orbstack')}`,
          `or point the CLI elsewhere: unset DOCKER_HOST and DOCKER_CONTEXT, then ${theme.command('docker context use <name>')}`,
        ])
      : launchFailed(required, 'Found the docker CLI, but no app to start.', NO_APP_HINTS)
  }

  const spin = p.spinner()
  spin.start(`Waiting for the Docker daemon (${app.name})…`)
  const up = await waitFor(async () => daemonUp(), 90_000, 2000)
  spin.stop(up ? 'Docker is running' : `${glyph.fail} daemon did not come up`)
  if (!up) {
    return launchFailed(required, `${app.name} did not start within 90s.`, [
      app === ORBSTACK_APP
        ? 'open OrbStack manually once to finish its first-run setup, then re-run'
        : 'first-ever launch needs a GUI license acceptance — open Docker Desktop manually once, then re-run',
    ])
  }
  return true
}
