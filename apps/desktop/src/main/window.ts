import { createLogger } from '@sim/logger'
import type { Session, WebPreferences } from 'electron'
import { app, BrowserWindow, dialog, nativeTheme, systemPreferences } from 'electron'
import { type ConfigStore, isSafeInternalPath, type WindowBounds } from '@/main/config'
import { isAppOrigin, isAuthSurfacePath } from '@/main/navigation'
import type { EventRecorder } from '@/main/observability'

const logger = createLogger('DesktopWindow')

const DARK_BACKGROUND = '#0c0c0c'
const LIGHT_BACKGROUND = '#ffffff'
const DEFAULT_WIDTH = 1360
const DEFAULT_HEIGHT = 860
const MIN_WIDTH = 800
const MIN_HEIGHT = 600
const BOUNDS_SAVE_DELAY_MS = 400
const ROUTE_SAVE_DELAY_MS = 500

const THEME_PROBE_SCRIPT = `(() => {
  try {
    return document.documentElement.classList.contains('dark')
  } catch {
    return null
  }
})()`

/**
 * The hardened webPreferences shared by the main window and any child window.
 * The preload injects nothing into the page; it only exposes a whitelisted
 * IPC bridge.
 */
export function createSecureWebPreferences(
  partition: string,
  preloadPath: string,
  isPackaged: boolean
): WebPreferences {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    devTools: !isPackaged,
    spellcheck: true,
    partition,
    preload: preloadPath,
  }
}

/**
 * The permission matrix: microphone capture and sanitized clipboard writes for
 * the trusted app origin, default-deny for everything else including unknown
 * future permissions. Voice STT uses getUserMedia (audio) — camera stays
 * denied.
 */
export function resolvePermission(
  permission: string,
  requestingOrigin: string,
  appOrigin: string,
  mediaTypes?: readonly string[]
): boolean {
  if (!requestingOrigin || requestingOrigin !== appOrigin) {
    return false
  }
  if (permission === 'media') {
    // Default-deny: grant only when the request explicitly asks for audio
    // (and nothing else). An absent/empty mediaTypes must not fall through to
    // a grant — that would allow camera capture, which is denied by policy.
    return (
      mediaTypes !== undefined &&
      mediaTypes.length > 0 &&
      mediaTypes.every((type) => type === 'audio')
    )
  }
  return permission === 'clipboard-sanitized-write'
}

function originOf(raw: string): string {
  try {
    return new URL(raw).origin
  } catch {
    return ''
  }
}

/**
 * Resolves macOS TCC microphone consent, prompting on first use. Returns the
 * final grant state; on non-darwin platforms capture needs no OS consent.
 */
export async function ensureMicrophoneAccess(
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  if (platform !== 'darwin') {
    return true
  }
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') {
    return true
  }
  if (status === 'denied' || status === 'restricted') {
    return false
  }
  try {
    return await systemPreferences.askForMediaAccess('microphone')
  } catch (error) {
    logger.error('Microphone access prompt failed', { error })
    return false
  }
}

/**
 * Installs both permission handlers (request + check) on a session from the
 * shared permission matrix, wiring macOS microphone TCC consent into media
 * grants.
 */
export function setupPermissionHandlers(
  session: Session,
  getAppOrigin: () => string,
  platform: NodeJS.Platform = process.platform
): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents?.getURL() || ''
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
    const allowed = resolvePermission(
      permission,
      originOf(requestingUrl),
      getAppOrigin(),
      mediaTypes
    )
    if (!allowed) {
      callback(false)
      return
    }
    if (permission === 'media') {
      void ensureMicrophoneAccess(platform).then(callback)
      return
    }
    callback(true)
  })

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const mediaType = 'mediaType' in details ? details.mediaType : undefined
    return resolvePermission(
      permission,
      originOf(requestingOrigin),
      getAppOrigin(),
      mediaType ? [mediaType] : undefined
    )
  })
}

/**
 * Picks the pre-paint window background from the persisted web-app theme so
 * dark-mode users never see a white flash before the remote page paints.
 */
export function backgroundColorFor(
  theme: 'dark' | 'light' | undefined,
  systemPrefersDark: boolean
): string {
  if (theme === 'dark') {
    return DARK_BACKGROUND
  }
  if (theme === 'light') {
    return LIGHT_BACKGROUND
  }
  return systemPrefersDark ? DARK_BACKGROUND : LIGHT_BACKGROUND
}

/**
 * Drops persisted bounds that are malformed or implausibly small so a bad
 * settings file can never produce an unusable window.
 */
export function sanitizeBounds(bounds: WindowBounds | undefined): WindowBounds | undefined {
  if (!bounds) {
    return undefined
  }
  const { x, y, width, height } = bounds
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined
  }
  if (width < MIN_WIDTH || height < MIN_HEIGHT) {
    return undefined
  }
  if ((x !== undefined && !Number.isFinite(x)) || (y !== undefined && !Number.isFinite(y))) {
    return { width, height }
  }
  return bounds
}

export interface CreateMainWindowDeps {
  config: ConfigStore
  events: EventRecorder
  appOrigin: () => string
  partition: string
  preloadPath: string
  isPackaged: boolean
  onClosed: () => void
  onFullScreenChange?: (isFullScreen: boolean) => void
}

/**
 * Creates the hardened main window: persisted bounds and zoom, theme-matched
 * background, beforeunload passthrough, renderer crash/hang recovery, and
 * last-route tracking for relaunch restore.
 */
export function createMainWindow(deps: CreateMainWindowDeps): BrowserWindow {
  const bounds = sanitizeBounds(deps.config.get('windowBounds'))
  const win = new BrowserWindow({
    title: 'Sim',
    width: bounds?.width ?? DEFAULT_WIDTH,
    height: bounds?.height ?? DEFAULT_HEIGHT,
    x: bounds?.x,
    y: bounds?.y,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // No separate title bar: the page renders full-bleed to the window's top
    // edge with the traffic lights inset over it (Codex-style). Position is
    // explicit so the web app can reserve a matching top-left area.
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 12 },
        }
      : {}),
    show: false,
    backgroundColor: backgroundColorFor(
      deps.config.get('themeBackground'),
      nativeTheme.shouldUseDarkColors
    ),
    webPreferences: createSecureWebPreferences(deps.partition, deps.preloadPath, deps.isPackaged),
  })

  win.once('ready-to-show', () => {
    win.show()
  })

  let boundsTimer: NodeJS.Timeout | undefined
  const persistBounds = () => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (win.isDestroyed() || win.isFullScreen() || win.isMaximized()) {
        return
      }
      deps.config.set('windowBounds', win.getNormalBounds())
    }, BOUNDS_SAVE_DELAY_MS)
  }
  win.on('resize', persistBounds)
  win.on('move', persistBounds)
  win.on('enter-full-screen', () => deps.onFullScreenChange?.(true))
  win.on('leave-full-screen', () => deps.onFullScreenChange?.(false))

  win.webContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 0,
      cancelId: 1,
      message: 'Leave Sim?',
      detail: 'Changes you made may not be saved.',
    })
    if (choice === 0) {
      event.preventDefault()
    }
  })

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') {
      return
    }
    deps.events.record('renderer_gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      crashDumpDir: app.getPath('crashDumps'),
    })
    setTimeout(() => {
      if (win.isDestroyed()) {
        return
      }
      void dialog
        .showMessageBox(win, {
          type: 'error',
          buttons: ['Reload', 'Quit Sim'],
          defaultId: 0,
          cancelId: 0,
          message: 'Sim encountered a problem',
          detail: 'The page stopped unexpectedly. Reload to pick up where you left off.',
        })
        .then(({ response }) => {
          if (win.isDestroyed()) {
            return
          }
          if (response === 0) {
            win.webContents.reload()
          } else {
            app.quit()
          }
        })
    }, 0)
  })

  let hangDialogOpen = false
  win.webContents.on('unresponsive', () => {
    if (hangDialogOpen || win.isDestroyed()) {
      return
    }
    hangDialogOpen = true
    deps.events.record('renderer_unresponsive')
    void dialog
      .showMessageBox(win, {
        type: 'warning',
        buttons: ['Wait', 'Reload'],
        defaultId: 0,
        cancelId: 0,
        message: 'Sim isn’t responding',
        detail: 'You can wait for it to recover or reload the page.',
      })
      .then(({ response }) => {
        hangDialogOpen = false
        if (!win.isDestroyed() && response === 1) {
          win.webContents.reload()
        }
      })
  })
  win.webContents.on('responsive', () => {
    hangDialogOpen = false
  })

  let zoomRestored = false
  win.webContents.on('did-finish-load', () => {
    if (!zoomRestored) {
      zoomRestored = true
      const zoomLevel = deps.config.get('zoomLevel')
      if (typeof zoomLevel === 'number' && Number.isFinite(zoomLevel)) {
        win.webContents.setZoomLevel(zoomLevel)
      }
    }
    const url = win.webContents.getURL()
    if (isAppOrigin(url, deps.appOrigin())) {
      void win.webContents
        .executeJavaScript(THEME_PROBE_SCRIPT, true)
        .then((isDark) => {
          if (typeof isDark === 'boolean') {
            deps.config.set('themeBackground', isDark ? 'dark' : 'light')
          }
        })
        .catch(() => {})
    }
  })

  let routeTimer: NodeJS.Timeout | undefined
  const recordRoute = (url: string) => {
    const origin = deps.appOrigin()
    if (!isAppOrigin(url, origin)) {
      return
    }
    const path = url.slice(origin.length) || '/'
    if (!isSafeInternalPath(path) || isAuthSurfacePath(path)) {
      return
    }
    clearTimeout(routeTimer)
    routeTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        deps.config.set('lastRoute', path)
      }
    }, ROUTE_SAVE_DELAY_MS)
  }
  win.webContents.on('did-navigate', (_event, url) => recordRoute(url))
  win.webContents.on('did-navigate-in-page', (_event, url) => recordRoute(url))

  win.on('closed', () => {
    clearTimeout(routeTimer)
    deps.onClosed()
  })

  return win
}
