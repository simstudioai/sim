/**
 * THE single detection point for the Sim desktop app.
 *
 * The web app is served identically to browsers and to the desktop shell; the
 * only difference is the preload bridge the shell injects
 * (`window.simDesktop`, typed in `@sim/desktop-bridge`). Desktop features are
 * progressive enhancements: feature-detect a bridge surface here, never
 * assume it.
 *
 * Rules for scaling desktop features without scattering gates:
 * - Shared code must not touch `window.simDesktop` directly — add an accessor
 *   here (or a feature-scoped wrapper like `lib/browser-agent/transport.ts`
 *   that builds on {@link getDesktopBridge}) so "everything desktop" stays
 *   greppable from one module.
 * - Gate on the specific bridge surface a feature needs (e.g.
 *   {@link hasLocalFilesystem}), not on "is desktop" — older shells may lack
 *   newer surfaces.
 * - Anything advertised to the copilot backend must flow through
 *   {@link getDesktopChatCapabilities} so every chat surface reports
 *   capabilities consistently.
 */
import type { BrowserKnownSession } from '@sim/browser-protocol'
import type { SimDesktopApi } from '@sim/desktop-bridge'

/** The preload bridge, or undefined outside the desktop app (and on the server). */
export function getDesktopBridge(): SimDesktopApi | undefined {
  if (typeof window === 'undefined') return undefined
  return window.simDesktop
}

/** True when running inside the Sim desktop app. */
export function isDesktopApp(): boolean {
  return getDesktopBridge() !== undefined
}

/** True when the shell can serve read-only local-directory grants. */
export function hasLocalFilesystem(): boolean {
  return Boolean(getDesktopBridge()?.localFilesystem)
}

/** True when the shell hosts the embedded agent browser. */
export function hasBrowserAgent(): boolean {
  return Boolean(getDesktopBridge()?.browserAgent)
}

/** True when the shell exposes device-level desktop preferences. */
export function hasDesktopSettings(): boolean {
  return Boolean(getDesktopBridge()?.settings)
}

/**
 * The installed shell's semver, or undefined in a browser and on shells that
 * predate version reporting. Input to the minimum-shell-version gate (see
 * `lib/desktop/min-version.ts`).
 */
export function getDesktopShellVersion(): string | undefined {
  return getDesktopBridge()?.version
}

/** The shell updater surface, when the installed shell provides one. */
export function getDesktopUpdates(): SimDesktopApi['updates'] {
  return getDesktopBridge()?.updates
}

export interface DesktopChatCapabilities {
  desktopCapabilities?: {
    localFilesystem?: true
    browser?: true
    browserSessions?: BrowserKnownSession[]
  }
  /** Compatibility for mothership deployments predating desktopCapabilities.browser. */
  browserCapable?: true
}

/**
 * The capability fragment spread into chat request payloads. Mothership gates
 * user-local VFS guidance/routing and the browser subagent on these flags, so
 * in a plain web browser the model never sees the features.
 */
export async function getDesktopChatCapabilities(): Promise<DesktopChatCapabilities> {
  const bridge = getDesktopBridge()
  const localFilesystem = hasLocalFilesystem()
  const browser = hasBrowserAgent()
  const browserSessions =
    browser && bridge?.browserAgent?.getKnownSessions
      ? await bridge.browserAgent
          .getKnownSessions()
          .then((state) => state.sessions)
          .catch(() => [])
      : []
  return {
    ...(localFilesystem || browser
      ? {
          desktopCapabilities: {
            ...(localFilesystem ? { localFilesystem: true as const } : {}),
            ...(browser ? { browser: true as const } : {}),
            ...(browserSessions.length > 0 ? { browserSessions } : {}),
          },
        }
      : {}),
    ...(browser ? { browserCapable: true } : {}),
  }
}
