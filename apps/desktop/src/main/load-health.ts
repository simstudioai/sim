import { createLogger } from '@sim/logger'
import type { BrowserWindow } from 'electron'
import { type EventRecorder, scrubUrl } from '@/main/observability'

const logger = createLogger('DesktopLoadHealth')

const AUTO_RETRY_INTERVAL_MS = 5000
const LOAD_WATCHDOG_MS = 30_000

export type LoadErrorKind = 'offline' | 'dns' | 'tls' | 'timeout' | 'unreachable' | 'ignored'

/**
 * Maps Chromium net error codes to recovery copy. -3 (ERR_ABORTED) is emitted
 * constantly by OAuth redirect chains and in-app aborts and must be ignored.
 */
export function classifyLoadError(errorCode: number): LoadErrorKind {
  // Only ERR_ABORTED (-3) and success (0) are ignored. ERR_FAILED (-2) and
  // ERR_IO_PENDING (-1) are real failures that must surface the offline page.
  if (errorCode === 0 || errorCode === -3) {
    return 'ignored'
  }
  if (errorCode === -106) {
    return 'offline'
  }
  if (errorCode === -105 || errorCode === -137) {
    return 'dns'
  }
  if (errorCode === -7 || errorCode === -118) {
    return 'timeout'
  }
  if (errorCode <= -200 && errorCode >= -213) {
    return 'tls'
  }
  return 'unreachable'
}

export interface LoadHealthDeps {
  offlinePagePath: string
  getStartUrl: () => string
  isOnline: () => boolean
  events: EventRecorder
}

export interface LoadHealthHandle {
  retry(): void
  startWatchdog(): void
}

/**
 * Branded recovery for a fully remote renderer: on main-frame load failures
 * the window swaps to the bundled offline page (a local file, never wrapping
 * the origin), auto-retries when the network returns, and a first-paint
 * watchdog catches servers that accept connections but never respond.
 */
export function attachLoadHealth(win: BrowserWindow, deps: LoadHealthDeps): LoadHealthHandle {
  let intendedUrl: string | null = null
  let showingOffline = false
  let retryTimer: NodeJS.Timeout | undefined
  let watchdogTimer: NodeJS.Timeout | undefined

  const stopAutoRetry = () => {
    clearInterval(retryTimer)
    retryTimer = undefined
  }

  const retry = () => {
    if (win.isDestroyed()) {
      return
    }
    const target = intendedUrl ?? deps.getStartUrl()
    logger.info('Retrying load', { url: scrubUrl(target) })
    void win.loadURL(target)
  }

  const startAutoRetry = () => {
    if (retryTimer) {
      return
    }
    retryTimer = setInterval(() => {
      if (!showingOffline || win.isDestroyed()) {
        stopAutoRetry()
        return
      }
      if (deps.isOnline()) {
        stopAutoRetry()
        retry()
      }
    }, AUTO_RETRY_INTERVAL_MS)
  }

  const showOffline = (kind: LoadErrorKind, detail: string) => {
    if (win.isDestroyed()) {
      return
    }
    showingOffline = true
    deps.events.record('load_failure', { kind, detail })
    void win.loadFile(deps.offlinePagePath, { query: { kind, detail } })
    startAutoRetry()
  }

  win.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return
      }
      clearTimeout(watchdogTimer)
      const kind = classifyLoadError(errorCode)
      if (kind === 'ignored') {
        return
      }
      if (validatedURL?.startsWith('http')) {
        intendedUrl = validatedURL
      }
      logger.warn('Main-frame load failed', {
        kind,
        errorCode,
        errorDescription,
        url: scrubUrl(validatedURL ?? ''),
      })
      showOffline(kind, `${errorDescription} (${errorCode})`)
    }
  )

  win.webContents.on('did-finish-load', () => {
    clearTimeout(watchdogTimer)
    const url = win.webContents.getURL()
    if (url.startsWith('http')) {
      showingOffline = false
      intendedUrl = null
      stopAutoRetry()
    }
  })

  win.on('closed', () => {
    stopAutoRetry()
    clearTimeout(watchdogTimer)
  })

  return {
    retry,
    startWatchdog() {
      clearTimeout(watchdogTimer)
      watchdogTimer = setTimeout(() => {
        if (!win.isDestroyed() && win.webContents.isLoading()) {
          showOffline('timeout', 'The app took too long to load')
        }
      }, LOAD_WATCHDOG_MS)
    },
  }
}
