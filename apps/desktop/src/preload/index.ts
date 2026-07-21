import type {
  BrowserOmniboxFocusMode,
  BrowserPageState,
  BrowserPanelAction,
  BrowserPanelBounds,
  BrowserPanelSnapshot,
  BrowserTabsState,
  BrowserTheme,
  BrowserToolName,
  BrowserToolResponse,
} from '@sim/browser-protocol'
import type {
  DesktopCommand,
  DesktopNotificationPayload,
  DesktopOAuthConnectResult,
  DesktopOAuthConnectScope,
  DesktopPreferenceKey,
  DesktopPreferences,
  DesktopWindowState,
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
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('desktop:open-external', url),
  beginOAuthConnect: (providerId: string, scope?: DesktopOAuthConnectScope): Promise<boolean> =>
    ipcRenderer.invoke('desktop:oauth-connect', providerId, scope),
  onOAuthConnectComplete: (callback: (result: DesktopOAuthConnectResult) => void): (() => void) => {
    const listener = (_event: unknown, result: DesktopOAuthConnectResult) => callback(result)
    ipcRenderer.on('desktop:oauth-connect-complete', listener)
    return () => {
      ipcRenderer.removeListener('desktop:oauth-connect-complete', listener)
    }
  },
  offlineRetry: (): void => {
    ipcRenderer.send('offline:retry')
  },
  localFilesystem: (request: LocalFilesystemRequest): Promise<LocalFilesystemResponse> =>
    ipcRenderer.invoke('desktop:local-filesystem', request),
  onCommand: (callback: (command: DesktopCommand) => void): (() => void) => {
    const listener = (_event: unknown, command: DesktopCommand) => callback(command)
    ipcRenderer.on('desktop:command', listener)
    return () => {
      ipcRenderer.removeListener('desktop:command', listener)
    }
  },
  windowState: {
    getState: (): Promise<DesktopWindowState> => ipcRenderer.invoke('desktop:window-state:get'),
    onStateChange: (callback: (state: DesktopWindowState) => void): (() => void) => {
      const listener = (_event: unknown, state: DesktopWindowState) => callback(state)
      ipcRenderer.on('desktop:window-state:changed', listener)
      return () => {
        ipcRenderer.removeListener('desktop:window-state:changed', listener)
      }
    },
  },
  settings: {
    getPreferences: (): Promise<DesktopPreferences> => ipcRenderer.invoke('desktop:settings:get'),
    setPreference: (key: DesktopPreferenceKey, value: boolean): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set', key, value),
    notify: (payload: DesktopNotificationPayload): Promise<boolean> =>
      ipcRenderer.invoke('desktop:settings:notify', payload),
  },
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
    setPanelOccluded: (occluded: boolean): void => {
      ipcRenderer.send('browser-agent:set-panel-occluded', occluded)
    },
    setTheme: (theme: BrowserTheme): void => {
      ipcRenderer.send('browser-agent:set-theme', theme)
    },
    onFocusOmnibox: (callback: (mode: BrowserOmniboxFocusMode) => void): (() => void) => {
      const listener = (_event: unknown, mode: BrowserOmniboxFocusMode) => callback(mode)
      ipcRenderer.on('browser-agent:focus-omnibox', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:focus-omnibox', listener)
      }
    },
    onPanelSnapshot: (callback: (snapshot: BrowserPanelSnapshot) => void): (() => void) => {
      const listener = (_event: unknown, snapshot: BrowserPanelSnapshot) => callback(snapshot)
      ipcRenderer.on('browser-agent:panel-snapshot', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:panel-snapshot', listener)
      }
    },
    onPageState: (callback: (state: BrowserPageState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserPageState) => callback(state)
      ipcRenderer.on('browser-agent:page-state', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:page-state', listener)
      }
    },
    getTabsState: (): Promise<BrowserTabsState> =>
      ipcRenderer.invoke('browser-agent:get-tabs-state'),
    onTabsState: (callback: (state: BrowserTabsState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserTabsState) => callback(state)
      ipcRenderer.on('browser-agent:tabs-state', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:tabs-state', listener)
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
