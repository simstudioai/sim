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
  TerminalCommandEvent,
  TerminalStartOptions,
  TerminalTabsState,
  TerminalToolName,
  TerminalToolResponse,
} from '@sim/terminal-protocol'

/**
 * The agent-terminal surface of the preload bridge. Real PTYs run in the
 * Electron main process; the renderer paints their bytes with xterm.js and
 * forwards keystrokes back. Several terminals can be open at once, each its own
 * shell, and the user and the agent share them — so working directory and
 * environment stay consistent between the two.
 */
export interface SimDesktopTerminalApi {
  /** Open the first terminal, or adopt the ones already running. */
  start(options: TerminalStartOptions): Promise<TerminalTabsState>
  /**
   * Execute one terminal tool. Resolves with the tool's outcome; never
   * rejects for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    tool: TerminalToolName,
    params: Record<string, unknown>
  ): Promise<TerminalToolResponse>
  /** Forward the user's keystrokes to one terminal's PTY. */
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  /** Open an additional terminal and make it active. */
  openTerminal(cwd?: string): Promise<TerminalTabsState>
  switchTerminal(terminalId: string): Promise<TerminalTabsState>
  closeTerminal(terminalId: string): Promise<TerminalTabsState>
  getTabs(): Promise<TerminalTabsState>
  /** End every shell. A new one starts on the next `start`. */
  dispose(): void
  /** Subscribe to PTY output batches. Returns an unsubscribe function. */
  onData(callback: (terminalId: string, data: string) => void): () => void
  /**
   * Subscribe to full-scrollback repaints, sent when the panel attaches to a
   * shell that was already running. Reset the terminal before writing it.
   * Optional for compatibility with shells predating scrollback replay; without
   * it the panel simply starts empty over a live shell.
   */
  onReplay?(callback: (terminalId: string, data: string) => void): () => void
  /** Subscribe to the open-terminal list and which one is active. */
  onTabs(callback: (state: TerminalTabsState) => void): () => void
  /** Subscribe to command start/end, used for agent attribution in the panel. */
  onCommand(callback: (event: TerminalCommandEvent) => void): () => void
}

/**
 * The browser-agent surface of the preload bridge. Tools execute in the
 * Electron main process against the desktop app's built-in agent browser — a
 * persistent-profile browser view embedded in the main Sim window, positioned
 * over the chat's browser panel so the user interacts with the real page.
 */
export interface SimDesktopBrowserAgentApi {
  /**
   * Execute one browser tool. Resolves with the tool's outcome; never
   * rejects for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    tool: BrowserToolName,
    params: Record<string, unknown>
  ): Promise<BrowserToolResponse>
  /** Browser-chrome commands from the panel (URL bar, back, reload, takeover Done). */
  panelAction(action: BrowserPanelAction): void
  /**
   * Pin or unpin a live browser tab. Optional for compatibility with desktop
   * builds predating durable pinned tabs.
   */
  setTabPinned?(tabId: string, pinned: boolean): void
  /**
   * Move a live tab to a final list index. Optional for compatibility with
   * desktop builds predating tab reordering.
   */
  reorderTab?(tabId: string, targetIndex: number): void
  /**
   * Report where the browser panel sits in the window (CSS pixels relative
   * to the viewport), or null when the panel is hidden/unmounted. The main
   * process keeps the embedded view glued to this rect.
   *
   * `anchor` declares how that rect derives from the viewport so the shell can
   * re-evaluate it mid-resize rather than hold a stale rect; omit it and the
   * shell falls back to the measured rect alone. Shells predating it ignore the
   * argument.
   */
  setPanelBounds(bounds: BrowserPanelBounds | null, anchor?: BrowserPanelAnchor | null): void
  /**
   * Report whether renderer-owned browser chrome currently owns the user's
   * interaction context. Optional for compatibility with older desktop builds.
   */
  setPanelFocused?(focused: boolean): void
  /**
   * Hide or reveal the native browser surface without detaching it. Optional
   * so newer web deployments remain compatible with older desktop builds.
   */
  setPanelOccluded?(occluded: boolean): void
  /**
   * Mirror Sim's light/dark/system preference into the embedded pages.
   * Optional for compatibility with desktop builds predating theme sync.
   */
  setTheme?(theme: BrowserTheme): void
  /**
   * Focus requests emitted by native tabs for browser-level keyboard
   * shortcuts such as Mod+L and Mod+T.
   */
  onFocusOmnibox?(callback: (mode: BrowserOmniboxFocusMode) => void): () => void
  /**
   * Subscribe to captured browser frames used beneath renderer overlays.
   * Optional for compatibility with desktop builds predating occlusion.
   */
  onPanelSnapshot?(callback: (snapshot: BrowserPanelSnapshot) => void): () => void
  /** Subscribe to live page state for the panel header. Returns an unsubscribe function. */
  onPageState(callback: (state: BrowserPageState) => void): () => void
  /**
   * Read the current live tab list. Optional so a newer web deployment remains
   * compatible with installed desktop versions that only support one visible tab.
   */
  getTabsState?(): Promise<BrowserTabsState>
  /**
   * Read a privacy-preserving hint of websites that may have a usable session
   * in the dedicated profile. Optional for compatibility with older shells.
   */
  getKnownSessions?(): Promise<BrowserKnownSessionsState>
  /**
   * Wipe the dedicated profile — cookies, storage, cache, and the remembered
   * browsing trail — and resolve the resulting (empty) session list. Optional
   * for compatibility with older shells.
   */
  clearBrowsingData?(): Promise<BrowserKnownSessionsState>
  /**
   * Subscribe to live tab-list changes. Optional for compatibility with older
   * installed desktop versions.
   */
  onTabsState?(callback: (state: BrowserTabsState) => void): () => void
  /**
   * Subscribe to session liveness changes (false when the browser session
   * ends). Returns an unsubscribe function.
   */
  onSessionStatus(callback: (alive: boolean) => void): () => void
}

export interface LocalFilesystemMount {
  id: string
  name: string
  uri: string
  /** True when the encrypted grant will be restored after restarting the desktop app. */
  remembered: boolean
}

export type LocalFilesystemEntryKind = 'file' | 'directory' | 'symlink' | 'other'

export interface LocalFilesystemEntry {
  name: string
  uri: string
  kind: LocalFilesystemEntryKind
  size?: number
  modifiedAt?: string
}

export interface LocalFilesystemStat {
  name: string
  uri: string
  kind: LocalFilesystemEntryKind
  size: number
  modifiedAt: string
}

export interface LocalFilesystemReadResult {
  uri: string
  content: string
  startLine: number
  endLine: number
  totalLines: number
}

export interface LocalFilesystemGrepMatch {
  uri: string
  line: number
  text: string
}

export type LocalFilesystemRequest =
  | { operation: 'mount_directory' }
  | { operation: 'list_mounts' }
  | { operation: 'forget_mount'; uri: string }
  | { operation: 'reveal_mount'; uri: string }
  | { operation: 'list'; uri: string; requestId?: string }
  | {
      operation: 'glob'
      uri: string
      pattern: string
      pathPrefix?: string
      requestId?: string
    }
  | {
      operation: 'read'
      uri: string
      startLine?: number
      lineCount?: number
      requestId?: string
    }
  | {
      operation: 'grep'
      uri: string
      query?: string
      pattern?: string
      include?: string
      caseSensitive?: boolean
      maxResults?: number
      outputMode?: 'content' | 'files_with_matches' | 'count'
      lineNumbers?: boolean
      context?: number
      requestId?: string
    }
  | { operation: 'stat'; uri: string; requestId?: string }
  | { operation: 'cancel'; requestId: string }

export type LocalFilesystemData =
  | { mount: LocalFilesystemMount | null; cancelled: boolean }
  | { mounts: LocalFilesystemMount[] }
  | { forgotten: boolean }
  | { revealed: boolean }
  | { entries: LocalFilesystemEntry[]; truncated: boolean }
  | { matches: LocalFilesystemGrepMatch[]; truncated: boolean }
  | { files: string[]; truncated: boolean }
  | { counts: Array<{ uri: string; count: number }>; truncated: boolean }
  | { cancelled: boolean }
  | LocalFilesystemReadResult
  | LocalFilesystemStat

export type LocalFilesystemResponse =
  | { ok: true; data: LocalFilesystemData }
  | {
      ok: false
      code:
        | 'INVALID_REQUEST'
        | 'INVALID_URI'
        | 'MOUNT_NOT_FOUND'
        | 'NOT_FOUND'
        | 'NOT_A_FILE'
        | 'NOT_A_DIRECTORY'
        | 'FILE_TOO_LARGE'
        | 'BINARY_FILE'
        | 'ACCESS_DENIED'
        | 'CANCELLED'
        | 'IO_ERROR'
      error: string
    }

/** Outcome of an OAuth connect handoff, pushed when the browser flow finishes. */
export interface DesktopOAuthConnectResult {
  ok: boolean
  /** OAuth error slug forwarded from the provider callback, when the flow failed. */
  error?: string
}

/**
 * Optional scope for an OAuth connect handoff. Chip-initiated connects carry
 * the workspace (the browser flow creates the workspace connect draft
 * server-side) and, for reconnects, the credential to rebind. Modal-initiated
 * connects omit both — the app already created the draft.
 */
export interface DesktopOAuthConnectScope {
  workspaceId?: string
  credentialId?: string
}

export interface DesktopPreferences {
  notificationsEnabled: boolean
  notificationSounds: boolean
  notificationsOnlyWhenUnfocused: boolean
  launchAtLogin: boolean
  autoDownloadUpdates: boolean
  /**
   * Show the Sim status item (recent chats menu) in the macOS menu bar.
   * Optional because shells predating the preference don't report it.
   */
  trayEnabled?: boolean
  /**
   * Let Chat drive the built-in agent browser on this device. Optional
   * because shells predating the preference don't report it; absent means the
   * surface is simply always on, which is how those shells behave.
   */
  browserEnabled?: boolean
  /** Let Chat run commands in local shells. Same compatibility caveat. */
  terminalEnabled?: boolean
}

/**
 * The keys settable through {@link SimDesktopSettingsApi.setPreference}. A
 * closed union frozen at the first shell release: widening it would demand a
 * capability installed shells lack (their setPreference is typed over fewer
 * keys), which the bridge contract audit rejects. Preferences added later get
 * their own optional setter (e.g. {@link SimDesktopSettingsApi.setTrayEnabled})
 * so the web app can feature-detect them — and must be excluded here, or they
 * widen this union right back.
 */
export type DesktopPreferenceKey = Exclude<
  keyof DesktopPreferences,
  'trayEnabled' | 'browserEnabled' | 'terminalEnabled'
>

export interface DesktopNotificationPayload {
  title: string
  body: string
  /** Optional in-app route opened when the notification is clicked. */
  route?: string
}

/**
 * Device-level settings owned by the desktop shell. This surface is optional
 * so a newer web deployment remains compatible with older installed shells.
 */
export interface SimDesktopSettingsApi {
  getPreferences(): Promise<DesktopPreferences>
  setPreference<K extends DesktopPreferenceKey>(
    key: K,
    value: DesktopPreferences[K]
  ): Promise<DesktopPreferences>
  notify(payload: DesktopNotificationPayload): Promise<boolean>
  /**
   * Shows or hides the Sim menu-bar status item. Optional: only shells that
   * support the tray preference expose it — feature-detect before rendering
   * a toggle.
   */
  setTrayEnabled?(enabled: boolean): Promise<DesktopPreferences>
  /**
   * Turns the agent browser on or off for this device; disabling it also ends
   * the running session. Optional — feature-detect before rendering a toggle.
   */
  setBrowserEnabled?(enabled: boolean): Promise<DesktopPreferences>
  /**
   * Turns the agent terminal on or off for this device; disabling it also
   * ends every open shell. Optional, like {@link setBrowserEnabled}.
   */
  setTerminalEnabled?(enabled: boolean): Promise<DesktopPreferences>
}

/**
 * Where the shell's update pipeline currently is. `available` only occurs
 * when automatic downloads are disabled; with them enabled the shell moves
 * straight to `downloading`.
 */
export type DesktopUpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface DesktopUpdateState {
  status: DesktopUpdateStatus
  /** Version of the update being offered/downloaded/ready, when known. */
  version?: string
  /** Whole-number download progress (0-100) while `downloading`. */
  percent?: number
  /**
   * True when this shell cannot apply updates in place (a build without a
   * Developer ID signature — local installs and pre-signing CI prereleases;
   * Squirrel.Mac refuses to swap unsigned bundles). `available` is then the
   * pipeline's terminal state and the advance action opens the download in
   * the browser instead of downloading in the background.
   */
  manual?: boolean
}

/**
 * The shell updater surface. Optional so a newer web deployment remains
 * compatible with older installed shells.
 */
export interface SimDesktopUpdatesApi {
  getState(): Promise<DesktopUpdateState>
  /**
   * Advance the pipeline: checks for an update, or starts the download when
   * one is already known to be available (auto-download off).
   */
  check(): void
  /** Quit and install a `ready` update. No-op in any other state. */
  install(): void
  /** Subscribe to pipeline state changes. Returns an unsubscribe function. */
  onState(callback: (state: DesktopUpdateState) => void): () => void
}

export type DesktopCommand = 'toggle-sidebar'

export interface DesktopWindowState {
  isFullScreen: boolean
}

export interface SimDesktopWindowStateApi {
  getState(): Promise<DesktopWindowState>
  onStateChange(callback: (state: DesktopWindowState) => void): () => void
}

export interface SimDesktopApi {
  /**
   * Installed shell version (plain semver, e.g. `0.3.1`). Optional because
   * shells predating version reporting don't set it — the web app's minimum
   * shell version gate treats an absent version as older than any floor.
   */
  version?: string
  openExternal(url: string): Promise<boolean>
  /**
   * Start the OAuth connect handoff for a provider: the whole flow runs in
   * the system browser and returns via loopback. Resolves false when the
   * browser could not be opened.
   */
  beginOAuthConnect(providerId: string, scope?: DesktopOAuthConnectScope): Promise<boolean>
  /**
   * Subscribe to connect-handoff completions (the app is refocused just
   * before this fires). Returns an unsubscribe function.
   */
  onOAuthConnectComplete(callback: (result: DesktopOAuthConnectResult) => void): () => void
  offlineRetry(): void
  localFilesystem(request: LocalFilesystemRequest): Promise<LocalFilesystemResponse>
  /** Subscribe to commands initiated by the native application menu. */
  onCommand?(callback: (command: DesktopCommand) => void): () => void
  windowState?: SimDesktopWindowStateApi
  settings?: SimDesktopSettingsApi
  updates?: SimDesktopUpdatesApi
  browserAgent?: SimDesktopBrowserAgentApi
  /**
   * Optional so a newer web deployment stays compatible with installed shells
   * that predate the agent terminal.
   */
  terminal?: SimDesktopTerminalApi
}
