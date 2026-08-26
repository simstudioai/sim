import type { DesktopServerChangeResult, DesktopServerConfiguration } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { app, BrowserWindow } from 'electron'
import type { ConfigStore } from '@/main/config'
import { createSecureWebPreferences } from '@/main/window'

const logger = createLogger('DesktopServerWindow')

/** The bundled local page, resolved the same way the offline page is. */
const SERVER_PAGE = 'static/server.html'

const WINDOW_WIDTH = 520
const WINDOW_HEIGHT = 340

/**
 * The partition the server-selection window runs in.
 *
 * Deliberately NOT the app session's partition. This window exists to move the
 * shell between deployments, so binding it to the partition of the deployment
 * being left would tie the escape hatch to the state it is escaping — and the
 * page is a bundled `file:` document that stores nothing, so it has no reason
 * to touch a persistent jar at all.
 */
const SERVER_WINDOW_PARTITION = 'server-selection'

export interface ServerWindowDeps {
  config: ConfigStore
  defaultOrigin: string
  preloadPath: string
  isPackaged: boolean
  getParentWindow: () => BrowserWindow | null
  /**
   * Relaunches the shell against the newly stored origin. A full restart
   * rather than an in-place swap: the origin decides the cookie partition, the
   * update feed, the encrypted per-origin task state, and the identity every
   * live browser view and PTY was opened under, and there is no partial
   * teardown of that set which is obviously correct.
   */
  relaunch: () => void
}

export interface ServerWindowHandle {
  open(): void
  getConfiguration(): DesktopServerConfiguration
  setOrigin(origin: string): DesktopServerChangeResult
  close(): void
}

/**
 * The native server picker: how a self-hosted operator points the shell at
 * their own deployment.
 *
 * Native rather than a page in the web app, because the web app is served BY
 * the origin being changed. Someone whose stored origin is unreachable — a
 * typo, a VPN-only host, an instance that moved — can never reach an in-app
 * settings route to fix it, which is exactly when they need this most. The
 * same reasoning gates its IPC channels to bundled `file:` senders.
 */
export function createServerWindow(deps: ServerWindowDeps): ServerWindowHandle {
  let win: BrowserWindow | null = null

  const getConfiguration = (): DesktopServerConfiguration => ({
    origin: deps.config.getOrigin(),
    defaultOrigin: deps.defaultOrigin,
  })

  const close = (): void => {
    if (win && !win.isDestroyed()) {
      win.destroy()
    }
    win = null
  }

  const open = (): void => {
    if (win && !win.isDestroyed()) {
      win.show()
      win.focus()
      return
    }
    const parent = deps.getParentWindow()
    win = new BrowserWindow({
      width: WINDOW_WIDTH,
      height: WINDOW_HEIGHT,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      title: 'Sim Server',
      titleBarStyle: 'hiddenInset',
      show: false,
      // Modal only when there is a live parent to attach to. A shell whose
      // window is gone (or never opened, because the origin failed to load)
      // still has to be able to reach this.
      ...(parent && !parent.isDestroyed() ? { parent, modal: true } : {}),
      webPreferences: createSecureWebPreferences(
        SERVER_WINDOW_PARTITION,
        deps.preloadPath,
        deps.isPackaged
      ),
    })
    win.once('ready-to-show', () => {
      win?.show()
    })
    win.on('closed', () => {
      win = null
    })
    void win.loadFile(SERVER_PAGE).catch((error) => {
      logger.error('Could not open the server window', { error: getErrorMessage(error) })
    })
  }

  const setOrigin = (raw: string): DesktopServerChangeResult => {
    const current = deps.config.getOrigin()
    const validated = deps.config.setOrigin(raw)
    if (!validated.ok) {
      return validated
    }
    if (validated.origin === current) {
      // Nothing moved, so nothing is torn down. Relaunching anyway would make
      // "confirm the URL I already use" restart the app for no reason.
      return { ok: true, origin: validated.origin, unchanged: true }
    }
    logger.info('Server origin changed; relaunching', { from: current, to: validated.origin })
    // setOrigin writes through immediately, but the rest of the settings file
    // (window bounds, last route) is debounced — flush before the process goes.
    deps.config.flush()
    close()
    deps.relaunch()
    return { ok: true, origin: validated.origin, unchanged: false }
  }

  return { open, getConfiguration, setOrigin, close }
}

/** Restarts the process in place. Split out so tests can drive the seam. */
export function relaunchApp(): void {
  app.relaunch()
  app.quit()
}
