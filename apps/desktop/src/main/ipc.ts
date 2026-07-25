import {
  type BrowserPanelAnchor,
  type BrowserPanelBounds,
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
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { ipcMain } from 'electron'
import {
  clearBrowserProfile,
  executeTool,
  getKnownSessions,
  handlePanelAction,
} from '@/main/browser-agent/driver'
import {
  getTabsState,
  reorderTab,
  setBrowserTheme,
  setTabPinned,
} from '@/main/browser-agent/session'
import { isSafeInternalPath } from '@/main/config'
import type { DesktopSettingsService } from '@/main/desktop-settings'
import { isDesktopPreferenceKey } from '@/main/desktop-settings'
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
 * - `any`: sender-independent channels that validate their input instead.
 */
type ChannelGate = 'app-origin' | 'local-page' | 'any'

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

async function rendererHasActiveUserGesture(event: IpcMainInvokeEvent): Promise<boolean> {
  const frame = event.senderFrame
  if (!frame || typeof frame.executeJavaScript !== 'function') return false
  try {
    return (await frame.executeJavaScript('navigator.userActivation?.isActive === true')) === true
  } catch {
    return false
  }
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
      denied: { sessions: [] },
      handler: () => getKnownSessions(),
    },
    'browser-agent:clear-browsing-data': {
      kind: 'invoke',
      gate: 'app-origin',
      needsUserActivation: true,
      denied: { sessions: [] },
      handler: async () => {
        await clearBrowserProfile()
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
              cols: Number.isFinite(cols) && cols > 0 ? Math.floor(cols) : 80,
              rows: Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : 24,
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
      handler: (focused) => deps.terminal.setPanelFocused(focused === true),
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
        if (typeof terminalId === 'string' && typeof data === 'string') {
          deps.terminal.write(terminalId, data)
        }
      },
    },
    'terminal:resize': {
      kind: 'send',
      gate: 'app-origin',
      requires: 'terminal',
      handler: (terminalId, cols, rows) => {
        if (
          typeof terminalId === 'string' &&
          typeof cols === 'number' &&
          typeof rows === 'number'
        ) {
          deps.terminal.resize(terminalId, Math.floor(cols), Math.floor(rows))
        }
      },
    },
    'terminal:dispose': {
      kind: 'send',
      gate: 'app-origin',
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
        if (spec.needsUserActivation && !(await rendererHasActiveUserGesture(event))) {
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
          !(await rendererHasActiveUserGesture(event))
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
        if (senderAllowed(event, spec.gate) && featureAllowed(spec.requires)) {
          spec.handler(...(spec.passSender ? [event.sender, ...args] : args))
        }
      })
    }
  }
}
