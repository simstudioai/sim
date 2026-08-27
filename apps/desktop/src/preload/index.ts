import type {
  BrowserDataKind,
  BrowserFindRequest,
  BrowserFindResult,
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
  BrowserAddToChatPayload,
  BrowserChromeImportResult,
  BrowserCredentialConflictPolicy,
  BrowserCredentialMetadata,
  BrowserDownloadsState,
  BrowserFillAvailability,
  BrowserImportProfile,
  BrowserImportResult,
  BrowserPasswordImportResult,
  BrowserSiteInfo,
  BrowserToolbarCommand,
  DesktopAppearanceTheme,
  DesktopCommand,
  DesktopNotificationPayload,
  DesktopOAuthConnectResult,
  DesktopOAuthConnectScope,
  DesktopPreferenceKey,
  DesktopPreferences,
  DesktopServerChangeResult,
  DesktopServerConfiguration,
  DesktopUpdateState,
  DesktopWindowState,
  DesktopZoomPercent,
  LocalFilesystemRequest,
  LocalFilesystemResponse,
  SimDesktopApi,
  TerminalShortcutCommand,
  TerminalThemeProfile,
} from '@sim/desktop-bridge'
import {
  type ScopedTerminalCommandEvent,
  type ScopedTerminalTabsState,
  TERMINAL_TOOL_NAME,
  type TerminalOperation,
  type TerminalStartOptions,
  type TerminalToolArgs,
  type TerminalToolResponse,
} from '@sim/terminal-protocol'
import { contextBridge, ipcRenderer } from 'electron'

const VERSION_ARG_PREFIX = '--sim-desktop-version='

interface FillAvailabilitySubscription {
  callback: (state: BrowserFillAvailability) => void
  scopeId: string
}

const fillAvailabilitySubscriptions = new Set<FillAvailabilitySubscription>()
let latestFillAvailability: BrowserFillAvailability | null = null

// Keep the latest scoped value in the always-live preload. Browser resources
// mount after native scope activation, so a component-level listener alone can
// miss the only availability edge that made the key affordance visible.
ipcRenderer.on(
  'browser-credentials:fill-availability',
  (_event: unknown, state: BrowserFillAvailability) => {
    if (!state || typeof state.available !== 'boolean') return
    latestFillAvailability = state
    for (const subscription of fillAvailabilitySubscriptions) {
      if (state.scopeId !== subscription.scopeId) {
        continue
      }
      subscription.callback(state)
    }
  }
)

function subscribeFillAvailability(
  callback: (state: BrowserFillAvailability) => void,
  scopeId: string
): () => void {
  const subscription: FillAvailabilitySubscription = { callback, scopeId }
  fillAvailabilitySubscriptions.add(subscription)
  if (latestFillAvailability && latestFillAvailability.scopeId === scopeId) {
    callback(latestFillAvailability)
  }
  return () => {
    fillAvailabilitySubscriptions.delete(subscription)
  }
}

/**
 * The shell version injected by the main process as a preload argv flag (see
 * createSecureWebPreferences). Read synchronously so the web app's minimum
 * shell version gate has it at first paint.
 */
function shellVersion(): string {
  const arg = process.argv.find((value) => value.startsWith(VERSION_ARG_PREFIX))
  const version = arg?.slice(VERSION_ARG_PREFIX.length)
  return version || '0.0.0'
}

/**
 * The narrow bridge exposed to pages. Every channel is validated and gated in
 * the main process — nothing here grants page code any privilege by itself.
 */
const api: SimDesktopApi = {
  version: shellVersion(),
  openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('desktop:open-external', url),
  ...(process.platform === 'darwin' || process.platform === 'win32'
    ? {
        openMicrophoneSettings: (): Promise<boolean> =>
          ipcRenderer.invoke('desktop:open-microphone-settings'),
      }
    : {}),
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
  server: {
    open: (): void => {
      ipcRenderer.send('server:open')
    },
    getConfiguration: (): Promise<DesktopServerConfiguration> =>
      ipcRenderer.invoke('server:get-configuration'),
    setOrigin: (origin: string): Promise<DesktopServerChangeResult> =>
      ipcRenderer.invoke('server:set-origin', origin),
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
    setBrowserSearchSuggestionsEnabled: (enabled: boolean): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set-browser-search-suggestions', enabled),
    notify: (payload: DesktopNotificationPayload): Promise<boolean> =>
      ipcRenderer.invoke('desktop:settings:notify', payload),
    setBrowserTheme: (theme: DesktopAppearanceTheme): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set-appearance', 'browserTheme', theme),
    setBrowserDefaultZoom: (zoom: DesktopZoomPercent): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set-browser-default-zoom', zoom),
    chooseBrowserDownloadDirectory: (): Promise<DesktopPreferences | null> =>
      ipcRenderer.invoke('desktop:settings:choose-browser-download-directory'),
    setTerminalTheme: (theme: DesktopAppearanceTheme): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set-appearance', 'terminalTheme', theme),
    setTerminalDefaultZoom: (zoom: DesktopZoomPercent): Promise<DesktopPreferences> =>
      ipcRenderer.invoke('desktop:settings:set-terminal-default-zoom', zoom),
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
    supportsAtomicPanelOcclusion: true,
    executeTool: (
      toolCallId: string,
      tool: BrowserToolName,
      params: Record<string, unknown>,
      scopeId: string
    ): Promise<BrowserToolResponse> =>
      ipcRenderer.invoke('browser-agent:execute-tool', toolCallId, tool, params, scopeId),
    cancelTool: (toolCallId: string, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:cancel-tool', toolCallId, scopeId),
    cancelActiveTool: (scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:cancel-active-tool', scopeId),
    panelAction: (action: BrowserPanelAction, scopeId: string): void => {
      ipcRenderer.send('browser-agent:panel-action', action, scopeId)
    },
    openTab: (scopeId: string): Promise<BrowserTabsState> =>
      ipcRenderer.invoke('browser-agent:open-tab', scopeId),
    activateScope: (scopeId: string): Promise<BrowserTabsState> =>
      ipcRenderer.invoke('browser-agent:activate-scope', scopeId),
    restoreScope: (scopeId: string): Promise<BrowserTabsState> =>
      ipcRenderer.invoke('browser-agent:restore-scope', scopeId),
    migrateScope: (fromScopeId: string, toScopeId: string): Promise<BrowserTabsState> =>
      ipcRenderer.invoke('browser-agent:migrate-scope', fromScopeId, toScopeId),
    disposeScope: (scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:dispose-scope', scopeId),
    suspendScope: (scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:suspend-scope', scopeId),
    setTabPinned: (tabId: string, pinned: boolean, scopeId: string): void => {
      ipcRenderer.send('browser-agent:set-tab-pinned', tabId, pinned, scopeId)
    },
    showTabContextMenu: (tabId: string, scopeId: string): void => {
      ipcRenderer.send('browser-agent:show-tab-context-menu', tabId, scopeId)
    },
    reorderTab: (tabId: string, targetIndex: number, scopeId: string): void => {
      ipcRenderer.send('browser-agent:reorder-tab', tabId, targetIndex, scopeId)
    },
    setPanelBounds: (
      bounds: BrowserPanelBounds | null,
      anchor: BrowserPanelAnchor | null,
      scopeId: string
    ): void => {
      ipcRenderer.send('browser-agent:set-panel-bounds', bounds, anchor ?? null, scopeId)
    },
    capturePanelSnapshot: (scopeId: string): Promise<BrowserPanelSnapshot | null> =>
      ipcRenderer.invoke('browser-agent:capture-panel-snapshot', scopeId),
    setPanelOccluded: (occluded: boolean, scopeId: string, force?: boolean): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:set-panel-occluded', occluded, scopeId, force ?? false),
    setPanelFocused: (focused: boolean, scopeId: string): void => {
      ipcRenderer.send('browser-agent:set-panel-focused', focused, scopeId)
    },
    setTheme: (theme: BrowserTheme): void => {
      ipcRenderer.send('browser-agent:set-theme', theme)
    },
    onFocusOmnibox: (
      callback: (mode: BrowserOmniboxFocusMode, scopeId: string) => void
    ): (() => void) => {
      const listener = (_event: unknown, mode: BrowserOmniboxFocusMode, scopeId: string) =>
        callback(mode, scopeId)
      ipcRenderer.on('browser-agent:focus-omnibox', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:focus-omnibox', listener)
      }
    },
    find: (request: BrowserFindRequest, scopeId: string): void => {
      ipcRenderer.send('browser-agent:find', request, scopeId)
    },
    stopFind: (focusPage: boolean, scopeId: string): void => {
      ipcRenderer.send('browser-agent:stop-find', focusPage === true, scopeId)
    },
    onOpenFind: (callback: (scopeId: string) => void): (() => void) => {
      const listener = (_event: unknown, scopeId: string) => callback(scopeId)
      ipcRenderer.on('browser-agent:open-find', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:open-find', listener)
      }
    },
    onCloseFind: (callback: (scopeId: string) => void): (() => void) => {
      const listener = (_event: unknown, scopeId: string) => callback(scopeId)
      ipcRenderer.on('browser-agent:close-find', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:close-find', listener)
      }
    },
    onFindResult: (
      callback: (result: BrowserFindResult, scopeId: string) => void
    ): (() => void) => {
      const listener = (_event: unknown, result: BrowserFindResult, scopeId: string) =>
        callback(result, scopeId)
      ipcRenderer.on('browser-agent:find-result', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:find-result', listener)
      }
    },
    onPageState: (callback: (state: BrowserPageState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserPageState) => callback(state)
      ipcRenderer.on('browser-agent:page-state', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:page-state', listener)
      }
    },
    getTabsState: (scopeId: string): Promise<BrowserTabsState> =>
      ipcRenderer.invoke('browser-agent:get-tabs-state', scopeId),
    getKnownSessions: (): Promise<BrowserKnownSessionsState> =>
      ipcRenderer.invoke('browser-agent:get-known-sessions'),
    getSearchSuggestions: (query: string): Promise<string[]> =>
      ipcRenderer.invoke('browser-agent:search-suggestions', query),
    clearBrowsingData: (kinds?: readonly BrowserDataKind[]): Promise<BrowserKnownSessionsState> =>
      ipcRenderer.invoke('browser-agent:clear-browsing-data', kinds),
    getDownloadsState: (scopeId: string): Promise<BrowserDownloadsState> =>
      ipcRenderer.invoke('browser-agent:get-downloads-state', scopeId),
    showDownloadsMenu: (anchor: { x: number; y: number }, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:show-downloads-menu', anchor, scopeId),
    showToolbarMenu: (anchor: { x: number; y: number }, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:show-toolbar-menu', anchor, scopeId),
    showDownloadInFolder: (downloadId: string, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-agent:show-download-in-folder', downloadId, scopeId),
    onDownloadsState: (callback: (state: BrowserDownloadsState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserDownloadsState) => callback(state)
      ipcRenderer.on('browser-agent:downloads-state', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:downloads-state', listener)
      }
    },
    onToolbarCommand: (
      callback: (command: BrowserToolbarCommand, scopeId: string) => void
    ): (() => void) => {
      const listener = (_event: unknown, command: BrowserToolbarCommand, scopeId: string) =>
        callback(command, scopeId)
      ipcRenderer.on('browser-agent:toolbar-command', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:toolbar-command', listener)
      }
    },
    onAddToChat: (callback: (payload: BrowserAddToChatPayload) => void): (() => void) => {
      const listener = (_event: unknown, payload: BrowserAddToChatPayload) => callback(payload)
      ipcRenderer.on('browser-agent:add-to-chat', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:add-to-chat', listener)
      }
    },
    onAppearanceThemeChanged: (callback: (theme: DesktopAppearanceTheme) => void): (() => void) => {
      const listener = (_event: unknown, theme: DesktopAppearanceTheme) => callback(theme)
      ipcRenderer.on('browser-agent:appearance-theme-changed', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:appearance-theme-changed', listener)
      }
    },
    onTabsState: (callback: (state: BrowserTabsState) => void): (() => void) => {
      const listener = (_event: unknown, state: BrowserTabsState) => callback(state)
      ipcRenderer.on('browser-agent:tabs-state', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:tabs-state', listener)
      }
    },
    onSessionStatus: (callback: (alive: boolean, scopeId: string) => void): (() => void) => {
      const listener = (_event: unknown, alive: boolean, scopeId: string) =>
        callback(alive, scopeId)
      ipcRenderer.on('browser-agent:session-status', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:session-status', listener)
      }
    },
    onScopeSuspended: (callback: (scopeId: string) => void): (() => void) => {
      const listener = (_event: unknown, scopeId: string) => callback(scopeId)
      ipcRenderer.on('browser-agent:scope-suspended', listener)
      return () => {
        ipcRenderer.removeListener('browser-agent:scope-suspended', listener)
      }
    },
  },
  // Omitted entirely off macOS, so the web app's feature detection reflects
  // whether an import can actually run rather than only whether the shell is
  // new enough. Chrome's App-Bound Encryption on Windows is deliberately not
  // worked around.
  ...(process.platform === 'darwin'
    ? {
        terminalThemes: {
          listProfiles: (): Promise<TerminalThemeProfile[]> =>
            ipcRenderer.invoke('terminal-themes:list-profiles'),
          selectProfile: (profileId: string): Promise<DesktopPreferences | null> =>
            ipcRenderer.invoke('terminal-themes:select-profile', profileId),
        },
        browserImport: {
          listChromeProfiles: (): Promise<BrowserImportProfile[]> =>
            ipcRenderer.invoke('browser-import:list-profiles'),
          listSites: (): Promise<BrowserSiteInfo[]> => ipcRenderer.invoke('browser-import:sites'),
          importChromeCookies: (profileId?: string): Promise<BrowserImportResult> =>
            ipcRenderer.invoke('browser-import:cookies', profileId),
          importFromChrome: (
            profileId?: string,
            policy?: BrowserCredentialConflictPolicy
          ): Promise<BrowserChromeImportResult> =>
            ipcRenderer.invoke('browser-import:all', profileId, policy),
        },
      }
    : {}),
  // Note what is absent: there is no fill path that returns a password. The
  // renderer can name only an option from the latest active-page match list;
  // the main process owns the short-lived authorization and the actual fill.
  browserCredentials: {
    isAvailable: (): Promise<boolean> => ipcRenderer.invoke('browser-credentials:available'),
    list: (): Promise<BrowserCredentialMetadata[]> =>
      ipcRenderer.invoke('browser-credentials:list'),
    forget: (id: string): Promise<BrowserCredentialMetadata[]> =>
      ipcRenderer.invoke('browser-credentials:forget', id),
    forgetAll: (): Promise<BrowserCredentialMetadata[]> =>
      ipcRenderer.invoke('browser-credentials:forget-all'),
    reveal: (id: string): Promise<string | null> =>
      ipcRenderer.invoke('browser-credentials:reveal', id),
    copy: (id: string): Promise<boolean> => ipcRenderer.invoke('browser-credentials:copy', id),
    importFromChrome: (
      profileId?: string,
      policy?: BrowserCredentialConflictPolicy
    ): Promise<BrowserPasswordImportResult> =>
      ipcRenderer.invoke('browser-credentials:import', profileId, policy),
    showChooser: (anchor: { x: number; y: number }, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-credentials:show-chooser', anchor, scopeId),
    listFillOptions: (scopeId: string): Promise<BrowserCredentialMetadata[]> =>
      ipcRenderer.invoke('browser-credentials:list-fill-options', scopeId),
    fill: (id: string, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('browser-credentials:fill-selected', id, scopeId),
    onFillAvailability: subscribeFillAvailability,
  },
  terminal: {
    start: async (
      options: TerminalStartOptions,
      scopeId: string
    ): Promise<ScopedTerminalTabsState> => {
      const response = (await ipcRenderer.invoke('terminal:start', options, scopeId)) as
        | { ok: true; tabs: ScopedTerminalTabsState }
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
      args: TerminalToolArgs,
      scopeId: string
    ): Promise<TerminalToolResponse> =>
      ipcRenderer.invoke(
        'terminal:execute-tool',
        toolCallId,
        TERMINAL_TOOL_NAME,
        {
          operation,
          args,
        },
        scopeId
      ),
    write: (terminalId: string, data: string, scopeId: string): void => {
      ipcRenderer.send('terminal:write', terminalId, data, scopeId)
    },
    paste: (terminalId: string, scopeId: string) =>
      ipcRenderer.invoke('terminal:paste', terminalId, scopeId),
    resize: (terminalId: string, cols: number, rows: number, scopeId: string): void => {
      ipcRenderer.send('terminal:resize', terminalId, cols, rows, scopeId)
    },
    openTerminal: (cwd: string | undefined, scopeId: string): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:open', cwd, scopeId),
    switchTerminal: (terminalId: string, scopeId: string): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:switch', terminalId, scopeId),
    reorderTerminal: (
      terminalId: string,
      targetIndex: number,
      scopeId: string
    ): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:reorder', terminalId, targetIndex, scopeId),
    closeTerminal: (terminalId: string, scopeId: string): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:close', terminalId, scopeId),
    getTabs: (scopeId: string): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:get-tabs', scopeId),
    activateScope: (scopeId: string): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:activate-scope', scopeId),
    migrateScope: (fromScopeId: string, toScopeId: string): Promise<ScopedTerminalTabsState> =>
      ipcRenderer.invoke('terminal:migrate-scope', fromScopeId, toScopeId),
    disposeScope: (scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('terminal:dispose-scope', scopeId),
    suspendScope: (scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('terminal:suspend-scope', scopeId),
    onData: (
      callback: (terminalId: string, data: string, scopeId: string) => void
    ): (() => void) => {
      const listener = (_event: unknown, terminalId: string, data: string, scopeId: string) =>
        callback(terminalId, data, scopeId)
      ipcRenderer.on('terminal:data', listener)
      return () => {
        ipcRenderer.removeListener('terminal:data', listener)
      }
    },
    getScrollback: (terminalId: string, scopeId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:scrollback', terminalId, scopeId),
    clearScrollback: (terminalId: string, scopeId: string): Promise<boolean> =>
      ipcRenderer.invoke('terminal:clear-scrollback', terminalId, scopeId),
    setFocused: (focused: boolean, scopeId: string): void => {
      ipcRenderer.send('terminal:focused', focused, scopeId)
    },
    setVisible: (visible: boolean, scopeId: string): void => {
      ipcRenderer.send('terminal:visible', visible, scopeId)
    },
    finishHandoff: (terminalId: string, scopeId: string): void => {
      ipcRenderer.send('terminal:handoff-done', terminalId, scopeId)
    },
    onTabs: (callback: (state: ScopedTerminalTabsState) => void): (() => void) => {
      const listener = (_event: unknown, state: ScopedTerminalTabsState) => callback(state)
      ipcRenderer.on('terminal:tabs', listener)
      return () => {
        ipcRenderer.removeListener('terminal:tabs', listener)
      }
    },
    onCommand: (callback: (event: ScopedTerminalCommandEvent) => void): (() => void) => {
      const listener = (_event: unknown, payload: ScopedTerminalCommandEvent) => callback(payload)
      ipcRenderer.on('terminal:command', listener)
      return () => {
        ipcRenderer.removeListener('terminal:command', listener)
      }
    },
    onShortcutCommand: (
      callback: (command: TerminalShortcutCommand, scopeId: string, terminalId?: string) => void
    ): (() => void) => {
      const listener = (
        _event: unknown,
        command: TerminalShortcutCommand,
        scopeId: string,
        terminalId?: string
      ) => callback(command, scopeId, terminalId)
      ipcRenderer.on('terminal:shortcut-command', listener)
      return () => {
        ipcRenderer.removeListener('terminal:shortcut-command', listener)
      }
    },
    onDefaultZoomChanged: (callback: (zoom: DesktopZoomPercent) => void): (() => void) => {
      const listener = (_event: unknown, zoom: DesktopZoomPercent) => callback(zoom)
      ipcRenderer.on('terminal:default-zoom-changed', listener)
      return () => {
        ipcRenderer.removeListener('terminal:default-zoom-changed', listener)
      }
    },
    onScopeSuspended: (callback: (scopeId: string) => void): (() => void) => {
      const listener = (_event: unknown, scopeId: string) => callback(scopeId)
      ipcRenderer.on('terminal:scope-suspended', listener)
      return () => {
        ipcRenderer.removeListener('terminal:scope-suspended', listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('simDesktop', api)
