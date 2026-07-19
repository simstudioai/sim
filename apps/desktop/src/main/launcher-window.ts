import { createLogger } from '@sim/logger'
import type { Display, Rectangle } from 'electron'
import { BrowserWindow, nativeTheme, screen } from 'electron'
import type { EventRecorder } from '@/main/observability'
import { scrubUrl } from '@/main/observability'
import { backgroundColorFor, createSecureWebPreferences } from '@/main/window'

const logger = createLogger('DesktopLauncher')

export const LAUNCHER_ROUTE = '/desktop/launcher'
export const LAUNCHER_WIDTH = 420
export const LAUNCHER_MIN_HEIGHT = 96
export const LAUNCHER_MAX_HEIGHT = 600
/** Gap from the work-area edges when the card is pinned to the corner. */
const LAUNCHER_EDGE_GAP = 16

/**
 * Card placement: pinned to the TOP-RIGHT corner of the active display's work
 * area (below the menu bar, inset from the right edge) — a compact overlay
 * that stays out of the way while you talk to it.
 */
export function launcherBoundsFor(workArea: Rectangle, height: number): Rectangle {
  const clamped = clampLauncherHeight(height)
  return {
    x: Math.round(workArea.x + workArea.width - LAUNCHER_WIDTH - LAUNCHER_EDGE_GAP),
    y: Math.round(workArea.y + LAUNCHER_EDGE_GAP),
    width: LAUNCHER_WIDTH,
    height: clamped,
  }
}

export function clampLauncherHeight(height: number): number {
  if (!Number.isFinite(height)) {
    return LAUNCHER_MIN_HEIGHT
  }
  return Math.min(LAUNCHER_MAX_HEIGHT, Math.max(LAUNCHER_MIN_HEIGHT, Math.round(height)))
}

export interface LauncherWindowDeps {
  appOrigin: () => string
  partition: () => string
  preloadPath: string
  isPackaged: boolean
  themeBackground: () => 'dark' | 'light' | undefined
  /** Fallback when the launcher route is unavailable (older self-hosted server, offline). */
  openMainWindow: () => void
  events: EventRecorder
}

export interface LauncherWindowHandle {
  /**
   * Summon (on the display with the cursor) or dismiss the panel. Pass
   * `voice` to open it in voice mode (mic focused, replies spoken aloud).
   */
  toggle(options?: { voice?: boolean }): void
  hide(): void
  /**
   * Create and load the panel offscreen without showing it, so the first
   * summon is instant instead of waiting on window creation + the remote
   * route load. No-op if already created.
   */
  prewarm(): void
  /** Renderer-driven growth as a response streams in; clamped. */
  resize(height: number): void
  /** Tears the window down (origin change, quit). Next toggle recreates it. */
  destroy(): void
}

/**
 * The Quick Ask panel: a non-activating floating window (Electron `panel`
 * type) that appears over full-screen apps on every Space, summoned by the
 * global shortcut or the tray. It loads the remote `/desktop/launcher` route
 * in the app partition, so the page is authenticated exactly like the main
 * window. Dismissal is hide-not-close — the page (and any streaming response)
 * survives across summons until the origin changes or the app quits.
 */
export function createLauncherWindow(deps: LauncherWindowDeps): LauncherWindowHandle {
  let win: BrowserWindow | null = null
  let loadFailed = false

  const activeDisplay = (): Display => screen.getDisplayNearestPoint(screen.getCursorScreenPoint())

  const create = (): BrowserWindow => {
    const panel = new BrowserWindow({
      ...launcherBoundsFor(activeDisplay().workArea, LAUNCHER_MIN_HEIGHT),
      type: 'panel',
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      hiddenInMissionControl: true,
      acceptFirstMouse: true,
      roundedCorners: true,
      show: false,
      backgroundColor: backgroundColorFor(deps.themeBackground(), nativeTheme.shouldUseDarkColors),
      webPreferences: createSecureWebPreferences(
        deps.partition(),
        deps.preloadPath,
        deps.isPackaged
      ),
    })
    panel.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true,
    })
    panel.setAlwaysOnTop(true, 'screen-saver')

    panel.on('blur', () => {
      // DevTools focus counts as window blur; hiding then would make the
      // panel undebuggable in dev.
      if (!panel.webContents.isDevToolsOpened()) {
        panel.hide()
      }
    })

    // A failed launcher load hides the panel and falls back to the main window.
    const failLaunchLoad = (code: number, reason: string) => {
      deps.events.record('launcher_load_failed', { code, reason })
      loadFailed = true
      if (panel.isVisible()) {
        panel.hide()
        deps.openMainWindow()
      }
    }

    // did-fail-load covers network-level failures (offline); an HTTP error
    // status (older self-hosted server without the route) still "loads", so
    // it is caught from the navigation's response code instead.
    panel.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (!isMainFrame || code === -3 /* ERR_ABORTED: superseded navigation */) {
        return
      }
      logger.warn('Launcher route failed to load', { code, description, url: scrubUrl(url) })
      failLaunchLoad(code, description)
    })
    panel.webContents.on('did-navigate', (_event, url, httpResponseCode) => {
      if (httpResponseCode < 400) {
        return
      }
      logger.warn('Launcher route returned an error status', {
        status: httpResponseCode,
        url: scrubUrl(url),
      })
      failLaunchLoad(httpResponseCode, 'http')
    })
    panel.webContents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit') {
        logger.warn('Launcher renderer gone; recreating on next summon', {
          reason: details.reason,
        })
      }
      panel.destroy()
    })
    panel.on('closed', () => {
      if (win === panel) {
        win = null
      }
    })
    return panel
  }

  const load = (panel: BrowserWindow) => {
    loadFailed = false
    void panel.webContents.loadURL(`${deps.appOrigin()}${LAUNCHER_ROUTE}`).catch(() => {})
  }

  const show = (panel: BrowserWindow, voice: boolean) => {
    panel.setBounds(launcherBoundsFor(activeDisplay().workArea, LAUNCHER_MIN_HEIGHT))
    panel.show()
    panel.webContents.send('launcher:shown', { voice })
  }

  return {
    toggle(options?: { voice?: boolean }) {
      const voice = options?.voice === true
      if (win && !win.isDestroyed()) {
        if (win.isVisible()) {
          win.hide()
          return
        }
        if (loadFailed) {
          load(win)
        }
        show(win, voice)
        return
      }
      win = create()
      load(win)
      show(win, voice)
    },
    prewarm() {
      if (win && !win.isDestroyed()) {
        return
      }
      // Built hidden and positioned offscreen; toggle() will place + show it
      // on the active display. Loading now means the remote route is already
      // painted by the time the user first summons.
      win = create()
      load(win)
    },
    hide() {
      if (win && !win.isDestroyed() && win.isVisible()) {
        win.hide()
      }
    },
    resize(height: number) {
      if (!win || win.isDestroyed()) {
        return
      }
      const bounds = win.getBounds()
      win.setBounds({ ...bounds, height: clampLauncherHeight(height) })
    },
    destroy() {
      if (win && !win.isDestroyed()) {
        win.destroy()
      }
      win = null
    },
  }
}
