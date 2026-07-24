import { spawnSync } from 'node:child_process'
import { SetupError } from './errors.ts'
import { waitFor } from './probes.ts'
import * as p from './prompter.ts'
import { glyph, theme } from './theme.ts'

const INSTALL_HINTS = [
  'install Docker Desktop: https://docker.com/products/docker-desktop',
  `or OrbStack (lighter on macOS): ${theme.command('brew install orbstack')}`,
]

function daemonUp(): boolean {
  return spawnSync('docker', ['info'], { stdio: 'ignore' }).status === 0
}

function installed(): boolean {
  return spawnSync('which', ['docker'], { stdio: 'ignore' }).status === 0
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

  const launch = await p.confirm({
    message: 'Docker is installed but not running — start Docker Desktop now?',
    initialValue: true,
  })
  if (!launch) {
    if (required) {
      throw new SetupError('Docker is required for this mode.', [
        'start Docker Desktop, then re-run the wizard',
      ])
    }
    return false
  }

  spawnSync('open', ['-a', 'Docker'], { stdio: 'ignore' })
  const spin = p.spinner()
  spin.start('Waiting for the Docker daemon…')
  const up = await waitFor(async () => daemonUp(), 90_000, 2000)
  spin.stop(up ? 'Docker is running' : `${glyph.fail} daemon did not come up`)
  if (!up) {
    throw new SetupError('Docker Desktop did not start within 90s.', [
      'first-ever launch needs a GUI license acceptance — open Docker Desktop manually once, then re-run',
    ])
  }
  return true
}
