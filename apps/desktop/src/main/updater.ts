import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import type { BrowserWindow } from 'electron'
import { app, dialog } from 'electron'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopUpdater')

const INITIAL_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export type UpdateChannel = 'latest' | 'beta' | 'alpha'

/**
 * Maps the running version to its update channel: prerelease builds follow
 * their prerelease channel, stable builds only ever see stable releases.
 */
export function resolveUpdateChannel(version: string): UpdateChannel {
  if (version.includes('-alpha')) {
    return 'alpha'
  }
  if (version.includes('-beta')) {
    return 'beta'
  }
  return 'latest'
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
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim())
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

/**
 * The blockedVersions kill-switch: a known-bad release is never offered for
 * install even if the feed still serves it.
 */
export function isVersionBlocked(version: string, blockedVersions: readonly string[]): boolean {
  const normalized = version.replace(/^v/, '')
  return blockedVersions.some((blocked) => blocked.replace(/^v/, '') === normalized)
}

export interface UpdaterDeps {
  getWindow: () => BrowserWindow | null
  events: EventRecorder
  blockedVersions?: readonly string[]
}

/**
 * Loads the electron-updater singleton and (re)applies the channel and safety
 * invariants — channel scoped to the running build, downgrades refused. Both
 * the launch wiring and the manual check go through here so neither can run
 * against a mis-set channel or an allowDowngrade default. `autoInstallOnAppQuit`
 * is deliberately NOT touched: it is toggled per accepted download and must
 * survive a manual check.
 */
function configureAutoUpdater(): typeof import('electron-updater')['autoUpdater'] | null {
  try {
    const { autoUpdater } = require('electron-updater') as typeof import('electron-updater')
    autoUpdater.channel = resolveUpdateChannel(app.getVersion())
    autoUpdater.allowDowngrade = false
    autoUpdater.autoDownload = true
    autoUpdater.logger = null
    return autoUpdater
  } catch (error) {
    logger.error('electron-updater unavailable', { error })
    return null
  }
}

/**
 * Wires electron-updater against the GitHub Releases feed: channel-scoped
 * checks on launch and every four hours, delta downloads in the background,
 * and install only on user confirmation — never mid-session without consent.
 */
export function initUpdater(deps: UpdaterDeps): void {
  if (!app.isPackaged) {
    return
  }
  const autoUpdater = configureAutoUpdater()
  if (!autoUpdater) {
    return
  }

  const currentVersion = app.getVersion()
  // Never install without vetting the downloaded version first. Enabled per
  // download in the update-downloaded handler, but only for accepted updates
  // — so a blocked/downgrade build that was already downloaded is never
  // silently installed on quit.
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    deps.events.record('update_check', { available: info.version })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (
      isDowngrade(currentVersion, info.version) ||
      isVersionBlocked(info.version, deps.blockedVersions ?? [])
    ) {
      autoUpdater.autoInstallOnAppQuit = false
      deps.events.record('update_blocked_version', { version: info.version })
      return
    }
    autoUpdater.autoInstallOnAppQuit = true
    deps.events.record('update_downloaded', { version: info.version })
    const win = deps.getWindow()
    win?.webContents.send('desktop:update-status', { state: 'ready', version: info.version })
    const options = {
      type: 'info' as const,
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      message: `Sim ${info.version} is ready to install`,
      detail: 'Restart to finish updating. If you choose Later, the update installs on quit.',
    }
    const prompt = win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options)
    void prompt.then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall()
      }
    })
  })

  autoUpdater.on('error', (error) => {
    deps.events.record('update_error', { message: getErrorMessage(error, 'unknown') })
  })

  const check = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      logger.warn('Update check failed', { message: getErrorMessage(error, 'unknown') })
    })
  }
  setTimeout(check, INITIAL_CHECK_DELAY_MS)
  setInterval(check, CHECK_INTERVAL_MS)
}

/**
 * Menu-triggered manual check with user-visible feedback.
 */
export function checkForUpdatesInteractive(deps: UpdaterDeps): void {
  if (!app.isPackaged) {
    void dialog.showMessageBox({
      type: 'info',
      message: 'Updates are only available in packaged builds',
    })
    return
  }
  deps.events.record('update_check', { manual: true })
  const autoUpdater = configureAutoUpdater()
  if (!autoUpdater) {
    return
  }
  void autoUpdater
    .checkForUpdates()
    .then((result) => {
      if (!result || result.updateInfo.version === app.getVersion()) {
        void dialog.showMessageBox({ type: 'info', message: 'Sim is up to date' })
      }
    })
    .catch((error) => {
      logger.error('Manual update check failed', { error })
      void dialog.showMessageBox({
        type: 'error',
        message: 'Could not check for updates',
        detail: 'Something went wrong reaching the update server. Try again later.',
      })
    })
}
