import { spawn } from 'node:child_process'
import { readFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getErrorMessage } from '@sim/utils/errors'
import { omit } from '@sim/utils/object'
import { lock } from 'proper-lockfile'
import { upgradeCommand } from '#sim-cli/update/check'
import { CLI_VERSION } from '#sim-cli/version'

export class CliUpdateError extends Error {}

const PACKAGE_MANAGERS = ['npm', 'pnpm', 'bun', 'yarn'] as const
export type PackageManager = (typeof PACKAGE_MANAGERS)[number]

interface PackageManagerOptions {
  env: NodeJS.ProcessEnv
  capture: boolean
}

type RunPackageManager = (
  manager: PackageManager,
  args: string[],
  options: PackageManagerOptions
) => Promise<string>

interface InstallUpdateOptions {
  modulePath?: string
  env?: NodeJS.ProcessEnv
  currentVersion?: string
  packageManager?: PackageManager
  run?: RunPackageManager
  write?: (message: string) => void
}

/** Runs only fixed package-manager commands; installer output belongs on stderr. */
const runPackageManager: RunPackageManager = (manager, args, { env, capture }) =>
  new Promise((resolve, reject) => {
    const child = spawn(manager, args, {
      cwd: homedir(),
      env,
      /** Windows package managers ship .cmd launchers. Arguments contain no user input. */
      shell: process.platform === 'win32',
      stdio: ['ignore', capture ? 'pipe' : process.stderr, process.stderr],
      timeout: capture ? 10_000 : 5 * 60_000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    let output = ''
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
      output += chunk
      if (Buffer.byteLength(output) > 64 * 1024) {
        child.kill('SIGKILL')
        reject(new CliUpdateError(`${manager} returned too much output while locating Sim.`))
      }
    })
    child.once('error', (error) => {
      reject(new CliUpdateError(`Could not run ${manager}: ${getErrorMessage(error)}`))
    })
    child.once('close', (code, signal) => {
      if (code !== 0) {
        reject(
          new CliUpdateError(
            `${manager} ${args.join(' ')} failed (${signal ?? `exit ${code}`}). Resolve the package-manager error and run sim update again.`
          )
        )
        return
      }
      resolve(output.trim())
    })
  })

/** Preserves published preview/dev channels instead of silently switching them to stable. */
function updateTarget(current: string): string {
  if (/^\d+\.\d+\.\d+-preview\.\d+\.\d+$/.test(current)) return 'staging'
  if (/^\d+\.\d+\.\d+-dev\.\d+\.\d+$/.test(current)) return 'dev'
  if (/^\d+\.\d+\.\d+(?:\+[\w.-]+)?$/.test(current)) return 'latest'
  throw new CliUpdateError(`Cannot determine the release channel for Sim ${current}.`)
}

/** Updates the verified global installation and reports the version actually installed. */
export async function installUpdate(options: InstallUpdateOptions = {}): Promise<void> {
  const modulePath = realpathSync(options.modulePath ?? fileURLToPath(import.meta.url))
  const env = omit(options.env ?? process.env, ['SIM_API_KEY'])
  const normalized = modulePath.replaceAll('\\', '/').toLowerCase()
  if (
    env.npm_command === 'exec' ||
    normalized.includes('/_npx/') ||
    normalized.includes('/bunx-') ||
    !normalized.endsWith('/node_modules/sim/dist/index.js')
  ) {
    throw new CliUpdateError(
      'sim update requires a global installation. Update project dependencies with their package manager, or use sim@latest with your package runner.'
    )
  }

  const manager = options.packageManager ?? upgradeCommand(modulePath, env).split(' ')[0]
  if (!PACKAGE_MANAGERS.includes(manager as PackageManager)) {
    throw new CliUpdateError('Cannot determine which package manager installed Sim.')
  }
  const packageManager = manager as PackageManager
  const run = options.run ?? runPackageManager
  const currentVersion = options.currentVersion ?? CLI_VERSION
  const target = updateTarget(currentVersion)
  const write = options.write ?? ((message: string) => void process.stderr.write(message))
  env.SIM_NO_UPDATE_CHECK = '1'

  const locateArgs =
    packageManager === 'bun'
      ? ['pm', 'bin', '-g']
      : packageManager === 'yarn'
        ? ['global', 'dir', '--silent']
        : ['root', '-g']
  const directory = await run(packageManager, locateArgs, { env, capture: true })
  if (!isAbsolute(directory) || /[\r\n]/.test(directory)) {
    throw new CliUpdateError(`${packageManager} did not return a valid global installation path.`)
  }
  const installedEntry =
    packageManager === 'bun'
      ? join(directory, 'sim')
      : join(directory, ...(packageManager === 'yarn' ? ['node_modules'] : []), 'sim/dist/index.js')
  if (realpathSync(installedEntry) !== modulePath) {
    throw new CliUpdateError(
      `${packageManager} would update a different Sim installation. Use the package manager and global configuration that installed this copy, or select --package-manager.`
    )
  }

  const release = await lock(dirname(dirname(modulePath)), { retries: 0, realpath: false })
  try {
    write(`Updating Sim ${currentVersion} with ${packageManager} (sim@${target})…\n`)
    const args =
      packageManager === 'npm'
        ? ['install', '-g', `sim@${target}`]
        : packageManager === 'yarn'
          ? ['global', 'add', `sim@${target}`]
          : ['add', '-g', `sim@${target}`]
    await run(packageManager, args, { env, capture: false })
    const manifest: unknown = JSON.parse(
      readFileSync(join(dirname(dirname(realpathSync(installedEntry))), 'package.json'), 'utf8')
    )
    if (
      typeof manifest !== 'object' ||
      manifest === null ||
      !('name' in manifest) ||
      manifest.name !== 'sim' ||
      !('version' in manifest) ||
      typeof manifest.version !== 'string'
    ) {
      throw new CliUpdateError('The package manager did not install the expected Sim version.')
    }
    if (updateTarget(manifest.version) !== target) {
      throw new CliUpdateError(
        'The package manager installed Sim from a different release channel.'
      )
    }
    write(
      manifest.version === currentVersion
        ? `Sim ${currentVersion} is already up to date.\n`
        : `Updated Sim ${currentVersion} → ${manifest.version}. The next invocation will use the new version.\n`
    )
  } finally {
    await release()
  }
}
