import type { DesktopServerChangeResult, DesktopServerConfiguration } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { app, BrowserWindow, nativeTheme, session } from 'electron'
import type { ConfigStore, DesktopSettings } from '@/main/config'
import { isSimCloudOrigin } from '@/main/config'
import {
  backgroundColorFor,
  createSecureWebPreferences,
  setupPermissionHandlers,
} from '@/main/window'

const logger = createLogger('DesktopServerWindow')

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

/**
 * Settings that describe the deployment rather than the device, and so must not
 * survive a move to a different one. The home for this rule: `DesktopSettings`
 * is a single global record with no per-origin namespace, so anything added
 * there that names a Sim resource belongs in this list.
 *
 * `lastRoute` carries a workspace id in its path, so keeping it would open
 * `/workspace/<old-id>` on the new server. `resolveStartRoute` cannot rescue
 * that: it discards a route only on a confirmed 403, and a fresh partition has
 * no session, so the new server answers 401 and the stale route survives the
 * probe.
 *
 * The agent browser is deliberately untouched — both its cookie jar and the
 * `browserKnownSites` inference metadata that describes it. Sign-out clears the
 * pair because the ACCOUNT changed; pointing the shell at another deployment
 * does not imply that, and signing the operator out of every unrelated site in
 * the built-in browser is not a reasonable side effect of correcting a server
 * URL. They are kept together on purpose: clearing the metadata alone would
 * leave Sim blind to sign-ins that are still live in the profile.
 */
const ORIGIN_SCOPED_SETTINGS: readonly (keyof DesktopSettings)[] = ['lastRoute']

export interface ServerWindowDeps {
  config: ConfigStore
  defaultOrigin: string
  /** The bundled page to load, resolved by the caller like the offline page. */
  pagePath: string
  preloadPath: string
  isPackaged: boolean
  getParentWindow: () => BrowserWindow | null
  /**
   * Relaunches the shell against the newly stored origin. A full restart rather
   * than an in-place swap: the origin decides the cookie partition, the update
   * feed, the encrypted per-origin task state, and the identity every live
   * browser view and PTY was opened under. Nothing in the app exposes a reset
   * for that set — `ensureAppSession` and the partition cache are one-way
   * memoizations, and the sign-out coordinator revokes server-side, which is
   * wrong here (the old server's session should stay valid). The quit path
   * already performs the orderly teardown, so relaunching reuses it.
   */
  relaunch: () => void
}

export interface ServerWindowHandle {
  open(): void
  getConfiguration(): DesktopServerConfiguration
  setOrigin(origin: string): DesktopServerChangeResult
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

  const getConfiguration = (): DesktopServerConfiguration => {
    const origin = deps.config.getOrigin()
    return { origin, defaultOrigin: deps.defaultOrigin, isSimCloud: isSimCloudOrigin(origin) }
  }

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
    // Every other session in the app installs a permission handler; without one
    // Electron decides for itself what a page may ask the OS for. The page here
    // asks for nothing, and a foreign origin can never load in this window, so
    // the shared handler resolves to a deny-all — which is the intent.
    setupPermissionHandlers(session.fromPartition(SERVER_WINDOW_PARTITION), deps.config.getOrigin)
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
      // System preference only, unlike the main window: that one pre-paints for
      // the web app it is about to load, whose theme the user picked in Sim.
      // This window loads a bundled page that follows `prefers-color-scheme`,
      // so honouring the stored web-app theme here would pre-paint dark behind
      // a page about to render light whenever the two disagree.
      backgroundColor: backgroundColorFor(undefined, nativeTheme.shouldUseDarkColors),
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
    void win.loadFile(deps.pagePath).catch((error) => {
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
    for (const key of ORIGIN_SCOPED_SETTINGS) {
      deps.config.set(key, undefined)
    }
    // setOrigin writes through immediately; the clears above are debounced like
    // every other setting. `before-quit` flushes too, but doing it here keeps
    // the write independent of the Electron quit sequence.
    deps.config.flush()
    close()
    deps.relaunch()
    return { ok: true, origin: validated.origin, unchanged: false }
  }

  return { open, getConfiguration, setOrigin }
}

/** Restarts the process in place. Split out so tests can drive the seam. */
export function relaunchApp(): void {
  app.relaunch()
  app.quit()
}
