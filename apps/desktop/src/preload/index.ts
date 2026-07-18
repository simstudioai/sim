import type {
  BrowserPageState,
  BrowserPanelAction,
  BrowserPanelBounds,
  BrowserToolName,
  BrowserToolResponse,
} from '@sim/browser-protocol'
import type {
  DesktopUpdateStatus,
  LauncherShortcutSettings,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
  SimDesktopApi,
} from '@sim/desktop-bridge'
import { contextBridge, ipcRenderer } from 'electron'

/**
 * The narrow bridge exposed to pages. Every channel is validated and gated in
 * the main process — nothing here grants page code any privilege by itself.
 */
const api: SimDesktopApi = {
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('desktop:get-app-version'),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('desktop:open-external', url),
  requestMicrophonePermission: (): Promise<boolean> =>
    ipcRenderer.invoke('desktop:request-mic-permission'),
  onUpdateStatus: (callback: (status: DesktopUpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: DesktopUpdateStatus) => callback(status)
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
  settingsGetLauncherShortcut: (): Promise<LauncherShortcutSettings | null> =>
    ipcRenderer.invoke('settings:launcher-shortcut-get'),
  settingsSaveLauncherShortcut: (shortcut: string): Promise<LauncherShortcutSettings | null> =>
    ipcRenderer.invoke('settings:launcher-shortcut-set', shortcut),
  localFilesystem: (request: LocalFilesystemRequest): Promise<LocalFilesystemResponse> =>
    ipcRenderer.invoke('desktop:local-filesystem', request),
  launcher: {
    openChat: (target: { workspaceId: string; chatId?: string }): void => {
      ipcRenderer.send('launcher:open-chat', target)
    },
    openApp: (): void => {
      ipcRenderer.send('launcher:open-app')
    },
    close: (): void => {
      ipcRenderer.send('launcher:close')
    },
    resize: (height: number): void => {
      ipcRenderer.send('launcher:resize', height)
    },
    onShown: (callback: () => void): (() => void) => {
      const listener = () => callback()
      ipcRenderer.on('launcher:shown', listener)
      return () => {
        ipcRenderer.removeListener('launcher:shown', listener)
      }
    },
  },
  browserAgent: {
    executeTool: (
      tool: BrowserToolName,
      params: Record<string, unknown>
    ): Promise<BrowserToolResponse> =>
      ipcRenderer.invoke('browser-agent:execute-tool', tool, params),
    panelAction: (action: BrowserPanelAction): void => {
      ipcRenderer.send('browser-agent:panel-action', action)
    },
    setPanelBounds: (bounds: BrowserPanelBounds | null): void => {
      ipcRenderer.send('browser-agent:set-panel-bounds', bounds)
    },
    onPageState: (callback: (state: BrowserPageState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserPageState) => callback(state)
      ipcRenderer.on('browser-agent:page-state', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:page-state', listener)
      }
    },
    onSessionStatus: (callback: (alive: boolean) => void): (() => void) => {
      const listener = (_event: unknown, alive: boolean) => callback(alive)
      ipcRenderer.on('browser-agent:session-status', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:session-status', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('simDesktop', api)
