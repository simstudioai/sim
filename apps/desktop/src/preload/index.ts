import type {
  BrowserKnownSessionsState,
  BrowserOmniboxFocusMode,
  BrowserPageState,
  BrowserPanelAction,
  BrowserPanelAnchor,
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
  DesktopUpdateState,
  DesktopWindowState,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
  SimDesktopApi,
} from '@sim/desktop-bridge'
import {
  TERMINAL_TOOL_NAME,
  type TerminalCommandEvent,
  type TerminalOperation,
  type TerminalStartOptions,
  type TerminalTabsState,
  type TerminalToolArgs,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { contextBridge, ipcRenderer } from 'electron'

const VERSION_ARG_PREFIX = '--sim-desktop-version='

/**
 * The shell version injected by the main process as a preload argv flag (see
 * createSecureWebPreferences). Read synchronously so the web app's minimum
 * shell version gate has it at first paint.
 */
function shellVersion(): string | undefined {
  const arg = process.argv.find((value) => value.startsWith(VERSION_ARG_PREFIX))
  const version = arg?.slice(VERSION_ARG_PREFIX.length)
  return version || undefined
}

/**
 * The narrow bridge exposed to pages. Every channel is validated and gated in
 * the main process — nothing here grants page code any privilege by itself.
 */
const api: SimDesktopApi = {
  ...(shellVersion() ? { version: shellVersion() } : {}),
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
    setTrayEnabled: (enabled: boolean): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set', 'trayEnabled', enabled),
    setBrowserEnabled: (enabled: boolean): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set', 'browserEnabled', enabled),
    setTerminalEnabled: (enabled: boolean): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set', 'terminalEnabled', enabled),
  },
  updates: {
    getState: (): Promise<DesktopUpdateState> => ipcRenderer.invoke('desktop:updates:get-state'),
    check: (): void => {
      ipcRenderer.send('desktop:updates:check')
    },
    install: (): void => {
      ipcRenderer.send('desktop:updates:install')
    },
    onState: (callback: (state: DesktopUpdateState) => void): (() => void) => {
      const listener = (_event: unknown, state: DesktopUpdateState) => callback(state)
      ipcRenderer.on('desktop:updates:state', listener)
      return () => {
        ipcRenderer.removeListener('desktop:updates:state', listener)
      }
    },
  },
  browserAgent: {
    executeTool: (
      toolCallId: string,
      tool: BrowserToolName,
      params: Record<string, unknown>
    ): Promise<BrowserToolResponse> =>
      ipcRenderer.invoke('browser-agent:execute-tool', toolCallId, tool, params),
    panelAction: (action: BrowserPanelAction): void => {
      ipcRenderer.send('browser-agent:panel-action', action)
    },
    setTabPinned: (tabId: string, pinned: boolean): void => {
      ipcRenderer.send('browser-agent:set-tab-pinned', tabId, pinned)
    },
    reorderTab: (tabId: string, targetIndex: number): void => {
      ipcRenderer.send('browser-agent:reorder-tab', tabId, targetIndex)
    },
    setPanelBounds: (
      bounds: BrowserPanelBounds | null,
      anchor?: BrowserPanelAnchor | null
    ): void => {
      ipcRenderer.send('browser-agent:set-panel-bounds', bounds, anchor ?? null)
    },
    setPanelFocused: (focused: boolean): void => {
      ipcRenderer.send('browser-agent:set-panel-focused', focused)
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
    getKnownSessions: (): Promise<BrowserKnownSessionsState> =>
      ipcRenderer.invoke('browser-agent:get-known-sessions'),
    clearBrowsingData: (): Promise<BrowserKnownSessionsState> =>
      ipcRenderer.invoke('browser-agent:clear-browsing-data'),
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
  terminal: {
    start: async (options: TerminalStartOptions): Promise<TerminalTabsState> => {
      const response = (await ipcRenderer.invoke('terminal:start', options)) as
        | { ok: true; tabs: TerminalTabsState }
        | { ok: false; code?: string; error?: string }
      if (!response?.ok) {
        const failure = new Error(response?.error ?? 'Could not open a terminal.')
        failure.name = response?.code ?? 'SPAWN_FAILED'
        throw failure
      }
      return response.tabs
    },
    // The tool name rides alongside the call because the main process
    // re-fetches the server's authorized arguments by tool call id and uses
    // those, not these — what the renderer passes is only a request.
    executeTool: (
      toolCallId: string,
      operation: TerminalOperation,
      args: TerminalToolArgs
    ): Promise<TerminalToolResponse> =>
      ipcRenderer.invoke('terminal:execute-tool', toolCallId, TERMINAL_TOOL_NAME, {
        operation,
        args,
      }),
    write: (terminalId: string, data: string): void => {
      ipcRenderer.send('terminal:write', terminalId, data)
    },
    resize: (terminalId: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', terminalId, cols, rows)
    },
    openTerminal: (cwd?: string): Promise<TerminalTabsState> =>
      ipcRenderer.invoke('terminal:open', cwd),
    switchTerminal: (terminalId: string): Promise<TerminalTabsState> =>
      ipcRenderer.invoke('terminal:switch', terminalId),
    closeTerminal: (terminalId: string): Promise<TerminalTabsState> =>
      ipcRenderer.invoke('terminal:close', terminalId),
    getTabs: (): Promise<TerminalTabsState> => ipcRenderer.invoke('terminal:get-tabs'),
    dispose: (): void => {
      ipcRenderer.send('terminal:dispose')
    },
    onData: (callback: (terminalId: string, data: string) => void): (() => void) => {
      const listener = (_event: unknown, terminalId: string, data: string) =>
        callback(terminalId, data)
      ipcRenderer.on('terminal:data', listener)
      return () => {
        ipcRenderer.removeListener('terminal:data', listener)
      }
    },
    getScrollback: (terminalId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:scrollback', terminalId),
    onTabs: (callback: (state: TerminalTabsState) => void): (() => void) => {
      const listener = (_event: unknown, state: TerminalTabsState) => callback(state)
      ipcRenderer.on('terminal:tabs', listener)
      return () => {
        ipcRenderer.removeListener('terminal:tabs', listener)
      }
    },
    onCommand: (callback: (event: TerminalCommandEvent) => void): (() => void) => {
      const listener = (_event: unknown, payload: TerminalCommandEvent) => callback(payload)
      ipcRenderer.on('terminal:command', listener)
      return () => {
        ipcRenderer.removeListener('terminal:command', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('simDesktop', api)
