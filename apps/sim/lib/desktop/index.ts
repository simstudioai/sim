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
 * - The browser and terminal additionally have a device switch the user can
 *   turn off. `has*` answers whether the shell ships the surface (what the
 *   settings pages need, so the switch can be turned back on); `is*Enabled`
 *   answers whether it may actually run (what everything else needs).
 * - Anything advertised to the copilot backend must flow through
 *   {@link getDesktopChatCapabilities} so every chat surface reports
 *   capabilities consistently.
 */
import type { BrowserKnownSession } from '@sim/browser-protocol'
import type { DesktopPreferences, SimDesktopApi } from '@sim/desktop-bridge'

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

/** True when the shell can run an interactive local shell for the agent. */
export function hasTerminal(): boolean {
  return Boolean(getDesktopBridge()?.terminal)
}

/** True when the shell exposes device-level desktop preferences. */
export function hasDesktopSettings(): boolean {
  return Boolean(getDesktopBridge()?.settings)
}

/**
 * The device switches for the browser and terminal, cached because the chat UI
 * reads availability synchronously while the shell only answers over async
 * IPC. An unread or absent value means enabled: both surfaces predate the
 * preference, and both default to on.
 *
 * The cache is authoritative at call time, which is what tool execution and
 * capability reporting need. React trees that read it in a memo settle on the
 * next mount — flipping a switch happens on a settings route, so the chat view
 * has unmounted by then anyway.
 */
let devicePreferences: DesktopPreferences | null = null
let devicePreferencesLoad: Promise<void> | null = null

function loadDevicePreferences(): Promise<void> {
  devicePreferencesLoad ??=
    getDesktopBridge()
      ?.settings?.getPreferences()
      .then((preferences) => {
        devicePreferences = preferences
      })
      .catch(() => {}) ?? Promise.resolve()
  return devicePreferencesLoad
}

function isSurfaceSwitchedOn(key: 'browserEnabled' | 'terminalEnabled'): boolean {
  void loadDevicePreferences()
  return devicePreferences?.[key] !== false
}

/**
 * Publishes a preference change from the settings pages so the synchronous
 * gates below stop lagging a round trip behind the shell.
 */
export function setDesktopPreferencesSnapshot(preferences: DesktopPreferences): void {
  devicePreferences = preferences
  devicePreferencesLoad = Promise.resolve()
}

/** True when the agent browser is installed and switched on for this device. */
export function isBrowserAgentEnabled(): boolean {
  return hasBrowserAgent() && isSurfaceSwitchedOn('browserEnabled')
}

/** True when the agent terminal is installed and switched on for this device. */
export function isTerminalEnabled(): boolean {
  return hasTerminal() && isSurfaceSwitchedOn('terminalEnabled')
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

/**
 * Summary of one open shell, sent with each request so the agent knows what is
 * already running without having to ask. No output and no environment: only
 * enough to pick a terminal and notice when one is occupied.
 */
export interface DesktopTerminalHint {
  id: string
  cwd?: string
  running?: string
  interactive?: boolean
  active?: boolean
}

export interface DesktopChatCapabilities {
  desktopCapabilities?: {
    localFilesystem?: true
    browser?: true
    terminal?: true
    browserSessions?: BrowserKnownSession[]
    terminals?: DesktopTerminalHint[]
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
  // Never advertise a surface the user switched off, even on the first
  // request after launch, before the cached preferences have arrived.
  await loadDevicePreferences()
  const localFilesystem = hasLocalFilesystem()
  const browser = isBrowserAgentEnabled()
  const terminal = isTerminalEnabled()
  // Sent every request so the agent knows what is already running without
  // spending a tool call to ask — and, more importantly, so it notices a
  // terminal that is occupied instead of launching a second copy into it.
  const terminals: DesktopTerminalHint[] =
    terminal && bridge?.terminal?.getTabs
      ? await bridge.terminal
          .getTabs()
          .then((state) =>
            state.tabs.map((tab) => ({
              id: tab.terminalId,
              ...(tab.cwd ? { cwd: tab.cwd } : {}),
              ...(tab.running ? { running: tab.running } : {}),
              ...(tab.interactive ? { interactive: true as const } : {}),
              ...(tab.active ? { active: true as const } : {}),
            }))
          )
          .catch(() => [])
      : []
  const browserSessions =
    browser && bridge?.browserAgent?.getKnownSessions
      ? await bridge.browserAgent
          .getKnownSessions()
          .then((state) => state.sessions)
          .catch(() => [])
      : []
  return {
    ...(localFilesystem || browser || terminal
      ? {
          desktopCapabilities: {
            ...(localFilesystem ? { localFilesystem: true as const } : {}),
            ...(browser ? { browser: true as const } : {}),
            ...(terminal ? { terminal: true as const } : {}),
            ...(terminals.length > 0 ? { terminals } : {}),
            ...(browserSessions.length > 0 ? { browserSessions } : {}),
          },
        }
      : {}),
    ...(browser ? { browserCapable: true } : {}),
  }
}
