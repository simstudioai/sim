import { isBrowserToolName } from '@sim/browser-protocol'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { ipcMain } from 'electron'
import { executeTool, handlePanelAction } from '@/main/browser-agent/driver'
import { setPanelBounds } from '@/main/browser-agent/session'
import type { LocalFilesystemService } from '@/main/local-filesystem'
import { openExternalSafe } from '@/main/navigation'

/** Workspace/chat ids are opaque tokens; anything else never reaches a URL. */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export interface LauncherOpenChatTarget {
  workspaceId: string
  chatId?: string
}

/**
 * Validates the launcher's open-chat payload. Both ids are embedded into a
 * loadURL path, so they are allowlisted to opaque-token characters — no
 * slashes, dots, or percent escapes.
 */
export function parseLauncherOpenChatTarget(raw: unknown): LauncherOpenChatTarget | null {
  if (typeof raw !== 'object' || raw === null) {
    return null
  }
  const { workspaceId, chatId } = raw as { workspaceId?: unknown; chatId?: unknown }
  if (typeof workspaceId !== 'string' || !ID_PATTERN.test(workspaceId)) {
    return null
  }
  if (chatId !== undefined && (typeof chatId !== 'string' || !ID_PATTERN.test(chatId))) {
    return null
  }
  return { workspaceId, ...(chatId !== undefined ? { chatId } : {}) }
}

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

export interface IpcDeps {
  appOrigin: () => string
  allowHttpLocalhost: () => boolean
  retryLoad: () => void
  localFilesystem: LocalFilesystemService
  beginOAuthConnect: (providerId: string, scope: OAuthConnectScope) => Promise<boolean>
  launcher: {
    openChat: (target: LauncherOpenChatTarget) => void
    openApp: () => void
    hide: () => void
    resize: (height: number) => void
  }
}

/**
 * Who may call a channel:
 * - `app-origin`: only the remote app origin (main window / launcher pages).
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
    'offline:retry': { kind: 'send', gate: 'local-page', handler: () => deps.retryLoad() },
    'launcher:open-chat': {
      kind: 'send',
      gate: 'app-origin',
      handler: (raw) => {
        const target = parseLauncherOpenChatTarget(raw)
        if (target) {
          deps.launcher.openChat(target)
        }
      },
    },
    'launcher:open-app': {
      kind: 'send',
      gate: 'app-origin',
      handler: () => deps.launcher.openApp(),
    },
    'launcher:close': { kind: 'send', gate: 'app-origin', handler: () => deps.launcher.hide() },
    'launcher:resize': {
      kind: 'send',
      gate: 'app-origin',
      handler: (height) => {
        if (typeof height === 'number' && Number.isFinite(height)) {
          deps.launcher.resize(height)
        }
      },
    },
  }

  const senderAllowed = (event: IpcMainEvent | IpcMainInvokeEvent, gate: ChannelGate): boolean => {
    if (gate === 'any') return true
    if (gate === 'app-origin') return isAppOriginSender(event, deps.appOrigin())
    return isLocalPageSender(event)
  }

  for (const [channel, spec] of Object.entries(channels)) {
    if (spec.kind === 'invoke') {
      ipcMain.handle(channel, (event, ...args) =>
        senderAllowed(event, spec.gate) ? spec.handler(...args) : spec.denied
      )
    } else {
      ipcMain.on(channel, (event, ...args) => {
        if (senderAllowed(event, spec.gate)) {
          spec.handler(...args)
        }
      })
    }
  }
}
