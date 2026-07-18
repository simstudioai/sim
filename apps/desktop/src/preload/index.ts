import { contextBridge, ipcRenderer } from 'electron'

export interface UpdateStatus {
  state: string
  version?: string
}

/**
 * The minimal bridge exposed to pages. The remote web app reads no Electron
 * global today; this surface exists for the bundled offline/settings pages
 * and future opt-in web integration. Every channel is validated and gated in
 * the main process — nothing here grants page code any privilege by itself.
 */
const api = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('desktop:get-app-version'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('desktop:open-external', url),
  requestMicrophonePermission: (): Promise<boolean> =>
    ipcRenderer.invoke('desktop:request-mic-permission'),
  onUpdateStatus: (callback: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: UpdateStatus) => callback(status)
    ipcRenderer.on('desktop:update-status', listener)
    return () => {
      ipcRenderer.removeListener('desktop:update-status', listener)
    }
  },
  offlineRetry: (): void => {
    ipcRenderer.send('offline:retry')
  },
  openSettings: (): void => {
    ipcRenderer.send('settings:open')
  },
  settingsClose: (): void => {
    ipcRenderer.send('settings:close')
  },
  settingsGet: (): Promise<{ origin: string; isDefault: boolean } | null> =>
    ipcRenderer.invoke('settings:get'),
  settingsSave: (origin: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:save', origin),
}

export type SimDesktopApi = typeof api

contextBridge.exposeInMainWorld('simDesktop', api)
