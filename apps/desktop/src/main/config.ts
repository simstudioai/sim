import { readFileSync } from 'node:fs'
import type { DesktopZoomPercent, TerminalAppearanceTheme } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { isLoopbackHostname } from '@sim/security/ssrf'
import { writeJsonFileAtomicallySync } from '@/main/atomic-json-file'

/** settings.json is meant to be readable when a user opens it. */
const SETTINGS_INDENT = 2

const logger = createLogger('DesktopConfig')

/**
 * The server origin fresh installs point at. `scripts/build.ts` can bake an
 * override in via SIM_DESKTOP_DEFAULT_ORIGIN (per-environment builds: dev,
 * staging, localhost); official builds default to production. The esbuild
 * define replaces the env read at bundle time, so a packaged app never
 * consults the runtime environment for this. http is accepted only for
 * loopback origins (the localhost dev-server channel).
 *
 * This must be the origin the server actually *serves*, not a hostname that
 * redirects to it. Every environment canonicalizes the apex to `www` (the load
 * balancer 301s `sim.ai` → `www.sim.ai`), and the navigation guards compare
 * origins for exact equality — so an apex origin here silently leaves every
 * page off-origin, which reclassifies social login as an integration connect
 * and strands the sign-in in the browser with no way back.
 *
 * Changing this does NOT reach installs that already persisted the old value —
 * see {@link canonicalOrigin}.
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
  : 'https://www.sim.ai'

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
  browserEnabled?: boolean
  /** Whether omnibox typing may request live Google search completions. */
  browserSearchSuggestionsEnabled?: boolean
  terminalEnabled?: boolean
  /** Device-wide browser page appearance; `app` follows Sim. */
  browserTheme?: 'app' | 'light' | 'dark'
  /** Device-wide default zoom for built-in browser pages. */
  browserDefaultZoom?: DesktopZoomPercent
  /** Folder where the built-in browser saves downloaded files. */
  browserDownloadDirectory?: string
  /** Device-wide terminal canvas appearance; `app` follows Sim. */
  terminalTheme?: TerminalAppearanceTheme
  /** Device-wide default zoom for built-in terminal canvases. */
  terminalDefaultZoom?: DesktopZoomPercent
  /**
   * Top-level sites visited in the dedicated agent-browser profile. This is
   * local inference metadata only; no cookies, credentials, or account data
   * are persisted here.
   */
  browserKnownSites?: BrowserKnownSiteSetting[]
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
 * Stored origins that must be rewritten on load, because the app can no
 * longer work correctly while pointed at them.
 *
 * Every install that shipped before DEFAULT_ORIGIN moved to www persisted the
 * apex on first launch, and a build-time change alone never reaches them —
 * the stored value wins over the default. Two things break if they keep it:
 * social login is misclassified as an integration connect (see DEFAULT_ORIGIN),
 * and, because the apex no longer equals DEFAULT_ORIGIN, partitionForOrigin
 * would move them off `persist:sim` onto a fresh, empty jar — signing out
 * every existing user on update. Rewriting to the canonical origin fixes the
 * first and avoids the second: www.sim.ai IS the new DEFAULT_ORIGIN, so the
 * partition stays `persist:sim` and the session survives.
 *
 * Keyed on the exact stored string, not a host pattern: this rewrites what a
 * previous BUILD wrote, never a deliberate operator choice like a self-hosted
 * origin that happens to redirect.
 */
const ORIGIN_REWRITES: Readonly<Record<string, string>> = {
  'https://sim.ai': 'https://www.sim.ai',
}

/** Applies ORIGIN_REWRITES to a validated origin. */
export function canonicalOrigin(origin: string): string {
  return ORIGIN_REWRITES[origin] ?? origin
}

/**
 * Whether an origin is one of Sim's own deployments rather than a self-hosted
 * one. Sim-operated resources — the public status page above all — describe
 * only these, so a shell pointed elsewhere must not be offered them: telling a
 * self-hoster whose server is down to consult a page that is always green
 * sends the person who most needs an answer to the one place that has none.
 */
export function isSimCloudOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase()
    return host === 'sim.ai' || host.endsWith('.sim.ai')
  } catch {
    return false
  }
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
  browserEnabled: true,
  browserSearchSuggestionsEnabled: true,
  terminalEnabled: true,
}

export interface ConfigStore {
  readonly filePath: string
  isPersistenceAvailable(): boolean
  getOrigin(): string
  setOrigin(origin: string): OriginValidation
  get<K extends keyof DesktopSettings>(key: K): DesktopSettings[K]
  set<K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]): void
  /** Writes any debounced change immediately and reports whether persistence is healthy. */
  flush(): boolean
}

/**
 * How long settings changes coalesce before hitting disk. Long enough to
 * absorb a burst (a resize drag, a run of navigations), short enough that a
 * crash loses nothing a user would notice.
 */
const SAVE_DEBOUNCE_MS = 400

/**
 * Whether a settings write is a no-op. Identity first, then structurally,
 * because the array- and object-valued settings are rebuilt
 * on every write and would never be reference-equal.
 */
function isSameSetting(current: unknown, next: unknown): boolean {
  if (current === next) return true
  return JSON.stringify(current) === JSON.stringify(next)
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
  let rewroteOrigin = false
  let persistenceBlocked = false
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      persistenceBlocked = true
    } else {
      const loadedSettings = { ...DEFAULT_SETTINGS, ...(parsed as Partial<DesktopSettings>) }
      const validated = validateOriginInput(loadedSettings.origin)
      if (!validated.ok) {
        persistenceBlocked = true
      } else {
        const loaded = validated.origin
        settings = loadedSettings
        settings.origin = canonicalOrigin(loaded)
        rewroteOrigin = settings.origin !== loaded
        if (rewroteOrigin) {
          logger.info('Rewrote stored server origin to its canonical form', {
            from: loaded,
            to: settings.origin,
          })
        }
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      persistenceBlocked = true
    }
  }
  if (persistenceBlocked) {
    settings = { ...DEFAULT_SETTINGS }
    rewroteOrigin = false
    logger.warn('Desktop settings persistence is unavailable because the existing file is invalid')
  }

  const envOverride = env.SIM_DESKTOP_ORIGIN ? validateOriginInput(env.SIM_DESKTOP_ORIGIN) : null
  if (env.SIM_DESKTOP_ORIGIN && !envOverride?.ok) {
    logger.warn('Ignoring invalid SIM_DESKTOP_ORIGIN override', { value: env.SIM_DESKTOP_ORIGIN })
  }

  let saveTimer: ReturnType<typeof setTimeout> | null = null

  /** Writes the whole file now and cancels any pending debounced write. */
  const writeNow = (): boolean => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = null
    if (persistenceBlocked) return false
    try {
      writeJsonFileAtomicallySync(filePath, settings, SETTINGS_INDENT)
      return true
    } catch (error) {
      persistenceBlocked = true
      logger.error('Failed to persist desktop settings', { error })
      return false
    }
  }

  /**
   * Coalesces writes. `save` is a synchronous mkdir + write + rename of the
   * whole settings file on the main thread, and the callers are not rare: the
   * known-sites list is rewritten on browser navigation and sign-in, pinned
   * tabs on every pin change, window bounds on every resize step. Debouncing
   * here rather than per-caller is what makes that safe by default — two
   * callers had already hand-rolled their own timers, and the ones that had
   * not were paying a full fsync per event.
   */
  const save = () => {
    if (persistenceBlocked || saveTimer) return
    saveTimer = setTimeout(writeNow, SAVE_DEBOUNCE_MS)
    saveTimer.unref?.()
  }

  // Persist a rewrite immediately rather than waiting for the next debounced
  // write: the partition and every navigation check already use the canonical
  // value from here on, so a crash before the next save must not leave the
  // file claiming an origin the running app is no longer using.
  if (rewroteOrigin) {
    writeNow()
  }

  return {
    filePath,
    isPersistenceAvailable() {
      return !persistenceBlocked
    },
    getOrigin() {
      if (envOverride?.ok) {
        return envOverride.origin
      }
      return settings.origin
    },
    setOrigin(raw: string) {
      const validated = validateOriginInput(raw)
      if (!validated.ok) {
        return validated
      }
      // Same canonicalization the load path applies (ORIGIN_REWRITES).
      // Without it, entering the apex origin mid-session persists it and
      // immediately drives the wrong cookie partition and social-login
      // classification for the rest of the session — the load-time rewrite
      // only repairs it on the next launch. The canonical origin is also
      // returned so the caller sees what was actually stored.
      const origin = canonicalOrigin(validated.origin)
      if (persistenceBlocked) {
        const previousOrigin = settings.origin
        try {
          settings.origin = origin
          writeJsonFileAtomicallySync(filePath, settings, SETTINGS_INDENT)
          persistenceBlocked = false
          logger.warn('Recovered desktop settings persistence')
          return { ok: true, origin }
        } catch (error) {
          settings.origin = previousOrigin
          logger.error('Could not recover invalid desktop settings', { error })
          return { ok: false, error: 'Could not repair the desktop settings file' }
        }
      }
      // Re-confirming the origin already stored is the common case in the
      // server picker, and setOrigin's write is a synchronous mkdir + whole-file
      // write + rename on the main thread. There is nothing to persist.
      if (origin === settings.origin) {
        return { ok: true, origin }
      }
      const previousOrigin = settings.origin
      settings.origin = origin
      // Not debounced: changing the origin tears the session down and
      // reloads, so a pending write could be lost on the way out — and this
      // is the one setting whose loss strands the app on the wrong server.
      if (!writeNow()) {
        settings.origin = previousOrigin
        return { ok: false, error: 'Could not save the desktop settings file' }
      }
      return { ok: true, origin }
    },
    get(key) {
      return settings[key]
    },
    set(key, value) {
      // Structural, not `===`. Reference equality can never hold for the array
      // values this store carries (known sites, pinned tabs, window bounds are
      // all freshly built), so the guard was dead for exactly the keys written
      // most often — every one of them fell through to a write.
      if (isSameSetting(settings[key], value)) {
        return
      }
      settings[key] = value
      save()
    },
    flush() {
      return saveTimer ? writeNow() : !persistenceBlocked
    },
  }
}
