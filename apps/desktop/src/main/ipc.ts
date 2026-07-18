import { isBrowserToolName } from '@sim/browser-protocol'
import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, ipcMain } from 'electron'
import { executeTool, handlePanelAction, setPanelBounds } from '@/main/browser-agent/driver'
import type { ConfigStore, OriginValidation } from '@/main/config'
import { DEFAULT_ORIGIN } from '@/main/config'
import type { LocalFilesystemService } from '@/main/local-filesystem'
import { openExternalSafe } from '@/main/navigation'
import { ensureMicrophoneAccess } from '@/main/window'

export interface IpcDeps {
  config: ConfigStore
  appOrigin: () => string
  allowHttpLocalhost: () => boolean
  retryLoad: () => void
  openSettings: () => void
  closeSettings: () => void
  applyOrigin: (raw: string) => Promise<OriginValidation>
  localFilesystem: LocalFilesystemService
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
}
