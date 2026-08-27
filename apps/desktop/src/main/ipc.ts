import { normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  type BrowserPanelAction,
  type BrowserPanelAnchor,
  type BrowserPanelBounds,
  type BrowserPanelSnapshot,
  isBrowserDataKind,
  isBrowserTheme,
  isBrowserToolName,
} from '@sim/browser-protocol'
import {
  type DesktopNotificationPayload,
  type DesktopServerChangeResult,
  type DesktopServerConfiguration,
  type DesktopUpdateState,
  type DesktopWindowState,
  type DesktopZoomPercent,
  isDesktopAppearanceTheme,
  isDesktopScopeId,
  isDesktopZoomPercent,
  isPendingDesktopScopeId,
} from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import {
  isTerminalOperation,
  isTerminalToolName,
  type TerminalToolArgs,
} from '@sim/terminal-protocol'
import { getErrorMessage } from '@sim/utils/errors'
import { isRecordLike } from '@sim/utils/object'
import { PASTE_LIMITS, utf8ByteLength } from '@sim/utils/paste'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { clipboard, ipcMain, shell } from 'electron'
import {
  type BrowserToolQueueBoundary,
  cancelActiveTool,
  cancelTool,
  captureBrowserToolQueueBoundary,
  clearBrowsingData,
  disposeBrowserScope,
  executeTool,
  getKnownSessions,
  handlePanelAction,
  migrateBrowserScope,
  restoreBrowserScope,
  showToolbarMenu,
  suspendBrowserScope,
} from '@/main/browser-agent/driver'
import { isAgentWebContents } from '@/main/browser-agent/registry'
import {
  addTab,
  findInActiveTab,
  getBrowserDownloadsState,
  peekTabsState,
  reorderTab,
  setBrowserAppTheme,
  setTabPinned,
  showBrowserDownloadInFolder,
  showBrowserDownloadsMenu,
  showTabContextMenu,
  stopFindInActiveTab,
  withBrowserScope,
} from '@/main/browser-agent/session'
import {
  copyCredential,
  credentialsAvailable,
  fillCoordinator,
  forgetAllCredentials,
  forgetCredential,
  listCredentials,
  revealCredential,
} from '@/main/browser-credentials'
import {
  importChromeCookies,
  importChromeData,
  importChromePasswords,
  listChromeImportProfiles,
} from '@/main/browser-import'
import { getSearchSuggestions } from '@/main/browser-search/suggestions'
import { listSites } from '@/main/browser-sites'
import { isSafeInternalPath } from '@/main/config'
import type { DesktopSettingsService } from '@/main/desktop-settings'
import { isDesktopPreferenceKey } from '@/main/desktop-settings'
import { hasRecentDeliberateInput, hasRecentDiscreteInput } from '@/main/input-activity'
import type { LocalFilesystemService } from '@/main/local-filesystem'
import { isAppOrigin, openExternalSafe } from '@/main/navigation'
import type { ScopedEventRouter } from '@/main/scoped-event-router'
import type { TerminalRegistry } from '@/main/terminal/registry'
import { findCachedTerminalThemeProfile, listTerminalThemeProfiles } from '@/main/terminal-themes'

const logger = createLogger('DesktopIpc')

/** Workspace/chat ids are opaque tokens; anything else never reaches a URL. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const TERMINAL_WRITE_CHUNK_CHARACTERS = 64 * 1024

function writeTerminalText(
  terminal: TerminalRegistry,
  scope: string,
  terminalId: string,
  text: string,
  owner?: WebContents
): boolean {
  let start = 0
  while (start < text.length) {
    let end = Math.min(start + TERMINAL_WRITE_CHUNK_CHARACTERS, text.length)
    const finalCode = text.charCodeAt(end - 1)
    if (end < text.length && finalCode >= 0xd800 && finalCode <= 0xdbff) end -= 1
    const chunk = text.slice(start, end)
    if (owner) {
      if (!terminal.writeUserInput(scope, terminalId, chunk, owner)) return false
    } else {
      terminal.write(scope, terminalId, chunk)
    }
    start = end
  }
  return true
}

const MICROPHONE_SETTINGS_URLS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  win32: 'ms-settings:privacy-microphone',
}

/** Opens the native microphone privacy pane without accepting a renderer-provided URL. */
export async function openMicrophoneSettings(
  platform: NodeJS.Platform = process.platform
): Promise<boolean> {
  const settingsUrl = MICROPHONE_SETTINGS_URLS[platform]
  if (!settingsUrl) return false

  try {
    await shell.openExternal(settingsUrl)
    return true
  } catch (error) {
    logger.warn('Could not open microphone privacy settings', {
      error: getErrorMessage(error),
      platform,
    })
    return false
  }
}

/**
 * Desktop state is partitioned by the existing chat id. A new-chat view uses
 * the composer’s existing provisional key until the server assigns that id.
 */
function parseDesktopScope(raw: unknown): string | null {
  return isDesktopScopeId(raw) ? raw : null
}

export interface OAuthConnectScope {
  workspaceId?: string
  credentialId?: string
  draftId?: string
  chatAttemptId?: string
}

/**
 * Validates the optional connect-handoff scope: absent is fine, but a present
 * scope must be an object whose ids are opaque tokens (they are embedded into
 * the /desktop/connect URL). Returns undefined for malformed payloads.
 */
export function parseOAuthConnectScope(raw: unknown): OAuthConnectScope | undefined {
  if (raw === undefined || raw === null) {
    return {}
  }
  if (typeof raw !== 'object') {
    return undefined
  }
  const { workspaceId, credentialId, draftId, chatAttemptId } = raw as {
    workspaceId?: unknown
    credentialId?: unknown
    draftId?: unknown
    chatAttemptId?: unknown
  }
  if (
    workspaceId !== undefined &&
    (typeof workspaceId !== 'string' || !ID_PATTERN.test(workspaceId))
  ) {
    return undefined
  }
  if (
    credentialId !== undefined &&
    (typeof credentialId !== 'string' || !ID_PATTERN.test(credentialId))
  ) {
    return undefined
  }
  if (draftId !== undefined && (typeof draftId !== 'string' || !ID_PATTERN.test(draftId))) {
    return undefined
  }
  if (
    chatAttemptId !== undefined &&
    (typeof chatAttemptId !== 'string' || !ID_PATTERN.test(chatAttemptId))
  ) {
    return undefined
  }
  return {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(credentialId !== undefined ? { credentialId } : {}),
    ...(draftId !== undefined ? { draftId } : {}),
    ...(chatAttemptId !== undefined ? { chatAttemptId } : {}),
  }
}

/**
 * A renderer-supplied dimension worth acting on. `typeof NaN === 'number'` and
 * `NaN <= 0` is false, so a bare typeof check lets an unfinite value through
 * every downstream positivity guard untouched.
 */
export function isPositiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

/**
 * A renderer-supplied dimension as a usable whole number of cells.
 *
 * Flooring after the positivity check is not enough on its own: 0.5 passes
 * `> 0` and floors to 0, and a zero-column pty is either a broken shell or a
 * spawn failure. The floor of one cell is applied here so every caller gets it.
 */
export function toCellCount(value: unknown, fallback: number): number {
  return isPositiveFinite(value) ? Math.max(1, Math.floor(value)) : fallback
}

/** Validates a renderer-reported panel rect (finite numbers or explicit null). */
export function parsePanelBounds(
  raw: unknown
): { x: number; y: number; width: number; height: number } | null | undefined {
  if (raw === null) {
    return null
  }
  if (typeof raw !== 'object') {
    return undefined
  }
  const rect = raw as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
  if (
    typeof rect.x === 'number' &&
    typeof rect.y === 'number' &&
    typeof rect.width === 'number' &&
    typeof rect.height === 'number' &&
    [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
  ) {
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  }
  return undefined
}

/**
 * Validates the optional panel anchor. Absent or malformed yields undefined, so
 * the panel falls back to the measured rect alone — an anchor is an
 * optimization, never a requirement.
 */
export function parsePanelAnchor(raw: unknown): BrowserPanelAnchor | undefined {
  if (!isRecordLike(raw)) {
    return undefined
  }
  const { viewportWidth, viewportHeight, widthRatio } = raw as {
    viewportWidth?: unknown
    viewportHeight?: unknown
    widthRatio?: unknown
  }
  if (
    typeof viewportWidth !== 'number' ||
    typeof viewportHeight !== 'number' ||
    typeof widthRatio !== 'number' ||
    ![viewportWidth, viewportHeight, widthRatio].every(Number.isFinite) ||
    viewportWidth <= 0 ||
    viewportHeight <= 0 ||
    widthRatio < 0 ||
    widthRatio > 1
  ) {
    return undefined
  }
  return { viewportWidth, viewportHeight, widthRatio }
}

/**
 * Validates a renderer-supplied menu anchor point. Menus position at the
 * anchor, so unlike {@link parsePanelAnchor} a malformed value fails the
 * request rather than degrading.
 */
function parseMenuAnchor(raw: unknown): { x: number; y: number } | null {
  if (!isRecordLike(raw)) return null
  const { x, y } = raw as { x?: unknown; y?: unknown }
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    !Number.isFinite(x) ||
    !Number.isFinite(y)
  ) {
    return null
  }
  return { x, y }
}

export function parseDesktopNotificationPayload(raw: unknown): DesktopNotificationPayload | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const { title, body, route } = raw as {
    title?: unknown
    body?: unknown
    route?: unknown
  }
  if (
    typeof title !== 'string' ||
    title.length < 1 ||
    title.length > 120 ||
    typeof body !== 'string' ||
    body.length < 1 ||
    body.length > 500
  ) {
    return null
  }
  if (route !== undefined && (typeof route !== 'string' || !isSafeInternalPath(route))) {
    return null
  }
  return { title, body, ...(route !== undefined ? { route } : {}) }
}

export interface IpcDeps {
  appOrigin: () => string
  allowHttpLocalhost: () => boolean
  /** False while local account-data persistence is unavailable or teardown must be retried. */
  accountDataAvailable: () => boolean
  /** Absolute paths of the bundled recovery pages allowed to control the shell. */
  localPagePaths: readonly string[]
  retryLoad: (sender: WebContents) => void
  localFilesystem: LocalFilesystemService
  terminal: TerminalRegistry
  scopeEvents: Pick<
    ScopedEventRouter,
    'activateBrowser' | 'activateTerminal' | 'sendBrowser' | 'sendTerminal'
  >
  settings: DesktopSettingsService
  getWindowState: (sender: WebContents) => DesktopWindowState
  /** The window owning a renderer, for anchoring native menus. */
  getWindowForContents: (sender: WebContents) => BrowserWindow | null
  browserPanel: {
    /** Activates the singleton compositor only for the foreground app window. */
    activateScope: (sender: WebContents, scopeId: string) => void
    setBounds: (
      sender: WebContents,
      bounds: BrowserPanelBounds | null,
      anchor: BrowserPanelAnchor | undefined,
      scopeId: string
    ) => void
    setFocused: (sender: WebContents, focused: boolean, scopeId: string) => void
    captureSnapshot: (sender: WebContents, scopeId: string) => Promise<BrowserPanelSnapshot | null>
    setOccluded: (
      sender: WebContents,
      occluded: boolean,
      scopeId: string,
      force?: boolean
    ) => boolean
  }
  beginOAuthConnect: (providerId: string, scope: OAuthConnectScope) => Promise<boolean>
  updates: {
    getState: () => DesktopUpdateState
    check: () => void
    install: () => void
  }
  server: {
    open: () => void
    getConfiguration: () => DesktopServerConfiguration
    setOrigin: (origin: string) => Promise<DesktopServerChangeResult>
  }
}

/**
 * Who may call a channel:
 * - `app-origin`: only the remote app origin (main window pages).
 * - `local-page`: only bundled `file:` pages (offline) — shell control.
 * - `browser-page`: only the built-in browser's own tabs, identified by
 *   WebContents rather than by URL. These carry reports from the browser
 *   preload about untrusted pages, so they are the one inbound surface whose
 *   sender is not the app — the payload is treated as a claim to verify, never
 *   as an instruction.
 * - `any`: sender-independent channels that validate their input instead.
 */
type ChannelGate = 'app-origin' | 'local-page' | 'browser-page' | 'any'

/**
 * A desktop surface the user can switch off. Channels that drive one are
 * refused while it is off, so the gate holds even if renderer-side checks are
 * stale or bypassed. Channels that only read or reset the surface's settings
 * stay open — otherwise turning it back on would be impossible.
 */
type ChannelFeature = 'browser' | 'terminal'

interface ChannelSpecBase {
  gate: ChannelGate
  passSender?: boolean
  requires?: ChannelFeature
  /** Account-bearing storage must be readable and writable before this channel can run. */
  requiresAccountData?: boolean
  /** Requires a recent trusted input event for every call, or only selected argument shapes. */
  needsUserActivation?: boolean | ((args: readonly unknown[]) => boolean)
  /**
   * Why this channel's `gate` or `requires` deviates from the rest of its
   * name family. Required by `check:desktop-ipc` for any channel that does,
   * so a new channel cannot quietly opt out of its family's surface toggle.
   *
   * A field rather than a comment because the deviation is a property of this
   * object: reordering the table moves it with its channel, where a positional
   * comment would silently transfer to whichever channel took its place.
   */
  deviationReason?: string
}

type ChannelSpec =
  | (ChannelSpecBase & {
      kind: 'invoke'
      /** Returned to the caller when a gate rejects the call. */
      denied: unknown
      handler: (...args: unknown[]) => unknown
    })
  | (ChannelSpecBase & {
      kind: 'send'
      handler: (...args: unknown[]) => void
    })

function isLocalPageSender(
  event: IpcMainEvent | IpcMainInvokeEvent,
  localPagePaths: readonly string[]
): boolean {
  try {
    const url = new URL(event.senderFrame?.url ?? '')
    if (url.protocol !== 'file:') return false
    const senderPath = normalize(fileURLToPath(url))
    return localPagePaths.some((allowedPath) => senderPath === normalize(allowedPath))
  } catch {
    return false
  }
}

/**
 * Compared by parsed origin, not `startsWith`. This is the renderer-to-main
 * boundary, and prefix matching admits lookalike hosts — see the warning on
 * {@link isAppOrigin}.
 */
function isAppOriginSender(event: IpcMainEvent | IpcMainInvokeEvent, appOrigin: string): boolean {
  return isAppOrigin(event.senderFrame?.url ?? '', appOrigin)
}

function localFilesystemRequestNeedsUserActivation(request: unknown): boolean {
  if (typeof request !== 'object' || request === null) return false
  const operation = (request as { operation?: unknown }).operation
  return (
    operation === 'mount_directory' || operation === 'forget_mount' || operation === 'reveal_mount'
  )
}

function localFilesystemRequestNeedsToolAuthorization(request: unknown): boolean {
  if (typeof request !== 'object' || request === null) return false
  const operation = (request as { operation?: unknown }).operation
  return (
    operation === 'list' ||
    operation === 'glob' ||
    operation === 'read' ||
    operation === 'grep' ||
    operation === 'stat'
  )
}

/**
 * Whether the caller has a real user gesture behind it, answered from the main
 * process's own record of OS input rather than by asking the renderer.
 */
function senderHasUserGesture(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return hasRecentDiscreteInput(event.sender)
}

/**
 * Replies the PTY solicits and the terminal must answer unprompted. All
 * machine-generated and self-delimiting, which is what makes them safe to
 * enumerate.
 *
 * Only numeric/fixed device reports are included. DCS, OSC, focus, and mouse
 * responses are deliberately excluded even when well-formed: they describe
 * renderer state rather than PTY state and do not need an unconditional path
 * around the trusted-input gate.
 */
const PTY_REPLY_PATTERNS = [/\u001b\[[0-9;?]*[Rc]/]
const PTY_REPLY = new RegExp(
  `^(?:${PTY_REPLY_PATTERNS.map((pattern) => pattern.source).join('|')})+$`
)
const MAX_TERMINAL_WRITE_CHARS = 256_000
const MAX_PTY_REPLY_CHARS = 8_192

interface DesktopToolAuthorization {
  chatId: string
  toolName: string
  args: Record<string, unknown>
}

async function fetchDesktopToolAuthorization(
  event: IpcMainInvokeEvent,
  deps: IpcDeps,
  toolCallId: unknown
): Promise<DesktopToolAuthorization | null> {
  if (typeof toolCallId !== 'string' || toolCallId.length < 1 || toolCallId.length > 256) {
    return null
  }
  try {
    const response = await event.sender.session.fetch(
      `${deps.appOrigin()}/api/desktop/tool/authorize`,
      {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolCallId }),
      }
    )
    if (!response.ok) return null
    const authorization = (await response.json()) as {
      chatId?: unknown
      toolName?: unknown
      args?: unknown
    }
    if (
      typeof authorization.chatId !== 'string' ||
      !ID_PATTERN.test(authorization.chatId) ||
      typeof authorization.toolName !== 'string' ||
      typeof authorization.args !== 'object' ||
      authorization.args === null ||
      Array.isArray(authorization.args)
    ) {
      return null
    }
    return {
      chatId: authorization.chatId,
      toolName: authorization.toolName,
      args: authorization.args as Record<string, unknown>,
    }
  } catch {
    return null
  }
}

async function authorizeLocalFilesystemTool(
  event: IpcMainInvokeEvent,
  deps: IpcDeps,
  request: unknown
): Promise<boolean> {
  if (typeof request !== 'object' || request === null) return false
  const authorization = await fetchDesktopToolAuthorization(
    event,
    deps,
    (request as { requestId?: unknown }).requestId
  )
  return authorization
    ? deps.localFilesystem.isAuthorizedClientToolRequest(request, authorization)
    : false
}

/**
 * Registers the whitelisted IPC surface, table-driven so the whole
 * renderer→main security posture is auditable in one place: every channel
 * declares its sender gate up front, and handlers only ever see gated,
 * unvalidated args they must parse themselves.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  const browserScopeBySender = new WeakMap<WebContents, string>()
  const terminalScopeBySender = new WeakMap<WebContents, string>()
  const browserPendingScopesBySender = new WeakMap<WebContents, Set<string>>()
  const terminalPendingScopesBySender = new WeakMap<WebContents, Set<string>>()
  const observedPendingScopeSenders = new WeakSet<WebContents>()

  const observePendingScopeSender = (sender: WebContents): void => {
    if (observedPendingScopeSenders.has(sender)) return
    observedPendingScopeSenders.add(sender)

    const disposeOwnedPendingScopes = (): void => {
      const browserScopes = browserPendingScopesBySender.get(sender)
      browserPendingScopesBySender.delete(sender)
      for (const scope of browserScopes ?? []) {
        disposeBrowserScope(scope)
      }

      const terminalScopes = terminalPendingScopesBySender.get(sender)
      terminalPendingScopesBySender.delete(sender)
      for (const scope of terminalScopes ?? []) {
        deps.terminal.disposeScope(scope)
      }
    }

    sender.on('destroyed', disposeOwnedPendingScopes)
    sender.on('render-process-gone', disposeOwnedPendingScopes)
    sender.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      // SPA task navigation has an explicit detached-stream migration path.
      // A full renderer reload/navigation cannot recover its provisional key,
      // so leaving those native pages and PTYs alive would orphan them.
      if (!isInPlace && isMainFrame) disposeOwnedPendingScopes()
    })
  }

  const rememberPendingScope = (
    pendingScopes: WeakMap<WebContents, Set<string>>,
    sender: WebContents,
    scope: string
  ): void => {
    if (!isPendingDesktopScopeId(scope)) return
    const owned = pendingScopes.get(sender) ?? new Set<string>()
    owned.add(scope)
    pendingScopes.set(sender, owned)
    observePendingScopeSender(sender)
  }

  const consumePendingScope = (
    pendingScopes: WeakMap<WebContents, Set<string>>,
    sender: WebContents,
    scope: string
  ): boolean => {
    const owned = pendingScopes.get(sender)
    if (!owned?.delete(scope)) return false
    if (owned.size === 0) pendingScopes.delete(sender)
    return true
  }

  const activeRendererScope = (
    scopes: WeakMap<WebContents, string>,
    sender: WebContents,
    rawScope: unknown
  ): string | null => {
    const requested = parseDesktopScope(rawScope)
    if (!requested) return null

    const active = scopes.get(sender)
    if (active && active !== requested) return null
    if (!active) scopes.set(sender, requested)
    return requested
  }

  /**
   * Resolves an explicitly scoped operation without requiring that scope to be
   * renderer-active. Terminal groups are independent services, so a late
   * operation for chat A is safe while chat B is visible: it can only touch A.
   * (The browser compositor cannot make that guarantee and uses the stricter
   * helper above.)
   */
  const rendererScope = (
    scopes: WeakMap<WebContents, string>,
    sender: WebContents,
    rawScope: unknown
  ): string | null => {
    const requested = parseDesktopScope(rawScope)
    if (requested && !scopes.has(sender)) scopes.set(sender, requested)
    return requested
  }

  const channels: Record<string, ChannelSpec> = {
    'desktop:open-external': {
      kind: 'invoke',
      gate: 'any',
      needsUserActivation: true,
      deviationReason:
        'the offline and error pages are local-page senders, not app-origin, and handing a support link to the system browser is the one action that must work when the app cannot reach its origin at all',
      denied: false,
      handler: (url) =>
        typeof url === 'string' ? openExternalSafe(url, deps.allowHttpLocalhost()) : false,
    },
    'desktop:open-microphone-settings': {
      kind: 'invoke',
      gate: 'app-origin',
      needsUserActivation: true,
      denied: false,
      handler: () => openMicrophoneSettings(),
    },
    // OAuth connect handoff: the whole flow runs in the system browser (state
    // is cookie-bound to the initiating user agent), returning via loopback.
    'desktop:oauth-connect': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      needsUserActivation: true,
      denied: false,
      handler: (providerId, scope) => {
        if (typeof providerId !== 'string') {
          return false
        }
        const parsedScope = parseOAuthConnectScope(scope)
        if (parsedScope === undefined) {
          return false
        }
        return deps.beginOAuthConnect(providerId, parsedScope)
      },
    },
    'desktop:local-filesystem': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      denied: {
        ok: false,
        code: 'ACCESS_DENIED',
        error: 'Local filesystem access is not allowed from this page.',
      },
      handler: (request) => deps.localFilesystem.handle(request),
    },
    'desktop:settings:get': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: null,
      handler: () => deps.settings.getPreferences(),
    },
    'desktop:settings:set': {
      kind: 'invoke',
      gate: 'app-origin',
      needsUserActivation: ([key]) => key === 'launchAtLogin',
      denied: null,
      handler: (key, value) =>
        isDesktopPreferenceKey(key) && typeof value === 'boolean'
          ? deps.settings.setPreference(key, value)
          : deps.settings.getPreferences(),
    },
    'desktop:settings:set-browser-search-suggestions': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: null,
      handler: (enabled) =>
        typeof enabled === 'boolean'
          ? deps.settings.setBrowserSearchSuggestionsEnabled(enabled)
          : deps.settings.getPreferences(),
    },
    'desktop:settings:set-appearance': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: null,
      handler: (key: unknown, value: unknown) => {
        if (
          (key === 'browserTheme' || key === 'terminalTheme') &&
          isDesktopAppearanceTheme(value)
        ) {
          return deps.settings.setAppearancePreference(key, value)
        }
        return deps.settings.getPreferences()
      },
    },
    'desktop:settings:set-browser-default-zoom': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: null,
      handler: (zoom: unknown) =>
        isDesktopZoomPercent(zoom)
          ? deps.settings.setBrowserDefaultZoom(zoom as DesktopZoomPercent)
          : deps.settings.getPreferences(),
    },
    'desktop:settings:set-terminal-default-zoom': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: null,
      handler: (zoom: unknown) =>
        isDesktopZoomPercent(zoom)
          ? deps.settings.setTerminalDefaultZoom(zoom as DesktopZoomPercent)
          : deps.settings.getPreferences(),
    },
    'desktop:settings:choose-browser-download-directory': {
      kind: 'invoke',
      gate: 'app-origin',
      needsUserActivation: true,
      denied: null,
      handler: () => deps.settings.chooseBrowserDownloadDirectory(),
    },
    'terminal-themes:list-profiles': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: [],
      handler: () => listTerminalThemeProfiles(),
    },
    'terminal-themes:select-profile': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      needsUserActivation: true,
      denied: null,
      handler: (profileId) => {
        if (typeof profileId !== 'string') return null
        const profile = findCachedTerminalThemeProfile(profileId)
        return profile ? deps.settings.selectTerminalProfile(profile) : null
      },
    },
    'desktop:settings:notify': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: false,
      handler: (raw) => {
        const payload = parseDesktopNotificationPayload(raw)
        return payload ? deps.settings.notify(payload) : false
      },
    },
    'desktop:window-state:get': {
      kind: 'invoke',
      gate: 'app-origin',
      passSender: true,
      denied: { isFullScreen: false },
      handler: (sender) => deps.getWindowState(sender as WebContents),
    },
    'desktop:updates:get-state': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: { status: 'idle' },
      handler: () => deps.updates.getState(),
    },
    'desktop:updates:check': {
      kind: 'send',
      gate: 'app-origin',
      needsUserActivation: true,
      handler: () => deps.updates.check(),
    },
    'desktop:updates:install': {
      kind: 'send',
      gate: 'app-origin',
      needsUserActivation: true,
      handler: () => deps.updates.install(),
    },
    'browser-agent:execute-tool': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: { ok: false, error: 'Browser automation is not allowed from this page.' },
      handler: (scope, toolCallId, tool, params, authorizationBoundary) => {
        if (
          typeof scope !== 'string' ||
          typeof toolCallId !== 'string' ||
          typeof tool !== 'string' ||
          !isBrowserToolName(tool)
        ) {
          return { ok: false, error: `Unknown browser tool: ${String(tool)}` }
        }
        const toolParams = isRecordLike(params) ? params : {}
        return executeTool(
          scope,
          tool,
          toolParams,
          toolCallId,
          authorizationBoundary as BrowserToolQueueBoundary | undefined
        )
      },
    },
    'browser-agent:cancel-tool': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: false,
      handler: (sender, toolCallId, rawScope) => {
        const scope = rendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (
          !scope ||
          typeof toolCallId !== 'string' ||
          toolCallId.length < 1 ||
          toolCallId.length > 256
        ) {
          return false
        }
        return cancelTool(scope, toolCallId)
      },
    },
    'browser-agent:cancel-active-tool': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: false,
      handler: (sender, rawScope) => {
        const scope = rendererScope(browserScopeBySender, sender as WebContents, rawScope)
        return scope ? cancelActiveTool(scope) : false
      },
    },
    'browser-agent:get-tabs-state': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: { tabs: [], activeTabId: null },
      handler: (sender, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        return scope
          ? withBrowserScope(scope, () => peekTabsState())
          : { tabs: [], activeTabId: null }
      },
    },
    'browser-agent:open-tab': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: { scopeId: '', tabs: [], activeTabId: null },
      handler: (sender, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        if (!scope) return { scopeId: '', tabs: [], activeTabId: null }
        return withBrowserScope(scope, () => {
          addTab()
          return peekTabsState()
        })
      },
    },
    'browser-agent:activate-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: { tabs: [], activeTabId: null },
      handler: (sender, rawScope) => {
        const scope = parseDesktopScope(rawScope)
        if (!scope) return { tabs: [], activeTabId: null }
        const contents = sender as WebContents
        browserScopeBySender.set(contents, scope)
        rememberPendingScope(browserPendingScopesBySender, contents, scope)
        deps.scopeEvents.activateBrowser(contents, scope)
        deps.browserPanel.activateScope(contents, scope)
        return withBrowserScope(scope, () => peekTabsState())
      },
    },
    'browser-agent:restore-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: { tabs: [], activeTabId: null },
      handler: (sender, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        return scope ? restoreBrowserScope(scope) : { tabs: [], activeTabId: null }
      },
    },
    'browser-agent:migrate-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: { tabs: [], activeTabId: null },
      handler: (sender, rawFrom, rawTo) => {
        const from = parseDesktopScope(rawFrom)
        const to = parseDesktopScope(rawTo)
        const contents = sender as WebContents
        if (
          !from ||
          !isPendingDesktopScopeId(from) ||
          !to ||
          isPendingDesktopScopeId(to) ||
          !browserPendingScopesBySender.get(contents)?.has(from) ||
          !migrateBrowserScope(from, to)
        ) {
          return { tabs: [], activeTabId: null }
        }
        consumePendingScope(browserPendingScopesBySender, contents, from)
        if (browserScopeBySender.get(contents) === from) {
          browserScopeBySender.set(contents, to)
          deps.scopeEvents.activateBrowser(contents, to)
        }
        return withBrowserScope(to, () => peekTabsState())
      },
    },
    'browser-agent:dispose-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: false,
      handler: (rawScope) => {
        const scope = parseDesktopScope(rawScope)
        if (!scope || !isPendingDesktopScopeId(scope)) return false
        disposeBrowserScope(scope)
        return true
      },
    },
    'browser-agent:suspend-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: false,
      handler: (rawScope) => {
        const scope = parseDesktopScope(rawScope)
        if (!scope || isPendingDesktopScopeId(scope)) return false
        const suspended = suspendBrowserScope(scope)
        if (suspended) {
          deps.scopeEvents.sendBrowser(scope, 'browser-agent:scope-suspended', scope)
        }
        return suspended
      },
    },
    // Reads and wipes the stored browsing trail, so both stay available while
    // the browser is switched off — that is exactly when someone clears it.
    'browser-agent:get-known-sessions': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      deviationReason:
        "read/reset of the surface's own data; gating it on the surface would strand the browsing trail with no way to inspect or erase it",
      denied: { sessions: [] },
      handler: () => getKnownSessions(),
    },
    'browser-agent:search-suggestions': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: [],
      handler: (query) =>
        deps.settings.getPreferences().browserSearchSuggestionsEnabled === false
          ? []
          : getSearchSuggestions(query),
    },
    'browser-agent:clear-browsing-data': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      deviationReason:
        'erasing browsing data has to work with the browser off, which is the state a user clearing it is most likely to be in',
      needsUserActivation: true,
      denied: { sessions: [] },
      handler: async (rawKinds) => {
        // Saved passwords are intentionally untouched here; erasing the vault
        // is a separate, explicit action.
        const kinds = Array.isArray(rawKinds) ? rawKinds.filter(isBrowserDataKind) : undefined
        await clearBrowsingData(kinds && kinds.length > 0 ? kinds : undefined)
        return getKnownSessions()
      },
    },
    'browser-agent:get-downloads-state': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: { downloads: [] },
      handler: (sender, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        return scope ? getBrowserDownloadsState(scope) : { downloads: [] }
      },
    },
    'browser-agent:show-download-in-folder': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      needsUserActivation: true,
      denied: false,
      handler: (sender, downloadId, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        return scope && typeof downloadId === 'string'
          ? showBrowserDownloadInFolder(scope, downloadId)
          : false
      },
    },
    'browser-agent:show-downloads-menu': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      needsUserActivation: true,
      denied: false,
      handler: (sender, anchor, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        const ownerWindow = deps.getWindowForContents(contents)
        const point = parseMenuAnchor(anchor)
        if (!scope || !ownerWindow || !point) return false
        return showBrowserDownloadsMenu(scope, ownerWindow, point)
      },
    },
    'browser-agent:show-toolbar-menu': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      needsUserActivation: true,
      denied: false,
      handler: (sender, anchor, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        const ownerWindow = deps.getWindowForContents(contents)
        const point = parseMenuAnchor(anchor)
        if (!scope || !ownerWindow || !point) return false
        return showToolbarMenu(scope, ownerWindow, point)
      },
    },
    'browser-agent:panel-action': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      needsUserActivation: ([action]) =>
        isRecordLike(action) &&
        action.action === 'respond-media-permission' &&
        action.allowed === true,
      handler: (sender, action, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (
          !scope ||
          typeof action !== 'object' ||
          action === null ||
          typeof (action as { action?: unknown }).action !== 'string'
        ) {
          return
        }
        void handlePanelAction(scope, action as BrowserPanelAction).catch(() => {})
      },
    },
    'browser-agent:set-tab-pinned': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, tabId, pinned, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (!scope || typeof tabId !== 'string' || typeof pinned !== 'boolean') return
        try {
          withBrowserScope(scope, () => setTabPinned(tabId, pinned))
        } catch {}
      },
    },
    'browser-agent:show-tab-context-menu': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, tabId, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (!scope || typeof tabId !== 'string') return
        withBrowserScope(scope, () => showTabContextMenu(tabId))
      },
    },
    'browser-agent:reorder-tab': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, tabId, targetIndex, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (
          !scope ||
          typeof tabId !== 'string' ||
          typeof targetIndex !== 'number' ||
          !Number.isFinite(targetIndex)
        ) {
          return
        }
        try {
          withBrowserScope(scope, () => reorderTab(tabId, targetIndex))
        } catch {}
      },
    },
    'browser-agent:set-panel-bounds': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, raw, rawAnchor, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (!scope) return
        const bounds = parsePanelBounds(raw)
        if (bounds !== undefined) {
          deps.browserPanel.setBounds(
            sender as WebContents,
            bounds,
            parsePanelAnchor(rawAnchor),
            scope
          )
        }
      },
    },
    'browser-agent:capture-panel-snapshot': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: null,
      handler: (sender, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        return scope ? deps.browserPanel.captureSnapshot(contents, scope) : null
      },
    },
    'browser-agent:set-panel-occluded': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      denied: false,
      handler: (sender, occluded, rawScope, force = false) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        return scope && typeof occluded === 'boolean' && typeof force === 'boolean'
          ? deps.browserPanel.setOccluded(contents, occluded, scope, force)
          : false
      },
    },
    'browser-agent:set-panel-focused': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, focused, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (scope && typeof focused === 'boolean') {
          deps.browserPanel.setFocused(sender as WebContents, focused, scope)
        }
      },
    },
    'browser-agent:set-theme': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (theme) => {
        if (isBrowserTheme(theme)) {
          setBrowserAppTheme(theme)
        }
      },
    },
    'browser-agent:find': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, raw, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (!scope) return
        if (typeof raw !== 'object' || raw === null) return
        const { query, newSession, forward } = raw as Record<string, unknown>
        if (
          typeof query !== 'string' ||
          typeof newSession !== 'boolean' ||
          typeof forward !== 'boolean'
        ) {
          return
        }
        withBrowserScope(scope, () => findInActiveTab({ query, newSession, forward }))
      },
    },
    'browser-agent:stop-find': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, focusPage, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (scope) {
          withBrowserScope(scope, () => stopFindInActiveTab(focusPage === true))
        }
      },
    },
    // Local Chrome import. This is a user-only surface: no browser tool maps
    // to either channel, so the agent has no path to it, and the import itself
    // additionally demands a live user gesture — a compromised or scripted
    // renderer cannot start one on its own. Only counts come back.
    'browser-import:list-profiles': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: [],
      handler: () => listChromeImportProfiles(),
    },
    'browser-import:cookies': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      needsUserActivation: true,
      denied: { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' },
      handler: (profileId) => {
        // An explicit profile must be honoured or refused, never quietly
        // swapped for the default — that would import the wrong account.
        if (profileId !== undefined && profileId !== null && typeof profileId !== 'string') {
          return { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' }
        }
        return importChromeCookies(typeof profileId === 'string' ? profileId : undefined)
      },
    },
    // Cookies and passwords together, so the user only has to authorize once.
    'browser-import:all': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      needsUserActivation: true,
      denied: {
        cookies: { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' },
        passwords: {
          passwordsAdded: 0,
          passwordsUpdated: 0,
          passwordsSkipped: 0,
          error: 'unknown',
        },
      },
      handler: (profileId, policy) => {
        if (profileId !== undefined && profileId !== null && typeof profileId !== 'string') {
          return {
            cookies: { cookiesImported: 0, cookiesSkipped: 0, error: 'unknown' },
            passwords: {
              passwordsAdded: 0,
              passwordsUpdated: 0,
              passwordsSkipped: 0,
              error: 'unknown',
            },
          }
        }
        return importChromeData(
          typeof profileId === 'string' ? profileId : undefined,
          policy === 'replace' ? 'replace' : 'keep-existing'
        )
      },
    },
    // Reported by the browser preload for the page it is running in. The
    // origin it names is a claim: the fill coordinator re-checks it against
    // the live URL before any password is read.
    'browser-credentials:form-state': {
      kind: 'send',
      gate: 'browser-page',
      deviationReason:
        "the only sender in this family that is a browser PAGE rather than the Sim app, so browser-page is the correct gate and requires:'browser' follows — with the browser off no such page exists",
      requires: 'browser',
      passSender: true,
      handler: (sender, report) => {
        if (!isRecordLike(report)) return
        const { origin, hasLoginForm, hasPasswordField } = report as {
          origin?: unknown
          hasLoginForm?: unknown
          hasPasswordField?: unknown
        }
        if (
          typeof origin !== 'string' ||
          typeof hasLoginForm !== 'boolean' ||
          typeof hasPasswordField !== 'boolean'
        ) {
          return
        }
        fillCoordinator()?.noteFormState(sender as WebContents, {
          origin,
          hasLoginForm,
          hasPasswordField,
        })
      },
    },
    'browser-credentials:available': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      denied: false,
      handler: () => credentialsAvailable(),
    },
    'browser-credentials:list': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      denied: [],
      handler: () => listCredentials(),
    },
    'browser-credentials:list-fill-options': {
      kind: 'invoke',
      gate: 'app-origin',
      deviationReason:
        'this list is derived from the active browser page, so unlike the read-only password manager list beside it there is nothing to inspect when the browser is off',
      requires: 'browser',
      passSender: true,
      denied: [],
      handler: (sender, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        return scope ? (fillCoordinator()?.listFillOptions(scope) ?? []) : []
      },
    },
    // Hosts a previous import brought over, with the name and icon the source
    // browser gave each one and an aggregate count of how much it was used
    // there. No password material, and no browsing history in the sense that
    // matters: no visit times, no URLs beyond the host, no ordering of one
    // visit against another.
    'browser-import:sites': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      deviationReason:
        'a read of already-imported data; settings lists these hosts to show what an import brought over, which is what you look at while deciding whether to enable the browser',
      denied: [],
      handler: () => listSites(),
    },
    // The one channel in the whole surface that can return password
    // plaintext. It is gated three ways: the Sim app origin, a live user
    // gesture, and an OS prompt inside the handler on every single call.
    'browser-credentials:reveal': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      needsUserActivation: true,
      denied: null,
      handler: (id) => (typeof id === 'string' ? revealCredential(id) : null),
    },
    'browser-credentials:copy': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      needsUserActivation: true,
      denied: false,
      handler: (id) => (typeof id === 'string' ? copyCredential(id) : false),
    },
    'browser-credentials:forget': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      needsUserActivation: true,
      denied: [],
      handler: (id) => (typeof id === 'string' ? forgetCredential(id) : listCredentials()),
    },
    'browser-credentials:forget-all': {
      kind: 'invoke',
      gate: 'app-origin',
      requiresAccountData: true,
      needsUserActivation: true,
      denied: [],
      handler: () => forgetAllCredentials(),
    },
    'browser-credentials:import': {
      kind: 'invoke',
      gate: 'app-origin',
      deviationReason:
        "unlike its siblings this WRITES new credentials by driving the embedded browser's import path, so it needs the surface the rest of the family deliberately does without",
      requires: 'browser',
      needsUserActivation: true,
      denied: {
        passwordsAdded: 0,
        passwordsUpdated: 0,
        passwordsSkipped: 0,
        error: 'unknown',
      },
      handler: (profileId, policy) => {
        if (profileId !== undefined && profileId !== null && typeof profileId !== 'string') {
          return { passwordsAdded: 0, passwordsUpdated: 0, passwordsSkipped: 0, error: 'unknown' }
        }
        return importChromePasswords(
          typeof profileId === 'string' ? profileId : undefined,
          policy === 'replace' ? 'replace' : 'keep-existing'
        )
      },
    },
    // Opens the native account chooser. The renderer only says "the user
    // clicked the key icon, here"; it never learns which accounts exist, never
    // names one, and never receives a password. The shell performs the fill.
    'browser-credentials:show-chooser': {
      kind: 'invoke',
      gate: 'app-origin',
      deviationReason:
        'it fills into a live browser page, so unlike the read-only management channels beside it there is nothing to act on when the browser is off',
      requires: 'browser',
      needsUserActivation: true,
      passSender: true,
      denied: false,
      handler: (sender, anchor, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(browserScopeBySender, contents, rawScope)
        const window = deps.getWindowForContents(contents)
        const point = parseMenuAnchor(anchor)
        if (!scope || !window || !point) return false
        return fillCoordinator()?.showChooser(window, point, scope) ?? false
      },
    },
    'browser-credentials:fill-selected': {
      kind: 'invoke',
      gate: 'app-origin',
      deviationReason:
        'it writes a saved credential into the active browser page, so it requires the browser surface plus a live user selection',
      requires: 'browser',
      needsUserActivation: true,
      passSender: true,
      denied: false,
      handler: (sender, id, rawScope) => {
        const scope = activeRendererScope(browserScopeBySender, sender as WebContents, rawScope)
        if (!scope || typeof id !== 'string' || !ID_PATTERN.test(id)) return false
        return fillCoordinator()?.fillCredential(id, scope) ?? false
      },
    },
    'terminal:start': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { ok: false, code: 'ACCESS_DENIED', error: 'Not allowed from this page.' },
      handler: (sender, raw, rawScope) => {
        const contents = sender as WebContents
        const scope = rendererScope(terminalScopeBySender, contents, rawScope)
        if (!scope) {
          return { ok: false, code: 'STALE_SCOPE', error: 'This terminal chat is not active.' }
        }
        const options = isRecordLike(raw) ? raw : {}
        const cols = Number(options.cols)
        const rows = Number(options.rows)
        try {
          return {
            ok: true,
            tabs: {
              ...deps.terminal.start(scope, {
                cols: toCellCount(cols, 80),
                rows: toCellCount(rows, 24),
              }),
              scopeId: scope,
            },
          }
        } catch (error) {
          const failure = error as { code?: string; message?: string }
          return {
            ok: false,
            code: failure.code ?? 'SPAWN_FAILED',
            error: failure.message ?? 'Could not open a terminal.',
          }
        }
      },
    },
    'terminal:execute-tool': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: { ok: false, error: 'Terminal access is not allowed from this page.' },
      handler: (scope, toolCallId, tool, params) => {
        if (
          typeof scope !== 'string' ||
          typeof toolCallId !== 'string' ||
          typeof tool !== 'string' ||
          !isTerminalToolName(tool)
        ) {
          return { ok: false, error: `Unknown terminal tool: ${String(tool)}` }
        }
        const call = isRecordLike(params) ? params : {}
        if (!isTerminalOperation(call.operation)) {
          return { ok: false, error: `Unknown terminal operation: ${String(call.operation)}` }
        }
        const args = isRecordLike(call.args) ? (call.args as TerminalToolArgs) : {}
        return deps.terminal.executeTool(scope, toolCallId, call.operation, args)
      },
    },
    'terminal:handoff-done': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      handler: (sender, terminalId, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (scope && typeof terminalId === 'string') {
          deps.terminal.finishHandoff(scope, terminalId)
        }
      },
    },
    'terminal:focused': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      handler: (sender, focused, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (scope) deps.terminal.setPanelFocused(scope, focused === true, sender as WebContents)
      },
    },
    'terminal:visible': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      handler: (sender, visible, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (scope) deps.terminal.setPanelVisible(scope, visible === true, sender as WebContents)
      },
    },
    'terminal:paste': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: false,
      // Paste is the sole interactive operation whose bytes do not originate
      // in the renderer. The shell reads the clipboard itself after a fresh
      // click/shortcut and still requires visible, focused active-tab
      // ownership below.
      needsUserActivation: true,
      handler: (sender, terminalId, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (!scope || typeof terminalId !== 'string') return false
        const text = clipboard.readText()
        if (!text) return false
        if (utf8ByteLength(text, PASTE_LIMITS.TERMINAL_BYTES) > PASTE_LIMITS.TERMINAL_BYTES) {
          return 'too-large'
        }
        return writeTerminalText(deps.terminal, scope, terminalId, text, sender as WebContents)
      },
    },
    'terminal:scrollback': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: '',
      handler: (sender, terminalId, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        return scope && typeof terminalId === 'string'
          ? deps.terminal.getScrollback(scope, terminalId)
          : ''
      },
    },
    'terminal:clear-scrollback': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: false,
      handler: (sender, terminalId, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        return scope && typeof terminalId === 'string'
          ? deps.terminal.clearScrollback(scope, terminalId)
          : false
      },
    },
    'terminal:get-tabs': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, rawScope) => {
        const contents = sender as WebContents
        const scope = rendererScope(terminalScopeBySender, contents, rawScope)
        return scope
          ? { ...deps.terminal.peekTabs(scope), scopeId: scope }
          : { tabs: [], activeTerminalId: null }
      },
    },
    'terminal:activate-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, rawScope) => {
        const scope = parseDesktopScope(rawScope)
        if (!scope) return { tabs: [], activeTerminalId: null }
        const contents = sender as WebContents
        terminalScopeBySender.set(contents, scope)
        rememberPendingScope(terminalPendingScopesBySender, contents, scope)
        deps.scopeEvents.activateTerminal(contents, scope)
        return { ...deps.terminal.activateScope(scope), scopeId: scope }
      },
    },
    'terminal:migrate-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, rawFrom, rawTo) => {
        const from = parseDesktopScope(rawFrom)
        const to = parseDesktopScope(rawTo)
        const contents = sender as WebContents
        if (
          !from ||
          !isPendingDesktopScopeId(from) ||
          !to ||
          isPendingDesktopScopeId(to) ||
          !terminalPendingScopesBySender.get(contents)?.has(from) ||
          !deps.terminal.migrateScope(from, to)
        ) {
          return { tabs: [], activeTerminalId: null }
        }
        consumePendingScope(terminalPendingScopesBySender, contents, from)
        if (terminalScopeBySender.get(contents) === from) {
          terminalScopeBySender.set(contents, to)
          deps.scopeEvents.activateTerminal(contents, to)
        }
        return { ...deps.terminal.peekTabs(to), scopeId: to }
      },
    },
    'terminal:dispose-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: false,
      handler: (sender, rawScope) => {
        const scope = parseDesktopScope(rawScope)
        const contents = sender as WebContents
        if (
          !scope ||
          !isPendingDesktopScopeId(scope) ||
          !terminalPendingScopesBySender.get(contents)?.has(scope)
        ) {
          return false
        }
        consumePendingScope(terminalPendingScopesBySender, contents, scope)
        deps.terminal.disposeScope(scope)
        return true
      },
    },
    'terminal:suspend-scope': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: false,
      handler: (sender, rawScope) => {
        const scope = parseDesktopScope(rawScope)
        const contents = sender as WebContents
        if (
          !scope ||
          isPendingDesktopScopeId(scope) ||
          terminalScopeBySender.get(contents) !== scope
        ) {
          return false
        }
        const suspended = deps.terminal.suspendScope(scope)
        if (suspended) {
          deps.scopeEvents.sendTerminal(scope, 'terminal:scope-suspended', scope)
        }
        return suspended
      },
    },
    'terminal:open': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, cwd, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        return scope
          ? {
              ...deps.terminal.openTerminal(scope, typeof cwd === 'string' ? cwd : undefined),
              scopeId: scope,
            }
          : { tabs: [], activeTerminalId: null }
      },
    },
    'terminal:switch': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, terminalId, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (!scope) return { tabs: [], activeTerminalId: null }
        const tabs =
          typeof terminalId === 'string'
            ? deps.terminal.switchTerminal(scope, terminalId)
            : deps.terminal.getTabs(scope)
        return { ...tabs, scopeId: scope }
      },
    },
    'terminal:reorder': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, terminalId, targetIndex, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (!scope) return { tabs: [], activeTerminalId: null }
        const tabs =
          typeof terminalId === 'string' &&
          typeof targetIndex === 'number' &&
          Number.isFinite(targetIndex)
            ? deps.terminal.reorderTerminal(scope, terminalId, targetIndex)
            : deps.terminal.getTabs(scope)
        return { ...tabs, scopeId: scope }
      },
    },
    'terminal:close': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      needsUserActivation: true,
      denied: { tabs: [], activeTerminalId: null },
      handler: (sender, terminalId, rawScope) => {
        const contents = sender as WebContents
        const scope = activeRendererScope(terminalScopeBySender, contents, rawScope)
        if (!scope) return { tabs: [], activeTerminalId: null }
        const tabs =
          typeof terminalId === 'string'
            ? deps.terminal.closeUserTerminal(scope, terminalId, contents)
            : deps.terminal.getTabs(scope)
        return { ...tabs, scopeId: scope }
      },
    },
    'terminal:write': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      handler: (sender, terminalId, data, rawScope) => {
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (!scope || typeof terminalId !== 'string' || typeof data !== 'string') return
        if (data.length === 0 || data.length > MAX_TERMINAL_WRITE_CHARS) return
        if (data.length <= MAX_PTY_REPLY_CHARS && PTY_REPLY.test(data)) {
          writeTerminalText(deps.terminal, scope, terminalId, data)
          return
        }
        const contents = sender as WebContents
        if (!hasRecentDeliberateInput(contents)) return
        writeTerminalText(deps.terminal, scope, terminalId, data, contents)
      },
    },
    'terminal:resize': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      handler: (sender, terminalId, cols, rows, rawScope) => {
        // `typeof NaN === 'number'`, and the downstream `cols <= 0` guard is
        // false for NaN, so an unfinite value reached pty.resize() intact.
        // Matches the clamping terminal:start already applies to these fields.
        if (typeof terminalId !== 'string') return
        if (!isPositiveFinite(cols) || !isPositiveFinite(rows)) return
        const scope = rendererScope(terminalScopeBySender, sender as WebContents, rawScope)
        if (!scope) return
        deps.terminal.resize(scope, terminalId, toCellCount(cols, 1), toCellCount(rows, 1))
      },
    },
    'offline:retry': {
      kind: 'send',
      gate: 'local-page',
      passSender: true,
      handler: (sender) => deps.retryLoad(sender as WebContents),
    },
    // The `server:` family is local-page only, and deliberately so: the one
    // surface that repoints the shell at another deployment must keep working
    // when the current one is unreachable (the offline page is where a
    // self-hoster with a typo'd origin actually lands), and must never be
    // drivable by a page the current server serves.
    'server:open': {
      kind: 'send',
      gate: 'local-page',
      handler: () => deps.server.open(),
    },
    'server:get-configuration': {
      kind: 'invoke',
      gate: 'local-page',
      denied: null,
      handler: () => deps.server.getConfiguration(),
    },
    'server:set-origin': {
      kind: 'invoke',
      gate: 'local-page',
      denied: { ok: false, error: 'The server can only be changed from the Sim app itself.' },
      handler: (origin) =>
        typeof origin === 'string'
          ? deps.server.setOrigin(origin)
          : { ok: false, error: 'Server URL is required' },
    },
  }

  const senderAllowed = (event: IpcMainEvent | IpcMainInvokeEvent, gate: ChannelGate): boolean => {
    if (gate === 'any') return true
    if (gate === 'app-origin') return isAppOriginSender(event, deps.appOrigin())
    if (gate === 'browser-page') return isAgentWebContents(event.sender)
    return isLocalPageSender(event, deps.localPagePaths)
  }

  const featureAllowed = (feature: ChannelFeature | undefined): boolean => {
    if (!feature) return true
    if (!deps.accountDataAvailable()) return false
    const preferences = deps.settings.getPreferences()
    return feature === 'browser' ? preferences.browserEnabled : preferences.terminalEnabled
  }

  const accountDataAllowed = (spec: ChannelSpec): boolean =>
    spec.requiresAccountData !== true || deps.accountDataAvailable()

  const requiresUserActivation = (
    requirement: ChannelSpecBase['needsUserActivation'],
    args: readonly unknown[]
  ): boolean => (typeof requirement === 'function' ? requirement(args) : requirement === true)

  for (const [channel, spec] of Object.entries(channels)) {
    if (spec.kind === 'invoke') {
      ipcMain.handle(channel, async (event, ...args) => {
        if (
          !senderAllowed(event, spec.gate) ||
          !featureAllowed(spec.requires) ||
          !accountDataAllowed(spec)
        ) {
          return spec.denied
        }
        if (
          requiresUserActivation(spec.needsUserActivation, args) &&
          !senderHasUserGesture(event)
        ) {
          return spec.denied
        }
        let handlerArgs = args
        if (channel === 'browser-agent:execute-tool') {
          const requestedTool = args[1]
          const requestedScope = parseDesktopScope(args[3])
          const authorizationBoundary = requestedScope
            ? captureBrowserToolQueueBoundary(requestedScope)
            : undefined
          const authorization = await fetchDesktopToolAuthorization(event, deps, args[0])
          if (
            !authorization ||
            !requestedScope ||
            authorization.chatId !== requestedScope ||
            typeof requestedTool !== 'string' ||
            authorization.toolName !== requestedTool ||
            !isBrowserToolName(authorization.toolName)
          ) {
            return {
              ok: false,
              error: 'This browser action is not an authorized pending Copilot tool call.',
            }
          }
          handlerArgs = [
            authorization.chatId,
            args[0],
            authorization.toolName,
            authorization.args,
            authorizationBoundary,
          ]
        }
        if (channel === 'terminal:execute-tool') {
          const requestedTool = args[1]
          const authorization = await fetchDesktopToolAuthorization(event, deps, args[0])
          if (
            !authorization ||
            typeof requestedTool !== 'string' ||
            authorization.toolName !== requestedTool ||
            !isTerminalToolName(authorization.toolName)
          ) {
            return {
              ok: false,
              error: 'This terminal action is not an authorized pending Copilot tool call.',
            }
          }
          // The command executed is the one the server has on file for this
          // tool call, never the one the renderer passed in.
          handlerArgs = [authorization.chatId, args[0], authorization.toolName, authorization.args]
        }
        if (
          channel === 'desktop:local-filesystem' &&
          localFilesystemRequestNeedsUserActivation(args[0]) &&
          !senderHasUserGesture(event)
        ) {
          return {
            ok: false,
            code: 'ACCESS_DENIED',
            error: 'This local filesystem action requires an explicit user click.',
          }
        }
        if (
          channel === 'desktop:local-filesystem' &&
          localFilesystemRequestNeedsToolAuthorization(args[0]) &&
          !(await authorizeLocalFilesystemTool(event, deps, args[0]))
        ) {
          return {
            ok: false,
            code: 'ACCESS_DENIED',
            error: 'This local filesystem request is not an authorized pending Copilot tool call.',
          }
        }
        if (spec.passSender) {
          handlerArgs = [event.sender, ...handlerArgs]
        }
        return spec.handler(...handlerArgs)
      })
    } else {
      ipcMain.on(channel, (event, ...args) => {
        if (
          !senderAllowed(event, spec.gate) ||
          !featureAllowed(spec.requires) ||
          !accountDataAllowed(spec)
        ) {
          return
        }
        if (
          requiresUserActivation(spec.needsUserActivation, args) &&
          !senderHasUserGesture(event)
        ) {
          return
        }
        spec.handler(...(spec.passSender ? [event.sender, ...args] : args))
      })
    }
  }
}
