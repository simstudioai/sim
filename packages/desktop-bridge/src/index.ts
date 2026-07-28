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
  TerminalCommandEvent,
  TerminalOperation,
  TerminalStartOptions,
  TerminalTabsState,
  TerminalToolArgs,
  TerminalToolResponse,
} from '@sim/terminal-protocol'

/**
 * The agent-terminal surface of the preload bridge. Real PTYs run in the
 * Electron main process; the renderer paints their bytes with xterm.js and
 * forwards keystrokes back. Several terminals can be open at once, each its own
 * shell, and the user and the agent share them — so working directory and
 * environment stay consistent between the two.
 *
 * Members added after this surface first shipped are `optional?`, matching the
 * browser-agent surface beside it and the "feature-detect, never assume" rule
 * in apps/desktop/README.md: one web app is served to shells of every age, and
 * `MIN_DESKTOP_VERSION` is still `0.0.0` (no floor), so an older shell reaches
 * this code. Declaring such a member required makes the type disagree with the
 * renderer, which has to `?.` it anyway — and the contract audit cannot catch
 * that, because it compares against a snapshot the same PR regenerates.
 */
export interface SimDesktopTerminalApi {
  /** Open the first terminal, or adopt the ones already running. */
  start(options: TerminalStartOptions): Promise<TerminalTabsState>
  /**
   * Execute one terminal operation. Resolves with the outcome; never rejects
   * for tool-level failures (those ride `ok: false`).
   */
  executeTool(
    toolCallId: string,
    operation: TerminalOperation,
    args: TerminalToolArgs
  ): Promise<TerminalToolResponse>
  /** Forward the user's keystrokes to one terminal's PTY. */
  write(terminalId: string, data: string): void
  resize(terminalId: string, cols: number, rows: number): void
  /** Open an additional terminal and make it active. */
  openTerminal(cwd?: string): Promise<TerminalTabsState>
  switchTerminal(terminalId: string): Promise<TerminalTabsState>
  closeTerminal(terminalId: string): Promise<TerminalTabsState>
  getTabs?(): Promise<TerminalTabsState>
  /** End every shell. A new one starts on the next `start`. */
  dispose(): void
  /** Subscribe to PTY output batches. Returns an unsubscribe function. */
  onData?(callback: (terminalId: string, data: string) => void): () => void
  /**
   * Everything already on a terminal's screen, for a new view to paint itself
   * from. Pulled per view so the repaint cannot be aimed at the wrong set of
   * subscribers, or at none at all.
   */
  getScrollback(terminalId: string): Promise<string>
  /**
   * Reports whether the terminal panel owns keyboard focus, so global menu
   * accelerators can tell a Cmd-W meant for a terminal from one meant for the
   * window.
   */
  setFocused?(focused: boolean): void
  /**
   * The user finishing a handoff — the hand-back chip on the waiting tool row.
   */
  finishHandoff?(terminalId: string): void
  /** Subscribe to the open-terminal list and which one is active. */
  onTabs?(callback: (state: TerminalTabsState) => void): () => void
  /** Subscribe to command start/end, used for agent attribution in the panel. */
  onCommand?(callback: (event: TerminalCommandEvent) => void): () => void
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
   * Run Chromium's find-in-page against the active tab. Results do not come
   * back from this call — they stream through {@link onFindResult}. Optional
   * for compatibility with desktop builds predating find-in-page.
   */
  find?(request: BrowserFindRequest): void
  /**
   * Stop the running find and clear its highlights. `focusPage` hands keyboard
   * focus back to the page, for the user dismissing the bar; omit it when the
   * bar is going away because the panel is.
   */
  stopFind?(focusPage?: boolean): void
  /**
   * Mod+F pressed while the embedded page had focus, which the renderer never
   * sees as a key event. Opening the find bar is the renderer's job either
   * way, so both entry paths land on the same handler.
   */
  onOpenFind?(callback: () => void): () => void
  /**
   * The shell dismissing the find bar — the active tab navigated away from the
   * document the find was run against, or the user switched tabs.
   */
  onCloseFind?(callback: () => void): () => void
  /** Match counts for the running find, as Chromium resolves them. */
  onFindResult?(callback: (result: BrowserFindResult) => void): () => void
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
   * Erase browsing data from the dedicated profile and resolve the resulting
   * session list. Pass the kinds to clear; omit for all of them. Saved
   * passwords are never included — deleting those is a separate action.
   * Optional for compatibility with older shells, which ignore the argument
   * and clear everything.
   */
  clearBrowsingData?(kinds?: readonly BrowserDataKind[]): Promise<BrowserKnownSessionsState>
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

/**
 * One browser profile found on this device.
 *
 * `id` is an opaque handle used to name the same profile back to the shell;
 * the shell resolves it against the profiles it discovered rather than
 * building a path from it. Host paths never cross this bridge.
 *
 * `browserId` and `browserLabel` are optional because shells that only
 * supported Chrome did not report them — treat their absence as Chrome.
 */
export interface BrowserImportProfile {
  id: string
  /** Browser and profile together, e.g. `Arc · Microtrades`. */
  label: string
  /** Stable browser identifier, e.g. `chrome`, `arc`, `brave`. */
  browserId?: string
  /** The browser's product name, e.g. `Arc`. */
  browserLabel?: string
  /** The profile on its own, e.g. `Microtrades` or `Default`. */
  profileLabel?: string
}

/**
 * Why an import could not run, as a coarse category. Deliberately free of
 * specifics: no host paths, profile paths, domains, or underlying OS errors.
 */
export type BrowserImportError =
  | 'unsupported-platform'
  | 'chrome-not-found'
  | 'keychain-unavailable'
  | 'profile-unreadable'
  | 'unsupported-schema'
  | 'nothing-imported'
  | 'vault-unavailable'
  | 'unknown'

/**
 * Outcome of a Chrome import: counts and a coarse error category only. Cookie
 * names, values, domains, and full URLs never cross the bridge — they never
 * leave the Electron main process at all.
 */
export interface BrowserImportResult {
  cookiesImported: number
  cookiesSkipped: number
  /** Present only when the import could not complete. */
  error?: BrowserImportError
}

/**
 * Local, user-initiated import of Chrome data into the built-in browser's
 * dedicated profile. macOS-only today, and optional in two senses: older
 * shells lack the surface entirely, and shells on platforms without a
 * supported importer omit it too — so always feature-detect before rendering.
 *
 * The agent cannot reach this. Both methods are gated in the main process to
 * the Sim app origin, `importChromeCookies` additionally requires a live user
 * gesture, and no browser tool maps to either channel. Reading Chrome is
 * strictly read-only, and decrypted material stays in the main process.
 */
/** A site a previous import brought over, keyed by the hostname visited there. */
export interface BrowserSiteInfo {
  hostname: string
  /** Learned from the source browser's own page titles, not a built-in list. */
  name?: string
  /** The source browser's favicon, as a `data:` URL. */
  icon?: string
  /**
   * How much the site was used in the browser it came from — an aggregate for
   * ordering suggestions, never a visit time, a URL, or a sequence. Absent on
   * a record written before imports started counting.
   */
  visits?: number
  /** When Sim imported it; never the source browser's own last-visit time. */
  importedAt?: string
}

export interface SimDesktopBrowserImportApi {
  /** Chrome profiles detected on this device; empty when none are readable. */
  listChromeProfiles(): Promise<BrowserImportProfile[]>
  /**
   * The sites previous imports brought over, so the omnibox has somewhere to
   * start on a browser that keeps no history of its own — and can offer
   * "Gmail" instead of `mail.google.com`.
   *
   * Optional — feature-detect before calling, so a newer web deployment keeps
   * working against an installed shell that predates it.
   */
  listSites?(): Promise<BrowserSiteInfo[]>
  /**
   * Copy one Chrome profile's cookies into the built-in browser, preserving
   * each cookie's security attributes. Requires an active user gesture in the
   * calling page. Resolves a count-only report; never rejects for import-level
   * failures (those ride the `error` category).
   */
  importChromeCookies(profileId?: string): Promise<BrowserImportResult>
  /**
   * Copy cookies and saved passwords in one action.
   *
   * A single call rather than two, because the macOS Keychain prompt can
   * outlive the page's transient user activation and a second gated call would
   * then be refused for a user who did nothing wrong. Each half reports its
   * own outcome, so one failing does not hide the other.
   *
   * Optional: shells that predate saved passwords expose only
   * {@link importChromeCookies}, so feature-detect before offering it.
   */
  importFromChrome?(
    profileId?: string,
    policy?: BrowserCredentialConflictPolicy
  ): Promise<BrowserChromeImportResult>
}

/** Both halves of a combined Chrome import, each with its own outcome. */
export interface BrowserChromeImportResult {
  cookies: BrowserImportResult
  passwords: BrowserPasswordImportResult
}

/** How an import should treat a credential that already exists for a site. */
export type BrowserCredentialConflictPolicy = 'keep-existing' | 'replace'

/**
 * Outcome of a password import. Counts and a coarse category only, exactly
 * like the cookie import — no origins, usernames, or passwords.
 */
export interface BrowserPasswordImportResult {
  passwordsAdded: number
  passwordsUpdated: number
  passwordsSkipped: number
  error?: BrowserImportError
}

/**
 * One saved credential as the management UI sees it. The password is
 * deliberately absent, and there is no bridge method that can produce it:
 * plaintext only ever travels from the vault to an authorized fill, inside the
 * main process.
 */
export interface BrowserCredentialMetadata {
  id: string
  origin: string
  username: string
  createdAt: string
  updatedAt: string
  source: 'chrome' | 'manual'
  /**
   * The site's icon as a `data:` URL, copied from the source browser's own
   * favicon store during import. Absent when that browser had no icon for the
   * site. Never fetched over the network — doing so would disclose the list of
   * sites the user has passwords for.
   */
  icon?: string
}

/**
 * Whether the active browser tab is showing a login form that Sim holds a
 * credential for — just enough to decide whether to offer the fill affordance.
 *
 * Intentionally a bare boolean. The renderer learns nothing about which
 * accounts exist, and the chooser itself is a native main-process surface, so
 * no credential identifier crosses this bridge on the fill path at all.
 */
export interface BrowserFillAvailability {
  available: boolean
}

/**
 * The saved-password surface for the built-in browser: an OS-encrypted local
 * vault plus a user-driven fill.
 *
 * Optional so newer web deployments keep working against shells that lack it,
 * and absent where secure storage is unavailable — there is no plaintext
 * fallback. The agent has no path to any of it: management calls require the
 * Sim app origin, filling additionally requires a real user gesture and is
 * completed by a native menu the renderer cannot drive, and no browser tool
 * maps to these channels.
 */
export interface SimDesktopBrowserCredentialsApi {
  /** False when OS-backed encryption is unavailable and passwords are disabled. */
  isAvailable(): Promise<boolean>
  /** Saved credentials, without passwords. */
  list(): Promise<BrowserCredentialMetadata[]>
  /** Forget one credential; resolves the remaining list. */
  forget(id: string): Promise<BrowserCredentialMetadata[]>
  /**
   * Delete every saved password. Requires an active user gesture; resolves the
   * resulting (empty) list. Optional — feature-detect before offering it.
   */
  forgetAll?(): Promise<BrowserCredentialMetadata[]>
  /**
   * Reveal one saved password so the user can read it.
   *
   * This is the only method on the entire bridge that can produce password
   * plaintext, and it is heavily conditioned: it requires an active user
   * gesture, the shell prompts for Touch ID (or a native confirmation where
   * Touch ID is unavailable) on every call, and it returns exactly one
   * password. Resolves null when the user declines or the credential is gone.
   *
   * Optional — shells that predate the password manager omit it.
   */
  reveal?(id: string): Promise<string | null>
  /**
   * Copy one saved password to the clipboard. Same authorization as
   * {@link reveal}, but the password never enters the renderer: the shell
   * writes the clipboard itself and clears it again shortly after.
   */
  copy?(id: string): Promise<boolean>
  /** Copy saved passwords out of a Chrome profile into the vault. */
  importFromChrome(
    profileId?: string,
    policy?: BrowserCredentialConflictPolicy
  ): Promise<BrowserPasswordImportResult>
  /**
   * Ask the shell to show its native credential chooser near a point in the
   * window. Requires a user gesture. The shell performs the fill itself when
   * the user picks an account — no password or credential id comes back here.
   */
  showChooser(anchor: { x: number; y: number }): Promise<boolean>
  /** Subscribe to whether the active tab can be filled. */
  onFillAvailability(callback: (state: BrowserFillAvailability) => void): () => void
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
   * Local Chrome import for the built-in browser. Absent on shells predating
   * it and on platforms without a supported importer.
   */
  browserImport?: SimDesktopBrowserImportApi
  /**
   * Saved passwords and user-driven fill for the built-in browser. Absent on
   * older shells and wherever OS-backed encryption is unavailable.
   */
  browserCredentials?: SimDesktopBrowserCredentialsApi
  /**
   * Optional so a newer web deployment stays compatible with installed shells
   * that predate the agent terminal.
   */
  terminal?: SimDesktopTerminalApi
}
