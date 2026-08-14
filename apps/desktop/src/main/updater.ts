import { execFile } from 'node:child_process'
import type { DesktopUpdateState } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BrowserWindow } from 'electron'
import { app, dialog, net } from 'electron'
import { isSafeExternalUrl, openExternalSafe } from '@/main/navigation'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopUpdater')

const INITIAL_CHECK_DELAY_MS = 10_000
const PRERELEASE_CHECK_INTERVAL_MS = 5 * 60 * 1000
const STABLE_CHECK_INTERVAL_MS = 30 * 60 * 1000
const UPDATE_CHECK_TIMEOUT_MS = 10_000
const INTERACTIVE_FEEDBACK_TIMEOUT_MS = 12_000
const FEED_STATUS_HEADER = 'x-sim-desktop-update-feed'

export type UpdateChannel = 'latest' | 'staging' | 'dev'

/**
 * The per-environment update feed served by the Sim deployment this shell is
 * pointed at (`/api/desktop/update/latest-mac.yml`). Each environment pins
 * which shell build its clients are offered — dev serves dev builds,
 * staging serves staging builds, prod stable — so the environment, not the client, is the
 * channel. Returns null for origins that can't host a feed.
 */
export function feedUrlForOrigin(origin: string): string | null {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return null
    }
    return `${url.origin}/api/desktop/update`
  } catch {
    return null
  }
}

/**
 * Where the feed rewrites every manifest entry to. Downloads are constrained to
 * this prefix rather than to https alone, so a feed that serves an attacker's
 * host cannot get a bundle in front of the user's Download button.
 */
const RELEASE_ASSET_ORIGIN = 'https://github.com'
const RELEASE_ASSET_PATHS = [
  '/simstudioai/sim/releases/download/',
  '/simstudioai/sim-desktop-releases/releases/download/',
] as const

/** Whether a manifest url is one of our own release assets. */
function isReleaseAssetUrl(rawUrl: string): boolean {
  if (!isSafeExternalUrl(rawUrl)) return false
  try {
    const url = new URL(rawUrl)
    // Compared on the parsed origin and the parsed pathname, never by prefix on
    // the raw string: `https://github.com.evil.example/…` must not pass, and
    // `URL` has already normalized away any `..` segments by this point.
    return (
      url.origin === RELEASE_ASSET_ORIGIN &&
      RELEASE_ASSET_PATHS.some((path) => url.pathname.startsWith(path))
    )
  } catch {
    return false
  }
}

/**
 * Maps the running version to its update channel: prerelease builds follow
 * their prerelease channel, stable builds only ever see stable releases.
 * Channels are strictly isolated — dev/staging builds carry their own app
 * identity (Sim Dev / Sim Staging) and update only via their origin feed;
 * the packaged GitHub fallback feed is stable-only.
 */
export function resolveUpdateChannel(version: string): UpdateChannel {
  if (/-dev(?:\.|$)/.test(version) || /-alpha(?:\.|$)/.test(version)) {
    return 'dev'
  }
  if (/-staging(?:\.|$)/.test(version) || /-beta(?:\.|$)/.test(version)) {
    return 'staging'
  }
  return 'latest'
}

/** Dev/staging shells poll rapidly; production shells use a quieter cadence. */
export function updateCheckIntervalMs(version: string): number {
  return resolveUpdateChannel(version) === 'latest'
    ? STABLE_CHECK_INTERVAL_MS
    : PRERELEASE_CHECK_INTERVAL_MS
}

interface ParsedSemver {
  major: number
  minor: number
  patch: number
  prerelease: string
}

/**
 * Minimal semver parser for the defensive downgrade check (electron-updater
 * already enforces allowDowngrade=false; this guards against a tampered or
 * misconfigured feed).
 */
export function parseSemver(version: string): ParsedSemver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim())
  if (!match) {
    return null
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  }
}

/**
 * Compares two prerelease strings by semver precedence: a missing prerelease
 * outranks any prerelease, dotted identifiers compare left to right, numeric
 * identifiers compare numerically and rank below alphanumeric ones, and a
 * shorter identifier set ranks lower when all preceding fields are equal.
 * Returns <0 when a precedes b, 0 when equal, >0 when a follows b.
 */
function comparePrerelease(a: string, b: string): number {
  if (a === b) {
    return 0
  }
  if (a === '') {
    return 1
  }
  if (b === '') {
    return -1
  }
  const as = a.split('.')
  const bs = b.split('.')
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    const ai = as[i]
    const bi = bs[i]
    if (ai === undefined) {
      return -1
    }
    if (bi === undefined) {
      return 1
    }
    const aNum = /^\d+$/.test(ai)
    const bNum = /^\d+$/.test(bi)
    if (aNum && bNum) {
      const diff = Number(ai) - Number(bi)
      if (diff !== 0) {
        return diff < 0 ? -1 : 1
      }
    } else if (aNum) {
      return -1
    } else if (bNum) {
      return 1
    } else if (ai !== bi) {
      return ai < bi ? -1 : 1
    }
  }
  return 0
}

/**
 * True when candidate is a lower version than current, including a lower
 * prerelease of the same core version. Unparseable versions are treated as
 * downgrades and rejected.
 */
export function isDowngrade(currentVersion: string, candidateVersion: string): boolean {
  const current = parseSemver(currentVersion)
  const candidate = parseSemver(candidateVersion)
  if (!current || !candidate) {
    return true
  }
  const currentCore = [current.major, current.minor, current.patch]
  const candidateCore = [candidate.major, candidate.minor, candidate.patch]
  for (let i = 0; i < 3; i++) {
    if (candidateCore[i] !== currentCore[i]) {
      return candidateCore[i] < currentCore[i]
    }
  }
  return comparePrerelease(candidate.prerelease, current.prerelease) < 0
}

export interface UpdaterDeps {
  getWindow: () => BrowserWindow | null
  events: EventRecorder
  /** The Sim origin this shell is pointed at — hosts the per-env update feed. */
  appOrigin: () => string
  autoDownload?: () => boolean
  /** Pushed on every pipeline state change (renderer update UI). */
  onStateChange?: (state: DesktopUpdateState) => void
  /** Test seam: overrides the lazy electron-updater load. */
  loadAutoUpdater?: () => typeof import('electron-updater')['autoUpdater']
  /** Test seam: overrides the origin feed availability probe. */
  probeOriginFeed?: (feedUrl: string) => Promise<boolean | 'no-release'>
  /**
   * Test seam: overrides Squirrel self-update capability detection (whether
   * the running bundle carries a real Developer ID signature).
   */
  canSelfUpdate?: () => Promise<boolean>
  /** Test seam: overrides the manual-mode manifest fetch (body or null). */
  fetchManifest?: (url: string) => Promise<string | null>
}

export interface UpdaterHandle {
  setAutoDownload(enabled: boolean): void
  /** Current pipeline state for the renderer update UI. */
  getState(): DesktopUpdateState
  /**
   * Renderer-initiated advance: checks for an update, or starts the download
   * when one is already known to be available (auto-download off / manual).
   */
  check(): void
  /**
   * Quit and install a downloaded update (`ready`), or open the manual
   * download for an `available` update on a shell that can't self-update.
   */
  install(): void
  /** Main-process state subscription (menu feedback). Returns unsubscribe. */
  onState(callback: (state: DesktopUpdateState) => void): () => void
}

const NOOP_UPDATER_HANDLE: UpdaterHandle = {
  setAutoDownload: () => {},
  getState: () => ({ status: 'idle' }),
  check: () => {},
  install: () => {},
  onState: () => () => {},
}

/** True when candidate is strictly newer than current. */
export function isNewerVersion(candidateVersion: string, currentVersion: string): boolean {
  if (!parseSemver(candidateVersion)) {
    return false
  }
  return isDowngrade(candidateVersion, currentVersion)
}

/** A signed shell may only install a strictly newer build from its own environment stream. */
function isValidAutomaticUpdate(candidateVersion: string, currentVersion: string): boolean {
  return (
    resolveUpdateChannel(candidateVersion) === resolveUpdateChannel(currentVersion) &&
    isNewerVersion(candidateVersion, currentVersion)
  )
}

/**
 * Whether Squirrel.Mac can swap this bundle in place. It validates a
 * downloaded update against the running app's code signature, so only builds
 * carrying a real Developer ID (a TeamIdentifier) can self-update. Local
 * `install:local` builds and pre-signing CI prereleases are ad-hoc signed
 * (`TeamIdentifier=not set`) and would fail the swap — those shells get the
 * manual pipeline instead.
 */
async function detectSelfUpdateCapability(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true
  }
  const exe = app.getPath('exe')
  const bundleEnd = exe.indexOf('.app/')
  if (bundleEnd < 0) {
    return false
  }
  const bundlePath = exe.slice(0, bundleEnd + 4)
  return new Promise((resolve) => {
    execFile('codesign', ['-dv', '--verbose=2', bundlePath], (error, _stdout, stderr) => {
      if (error) {
        resolve(false)
        return
      }
      const team = /^TeamIdentifier=(.+)$/m.exec(stderr ?? '')
      resolve(team !== null && team[1].trim() !== 'not set')
    })
  })
}

/**
 * One update pipeline behind the shared handle: `check` looks for an update,
 * `advance` performs the `available` action (background download vs opening
 * the download in the browser), `install` performs the `ready` action.
 */
interface UpdateEngine {
  /** `interactive` requests must always publish a terminal state for their waiting UI. */
  check(interactive?: boolean): void
  advance(): void
  install(): void
  setAutoDownload(enabled: boolean): void
}

/**
 * Keeps installed shells current against the per-environment update feed:
 * checks on launch, then every five minutes for dev/staging builds or every
 * thirty minutes for production builds, and mirrors pipeline state to the
 * renderer for the settings update UI and the minimum-shell-version gate.
 *
 * Developer-ID-signed builds use electron-updater (background download,
 * then install and relaunch from an explicit Update action). Builds
 * that can't self-update (ad-hoc signed: local installs, pre-signing CI
 * prereleases) still poll the same feed but surface `available` as a manual
 * download link, so the whole pipeline is testable before signing exists.
 */
export function initUpdater(deps: UpdaterDeps): UpdaterHandle {
  if (!app.isPackaged && !deps.loadAutoUpdater && !deps.canSelfUpdate) {
    return NOOP_UPDATER_HANDLE
  }

  const currentVersion = app.getVersion()
  let state: DesktopUpdateState = { status: 'idle' }
  let installAfterDownload = false
  const listeners = new Set<(state: DesktopUpdateState) => void>()
  const setState = (next: DesktopUpdateState) => {
    state = next
    deps.onStateChange?.(next)
    for (const listener of listeners) {
      listener(next)
    }
  }

  const buildAutoEngine = (): UpdateEngine | null => {
    let autoUpdater: typeof import('electron-updater')['autoUpdater']
    try {
      autoUpdater = deps.loadAutoUpdater
        ? deps.loadAutoUpdater()
        : (require('electron-updater') as typeof import('electron-updater')).autoUpdater
    } catch (error) {
      logger.error('electron-updater unavailable', { error })
      return null
    }

    autoUpdater.channel = resolveUpdateChannel(currentVersion)
    autoUpdater.allowDowngrade = false
    autoUpdater.autoDownload = deps.autoDownload?.() ?? true
    // Explicit Update actions must reopen Sim after Squirrel swaps the bundle.
    autoUpdater.autoRunAppAfterInstall = true
    // Never install without vetting the downloaded version first. Enabled per
    // download in the update-downloaded handler, but only for accepted updates
    // — so a blocked/downgrade build that was already downloaded is never
    // silently installed on quit.
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.logger = null

    let activeCheckId: number | null = null
    let nextCheckId = 0
    let checkTimeout: ReturnType<typeof setTimeout> | null = null
    const finishCheck = () => {
      activeCheckId = null
      if (checkTimeout !== null) {
        clearTimeout(checkTimeout)
        checkTimeout = null
      }
    }

    autoUpdater.on('checking-for-update', () => {
      setState({ status: 'checking' })
    })

    autoUpdater.on('update-not-available', () => {
      finishCheck()
      installAfterDownload = false
      setState({ status: 'idle' })
    })

    autoUpdater.on('update-available', (info) => {
      finishCheck()
      if (!isValidAutomaticUpdate(info.version, currentVersion)) {
        installAfterDownload = false
        autoUpdater.autoInstallOnAppQuit = false
        deps.events.record('update_blocked_version', {
          version: info.version,
          reason: 'not-newer',
        })
        setState({ status: 'idle' })
        return
      }
      deps.events.record('update_check', { available: info.version })
      // With auto-download on, download-progress events follow immediately;
      // `available` is the terminal state only when downloads are manual.
      setState({
        status: autoUpdater.autoDownload ? 'downloading' : 'available',
        version: info.version,
      })
    })

    autoUpdater.on('download-progress', (progress) => {
      setState({
        status: 'downloading',
        version: state.version,
        percent: Math.round(progress.percent),
      })
    })

    autoUpdater.on('update-downloaded', (info) => {
      if (!isValidAutomaticUpdate(info.version, currentVersion)) {
        installAfterDownload = false
        autoUpdater.autoInstallOnAppQuit = false
        deps.events.record('update_blocked_version', { version: info.version })
        setState({ status: 'idle' })
        return
      }
      autoUpdater.autoInstallOnAppQuit = true
      deps.events.record('update_downloaded', { version: info.version })
      setState({ status: 'ready', version: info.version })
      if (installAfterDownload) {
        installAfterDownload = false
        autoUpdater.quitAndInstall()
      }
    })

    autoUpdater.on('error', (error) => {
      finishCheck()
      installAfterDownload = false
      deps.events.record('update_error', { message: getErrorMessage(error, 'unknown') })
      setState({ status: 'error', version: state.version })
    })

    /**
     * Prefer the per-environment feed served by the configured origin; fall
     * back to the packaged GitHub feed when the origin doesn't serve one (an
     * older or partial deployment). The origin feed is channel-resolved
     * server-side, so the client always requests plain `latest-mac.yml`.
     *
     * The fallback is stable-only: prerelease (dev/staging) builds exist
     * solely on their origin feed, and the GitHub feed could only offer them
     * a stable prod-identity artifact their Squirrel identity can't apply —
     * so when the origin feed is down, a prerelease shell skips checking
     * rather than erroring on every cycle. Resolves to whether checks may run.
     */
    const probeOriginFeed =
      deps.probeOriginFeed ??
      (async (feedUrl: string) => {
        const response = await net.fetch(`${feedUrl}/latest-mac.yml`, {
          signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
        })
        if (response.ok) return true
        return response.status === 404 && response.headers.get(FEED_STATUS_HEADER) === 'no-release'
          ? 'no-release'
          : false
      })
    type FeedResolution = 'origin' | 'fallback' | 'no-release' | 'skip'
    let originFeedConfigured = false
    let feedProbeInFlight: Promise<FeedResolution> | null = null
    const resolveFeedForCheck = async (): Promise<FeedResolution> => {
      if (originFeedConfigured) return 'origin'
      const feedUrl = feedUrlForOrigin(deps.appOrigin())
      const stableBuild = resolveUpdateChannel(currentVersion) === 'latest'
      if (!feedUrl) {
        return stableBuild ? 'fallback' : 'skip'
      }
      try {
        const availability = await probeOriginFeed(feedUrl)
        if (availability === 'no-release') {
          return 'no-release'
        }
        if (!availability) {
          throw new Error('feed responded non-OK')
        }
        autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl, channel: 'latest' })
        autoUpdater.channel = 'latest'
        originFeedConfigured = true
        deps.events.record('update_feed', { url: feedUrl })
        return 'origin'
      } catch (error) {
        logger.warn(
          stableBuild
            ? 'Origin update feed unavailable; using default GitHub feed'
            : 'Origin update feed unavailable; prerelease build skips update checks',
          { feedUrl, message: getErrorMessage(error, 'unknown') }
        )
        return stableBuild ? 'fallback' : 'skip'
      }
    }
    const feedForCheck = (): Promise<FeedResolution> => {
      if (originFeedConfigured) return Promise.resolve('origin')
      if (feedProbeInFlight) return feedProbeInFlight
      feedProbeInFlight = resolveFeedForCheck().finally(() => {
        feedProbeInFlight = null
      })
      return feedProbeInFlight
    }

    return {
      check(interactive = false) {
        if (
          activeCheckId !== null ||
          state.status === 'available' ||
          state.status === 'downloading' ||
          state.status === 'ready'
        ) {
          return
        }
        const checkId = ++nextCheckId
        activeCheckId = checkId
        if (interactive) {
          setState({ status: 'checking' })
        }
        checkTimeout = setTimeout(() => {
          if (activeCheckId !== checkId) return
          finishCheck()
          deps.events.record('update_error', { message: 'Update check timed out' })
          if (state.status === 'checking') setState({ status: 'error' })
        }, UPDATE_CHECK_TIMEOUT_MS)
        void feedForCheck().then((feed) => {
          if (activeCheckId !== checkId) return
          if (feed === 'no-release') {
            finishCheck()
            if (interactive && state.status === 'checking') setState({ status: 'idle' })
            return
          }
          if (feed === 'skip') {
            finishCheck()
            if (interactive && state.status === 'checking') setState({ status: 'error' })
            return
          }
          autoUpdater
            .checkForUpdates()
            .then(() => {
              if (activeCheckId !== checkId) return
              finishCheck()
              if (interactive && state.status === 'checking') setState({ status: 'error' })
            })
            .catch((error) => {
              if (activeCheckId !== checkId) return
              finishCheck()
              logger.warn('Update check failed', { message: getErrorMessage(error, 'unknown') })
              if (state.status === 'checking') setState({ status: 'error' })
            })
        })
      },
      advance() {
        autoUpdater.downloadUpdate().catch((error) => {
          installAfterDownload = false
          logger.warn('Update download failed', { message: getErrorMessage(error, 'unknown') })
          setState({ status: 'error', version: state.version })
        })
      },
      install() {
        autoUpdater.quitAndInstall()
      },
      setAutoDownload(enabled) {
        autoUpdater.autoDownload = enabled
      },
    }
  }

  const buildManualEngine = (): UpdateEngine => {
    const fetchManifest =
      deps.fetchManifest ??
      (async (url: string) => {
        const response = await net.fetch(url, {
          signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
        })
        return response.ok ? await response.text() : null
      })
    let downloadUrl: string | null = null
    let checkInFlight = false

    const doCheck = async () => {
      if (checkInFlight || state.status === 'available') return
      checkInFlight = true
      setState({ status: 'checking', manual: true })
      try {
        const feedUrl = feedUrlForOrigin(deps.appOrigin())
        const manifest = feedUrl ? await fetchManifest(`${feedUrl}/latest-mac.yml`) : null
        const version = manifest ? (/^version:\s*(\S+)\s*$/m.exec(manifest)?.[1] ?? null) : null
        if (!manifest || !version || !isNewerVersion(version, currentVersion)) {
          setState({ status: 'idle', manual: true })
          return
        }
        // The feed rewrites manifest urls to absolute GitHub asset URLs;
        // prefer the dmg for a human download.
        //
        // Filtered before selection, not just before opening: the manifest is
        // whatever the configured origin served, so `smb://…/x.dmg` or a bare
        // `file:///…` would otherwise pass the suffix test and be advertised as
        // an available update.
        const urls = Array.from(
          manifest.matchAll(/^\s*(?:-\s*)?url:\s*(\S+)\s*$/gm),
          (m) => m[1]
        ).filter(isReleaseAssetUrl)
        downloadUrl =
          urls.find((url) => url.endsWith('.dmg')) ??
          urls.find((url) => url.endsWith('.zip')) ??
          urls[0] ??
          null
        if (!downloadUrl) {
          // 'error', not 'idle': a newer version demonstrably exists and cannot
          // be offered, so "Sim is up to date" would strand a user whose shell
          // the server's minimum-version gate is already blocking.
          logger.warn('Update manifest had no usable download url', {
            version,
            candidates: urls.length,
          })
          deps.events.record('update_blocked_version', { version, reason: 'unusable-url' })
          setState({ status: 'error', version: state.version, manual: true })
          return
        }
        deps.events.record('update_check', { available: version, manual: true })
        setState({ status: 'available', version, manual: true })
      } catch (error) {
        logger.warn('Manual update check failed', { message: getErrorMessage(error, 'unknown') })
        setState({ status: 'error', version: state.version, manual: true })
      } finally {
        checkInFlight = false
      }
    }

    const openDownload = () => {
      if (downloadUrl) {
        deps.events.record('update_manual_download', { url: downloadUrl })
        // Through openExternalSafe like every other external open in the app,
        // so the allowlist is enforced at the sink and not only where the url
        // was chosen. No loopback exemption: every legitimate asset is https.
        void openExternalSafe(downloadUrl)
      }
    }

    return {
      check: () => void doCheck(),
      advance: openDownload,
      install: openDownload,
      setAutoDownload: () => {},
    }
  }

  let engine: UpdateEngine | null = null
  let pendingAutoDownload: boolean | null = null
  let pendingInteractiveCheck = false

  const canSelfUpdate = deps.canSelfUpdate ?? detectSelfUpdateCapability
  void canSelfUpdate()
    .catch(() => true)
    .then((capable) => {
      engine = capable ? buildAutoEngine() : buildManualEngine()
      if (!engine) {
        if (pendingInteractiveCheck) {
          pendingInteractiveCheck = false
          setState({ status: 'error' })
        }
        return
      }
      if (pendingAutoDownload !== null) {
        engine.setAutoDownload(pendingAutoDownload)
      }
      if (!capable) {
        deps.events.record('update_manual_mode', {})
      }
      if (pendingInteractiveCheck) {
        pendingInteractiveCheck = false
        engine.check(true)
      }
      const check = () => engine?.check()
      setTimeout(check, INITIAL_CHECK_DELAY_MS)
      setInterval(check, updateCheckIntervalMs(currentVersion))
    })

  return {
    setAutoDownload(enabled) {
      if (engine) {
        engine.setAutoDownload(enabled)
      } else {
        pendingAutoDownload = enabled
      }
    },
    getState: () => state,
    check() {
      if (state.status === 'checking' || state.status === 'downloading') {
        return
      }
      if (!engine) {
        pendingInteractiveCheck = true
        setState({ status: 'checking' })
        return
      }
      if (state.status === 'available') {
        installAfterDownload = !state.manual
        engine.advance()
        return
      }
      engine.check(true)
    },
    install() {
      if (!engine) {
        return
      }
      if (state.status === 'ready') {
        engine.install()
        return
      }
      if (state.status === 'available' && state.manual) {
        engine.advance()
      }
    },
    onState(callback) {
      listeners.add(callback)
      return () => {
        listeners.delete(callback)
      }
    },
  }
}

/**
 * Menu-triggered manual check with user-visible feedback. A thin dialog layer
 * over the updater handle — it drives whichever pipeline initUpdater selected
 * (electron-updater or the manual feed poll), so a shell that can't
 * self-update gets a working "Download" dialog instead of a Squirrel error.
 */
export function checkForUpdatesInteractive(
  deps: Pick<UpdaterDeps, 'getWindow' | 'events'> & { handle: UpdaterHandle | null }
): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      message: 'Updates are only available in packaged builds',
    })
    return
  }
  const handle = deps.handle
  if (!handle) {
    return
  }
  deps.events.record('update_check', { manual: true })

  const showDialog = (options: Electron.MessageBoxOptions) => {
    const win = deps.getWindow()
    return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
  }

  const settle = (state: DesktopUpdateState) => {
    switch (state.status) {
      case 'available': {
        const label = state.version ? `Sim ${state.version} is available` : 'An update is available'
        void showDialog({
          type: 'info',
          buttons: ['Download', 'Later'],
          defaultId: 0,
          cancelId: 1,
          message: label,
          detail: state.manual
            ? 'This build updates manually: the download opens in your browser, then replace the installed app.'
            : 'The update downloads in the background and installs when you restart.',
        }).then(({ response }) => {
          if (response !== 0) {
            return
          }
          if (state.manual) {
            handle.install()
          } else {
            handle.check()
          }
        })
        return
      }
      case 'downloading':
        void showDialog({
          type: 'info',
          message: state.version ? `Downloading Sim ${state.version}…` : 'Downloading update…',
          detail: 'You will be prompted to restart when it is ready.',
        })
        return
      case 'ready':
        // The download pipeline already shows its own restart prompt.
        return
      case 'error':
        void showDialog({
          type: 'error',
          message: 'Could not check for updates',
          detail: 'Something went wrong reaching the update server. Try again later.',
        })
        return
      default:
        void showDialog({
          type: 'info',
          buttons: ['OK'],
          defaultId: 0,
          message: 'You’re up to date!',
          detail: `Sim ${app.getVersion()} is currently the newest version available.`,
        })
    }
  }

  const initial = handle.getState()
  // Already mid-pipeline (or an update already found): report it directly
  // instead of advancing the pipeline behind a "check" click.
  if (initial.status !== 'idle' && initial.status !== 'checking' && initial.status !== 'error') {
    settle(initial)
    return
  }

  let settled = false
  const finish = (state: DesktopUpdateState) => {
    if (settled) {
      return
    }
    settled = true
    clearTimeout(timeout)
    unsubscribe()
    settle(state)
  }
  const unsubscribe = handle.onState((state) => {
    if (state.status === 'checking') {
      return
    }
    finish(state)
  })
  const timeout = setTimeout(() => finish({ status: 'error' }), INTERACTIVE_FEEDBACK_TIMEOUT_MS)
  handle.check()
}
