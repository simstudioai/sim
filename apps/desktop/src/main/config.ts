import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'
import { isLoopbackHostname } from '@sim/security/ssrf'

const logger = createLogger('DesktopConfig')

/**
 * The server origin fresh installs point at. `scripts/build.ts` can bake an
 * override in via SIM_DESKTOP_DEFAULT_ORIGIN (per-environment builds: dev,
 * staging, localhost); official builds default to production. The esbuild
 * define replaces the env read at bundle time, so a packaged app never
 * consults the runtime environment for this. http is accepted only for
 * loopback origins (the localhost dev-server channel).
 */
function isValidBakedOrigin(origin: string | undefined): origin is string {
  if (!origin) return false
  try {
    const url = new URL(origin)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && isLoopbackHostname(url.hostname)
  } catch {
    return false
  }
}

export const DEFAULT_ORIGIN = isValidBakedOrigin(process.env.SIM_DESKTOP_DEFAULT_ORIGIN)
  ? process.env.SIM_DESKTOP_DEFAULT_ORIGIN
  : 'https://sim.ai'

/**
 * The environment a build is keyed to, derived from its baked default origin.
 * Channel drives the app's identity — its name and therefore its userData
 * directory and single-instance lock — so one developer can keep a prod,
 * staging, dev, and localhost install side by side, each with its own
 * settings, sessions, and update feed.
 */
export type DesktopChannel = 'prod' | 'staging' | 'dev' | 'local'

export function channelForOrigin(origin: string): DesktopChannel {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    if (isLoopbackHostname(host)) return 'local'
    if (host === 'dev.sim.ai' || host.endsWith('.dev.sim.ai')) return 'dev'
    if (host === 'staging.sim.ai' || host.endsWith('.staging.sim.ai')) return 'staging'
    return 'prod'
  } catch {
    return 'prod'
  }
}

/**
 * Per-channel app names. Prod keeps the plain name every existing install
 * already has (its userData must not move); the others are distinct apps.
 */
export const APP_NAME_FOR_CHANNEL: Record<DesktopChannel, string> = {
  prod: 'Sim',
  staging: 'Sim Staging',
  dev: 'Sim Dev',
  local: 'Sim Local',
}

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface BrowserKnownSiteSetting {
  hostname: string
  lastVisitedAt: string
  signInCompletedAt?: string
}

export interface DesktopSettings {
  origin: string
  windowBounds?: WindowBounds
  zoomLevel?: number
  lastRoute?: string
  themeBackground?: 'dark' | 'light'
  blockThirdPartyAnalytics?: boolean
  trayEnabled?: boolean
  notificationsEnabled?: boolean
  notificationSounds?: boolean
  notificationsOnlyWhenUnfocused?: boolean
  launchAtLogin?: boolean
  autoDownloadUpdates?: boolean
  /**
   * Top-level sites visited in the dedicated agent-browser profile. This is
   * local inference metadata only; no cookies, credentials, or account data
   * are persisted here.
   */
  browserKnownSites?: BrowserKnownSiteSetting[]
  /**
   * URLs of user-pinned agent-browser tabs, in pinned-strip order. Pinned
   * pages are restored locally when the browser resource is opened again.
   */
  browserPinnedTabUrls?: string[]
}

export type OriginValidation = { ok: true; origin: string } | { ok: false; error: string }

/**
 * Validates a user-supplied server origin. HTTPS is required except for
 * localhost, which may use HTTP for local development and self-host testing.
 * Returns the normalized origin (scheme + host + port, no path).
 */
export function validateOriginInput(raw: string): OriginValidation {
  const trimmed = raw.trim()
  if (!trimmed) {
    return { ok: false, error: 'Server URL is required' }
  }
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    return { ok: false, error: 'Enter a full URL, like https://sim.example.com' }
  }
  if (url.username || url.password) {
    return { ok: false, error: 'Server URL must not contain credentials' }
  }
  if (url.protocol === 'https:') {
    return { ok: true, origin: url.origin }
  }
  if (url.protocol === 'http:' && isLoopbackHostname(url.hostname)) {
    return { ok: true, origin: url.origin }
  }
  return { ok: false, error: 'Server URL must use HTTPS (HTTP is allowed for localhost only)' }
}

/**
 * Maps a server origin to its cookie/storage partition. Each origin gets an
 * isolated persistent partition so sessions never leak across instances.
 */
export function partitionForOrigin(origin: string): string {
  if (origin === DEFAULT_ORIGIN) {
    return 'persist:sim'
  }
  return `persist:sim-${encodeURIComponent(origin)}`
}

/**
 * Validates that a value is a same-origin absolute path suitable for reload
 * targets and returnTo handoffs (single leading slash, no scheme or host).
 */
export function isSafeInternalPath(path: unknown): path is string {
  if (typeof path !== 'string' || path.length === 0 || path.length > 2048) {
    return false
  }
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\')) {
    return false
  }
  try {
    const url = new URL(path, 'https://internal.invalid')
    return url.origin === 'https://internal.invalid'
  } catch {
    return false
  }
}

const DEFAULT_SETTINGS: DesktopSettings = {
  origin: DEFAULT_ORIGIN,
  blockThirdPartyAnalytics: true,
  notificationsEnabled: true,
  notificationSounds: true,
  notificationsOnlyWhenUnfocused: true,
  launchAtLogin: false,
  autoDownloadUpdates: true,
}

export interface ConfigStore {
  readonly filePath: string
  getOrigin(): string
  setOrigin(origin: string): OriginValidation
  get<K extends keyof DesktopSettings>(key: K): DesktopSettings[K]
  set<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): void
}

/**
 * Creates the desktop settings store backed by a single JSON file. Writes are
 * atomic (temp file + rename) so a crash mid-write never corrupts settings.
 * The SIM_DESKTOP_ORIGIN environment variable overrides the stored origin,
 * which the e2e harness uses to point the app at a fixture server.
 */
export function createConfigStore(
  filePath: string,
  env: NodeJS.ProcessEnv = process.env
): ConfigStore {
  let settings: DesktopSettings = { ...DEFAULT_SETTINGS }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Partial<DesktopSettings>
    settings = { ...DEFAULT_SETTINGS, ...parsed }
    const validated = validateOriginInput(settings.origin)
    settings.origin = validated.ok ? validated.origin : DEFAULT_ORIGIN
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }

  const envOverride = env.SIM_DESKTOP_ORIGIN ? validateOriginInput(env.SIM_DESKTOP_ORIGIN) : null
  if (env.SIM_DESKTOP_ORIGIN && !envOverride?.ok) {
    logger.warn('Ignoring invalid SIM_DESKTOP_ORIGIN override', { value: env.SIM_DESKTOP_ORIGIN })
  }

  const save = () => {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      const tempPath = `${filePath}.tmp`
      writeFileSync(tempPath, JSON.stringify(settings, null, 2), { mode: 0o600 })
      renameSync(tempPath, filePath)
    } catch (error) {
      logger.error('Failed to persist desktop settings', { error })
    }
  }

  return {
    filePath,
    getOrigin() {
      if (envOverride?.ok) {
        return envOverride.origin
      }
      return settings.origin
    },
    setOrigin(raw: string) {
      const validated = validateOriginInput(raw)
      if (validated.ok) {
        settings.origin = validated.origin
        save()
      }
      return validated
    },
    get(key) {
      return settings[key]
    },
    set(key, value) {
      if (settings[key] === value) {
        return
      }
      settings[key] = value
      save()
    },
  }
}
