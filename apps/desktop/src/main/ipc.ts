import type { LauncherShortcutSettings } from '@sim/desktop-bridge'
import { isBrowserToolName } from '@sim/browser-protocol'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, ipcMain } from 'electron'
import { executeTool, handlePanelAction, setPanelBounds } from '@/main/browser-agent/driver'
import type { ConfigStore, OriginValidation } from '@/main/config'
import { DEFAULT_ORIGIN } from '@/main/config'
import type { LocalFilesystemService } from '@/main/local-filesystem'
import { openExternalSafe } from '@/main/navigation'
import { ensureMicrophoneAccess } from '@/main/window'

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

export interface IpcDeps {
  config: ConfigStore
  appOrigin: () => string
  allowHttpLocalhost: () => boolean
  retryLoad: () => void
  openSettings: () => void
  closeSettings: () => void
  applyOrigin: (raw: string) => Promise<OriginValidation>
  localFilesystem: LocalFilesystemService
  launcher: {
    openChat: (target: LauncherOpenChatTarget) => void
    openApp: () => void
    hide: () => void
    resize: (height: number) => void
  }
  launcherShortcut: {
    get: () => LauncherShortcutSettings
    set: (shortcut: string) => LauncherShortcutSettings
  }
}

function isLocalPageSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return (event.senderFrame?.url ?? '').startsWith('file:')
}

function isAppOriginSender(event: IpcMainEvent | IpcMainInvokeEvent, appOrigin: string): boolean {
  return (event.senderFrame?.url ?? '').startsWith(`${appOrigin}/`)
}

/**
 * Registers the whitelisted IPC surface. Shell-control channels (settings,
 * offline retry) are restricted to bundled file: pages; microphone consent is
 * restricted to the app origin. The remote origin can reach only harmless,
 * validated channels.
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  ipcMain.handle('desktop:get-app-version', () => app.getVersion())

  ipcMain.handle('desktop:open-external', (_event, url: unknown) => {
    if (typeof url !== 'string') {
      return false
    }
    return openExternalSafe(url, deps.allowHttpLocalhost())
  })

  ipcMain.handle('desktop:request-mic-permission', (event) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return false
    }
    return ensureMicrophoneAccess()
  })

  ipcMain.handle('desktop:local-filesystem', (event, request: unknown) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return {
        ok: false,
        code: 'ACCESS_DENIED',
        error: 'Local filesystem access is not allowed from this page.',
      }
    }
    return deps.localFilesystem.handle(request)
  })

  ipcMain.handle('browser-agent:execute-tool', async (event, tool: unknown, params: unknown) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return { ok: false, error: 'Browser automation is not allowed from this page.' }
    }
    if (typeof tool !== 'string' || !isBrowserToolName(tool)) {
      return { ok: false, error: `Unknown browser tool: ${String(tool)}` }
    }
    const toolParams =
      typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    return executeTool(tool, toolParams)
  })

  ipcMain.on('browser-agent:panel-action', (event, action: unknown) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return
    }
    if (
      typeof action !== 'object' ||
      action === null ||
      typeof (action as { action?: unknown }).action !== 'string'
    ) {
      return
    }
    void handlePanelAction(action as Parameters<typeof handlePanelAction>[0]).catch(() => {})
  })

  ipcMain.on('browser-agent:set-panel-bounds', (event, bounds: unknown) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return
    }
    if (bounds === null) {
      setPanelBounds(null)
      return
    }
    if (typeof bounds !== 'object') {
      return
    }
    const rect = bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown }
    if (
      typeof rect.x === 'number' &&
      typeof rect.y === 'number' &&
      typeof rect.width === 'number' &&
      typeof rect.height === 'number' &&
      [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)
    ) {
      setPanelBounds({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })
    }
  })

  ipcMain.on('offline:retry', (event) => {
    if (isLocalPageSender(event)) {
      deps.retryLoad()
    }
  })

  ipcMain.on('settings:open', (event) => {
    if (isLocalPageSender(event)) {
      deps.openSettings()
    }
  })

  ipcMain.on('settings:close', (event) => {
    if (isLocalPageSender(event)) {
      deps.closeSettings()
    }
  })

  ipcMain.handle('settings:get', (event) => {
    if (!isLocalPageSender(event)) {
      return null
    }
    const origin = deps.config.getOrigin()
    return { origin, isDefault: origin === DEFAULT_ORIGIN }
  })

  ipcMain.handle('settings:save', async (event, raw: unknown) => {
    if (!isLocalPageSender(event) || typeof raw !== 'string') {
      return { ok: false, error: 'Not allowed' }
    }
    return deps.applyOrigin(raw)
  })

  ipcMain.handle('settings:launcher-shortcut-get', (event) => {
    if (!isLocalPageSender(event)) {
      return null
    }
    return deps.launcherShortcut.get()
  })

  ipcMain.handle('settings:launcher-shortcut-set', (event, raw: unknown) => {
    if (!isLocalPageSender(event) || typeof raw !== 'string') {
      return null
    }
    return deps.launcherShortcut.set(raw)
  })

  ipcMain.on('launcher:open-chat', (event, raw: unknown) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return
    }
    const target = parseLauncherOpenChatTarget(raw)
    if (target) {
      deps.launcher.openChat(target)
    }
  })

  ipcMain.on('launcher:open-app', (event) => {
    if (isAppOriginSender(event, deps.appOrigin())) {
      deps.launcher.openApp()
    }
  })

  ipcMain.on('launcher:close', (event) => {
    if (isAppOriginSender(event, deps.appOrigin())) {
      deps.launcher.hide()
    }
  })

  ipcMain.on('launcher:resize', (event, height: unknown) => {
    if (!isAppOriginSender(event, deps.appOrigin())) {
      return
    }
    if (typeof height === 'number' && Number.isFinite(height)) {
      deps.launcher.resize(height)
    }
  })
}
