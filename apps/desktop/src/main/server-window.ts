import type { DesktopServerChangeResult, DesktopServerConfiguration } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { app, BrowserWindow, nativeTheme, session } from 'electron'
import type { ConfigStore, DesktopSettings } from '@/main/config'
import { canonicalOrigin, isSimCloudOrigin, validateOriginInput } from '@/main/config'
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
 * probe. `browserKnownSites` describes the agent-browser profile that
 * {@link ServerWindowDeps.clearDeploymentScopedState} clears, and is dropped
 * with it so Sim is never left believing in sign-ins the profile no longer has.
 */
const ORIGIN_SCOPED_SETTINGS: readonly (keyof DesktopSettings)[] = [
  'lastRoute',
  'browserKnownSites',
]

export interface ServerWindowDeps {
  config: ConfigStore
  defaultOrigin: string
  /** The bundled page to load, resolved by the caller like the offline page. */
  pagePath: string
  preloadPath: string
  isPackaged: boolean
  getParentWindow: () => BrowserWindow | null
  /**
   * Drops the capabilities the OUTGOING deployment was granted, and reports
   * what it could not drop.
   *
   * Local-filesystem grants and the agent browser's cookie jar live in
   * device-global stores with no origin key, and both are capabilities the user
   * handed to a specific Sim server: directories its agent may read, and live
   * third-party sessions its agent may drive. Carrying them across would let
   * the next deployment act with authority it was never given — which is why
   * sign-out clears exactly this pair.
   *
   * Returns the human-readable name of each store that survived; empty means
   * everything is gone. Reporting rather than throwing is what lets one store's
   * failure not hide another's, and lets the caller refuse to move.
   */
  clearDeploymentScopedState: () => Promise<readonly string[]>
  /** Completes this server wipe only when no stronger account wipe is pending. */
  completeDeploymentScopedStateChange: () => boolean
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
  setOrigin(origin: string): Promise<DesktopServerChangeResult>
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
  /**
   * Serializes the destructive part of a change, the way the sign-out
   * coordinator guards its own teardown. The picker re-enables its button
   * while a request is pending, and the IPC boundary is reachable regardless
   * of what the page does, so without this two changes could interleave their
   * teardown and their write and let the later write pick the next server.
   */
  let changeInFlight = false

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

  const setOrigin = async (raw: string): Promise<DesktopServerChangeResult> => {
    const validated = validateOriginInput(raw)
    if (!validated.ok) {
      return validated
    }
    // Same canonicalization the store applies, so the comparison below matches
    // what would actually be written.
    const origin = canonicalOrigin(validated.origin)
    const current = deps.config.getOrigin()
    if (origin === current && deps.config.isPersistenceAvailable()) {
      // Nothing moves, so nothing is torn down. Relaunching anyway would make
      // "confirm the URL I already use" restart the app for no reason.
      return { ok: true, origin, unchanged: true }
    }

    if (changeInFlight) {
      return { ok: false, error: 'A server change is already in progress.' }
    }
    changeInFlight = true
    try {
      // Fail closed, and clear BEFORE persisting. If a store cannot be emptied,
      // the shell must not move: the incoming deployment would otherwise
      // inherit folder grants and authenticated browser sessions the outgoing
      // one was given, and they are restored on the next startup. Nothing has
      // been written at this point, so refusing leaves the shell on the server
      // it was already using rather than half-applying the change.
      const surviving = await deps.clearDeploymentScopedState().catch((error) => {
        logger.error('Deployment-scoped teardown threw', { error: getErrorMessage(error) })
        return ['local file access and built-in browser sessions']
      })
      if (surviving.length > 0) {
        logger.error('Refusing to change server; deployment-scoped state survived', { surviving })
        // Deliberately describes the whole teardown, not just what failed. The
        // stores clear independently, so one may already be empty by now, and
        // there is nothing to roll back to — a revoked cookie jar and deleted
        // security-scoped bookmarks cannot be un-deleted. Saying "some may have
        // been cleared" is the honest account, and a retry is safe: clearing an
        // already-empty store succeeds, so it finishes the job rather than
        // repeating it.
        return {
          ok: false,
          error: `Could not clear ${surviving.join(' or ')} from the current server, so the server was not changed. Some local access may already have been cleared. Try again to finish, or sign out first.`,
        }
      }

      try {
        if (!deps.completeDeploymentScopedStateChange()) {
          logger.error('Refusing to change server while account-data recovery is active')
          return {
            ok: false,
            error: 'Finish signing out or restart Sim before changing servers.',
          }
        }
      } catch (error) {
        logger.error('Could not finish deployment-scoped teardown', {
          error: getErrorMessage(error),
        })
        return {
          ok: false,
          error: 'Local account-data recovery is still required. Restart Sim and try again.',
        }
      }

      try {
        for (const key of ORIGIN_SCOPED_SETTINGS) {
          deps.config.set(key, undefined)
        }
        const stored = deps.config.setOrigin(raw)
        if (!stored.ok) return stored
      } catch (error) {
        logger.error('Could not persist the new server origin', {
          error: getErrorMessage(error),
        })
        return {
          ok: false,
          error: 'Could not save the new server URL. Try again.',
        }
      }
      logger.info('Server origin changed; relaunching', { from: current, to: origin })
      close()
      deps.relaunch()
      return { ok: true, origin, unchanged: false }
    } finally {
      changeInFlight = false
    }
  }

  return { open, getConfiguration, setOrigin }
}

/** Restarts the process in place. Split out so tests can drive the seam. */
export function relaunchApp(): void {
  app.relaunch()
  app.quit()
}
