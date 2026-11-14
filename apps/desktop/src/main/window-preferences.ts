import type { WebPreferences } from 'electron'
import { app } from 'electron'

/**
 * The hardened webPreferences shared by the main window and any child window.
 * The preload injects nothing into the page; it only exposes a whitelisted
 * IPC bridge. The shell version rides in as a preload argv flag so the web
 * app can enforce its minimum shell version without an IPC round-trip.
 *
 * A null `preloadPath` gives a plain web page with no bridge at all, for
 * surfaces that must not report device capabilities (see `quick-chat.ts`).
 */
export function createSecureWebPreferences(
  partition: string,
  preloadPath: string | null,
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
    preload: preloadPath ?? undefined,
    additionalArguments: [`--sim-desktop-version=${app.getVersion()}`],
  }
}
