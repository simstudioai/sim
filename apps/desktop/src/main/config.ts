import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createLogger } from '@sim/logger'

const logger = createLogger('DesktopConfig')

export const DEFAULT_ORIGIN = 'https://sim.ai'

/** Loopback hostnames that may use plain HTTP (dev + self-host testing). */
export const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export interface WindowBounds {
  x?: number
  y?: number
  width: number
  height: number
}

export interface DesktopSettings {
  origin: string
  windowBounds?: WindowBounds
  zoomLevel?: number
  lastRoute?: string
  themeBackground?: 'dark' | 'light'
  blockThirdPartyAnalytics?: boolean
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
  if (url.protocol === 'http:' && LOCAL_HOSTNAMES.has(url.hostname)) {
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
