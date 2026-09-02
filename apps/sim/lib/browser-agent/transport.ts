/**
 * Transport for the browser agent: the agent browser built into the Sim
 * desktop app, reached through the preload bridge
 * (`window.simDesktop.browserAgent`).
 *
 * Tools execute in the Electron main process against a persistent-profile
 * browser view embedded in the main Sim window. The renderer's job is
 * geometry and chrome: it reports where the browser panel sits (the main
 * process glues the real page over that rect, so the panel is natively
 * interactive) and receives page-state pushes for the panel header.
 * Availability of this bridge, plus the device switch on the Browser settings
 * page, is what gates browser resources in Sim. In a regular web browser there
 * is no bridge, so the built-in browser is unavailable.
 */
import type {
  BrowserFindRequest,
  BrowserFindResult,
  BrowserKnownSession,
  BrowserOmniboxFocusMode,
  BrowserPageState,
  BrowserPanelAction,
  BrowserPanelAnchor,
  BrowserPanelBounds,
  BrowserPanelSnapshot,
  BrowserTabsState,
  BrowserTheme,
  BrowserToolName,
} from '@sim/browser-protocol'
import type {
  BrowserAddToChatPayload,
  BrowserCredentialMetadata,
  BrowserDownloadsState,
  BrowserSiteInfo,
  BrowserToolbarCommand,
  DesktopAppearanceTheme,
  SimDesktopBrowserAgentApi,
} from '@sim/desktop-bridge'
import { isPendingDesktopScopeId } from '@sim/desktop-bridge'
import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { getDesktopBridge, isBrowserAgentEnabled } from '@/lib/desktop'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const logger = createLogger('BrowserAgentTransport')

class BrowserOutcomeUnknownError extends Error {
  readonly outcomeUnknown = true
}

let initialized = false
let activeScopeId: string | null = null
/** Last VISIBLE rect per scope; a hidden/unmounted panel has no entry. */
const latestPanelBoundsByScope = new Map<string, BrowserPanelBounds>()

interface ActiveBrowserTool {
  toolCallId: string
  tool: BrowserToolName
  scopeId: string
  onCancel?: () => void
}

/** Native browser work outlives any one SSE reader or reconnect AbortController. */
const activeBrowserTools = new Map<string, ActiveBrowserTool>()

function bridge(): SimDesktopBrowserAgentApi | null {
  return getDesktopBridge()?.browserAgent ?? null
}

function currentBrowserScopeId(): string {
  if (!activeScopeId) throw new Error('No browser chat scope is active.')
  return activeScopeId
}

/** Applies the renderer half of a native suspension, regardless of its initiator. */
function applyBrowserScopeSuspended(scopeId: string): void {
  useBrowserSessionStore.getState().suspendScope(scopeId)
  latestPanelBoundsByScope.delete(scopeId)
  if (activeScopeId === scopeId) activeScopeId = null
}

/**
 * Idempotently wires page-state and session-status pushes into the
 * browser-session store. Safe to call repeatedly (e.g. per chat mount).
 */
export function initBrowserAgentTransport(): void {
  if (initialized) return
  const agent = bridge()
  if (!agent) return
  initialized = true
  agent.onPageState((state: BrowserPageState) => {
    useBrowserSessionStore.getState().setPageState(state)
  })
  agent.onTabsState((state: BrowserTabsState) => {
    useBrowserSessionStore.getState().setTabsState(state)
  })
  agent.onSessionStatus((alive, scopeId) => {
    useBrowserSessionStore.getState().setSessionAlive(alive, scopeId)
  })
  agent.onScopeSuspended(applyBrowserScopeSuspended)
  agent.registerSitePermissionPromptSupport?.()
}

/** Makes one chat's browser set active in both renderer and desktop. */
export async function activateBrowserScope(scopeId: string): Promise<void> {
  activeScopeId = scopeId
  useBrowserSessionStore.getState().activateScope(scopeId)
  const agent = bridge()
  if (!agent) return
  const tabs = await agent.activateScope(scopeId)
  useBrowserSessionStore.getState().setTabsState(tabs)
}

/**
 * Materializes persisted tabs for a lazily activated scope without waiting for
 * its React panel to mount and report native-view bounds.
 */
export async function restoreBrowserScope(scopeId: string): Promise<boolean> {
  const agent = bridge()
  if (!agent) return false
  const tabs = await agent.restoreScope(scopeId)
  useBrowserSessionStore.getState().setTabsState(tabs)
  return tabs.tabs.length > 0
}

/** Rebinds a pending new-chat browser set to the chat id assigned by the server. */
export async function migrateBrowserScope(fromScopeId: string, toScopeId: string): Promise<void> {
  const tabs = await bridge()?.migrateScope(fromScopeId, toScopeId)
  if (tabs?.scopeId !== toScopeId) {
    // A material durable destination wins (and no bridge at all is the same
    // outcome). Drop the provisional source rather than moving renderer state
    // ahead of a native migration that was refused and leaving hidden
    // WebContents orphaned under the pending id.
    await discardBrowserScope(fromScopeId)
    return
  }

  useBrowserSessionStore.getState().migrateScope(fromScopeId, toScopeId)
  for (const activeTool of activeBrowserTools.values()) {
    if (activeTool.scopeId === fromScopeId) activeTool.scopeId = toScopeId
  }
  if (activeScopeId === fromScopeId) activeScopeId = toScopeId
  const movedBounds = latestPanelBoundsByScope.get(fromScopeId)
  latestPanelBoundsByScope.delete(fromScopeId)
  if (movedBounds && !latestPanelBoundsByScope.has(toScopeId)) {
    latestPanelBoundsByScope.set(toScopeId, movedBounds)
  }
  useBrowserSessionStore.getState().setTabsState(tabs)
}

/** Drops an abandoned pre-chat browser group from renderer and native memory. */
export async function discardBrowserScope(scopeId: string): Promise<void> {
  if (!isPendingDesktopScopeId(scopeId)) return
  useBrowserSessionStore.getState().discardScope(scopeId)
  latestPanelBoundsByScope.delete(scopeId)
  if (activeScopeId === scopeId) activeScopeId = null
  await bridge()?.disposeScope(scopeId)
}

/**
 * Stops a soft-deleted chat's native pages without removing its encrypted
 * restart descriptor. Its renderer bucket is dropped only after native
 * persistence succeeds, preventing stale tab ids from racing lazy hydration
 * when the chat is restored.
 */
export async function suspendBrowserScope(scopeId: string): Promise<boolean> {
  if (isPendingDesktopScopeId(scopeId)) return false
  const suspended = (await bridge()?.suspendScope(scopeId)) ?? false
  if (!suspended) return false

  applyBrowserScopeSuspended(scopeId)
  return true
}

/** True when browser tools can run in the installed desktop shell. */
export function isBrowserAgentAvailable(): boolean {
  return isBrowserAgentEnabled()
}

/**
 * Executes one browser tool in the desktop main process. Rejects on transport
 * failure, tool failure, or when `timeoutMs` elapses first (null = no
 * timeout, e.g. takeovers).
 */
export async function executeBrowserTool(
  toolCallId: string,
  tool: BrowserToolName,
  params: Record<string, unknown>,
  timeoutMs: number | null,
  scopeId = currentBrowserScopeId(),
  onCancel?: () => void
): Promise<unknown> {
  const agent = bridge()
  if (!agent) {
    throw new Error('The Sim desktop browser agent is unavailable.')
  }
  const activeTool = { toolCallId, tool, scopeId, onCancel }
  activeBrowserTools.set(toolCallId, activeTool)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  try {
    const invocation = agent.executeTool(toolCallId, tool, params, scopeId)
    const response =
      timeoutMs === null
        ? await invocation
        : await Promise.race([
            invocation,
            new Promise<never>((_, reject) => {
              timeoutId = setTimeout(() => {
                try {
                  const cancellation = agent.cancelTool?.(toolCallId, activeTool.scopeId)
                  if (cancellation) {
                    void cancellation
                      .then((cancelled) => {
                        if (!cancelled) {
                          logger.warn('Native browser timeout cancellation was not accepted', {
                            toolCallId,
                            tool,
                          })
                        }
                      })
                      .catch((error) => {
                        logger.warn('Native browser timeout cancellation failed', {
                          toolCallId,
                          tool,
                          error: toError(error).message,
                        })
                      })
                  } else {
                    logger.warn('Installed desktop shell cannot cancel a timed-out browser tool', {
                      toolCallId,
                      tool,
                    })
                  }
                } catch (error) {
                  logger.warn('Native browser timeout cancellation threw synchronously', {
                    toolCallId,
                    tool,
                    error: toError(error).message,
                  })
                }
                reject(
                  new BrowserOutcomeUnknownError(
                    `The browser did not respond within ${timeoutMs}ms. Its outcome is unknown and the action may already have taken effect. Do not retry it automatically; take a fresh browser snapshot before deciding what to do.`
                  )
                )
              }, timeoutMs)
            }),
          ])
    if (!response.ok) {
      throw new Error(response.error || 'The browser agent reported an error')
    }
    return response.result
  } finally {
    clearTimeout(timeoutId)
    if (activeBrowserTools.get(toolCallId) === activeTool) {
      activeBrowserTools.delete(toolCallId)
    }
  }
}

async function cancelRegisteredBrowserTool(activeTool: ActiveBrowserTool): Promise<boolean> {
  activeTool.onCancel?.()
  const agent = bridge()
  if (!agent) return false

  try {
    if ((await agent.cancelTool?.(activeTool.toolCallId, activeTool.scopeId)) === true) return true
  } catch {
    // Older or transitioning shells fall through to the takeover hand-back.
  }

  if (activeTool.tool !== 'browser_request_takeover') return false
  try {
    agent.panelAction({ action: 'takeover-done' }, activeTool.scopeId)
    return true
  } catch {
    return false
  }
}

/** Requests cancellation of one exact native browser tool. */
export async function cancelBrowserTool(
  toolCallId: string,
  scopeId: string,
  tool: BrowserToolName
): Promise<boolean> {
  return await cancelRegisteredBrowserTool(
    activeBrowserTools.get(toolCallId) ?? { toolCallId, scopeId, tool }
  )
}

/** Cancels native browser work owned by the stopped stream's captured scopes. */
export async function cancelActiveBrowserTools(scopeIds: Iterable<string>): Promise<void> {
  const scopes = new Set(scopeIds)
  const activeTools = [...activeBrowserTools.values()].filter((activeTool) =>
    scopes.has(activeTool.scopeId)
  )
  const exactCancellations = activeTools.map(cancelRegisteredBrowserTool)

  // A renderer reload can lose an older native tool, then register newer work
  // in the same scope after reconnect. Establish the scope boundary even when
  // every currently known renderer tool was cancelled exactly, so that older
  // native work and queued pre-boundary calls cannot survive Stop.
  const agent = bridge()
  const scopeCancellations = agent
    ? [...scopes].map(async (scopeId) => {
        try {
          if ((await agent.cancelActiveTool?.(scopeId)) === true) return
        } catch {
          // Older or transitioning shells fall through to takeover hand-back.
        }
        try {
          agent.panelAction({ action: 'takeover-done' }, scopeId)
        } catch {
          // Best-effort recovery for a renderer-owned registry that no longer exists.
        }
      })
    : []

  // Both IPC paths are started before yielding. A new stream can begin while
  // cancellation settles, but its tools must land after the native scope
  // boundary rather than being swept up by the previous stream's Stop.
  await Promise.all([...exactCancellations, ...scopeCancellations])
}

/** Browser-chrome commands from the panel header; fire-and-forget. */
export function sendBrowserPanelAction(
  action: BrowserPanelAction['action'],
  payload: Omit<BrowserPanelAction, 'action'> = {},
  scopeId = currentBrowserScopeId()
): void {
  bridge()?.panelAction({ action, ...payload }, scopeId)
}

/**
 * Creates a tab through an acknowledged IPC path when supported. Older shells
 * retain the fire-and-forget fallback, but callers must not assume completion
 * until a tab-state push arrives in that case.
 */
export async function openBrowserTab(
  scopeId = currentBrowserScopeId()
): Promise<BrowserTabsState | null> {
  const agent = bridge()
  if (!agent) throw new Error('The Sim desktop browser agent is unavailable.')
  if (!agent.openTab) {
    agent.panelAction({ action: 'new-tab' }, scopeId)
    return null
  }
  const state = await agent.openTab(scopeId)
  if (state.scopeId !== scopeId || !state.activeTabId) {
    throw new Error('The desktop browser did not confirm the new tab.')
  }
  useBrowserSessionStore.getState().setTabsState(state)
  return state
}

/** Opens a distinct browser tab and navigates it after the shell accepts it. */
export async function openUrlInNewBrowserTab(
  url: string,
  scopeId = currentBrowserScopeId()
): Promise<void> {
  const agent = bridge()
  if (!agent) throw new Error('The Sim desktop browser agent is unavailable.')
  if (agent.openUrl) {
    const state = await agent.openUrl(url, scopeId)
    if (state.scopeId !== scopeId || !state.activeTabId) {
      throw new Error('The desktop browser did not confirm the new tab.')
    }
    useBrowserSessionStore.getState().setTabsState(state)
    return
  }
  await openBrowserTab(scopeId)
  sendBrowserPanelAction('navigate', { url }, scopeId)
}

/** Pins or unpins a live browser tab. */
export function setBrowserTabPinned(
  tabId: string,
  pinned: boolean,
  scopeId = currentBrowserScopeId()
): void {
  bridge()?.setTabPinned(tabId, pinned, scopeId)
}

/** Opens the desktop shell's native menu for one browser tab. */
export function showBrowserTabContextMenu(tabId: string, scopeId = currentBrowserScopeId()): void {
  bridge()?.showTabContextMenu(tabId, scopeId)
}

/** Moves a live browser tab to its final list index. */
export function reorderBrowserTab(
  tabId: string,
  targetIndex: number,
  scopeId = currentBrowserScopeId()
): void {
  const agent = bridge()
  if (!agent) return
  useBrowserSessionStore.getState().reorderTab(scopeId, tabId, targetIndex)
  agent.reorderTab(tabId, targetIndex, scopeId)
}

/** Mirrors Sim's raw light/dark/system preference into embedded pages. */
export function reportBrowserTheme(theme: BrowserTheme): void {
  bridge()?.setTheme(theme)
}

/** Subscribes to browser appearance changes initiated by native desktop UI. */
export function onBrowserAppearanceThemeChanged(
  callback: (theme: DesktopAppearanceTheme) => void
): () => void {
  return bridge()?.onAppearanceThemeChanged(callback) ?? (() => {})
}

/** Reads one chat's recent browser downloads. */
export async function loadBrowserDownloads(
  scopeId = currentBrowserScopeId()
): Promise<BrowserDownloadsState> {
  return (await bridge()?.getDownloadsState(scopeId)) ?? { downloads: [], scopeId }
}

/** Subscribes to download starts, progress, and completion for one chat. */
export function onBrowserDownloadsState(
  callback: (state: BrowserDownloadsState) => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onDownloadsState((state) => {
      if (state.scopeId === scopeId) callback(state)
    }) ?? (() => {})
  )
}

/** Opens the native downloads list above the embedded browser surface. */
export function showBrowserDownloadsMenu(
  anchor: { x: number; y: number },
  scopeId = currentBrowserScopeId()
): void {
  void bridge()?.showDownloadsMenu(anchor, scopeId)
}

/** Opens the native browser overflow menu above the embedded page. */
export function showBrowserToolbarMenu(
  anchor: { x: number; y: number },
  scopeId = currentBrowserScopeId()
): void {
  void bridge()?.showToolbarMenu(anchor, scopeId)
}

/** Routes native overflow-menu navigation back into the owning chat renderer. */
export function onBrowserToolbarCommand(
  callback: (command: BrowserToolbarCommand) => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onToolbarCommand((command, eventScopeId) => {
      if (eventScopeId === scopeId) callback(command)
    }) ?? (() => {})
  )
}

/** Routes selected page text only to the browser panel for its owning chat. */
export function onBrowserAddToChat(
  callback: (payload: BrowserAddToChatPayload) => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onAddToChat((payload) => {
      if (payload.scopeId === scopeId) callback(payload)
    }) ?? (() => {})
  )
}

/** Reveals a completed download without opening the downloaded file. */
export function showBrowserDownloadInFolder(
  downloadId: string,
  scopeId = currentBrowserScopeId()
): Promise<boolean> {
  return bridge()?.showDownloadInFolder(downloadId, scopeId) ?? Promise.resolve(false)
}

/**
 * Subscribes to whether the active page can be filled with a saved password.
 * A bare boolean by design — the page learns nothing about which accounts
 * exist, and the chooser itself is a native shell surface.
 */
export function onBrowserFillAvailability(
  callback: (available: boolean) => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    getDesktopBridge()?.browserCredentials.onFillAvailability(
      ({ available, scopeId: eventScope }) => {
        if (eventScope === scopeId) callback(available)
      },
      scopeId
    ) ?? (() => {})
  )
}

/** Saved accounts that the active scoped page can accept right now. */
export function loadBrowserFillOptions(
  scopeId = currentBrowserScopeId()
): Promise<BrowserCredentialMetadata[]> {
  return (
    getDesktopBridge()
      ?.browserCredentials.listFillOptions(scopeId)
      .catch(() => []) ?? Promise.resolve([])
  )
}

/** Fills one user-selected saved account into the active scoped page. */
export function fillBrowserCredential(
  credentialId: string,
  scopeId = currentBrowserScopeId()
): Promise<boolean> {
  return (
    getDesktopBridge()?.browserCredentials.fill(credentialId, scopeId) ?? Promise.resolve(false)
  )
}

/**
 * Asks the shell to open its native account chooser at a point in the window.
 * Must be called straight from a click: the shell requires a live user gesture,
 * and it performs the fill itself rather than handing anything back here.
 */
export function showBrowserCredentialChooser(
  anchor: { x: number; y: number },
  scopeId = currentBrowserScopeId()
): void {
  void getDesktopBridge()?.browserCredentials.showChooser(anchor, scopeId)
}

/**
 * Reads what the omnibox suggests from: hosts the browser holds cookies for,
 * and hosts with a saved password.
 *
 * Both already exist for other reasons, and neither is a record of where the
 * user has been — this browser keeps no history. Password metadata never
 * includes the password itself. Either source failing yields an empty list, so
 * a broken lookup costs suggestions rather than the omnibox.
 */
export async function loadBrowserSuggestionSources(): Promise<{
  sessions: BrowserKnownSession[]
  credentials: BrowserCredentialMetadata[]
  sites: BrowserSiteInfo[]
}> {
  const desktop = getDesktopBridge()
  const [known, credentials, sites] = await Promise.all([
    desktop?.browserAgent.getKnownSessions().catch(() => null) ?? null,
    desktop?.browserCredentials.list().catch(() => []) ?? [],
    desktop?.browserImport?.listSites().catch(() => []) ?? [],
  ])
  return { sessions: known?.sessions ?? [], credentials, sites }
}

/**
 * Requests live Google completions through the desktop shell. Older shells and
 * disabled/offline providers resolve to an empty list, leaving local sites and
 * ordinary Enter-to-search behavior intact.
 */
export function loadBrowserSearchSuggestions(query: string): Promise<string[]> {
  return (
    bridge()
      ?.getSearchSuggestions?.(query)
      .catch(() => []) ?? Promise.resolve([])
  )
}

/** Subscribes to native browser shortcuts that target the renderer omnibox. */
export function onBrowserOmniboxFocus(
  callback: (mode: BrowserOmniboxFocusMode) => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onFocusOmnibox((mode, eventScopeId) => {
      if (eventScopeId === scopeId) callback(mode)
    }) ?? (() => {})
  )
}

/**
 * Runs Chromium's find against the active page. Counts arrive separately via
 * {@link onBrowserFindResult} — Chromium resolves them asynchronously and
 * streams several updates per request.
 */
export function findInBrowserPage(
  request: BrowserFindRequest,
  scopeId = currentBrowserScopeId()
): void {
  bridge()?.find(request, scopeId)
}

/**
 * Stops the running find and clears its highlights. Pass `focusPage` when the
 * user dismissed the bar, so focus lands back on the page instead of being
 * stranded on the removed input; leave it off when the bar is unmounting
 * because the panel is going away.
 */
export function stopBrowserFind(focusPage = false, scopeId = currentBrowserScopeId()): void {
  bridge()?.stopFind(focusPage, scopeId)
}

/** Subscribes to Mod+F pressed while the embedded page held focus. */
export function onBrowserFindOpen(
  callback: () => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onOpenFind((eventScopeId) => {
      if (eventScopeId === scopeId) callback()
    }) ?? (() => {})
  )
}

/** Subscribes to the shell dismissing find (navigation, tab switch). */
export function onBrowserFindClose(
  callback: () => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onCloseFind((eventScopeId) => {
      if (eventScopeId === scopeId) callback()
    }) ?? (() => {})
  )
}

/** Subscribes to match counts for the running find. */
export function onBrowserFindResult(
  callback: (result: BrowserFindResult) => void,
  scopeId = currentBrowserScopeId()
): () => void {
  return (
    bridge()?.onFindResult((result, eventScopeId) => {
      if (eventScopeId === scopeId) callback(result)
    }) ?? (() => {})
  )
}

/**
 * Reports the panel's current rect (viewport CSS pixels), or null when the
 * panel is hidden/unmounted. The embedded view tracks this rect.
 */
export function reportBrowserPanelBounds(
  bounds: BrowserPanelBounds | null,
  anchor: BrowserPanelAnchor | null = null,
  scopeId = currentBrowserScopeId()
): void {
  if (bounds) {
    latestPanelBoundsByScope.set(scopeId, bounds)
  } else {
    latestPanelBoundsByScope.delete(scopeId)
  }
  bridge()?.setPanelBounds(bounds, anchor, scopeId)
}

/** Captures the live page without hiding or resizing it. */
export function captureBrowserPanelSnapshot(
  scopeId = currentBrowserScopeId()
): Promise<BrowserPanelSnapshot | null> {
  return bridge()?.capturePanelSnapshot(scopeId) ?? Promise.resolve(null)
}

/** Whether the installed shell supports the strict pre-paint force-hide fallback. */
export function supportsAtomicBrowserPanelOcclusion(): boolean {
  return bridge()?.supportsAtomicPanelOcclusion === true
}

/** Hides or reveals the native page after the renderer's replacement has painted. */
export function setBrowserPanelOccluded(
  occluded: boolean,
  scopeId = currentBrowserScopeId(),
  force = false
): Promise<boolean> {
  return bridge()?.setPanelOccluded(occluded, scopeId, force) ?? Promise.resolve(false)
}

/**
 * Fast path for live divider drags. The measured pipeline (renderer layout →
 * ResizeObserver → report) can only start after the new panel width has laid
 * out, so the native view learns each rect milliseconds after the divider
 * moved and can miss the frame's composite deadline — the page visibly swims
 * against the divider. During a divider drag only the panel's left edge
 * moves, so the next rect is pure arithmetic: the rect measured at drag start
 * with its left edge shifted by the divider's travel. Call at drag start with
 * the divider position (the panel's left edge in viewport CSS pixels); the
 * returned predictor reports a rect per pointer move, before layout runs.
 * Measured reports remain authoritative and correct any drift.
 *
 * Both `startDividerX` and every `dividerX` must be the panel's REAL viewport
 * left edge, clamps applied — never a width subtracted from `window.innerWidth`.
 * The panel is inset from the viewport by the workspace chrome's padding and
 * border, so that substitution reads as a constant offset in `dx`, which lands
 * wholly on the predicted rect's left edge: the native view then composites
 * beside the panel rather than on it, and alternates with the measured report
 * every frame. Derive `dividerX` from the same clamped width the caller writes
 * to the DOM and the two cannot disagree.
 */
export function beginBrowserPanelDividerDrag(
  startDividerX: number,
  scopeId = currentBrowserScopeId()
): ((dividerX: number) => void) | null {
  const base = latestPanelBoundsByScope.get(scopeId)
  if (!bridge() || !base) return null
  return (dividerX: number) => {
    const dx = Math.round(dividerX - startDividerX)
    const width = base.width - dx
    if (width <= 0) return
    // The drag has pinned an inline px width, so the rate is flat and the
    // viewport is whatever it already was — statable exactly, which keeps the
    // rect and its anchor from ever describing different states.
    reportBrowserPanelBounds(
      { x: base.x + dx, y: base.y, width, height: base.height },
      { viewportWidth: window.innerWidth, viewportHeight: window.innerHeight, widthRatio: 0 },
      scopeId
    )
  }
}

/** Reports whether renderer-owned browser chrome owns the interaction context. */
export function reportBrowserPanelFocused(
  focused: boolean,
  scopeId = currentBrowserScopeId()
): void {
  bridge()?.setPanelFocused(focused, scopeId)
}
