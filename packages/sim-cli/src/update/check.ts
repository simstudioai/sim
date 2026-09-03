/**
 * The once-a-day "there is a newer sim" notice.
 *
 * It exists because a missing subcommand is indistinguishable from a feature
 * that was never built: someone on 2.1.2 looking for `sim tools execute` — added
 * in 2.1.5 — sees a help listing without it and concludes the CLI cannot do it.
 * The version is the only thing that can tell them otherwise.
 *
 * Everything here fails silently. A courtesy notice that breaks a command, or
 * that writes anything to stdout, is worse than no notice at all.
 */

import { spawn } from 'node:child_process'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { updateCachePath } from '../config/paths'
import { CLI_VERSION } from '../version'

/** How long a cached check suppresses another request. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/** Courtesy work gets a short deadline independent of command request timeouts. */
const REGISTRY_TIMEOUT_MS = 1000

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/** Published package name used in both the registry path and upgrade command. */
const PACKAGE_NAME = 'sim'

/** Relative to the registry root, and about a hundred bytes of response. */
const DIST_TAGS_PATH = `-/package/${PACKAGE_NAME}/dist-tags`

/** Bounds responses from the environment-configurable registry host. */
const MAX_RESPONSE_BYTES = 64 * 1024

/** Far above the small timestamp-only cache while still bounding hostile files. */
const MAX_CACHE_BYTES = 4 * 1024

/** Stable SemVer, with optional build metadata that does not affect precedence. */
const STABLE_VERSION_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

type StableVersion = readonly [major: number, minor: number, patch: number]

/** Parses only stable versions because prerelease installations are never notified. */
function parseStableVersion(version: string): StableVersion | null {
  const match = STABLE_VERSION_PATTERN.exec(version)
  if (!match) return null
  const parsed = [Number(match[1]), Number(match[2]), Number(match[3])] as const
  return parsed.every(Number.isSafeInteger) ? parsed : null
}

function isNewerVersion(candidate: StableVersion, current: StableVersion): boolean {
  if (candidate[0] !== current[0]) return candidate[0] > current[0]
  if (candidate[1] !== current[1]) return candidate[1] > current[1]
  return candidate[2] > current[2]
}

/** Covers CI jobs that allocate a terminal despite being non-interactive. */
const CI_VARIABLES = [
  'CI',
  'GITHUB_ACTIONS',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BUILDKITE',
] as const

/** The shape written to the update cache. */
interface UpdateCacheEntry {
  /** Unknown cache versions are treated as absent. */
  version: 1
  checkedAt: string
}

const CACHE_VERSION = 1

export interface UpdateCheckOptions {
  /** Current working directory. Injected so project-local installation detection is testable. */
  cwd?: string
  currentVersion?: string
  env?: NodeJS.ProcessEnv
  /** Whether stderr is a terminal. Injected so the suppression rule is testable. */
  isTty?: boolean
  /** Location of the running module, used to recognise npx and local builds. */
  modulePath?: string
  now?: Date
  /** Registry transport. Injectable so network behavior can be tested without global state. */
  registryRequest?: RegistryRequest
  write?: (message: string) => void
}

interface RegistryRequestOptions {
  headers: Record<string, string>
  maxResponseBytes: number
  timeoutMs: number
}

type RegistryRequest = (url: URL, options: RegistryRequestOptions) => Promise<string | null>

/** Makes adjacent temporary files unique across writes in this process. */
let cacheWriteSequence = 0

/** Anything but unset, empty, `0` or `false` turns a switch on. */
function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

/** Whether the package is installed in a node_modules tree above the working directory. */
function isProjectLocalInstall(modulePath: string, cwd: string): boolean {
  const normalizedModulePath = normalizeModulePath(modulePath)
  const nodeModulesIndex = normalizedModulePath.indexOf('/node_modules/')
  if (nodeModulesIndex < 0) return false

  const installRoot = normalizedModulePath.slice(0, nodeModulesIndex)
  const workingDirectory = normalizeModulePath(cwd).replace(/\/+$/, '')
  return workingDirectory === installRoot || workingDirectory.startsWith(`${installRoot}/`)
}

/** Skips ephemeral, project-local, and checkout installs that global advice cannot update. */
function isUnadvisableInstall(modulePath: string, env: NodeJS.ProcessEnv, cwd: string): boolean {
  const normalized = normalizeModulePath(modulePath)
  return (
    env.npm_command === 'exec' ||
    normalized.includes('/_npx/') ||
    normalized.includes('/packages/sim-cli/') ||
    isProjectLocalInstall(modulePath, cwd)
  )
}

/** Normalizes separators and case before installation-path comparisons. */
function normalizeModulePath(modulePath: string): string {
  return modulePath.replace(/\\/g, '/').toLowerCase()
}

/**
 * The full dist-tags URL, honouring a configured mirror.
 *
 * A configured private registry keeps its path and query. `.npmrc` is not read;
 * supporting its scoped configuration and auth is outside this courtesy check.
 */
function registryUrl(env: NodeJS.ProcessEnv): URL | null {
  const fallback = new URL(DIST_TAGS_PATH, DEFAULT_REGISTRY)
  const configured = env.npm_config_registry?.trim()
  if (!configured) return fallback
  try {
    const base = new URL(configured)
    if (base.protocol !== 'http:' && base.protocol !== 'https:') return null
    if (base.username || base.password) return null
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${DIST_TAGS_PATH}`
    return base
  } catch {
    return null
  }
}

const REGISTRY_REQUEST_SCRIPT = `
let input = ''
process.stdin.setEncoding('utf8')
for await (const chunk of process.stdin) input += chunk

try {
  const { url, headers, maxResponseBytes, timeoutMs } = JSON.parse(input)
  const deadline = setTimeout(() => process.exit(1), timeoutMs)
  const response = await fetch(url, { headers, redirect: 'error' })
  const declared = Number(response.headers.get('content-length'))

  if (!response.ok || !response.body || (Number.isFinite(declared) && declared > maxResponseBytes)) {
    process.exit(1)
  }

  const reader = response.body.getReader()
  const chunks = []
  let seen = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    seen += value.byteLength
    if (seen > maxResponseBytes) {
      process.exit(1)
    }
    chunks.push(Buffer.from(value))
  }

  clearTimeout(deadline)
  process.stdout.write(Buffer.concat(chunks), () => process.exit(0))
} catch {
  process.exit(1)
}
`

/** Preserves proxy/TLS settings without copying CLI credentials into the probe. */
function registryProcessEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    const normalized = key.toLowerCase()
    if (normalized === 'npm_config_registry' || normalized === 'sim_api_key') delete env[key]
  }
  return env
}

/**
 * Makes one request in a process whose lifetime is owned entirely by this check.
 *
 * Neither a Fetch abort nor `ClientRequest.destroy()` can cancel every pending
 * operation: Undici may retain a connection attempt, and the native client
 * cannot cancel an OS `dns.lookup()`. Terminating this child at the deadline
 * closes both escape hatches. Input travels over stdin rather than argv or the
 * environment so a configured registry credential cannot appear in a process
 * listing.
 */
function requestRegistry(
  url: URL,
  { headers, maxResponseBytes, timeoutMs }: RegistryRequestOptions
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const proxyArguments = process.execArgv.filter(
      (argument) => argument === '--use-env-proxy' || argument === '--no-use-env-proxy'
    )
    const child = spawn(
      process.execPath,
      [...proxyArguments, '--input-type=module', '--eval', REGISTRY_REQUEST_SCRIPT],
      {
        env: registryProcessEnv(),
        killSignal: 'SIGKILL',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: timeoutMs,
        windowsHide: true,
      }
    )
    const chunks: Buffer[] = []
    let failed = false
    let seen = 0

    child.stdout.on('data', (chunk: Buffer) => {
      seen += chunk.byteLength
      if (seen > maxResponseBytes) {
        failed = true
        child.kill('SIGKILL')
        return
      }
      chunks.push(chunk)
    })
    child.stdout.on('error', () => {
      failed = true
      child.kill('SIGKILL')
    })
    child.stdin.on('error', () => {})
    child.once('error', reject)
    child.once('close', (code) => {
      resolve(code === 0 && !failed ? Buffer.concat(chunks).toString('utf8') : null)
    })
    child.stdin.end(JSON.stringify({ headers, maxResponseBytes, timeoutMs, url: url.href }))
  })
}

/**
 * The published dist-tags, or null if anything at all goes wrong.
 *
 * `-/package/sim/dist-tags` is about a hundred bytes and answers exactly the
 * question asked. The abbreviated packument would be tens of kilobytes and list
 * every version ever published.
 *
 * The User-Agent is cut down to the bare version: the full one from
 * `version.ts` carries the Node version, platform and architecture, which is
 * useful in our own logs and gratuitous to hand a third party.
 */
async function fetchDistTags(
  env: NodeJS.ProcessEnv,
  request: RegistryRequest
): Promise<Record<string, string> | null> {
  try {
    const url = registryUrl(env)
    if (!url) return null
    const text = await request(url, {
      headers: { accept: 'application/json', 'user-agent': `${PACKAGE_NAME}-cli/${CLI_VERSION}` },
      maxResponseBytes: MAX_RESPONSE_BYTES,
      timeoutMs: REGISTRY_TIMEOUT_MS,
    })
    if (text === null || Buffer.byteLength(text) > MAX_RESPONSE_BYTES) return null
    const body: unknown = JSON.parse(text)
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    const tags: Record<string, string> = {}
    for (const [tag, version] of Object.entries(body)) {
      if (typeof version === 'string') tags[tag] = version
    }
    return tags
  } catch {
    return null
  }
}

function readCache(path: string): UpdateCacheEntry | null {
  let descriptor: number | null = null
  try {
    if (!lstatSync(path).isFile()) return null
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW)
    const descriptorStats = fstatSync(descriptor)
    if (!descriptorStats.isFile() || descriptorStats.size > MAX_CACHE_BYTES) {
      return null
    }

    const buffer = Buffer.allocUnsafe(MAX_CACHE_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.byteLength) {
      const count = readSync(
        descriptor,
        buffer,
        bytesRead,
        buffer.byteLength - bytesRead,
        bytesRead
      )
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > MAX_CACHE_BYTES) return null

    const parsed: unknown = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const entry = parsed as Partial<UpdateCacheEntry>
    if (entry.version !== CACHE_VERSION) return null
    if (typeof entry.checkedAt !== 'string' || Number.isNaN(Date.parse(entry.checkedAt)))
      return null
    return {
      version: CACHE_VERSION,
      checkedAt: entry.checkedAt,
    }
  } catch {
    return null
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {}
    }
  }
}

/**
 * Records that a check happened, whether or not it produced an answer.
 *
 * Stamping on failure too is what keeps a blackholed registry costing one second
 * a day instead of one second per command.
 *
 * Failures are ignored because the cache is best-effort. An exclusive adjacent
 * temporary file makes replacement atomic without modifying a linked target.
 */
function writeCache(path: string, entry: UpdateCacheEntry): void {
  let descriptor: number | null = null
  let temporaryCreated = false
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${cacheWriteSequence++}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    descriptor = openSync(temporaryPath, 'wx', 0o644)
    temporaryCreated = true
    writeFileSync(descriptor, `${JSON.stringify(entry, null, 2)}\n`)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporaryPath, path)
    temporaryCreated = false
  } catch {
  } finally {
    if (descriptor !== null) {
      try {
        closeSync(descriptor)
      } catch {}
    }
    if (temporaryCreated) {
      try {
        unlinkSync(temporaryPath)
      } catch {}
    }
  }
}

/** Treats future timestamps as stale in case the clock moved backward. */
function isFresh(entry: UpdateCacheEntry, now: Date): boolean {
  const age = now.getTime() - Date.parse(entry.checkedAt)
  return age >= 0 && age < CHECK_INTERVAL_MS
}

/**
 * The command that upgrades *this* installation.
 *
 * The path is asked first because it describes the installation; the
 * environment is a fallback because for a globally installed CLI it usually
 * describes nothing but the shell that happened to invoke it.
 */
export function upgradeCommand(
  modulePath: string = fileURLToPath(import.meta.url),
  env: NodeJS.ProcessEnv = process.env
): string {
  const target = `${PACKAGE_NAME}@latest`
  const normalized = normalizeModulePath(modulePath)

  if (normalized.includes('.bun/install/global')) return `bun add -g ${target}`
  if (normalized.includes('/pnpm/') || normalized.includes('/.pnpm/')) {
    return `pnpm add -g ${target}`
  }
  if (normalized.includes('/.yarn/') || normalized.includes('/yarn/')) {
    return `yarn global add ${target}`
  }

  const agent = env.npm_config_user_agent ?? ''
  if (agent.startsWith('pnpm/')) return `pnpm add -g ${target}`
  if (agent.startsWith('yarn/')) return `yarn global add ${target}`
  if (agent.startsWith('bun/')) return `bun add -g ${target}`

  return `npm install -g ${target}`
}

/**
 * Uses a daily cache before telling the user their installation is out of date.
 *
 * Wired as a root `preAction` hook rather than a teardown in the entrypoint for
 * two structural reasons: commander answers `--help` and `--version` during
 * parsing, before any action hook runs, so the two most latency-sensitive
 * invocations are excluded by construction rather than by a check; and some
 * commands call `process.exit` directly, which a `finally` would never see.
 *
 * Never throws, writes only plain text to stderr, and stays silent when stderr
 * is redirected. The caller runs this before the user's actual command.
 */
export async function announceUpdateIfAvailable(options: UpdateCheckOptions = {}): Promise<void> {
  try {
    const env = options.env ?? process.env
    const isTty = options.isTty ?? process.stderr.isTTY === true
    const modulePath = options.modulePath ?? fileURLToPath(import.meta.url)
    const cwd = options.cwd ?? process.cwd()
    const now = options.now ?? new Date()

    if (isEnabled(env.SIM_NO_UPDATE_CHECK)) return
    if (!isTty) return
    if (CI_VARIABLES.some((variable) => isEnabled(env[variable]))) return
    if (isUnadvisableInstall(modulePath, env, cwd)) return

    const currentVersion = options.currentVersion ?? CLI_VERSION
    const current = parseStableVersion(currentVersion)
    if (!current) return

    const cachePath = updateCachePath()
    const cached = readCache(cachePath)
    if (cached && isFresh(cached, now)) return

    const tags = await fetchDistTags(env, options.registryRequest ?? requestRegistry)
    const latest = tags?.latest ?? null
    const available = latest ? parseStableVersion(latest) : null
    writeCache(cachePath, {
      version: CACHE_VERSION,
      checkedAt: now.toISOString(),
    })
    if (!latest || !available) return

    if (!isNewerVersion(available, current)) return

    const write = options.write ?? ((message: string) => void process.stderr.write(message))
    write(
      `Update available: sim ${currentVersion} → ${latest}. Run: ${upgradeCommand(modulePath, env)}\n`
    )
  } catch {}
}
