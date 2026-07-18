import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'
import { app, ipcMain } from 'electron'
import type { ConfigStore, OriginValidation } from '@/main/config'
import { DEFAULT_ORIGIN } from '@/main/config'
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
