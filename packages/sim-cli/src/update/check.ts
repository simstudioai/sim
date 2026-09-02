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

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { updateCachePath } from '../config/paths'
import { CLI_VERSION } from '../version'
import { channelOf, compareVersions, parseVersion, type ReleaseChannel } from './semver'

/** How long a check is trusted. The stated contract is one notice per day. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * Deliberately not `SIM_TIMEOUT_SECONDS`, which defaults to an hour: that bound
 * governs work the user asked for, and this is work they did not.
 */
const REGISTRY_TIMEOUT_MS = 1000

const DEFAULT_REGISTRY = 'https://registry.npmjs.org'

/**
 * Set by every CI provider worth naming. `!isTTY` already covers most of them;
 * this catches the ones that allocate a terminal anyway, such as a Buildkite
 * agent or `docker run -t`.
 */
const CI_VARIABLES = [
  'CI',
  'GITHUB_ACTIONS',
  'JENKINS_URL',
  'TEAMCITY_VERSION',
  'BUILDKITE',
] as const

/** The shape written to `~/.sim/update-check.json`. */
interface UpdateCacheEntry {
  /**
   * Forward compatibility hinge. A reader that does not recognise the number
   * treats the file as absent and checks again, so an older CLI can never be
   * confused by a newer one's cache — and neither ever has to migrate it.
   */
  version: 1
  checkedAt: string
  latestVersion: string | null
}

const CACHE_VERSION = 1

export interface UpdateCheckOptions {
  currentVersion?: string
  env?: NodeJS.ProcessEnv
  /** Whether stderr is a terminal. Injected so the suppression rule is testable. */
  isTty?: boolean
  /** Location of the running module, used to recognise npx and local builds. */
  modulePath?: string
  now?: Date
  write?: (message: string) => void
}

/**
 * One notice per process, no matter how the hook is reached. Commander runs a
 * single action per parse, so this is belt and braces rather than load-bearing.
 */
let announced = false

/** Test seam: the guard above is process-global, and each test needs it clear. */
export function resetUpdateCheck(): void {
  announced = false
}

/** Anything but unset, empty, `0` or `false` turns a switch on. */
function isEnabled(value: string | undefined): boolean {
  if (value === undefined) return false
  const normalized = value.trim().toLowerCase()
  return normalized !== '' && normalized !== '0' && normalized !== 'false'
}

/**
 * Whether this installation is one a "please upgrade" line cannot help.
 *
 * `npx` resolves the dist-tag on every invocation, so its user is by definition
 * already current. A checkout is the sharper case: the repo manifest trails npm
 * permanently and by design, because the publish workflow bumps the version
 * in-job under `permissions: contents: read` and never commits it back. Without
 * this, every Sim engineer running a local build would be told daily to upgrade
 * to a version their own tree already contains.
 */
function isUnadvisableInstall(modulePath: string): boolean {
  const normalized = modulePath.replace(/\\/g, '/')
  return normalized.includes('/_npx/') || normalized.includes('/packages/sim-cli/')
}

/**
 * The registry to ask. `npm_config_registry` is only set when the CLI is invoked
 * through a package-manager script, so this is inconsistent by nature — but the
 * case it rescues is real: behind a mirror with `registry.npmjs.org` firewalled,
 * the default would fail forever while the mirror holds the right answer.
 *
 * `.npmrc` is deliberately not parsed. That is an INI format with scopes and
 * auth tokens, and reading it is where a courtesy check would start growing.
 */
function registryBase(env: NodeJS.ProcessEnv): string {
  const configured = env.npm_config_registry?.trim()
  if (!configured) return DEFAULT_REGISTRY
  try {
    const url = new URL(configured)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return configured.endsWith('/') ? configured : `${configured}/`
    }
  } catch {
    // An unparseable value is not worth reporting; the default still works.
  }
  return DEFAULT_REGISTRY
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
async function fetchDistTags(env: NodeJS.ProcessEnv): Promise<Record<string, string> | null> {
  try {
    const response = await fetch(new URL('-/package/sim/dist-tags', registryBase(env)), {
      headers: { accept: 'application/json', 'user-agent': `sim-cli/${CLI_VERSION}` },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
    // Some proxies answer with an HTML error page under a 200, so the values are
    // checked rather than assumed.
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
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const entry = parsed as Partial<UpdateCacheEntry>
    if (entry.version !== CACHE_VERSION) return null
    if (typeof entry.checkedAt !== 'string' || Number.isNaN(Date.parse(entry.checkedAt)))
      return null
    return {
      version: CACHE_VERSION,
      checkedAt: entry.checkedAt,
      latestVersion: typeof entry.latestVersion === 'string' ? entry.latestVersion : null,
    }
  } catch {
    // Absent, unreadable, or truncated by an interleaved writer — all of which
    // mean the same thing here: check again.
    return null
  }
}

/**
 * Records that a check happened, whether or not it produced an answer.
 *
 * Stamping on failure too is what keeps a blackholed registry costing one second
 * a day instead of one second per command.
 *
 * There is no temp-file-and-rename. Two concurrent invocations can interleave
 * and truncate this file; the reader treats a truncated file as no cache, so the
 * whole cost of the race is one extra HTTP request.
 */
function writeCache(path: string, entry: UpdateCacheEntry): void {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`, { mode: 0o644 })
  } catch {
    // A read-only home directory is ordinary in a container, and it must not
    // stop the command the user actually ran.
  }
}

/** Whether a recorded check is recent enough to skip this one. */
function isFresh(entry: UpdateCacheEntry, now: Date): boolean {
  const age = now.getTime() - Date.parse(entry.checkedAt)
  // A negative age means the clock moved backwards since the write. Treating it
  // as fresh would suppress the notice until the clock caught up, which after a
  // one-off jump forward is forever.
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
  channel: ReleaseChannel,
  modulePath: string = fileURLToPath(import.meta.url),
  env: NodeJS.ProcessEnv = process.env
): string {
  const target = `sim@${channel}`
  const normalized = modulePath.replace(/\\/g, '/').toLowerCase()

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
 * Tells the user once a day when the channel they installed from has moved on.
 *
 * Wired as a root `preAction` hook rather than a teardown in the entrypoint for
 * two structural reasons: commander answers `--help` and `--version` during
 * parsing, before any action hook runs, so the two most latency-sensitive
 * invocations are excluded by construction rather than by a check; and some
 * commands call `process.exit` directly, which a `finally` would never see.
 *
 * Never throws. The caller is a hook in front of the user's actual command.
 */
export async function announceUpdateIfAvailable(options: UpdateCheckOptions = {}): Promise<void> {
  try {
    if (announced) return

    const env = options.env ?? process.env
    const isTty = options.isTty ?? process.stderr.isTTY === true
    const modulePath = options.modulePath ?? fileURLToPath(import.meta.url)
    const now = options.now ?? new Date()

    if (isEnabled(env.SIM_NO_UPDATE_CHECK)) return
    // stderr is where this goes, so a redirected stderr means it would land in a
    // log file or a pipeline rather than in front of a person.
    if (!isTty) return
    if (CI_VARIABLES.some((variable) => isEnabled(env[variable]))) return
    if (isUnadvisableInstall(modulePath)) return

    const currentVersion = options.currentVersion ?? CLI_VERSION
    const current = parseVersion(currentVersion)
    if (!current) return

    const channel = channelOf(current)
    // Prereleases publish on every push to their branch, so telling a prerelease
    // user to upgrade would be both correct and useless — the advice is stale
    // again within the hour, and they opted into moving fast in the first place.
    if (channel !== 'latest') return

    const cachePath = updateCachePath()
    const cached = readCache(cachePath)
    if (cached && isFresh(cached, now)) return

    const tags = await fetchDistTags(env)
    const latest = tags?.[channel] ?? null
    writeCache(cachePath, {
      version: CACHE_VERSION,
      checkedAt: now.toISOString(),
      latestVersion: latest,
    })
    if (!latest) return

    const available = parseVersion(latest)
    if (!available || compareVersions(available, current) <= 0) return

    announced = true
    const write = options.write ?? ((message: string) => void process.stderr.write(message))
    // Unstyled on purpose: chalk decides on stdout, so `sim workflows list | jq`
    // from a terminal would silently drop the colour here even though stderr is
    // still a terminal. Plain text is also the whole answer to NO_COLOR.
    write(
      `Update available: sim ${currentVersion} → ${latest}. Run: ${upgradeCommand(channel, modulePath, env)}\n`
    )
  } catch {
    // Nothing this function does is worth failing a command over.
  }
}
