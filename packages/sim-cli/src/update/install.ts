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
        reject(new CliUpdateError(`${manager} returned too much output while checking Sim.`))
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

interface ReleaseVersion {
  channel: 'latest' | 'staging' | 'dev'
  precedence: bigint[]
}

/** Parses the release formats published by CI; build metadata has no precedence. */
function parseReleaseVersion(version: string): ReleaseVersion {
  const match =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(preview|dev)\.(0|[1-9]\d*)\.(0|[1-9]\d*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(
      version
    )
  if (version.length > 256 || !match) {
    throw new CliUpdateError(`Cannot determine the release channel for Sim ${version}.`)
  }
  const precedence = [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])]
  if (match[4]) precedence.push(BigInt(match[5]), BigInt(match[6]))
  return {
    channel: match[4] === 'preview' ? 'staging' : match[4] === 'dev' ? 'dev' : 'latest',
    precedence,
  }
}

/** Both versions have already been checked to belong to the same release channel. */
function compareReleases(candidate: ReleaseVersion, current: ReleaseVersion): number {
  for (const [index, component] of candidate.precedence.entries()) {
    if (component !== current.precedence[index])
      return component > current.precedence[index] ? 1 : -1
  }
  return 0
}

function resolveInstallationPath(path: string): string {
  try {
    return realpathSync(path)
  } catch (cause) {
    throw new CliUpdateError(`Cannot access the Sim installation: ${getErrorMessage(cause)}`, {
      cause,
    })
  }
}

function readInstalledVersion(entrypoint: string): string {
  const manifestPath = join(dirname(dirname(resolveInstallationPath(entrypoint))), 'package.json')
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (cause) {
    throw new CliUpdateError(`Cannot read the installed Sim manifest: ${getErrorMessage(cause)}`, {
      cause,
    })
  }
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('name' in manifest) ||
    manifest.name !== 'sim' ||
    !('version' in manifest) ||
    typeof manifest.version !== 'string'
  ) {
    throw new CliUpdateError(
      'The installed Sim manifest must name the sim package and its version.'
    )
  }
  return manifest.version
}

/** Yarn Classic wraps the selected field in an inspect event among JSON status lines. */
function parseRegistryVersion(output: string, manager: PackageManager): string {
  let version: unknown
  try {
    if (manager === 'yarn') {
      const events: unknown[] = output
        .split(/\r?\n/)
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line))
      const inspections = events.filter(
        (event): event is { type: 'inspect'; data: unknown } =>
          typeof event === 'object' &&
          event !== null &&
          'type' in event &&
          event.type === 'inspect' &&
          'data' in event
      )
      if (inspections.length === 1) version = inspections[0].data
    } else {
      version = JSON.parse(output)
    }
  } catch (cause) {
    throw new CliUpdateError(`${manager} returned invalid registry JSON.`, { cause })
  }
  if (typeof version !== 'string') {
    throw new CliUpdateError(`${manager} did not resolve a single Sim release version.`)
  }
  return version
}

/** Updates the verified global installation and reports the version actually installed. */
export async function installUpdate(options: InstallUpdateOptions = {}): Promise<void> {
  const modulePath = resolveInstallationPath(options.modulePath ?? fileURLToPath(import.meta.url))
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
  const current = parseReleaseVersion(currentVersion)
  const target = current.channel
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
  if (resolveInstallationPath(installedEntry) !== modulePath) {
    throw new CliUpdateError(
      `${packageManager} would update a different Sim installation. Use the package manager and global configuration that installed this copy, or select --package-manager.`
    )
  }

  const release = await lock(dirname(dirname(modulePath)), { retries: 0, realpath: false }).catch(
    (cause: unknown) => {
      throw new CliUpdateError(`Cannot lock Sim for update: ${getErrorMessage(cause)}`, { cause })
    }
  )
  try {
    if (readInstalledVersion(installedEntry) !== currentVersion) {
      throw new CliUpdateError(
        'The Sim installation changed while starting the update. Run sim update again.'
      )
    }
    const version = parseRegistryVersion(
      await run(
        packageManager,
        [
          packageManager === 'bun' || packageManager === 'yarn' ? 'info' : 'view',
          `sim@${target}`,
          'version',
          '--json',
        ],
        { env, capture: true }
      ),
      packageManager
    )
    const candidate = parseReleaseVersion(version)
    if (candidate.channel !== target) {
      throw new CliUpdateError('The registry resolved Sim to a different release channel.')
    }
    const comparison = compareReleases(candidate, current)
    if (comparison < 0) {
      throw new CliUpdateError(
        `Refusing to downgrade Sim ${currentVersion} to ${version}. Check your package-manager registry settings.`
      )
    }
    if (comparison === 0) {
      write(`Sim ${currentVersion} is already up to date.\n`)
      return
    }
    write(`Updating Sim ${currentVersion} with ${packageManager} (sim@${version})…\n`)
    const args =
      packageManager === 'npm'
        ? ['install', '-g', `sim@${version}`]
        : packageManager === 'yarn'
          ? ['global', 'add', `sim@${version}`]
          : ['add', '-g', `sim@${version}`]
    await run(packageManager, args, { env, capture: false })
    if (readInstalledVersion(installedEntry) !== version) {
      throw new CliUpdateError('The package manager did not install the expected Sim version.')
    }
    write(
      `Updated Sim ${currentVersion} → ${version}. The next invocation will use the new version.\n`
    )
  } finally {
    await release().catch((cause: unknown) => {
      throw new CliUpdateError(`Cannot release the Sim update lock: ${getErrorMessage(cause)}`, {
        cause,
      })
    })
  }
}
