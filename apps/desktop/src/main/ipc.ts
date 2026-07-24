import { isBrowserTheme, isBrowserToolName } from '@sim/browser-protocol'
import type {
  DesktopNotificationPayload,
  DesktopUpdateState,
  DesktopWindowState,
} from '@sim/desktop-bridge'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import {
  executeTool,
  getKnownSessions,
  getTabsState,
  handlePanelAction,
} from '@/main/browser-agent/driver'
import {
  setBrowserTheme,
  setPanelBounds,
  setPanelFocused,
  setPanelOccluded,
} from '@/main/browser-agent/session'
import { isSafeInternalPath } from '@/main/config'
import type { DesktopSettingsService } from '@/main/desktop-settings'
import { isDesktopPreferenceKey } from '@/main/desktop-settings'
import type { LocalFilesystemService } from '@/main/local-filesystem'
import { openExternalSafe } from '@/main/navigation'

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
  retryLoad: () => void
  localFilesystem: LocalFilesystemService
  settings: DesktopSettingsService
  getWindowState: () => DesktopWindowState
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

type ChannelSpec =
  | {
      kind: 'invoke'
      gate: ChannelGate
      /** Returned to the caller when the gate rejects the sender. */
      denied: unknown
      handler: (...args: unknown[]) => unknown
    }
  | {
      kind: 'send'
      gate: ChannelGate
      handler: (...args: unknown[]) => void
    }

function isLocalPageSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return (event.senderFrame?.url ?? '').startsWith('file:')
}

function isAppOriginSender(event: IpcMainEvent | IpcMainInvokeEvent, appOrigin: string): boolean {
  return (event.senderFrame?.url ?? '').startsWith(`${appOrigin}/`)
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
      denied: { isFullScreen: false },
      handler: () => deps.getWindowState(),
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
      denied: { ok: false, error: 'Browser automation is not allowed from this page.' },
      handler: (tool, params) => {
        if (typeof tool !== 'string' || !isBrowserToolName(tool)) {
          return { ok: false, error: `Unknown browser tool: ${String(tool)}` }
        }
        const toolParams =
          typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
        return executeTool(tool, toolParams)
      },
    },
    'browser-agent:get-tabs-state': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: { tabs: [], activeTabId: null },
      handler: () => getTabsState(),
    },
    'browser-agent:get-known-sessions': {
      kind: 'invoke',
      gate: 'app-origin',
      denied: { sessions: [] },
      handler: () => getKnownSessions(),
    },
    'browser-agent:panel-action': {
      kind: 'send',
      gate: 'app-origin',
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
    'browser-agent:set-panel-bounds': {
      kind: 'send',
      gate: 'app-origin',
      handler: (raw) => {
        const bounds = parsePanelBounds(raw)
        if (bounds !== undefined) {
          setPanelBounds(bounds)
        }
      },
    },
    'browser-agent:set-panel-focused': {
      kind: 'send',
      gate: 'app-origin',
      handler: (focused) => {
        if (typeof focused === 'boolean') {
          setPanelFocused(focused)
        }
      },
    },
    'browser-agent:set-panel-occluded': {
      kind: 'send',
      gate: 'app-origin',
      handler: (occluded) => {
        if (typeof occluded === 'boolean') {
          setPanelOccluded(occluded)
        }
      },
    },
    'browser-agent:set-theme': {
      kind: 'send',
      gate: 'app-origin',
      handler: (theme) => {
        if (isBrowserTheme(theme)) {
          setBrowserTheme(theme)
        }
      },
    },
    'offline:retry': { kind: 'send', gate: 'local-page', handler: () => deps.retryLoad() },
  }

  const senderAllowed = (event: IpcMainEvent | IpcMainInvokeEvent, gate: ChannelGate): boolean => {
    if (gate === 'any') return true
    if (gate === 'app-origin') return isAppOriginSender(event, deps.appOrigin())
    return isLocalPageSender(event)
  }

  for (const [channel, spec] of Object.entries(channels)) {
    if (spec.kind === 'invoke') {
      ipcMain.handle(channel, async (event, ...args) => {
        if (!senderAllowed(event, spec.gate)) return spec.denied
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
        return spec.handler(...handlerArgs)
      })
    } else {
      ipcMain.on(channel, (event, ...args) => {
        if (senderAllowed(event, spec.gate)) {
          spec.handler(...args)
        }
      })
    }
  }
}
