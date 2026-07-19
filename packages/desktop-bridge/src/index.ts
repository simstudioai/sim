import type {
  BrowserPageState,
  BrowserPanelAction,
  BrowserPanelBounds,
  BrowserToolName,
  BrowserToolResponse,
} from '@sim/browser-protocol'

export interface DesktopUpdateStatus {
  state: string
  version?: string
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
  executeTool(tool: BrowserToolName, params: Record<string, unknown>): Promise<BrowserToolResponse>
  /** Browser-chrome commands from the panel (URL bar, back, reload, takeover Done). */
  panelAction(action: BrowserPanelAction): void
  /**
   * Report where the browser panel sits in the window (CSS pixels relative
   * to the viewport), or null when the panel is hidden/unmounted. The main
   * process keeps the embedded view glued to this rect.
   */
  setPanelBounds(bounds: BrowserPanelBounds | null): void
  /** Subscribe to live page state for the panel header. Returns an unsubscribe function. */
  onPageState(callback: (state: BrowserPageState) => void): () => void
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
  column: number
  text: string
}

export type LocalFilesystemRequest =
  | { operation: 'mount_directory' }
  | { operation: 'list_mounts' }
  | { operation: 'forget_mount'; uri: string }
  | { operation: 'list'; uri: string }
  | { operation: 'glob'; uri: string; pattern: string }
  | {
      operation: 'read'
      uri: string
      startLine?: number
      lineCount?: number
    }
  | {
      operation: 'grep'
      uri: string
      query: string
      include?: string
      caseSensitive?: boolean
    }
  | { operation: 'stat'; uri: string }
  | { operation: 'read_file_bytes'; uri: string }

export type LocalFilesystemData =
  | { mount: LocalFilesystemMount | null; cancelled: boolean }
  | { mounts: LocalFilesystemMount[] }
  | { forgotten: boolean }
  | { entries: LocalFilesystemEntry[]; truncated: boolean }
  | { matches: LocalFilesystemGrepMatch[]; truncated: boolean }
  | LocalFilesystemReadResult
  | LocalFilesystemStat
  | { uri: string; name: string; size: number; bytes: Uint8Array }

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
        | 'IO_ERROR'
      error: string
    }

/** Registration outcome of the Quick Ask global shortcut. */
export type LauncherShortcutStatus = 'registered' | 'failed' | 'disabled'

export interface LauncherShortcutSettings {
  shortcut: string
  presets: string[]
  status: LauncherShortcutStatus
}

/**
 * The Quick Ask launcher surface of the preload bridge, used by the
 * `/desktop/launcher` page loaded inside the floating panel window.
 */
export interface SimDesktopLauncherApi {
  /**
   * Dismiss the panel and open the main window on the given chat (or the
   * workspace's home surface when `chatId` is omitted).
   */
  openChat(target: { workspaceId: string; chatId?: string }): void
  /** Dismiss the panel and bring up the main window (sign-in, generic open). */
  openApp(): void
  /** Dismiss the panel (Esc). */
  close(): void
  /** Grow/shrink the panel to fit content; the main process clamps. */
  resize(height: number): void
  /** Fires each time the panel is summoned. Returns an unsubscribe function. */
  onShown(callback: () => void): () => void
}

export interface SimDesktopApi {
  getAppVersion(): Promise<string>
  openExternal(url: string): Promise<boolean>
  requestMicrophonePermission(): Promise<boolean>
  onUpdateStatus(callback: (status: DesktopUpdateStatus) => void): () => void
  offlineRetry(): void
  openSettings(): void
  settingsClose(): void
  settingsGet(): Promise<{ origin: string; isDefault: boolean } | null>
  settingsSave(origin: string): Promise<{ ok: boolean; error?: string }>
  settingsGetLauncherShortcut(): Promise<LauncherShortcutSettings | null>
  settingsSaveLauncherShortcut(shortcut: string): Promise<LauncherShortcutSettings | null>
  localFilesystem(request: LocalFilesystemRequest): Promise<LocalFilesystemResponse>
  browserAgent?: SimDesktopBrowserAgentApi
  launcher?: SimDesktopLauncherApi
}
