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
 *   {@link getDesktopChatCapabilities} so every chat surface (main app, Quick
 *   Ask launcher) reports capabilities consistently.
 */
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
  desktopCapabilities?: { localFilesystem?: true; browser?: true }
  /** Compatibility for mothership deployments predating desktopCapabilities.browser. */
  browserCapable?: true
}

/**
 * The capability fragment spread into chat request payloads. Mothership gates
 * user-local VFS guidance/routing and the browser subagent on these flags, so
 * in a plain web browser the model never sees the features.
 *
 * `includeBrowser: false` is for surfaces that cannot host the browser panel
 * (the Quick Ask launcher) — they still run filesystem tools inline but must
 * not invite browser tool calls they cannot render.
 */
export function getDesktopChatCapabilities(
  options: { includeBrowser?: boolean } = {}
): DesktopChatCapabilities {
  const { includeBrowser = true } = options
  const localFilesystem = hasLocalFilesystem()
  const browser = includeBrowser && hasBrowserAgent()
  return {
    ...(localFilesystem || browser
      ? {
          desktopCapabilities: {
            ...(localFilesystem ? { localFilesystem: true as const } : {}),
            ...(browser ? { browser: true as const } : {}),
          },
        }
      : {}),
    ...(browser ? { browserCapable: true } : {}),
  }
}
