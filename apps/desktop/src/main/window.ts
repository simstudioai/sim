import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
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
const WINDOW_TITLE = 'Sim'
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
 * IPC bridge. The shell version rides in as a preload argv flag so the web
 * app can enforce its minimum shell version without an IPC round-trip.
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
    additionalArguments: [`--sim-desktop-version=${app.getVersion()}`],
  }
}

/**
 * The permission matrix: clipboard and microphone access for the trusted app
 * origin, default-deny for everything else including unknown future
 * permissions (camera and screen capture stay denied).
 *
 * Clipboard reads are what the terminal's Paste action runs on — xterm has no
 * native paste target to fall back to, so a denied read is a Paste that fails.
 * `media` is what the composer's voice input runs on, and is narrowed to
 * audio-only requests so a `getUserMedia({ video: true })` still gets nothing.
 * Both grants are scoped to the app's own origin, which already reaches far
 * more sensitive surfaces through the preload bridge, so they widen nothing
 * that a compromise of that origin would not already own.
 *
 * `mediaTypes` is the capture kind Chromium asked for. It is absent on
 * non-media permissions and, on the check path, may arrive as `unknown` — an
 * un-narrowable request is treated as a camera request and denied.
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
    return (
      mediaTypes !== undefined &&
      mediaTypes.length > 0 &&
      mediaTypes.every((type) => type === 'audio')
    )
  }
  return permission === 'clipboard-sanitized-write' || permission === 'clipboard-read'
}

/**
 * macOS gates microphone capture behind TCC on top of Chromium's own
 * permission, and Chromium does not raise that system prompt for an Electron
 * app — an un-granted app just gets a hard `NotAllowedError`. So the shell
 * asks for OS access itself and only then answers the page's request.
 *
 * A `denied`/`restricted` status is not re-askable: macOS shows no second
 * prompt, so this resolves false and the renderer surfaces the "blocked"
 * message rather than the click doing nothing at all.
 */
export async function ensureMicrophoneAccess(): Promise<boolean> {
  if (process.platform !== 'darwin') {
    return true
  }
  const status = systemPreferences.getMediaAccessStatus('microphone')
  if (status === 'granted') {
    return true
  }
  if (status === 'denied' || status === 'restricted') {
    logger.warn('Microphone access is blocked by macOS privacy settings', { status })
    return false
  }
  try {
    const granted = await systemPreferences.askForMediaAccess('microphone')
    logger.info('Requested macOS microphone access', { granted })
    return granted
  } catch (error) {
    logger.error('Could not request macOS microphone access', { error: getErrorMessage(error) })
    return false
  }
}

function originOf(raw: string): string {
  try {
    return new URL(raw).origin
  } catch {
    return ''
  }
}

/**
 * Installs both permission handlers (request + check) on a session from the
 * shared permission matrix.
 */
export function setupPermissionHandlers(session: Session, getAppOrigin: () => string): void {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const requestingUrl = details.requestingUrl || webContents?.getURL() || ''
    const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined
    if (!resolvePermission(permission, originOf(requestingUrl), getAppOrigin(), mediaTypes)) {
      callback(false)
      return
    }
    if (permission === 'media') {
      void ensureMicrophoneAccess().then(callback)
      return
    }
    callback(true)
  })

  session.setPermissionCheckHandler((_webContents, permission, requestingOrigin, details) => {
    const mediaTypes = details.mediaType ? [details.mediaType] : undefined
    return resolvePermission(permission, originOf(requestingOrigin), getAppOrigin(), mediaTypes)
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
  /** A committed process restart must not be cancelled by a renderer's beforeunload handler. */
  isMandatoryRelaunchPending: () => boolean
  onFullScreenChange?: (isFullScreen: boolean) => void
  /**
   * Restores the persisted screen position for the first window. Secondary
   * windows omit it so the OS can cascade them instead of stacking every
   * window at the exact same coordinates.
   */
  restorePosition?: boolean
  /** Injectable for platform-specific window behavior tests. */
  platform?: NodeJS.Platform
}

/**
 * Creates the hardened main window: persisted bounds and zoom, theme-matched
 * background, beforeunload passthrough, renderer crash/hang recovery, and
 * last-route tracking for relaunch restore.
 */
export function createMainWindow(deps: CreateMainWindowDeps): BrowserWindow {
  const bounds = sanitizeBounds(deps.config.get('windowBounds'))
  const restorePosition = deps.restorePosition ?? true
  const platform = deps.platform ?? process.platform
  const win = new BrowserWindow({
    title: WINDOW_TITLE,
    width: bounds?.width ?? DEFAULT_WIDTH,
    height: bounds?.height ?? DEFAULT_HEIGHT,
    x: restorePosition ? bounds?.x : undefined,
    y: restorePosition ? bounds?.y : undefined,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    // No separate title bar: the page renders full-bleed to the window's top
    // edge with the traffic lights inset over it (Codex-style).
    ...(platform === 'darwin'
      ? {
          titleBarStyle: 'hiddenInset' as const,
          // Explicit so the published `titlebar-area-*` geometry is stable.
          trafficLightPosition: { x: 12, y: 12 },
          // Publishes the traffic lights' geometry (81x38 DIP) as the
          // `titlebar-area-*` CSS env vars, which Chromium rescales under page
          // zoom so the reserved lane holds its physical size.
          titleBarOverlay: true,
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
  win.on('enter-full-screen', () => {
    if (platform === 'darwin') {
      win.setTitle('')
    }
    deps.onFullScreenChange?.(true)
  })
  win.on('leave-full-screen', () => {
    if (platform === 'darwin') {
      win.setTitle(WINDOW_TITLE)
    }
    deps.onFullScreenChange?.(false)
  })
  win.on('page-title-updated', (event) => {
    if (platform === 'darwin' && win.isFullScreen()) {
      event.preventDefault()
      win.setTitle('')
    }
  })

  win.webContents.on('will-prevent-unload', (event) => {
    if (deps.isMandatoryRelaunchPending()) {
      event.preventDefault()
      return
    }
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Stay', 'Leave'],
      defaultId: 0,
      cancelId: 0,
      message: 'Leave Sim?',
      detail: 'Changes you made may not be saved.',
    })
    if (choice === 1) {
      event.preventDefault()
    }
  })

  let recoveryDialog: 'crash' | 'hang' | null = null
  let crashPendingAfterHang = false

  const showCrashRecovery = (): void => {
    if (win.isDestroyed()) return
    if (recoveryDialog !== null) {
      if (recoveryDialog === 'hang') crashPendingAfterHang = true
      return
    }
    recoveryDialog = 'crash'
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
        if (win.isDestroyed()) return
        if (response === 0) win.webContents.reload()
        else app.quit()
      })
      .catch((error) => {
        logger.error('Could not present renderer recovery', { error: getErrorMessage(error) })
      })
      .finally(() => {
        recoveryDialog = null
      })
  }

  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || recoveryDialog === 'crash' || crashPendingAfterHang) {
      return
    }
    deps.events.record('renderer_gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      crashDumpDir: app.getPath('crashDumps'),
    })
    showCrashRecovery()
  })

  win.webContents.on('unresponsive', () => {
    if (recoveryDialog !== null || win.isDestroyed()) return
    recoveryDialog = 'hang'
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
        if (!win.isDestroyed() && response === 1) {
          win.webContents.reload()
        }
      })
      .catch((error) => {
        logger.error('Could not present unresponsive renderer recovery', {
          error: getErrorMessage(error),
        })
      })
      .finally(() => {
        recoveryDialog = null
        if (crashPendingAfterHang) {
          crashPendingAfterHang = false
          showCrashRecovery()
        }
      })
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
