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
 * page, is what gates advertising `browserCapable` to the copilot — in a
 * regular web browser there is no bridge and the browser subagent is never
 * offered.
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
  BrowserTabsState,
  BrowserTheme,
  BrowserToolName,
} from '@sim/browser-protocol'
import type {
  BrowserCredentialMetadata,
  BrowserSiteInfo,
  SimDesktopBrowserAgentApi,
} from '@sim/desktop-bridge'
import { getDesktopBridge, isBrowserAgentEnabled } from '@/lib/desktop'
import { LEGACY_BROWSER_SCOPE, useBrowserSessionStore } from '@/stores/browser-session/store'

let initialized = false
let activeScopeId = LEGACY_BROWSER_SCOPE
const latestPanelBoundsByScope = new Map<string, BrowserPanelBounds | null>()
const panelOcclusionByScope = new Map<string, boolean>()

function bridge(): SimDesktopBrowserAgentApi | null {
  return getDesktopBridge()?.browserAgent ?? null
}

/** Applies the renderer half of a native suspension, regardless of its initiator. */
function applyBrowserScopeSuspended(scopeId: string): void {
  useBrowserSessionStore.getState().suspendScope(scopeId)
  latestPanelBoundsByScope.delete(scopeId)
  panelOcclusionByScope.delete(scopeId)
  if (activeScopeId === scopeId) activeScopeId = LEGACY_BROWSER_SCOPE
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
    useBrowserSessionStore.getState().setPageState(state, state.scopeId ?? activeScopeId)
  })
  agent.onPanelSnapshot?.((snapshot) => {
    useBrowserSessionStore.getState().setPanelSnapshot(snapshot, snapshot.scopeId ?? activeScopeId)
  })
  if (agent.onTabsState) {
    agent.onTabsState((state: BrowserTabsState) => {
      const scopeId = state.scopeId ?? activeScopeId
      useBrowserSessionStore.getState().setTabsSupported(true, scopeId)
      useBrowserSessionStore.getState().setTabsState(state, scopeId)
    })
    if (agent.getTabsState) {
      const initialScopeId = activeScopeId
      void agent
        .getTabsState(initialScopeId)
        .then((state) => {
          useBrowserSessionStore.getState().setTabsSupported(true, initialScopeId)
          useBrowserSessionStore.getState().setTabsState(state, initialScopeId)
        })
        .catch(() => {})
    }
  }
  agent.onSessionStatus((alive, scopeId) => {
    useBrowserSessionStore.getState().setSessionAlive(alive, scopeId ?? activeScopeId)
  })
  agent.onScopeSuspended?.(applyBrowserScopeSuspended)
}

/** Makes one chat's browser set active in both renderer and desktop. */
export async function activateBrowserScope(scopeId: string): Promise<void> {
  activeScopeId = scopeId
  useBrowserSessionStore.getState().activateScope(scopeId)
  const agent = bridge()
  if (!agent) return
  const tabs = agent.activateScope
    ? await agent.activateScope(scopeId)
    : await agent.getTabsState?.(scopeId)
  if (tabs) {
    useBrowserSessionStore.getState().setTabsSupported(true, scopeId)
    useBrowserSessionStore.getState().setTabsState(tabs, scopeId)
  }
}

/**
 * Materializes persisted tabs for a lazily activated scope without waiting for
 * its React panel to mount and report native-view bounds.
 */
export async function restoreBrowserScope(scopeId: string): Promise<boolean> {
  const tabs = await bridge()?.restoreScope?.(scopeId)
  if (!tabs) return false
  useBrowserSessionStore.getState().setTabsSupported(true, scopeId)
  useBrowserSessionStore.getState().setTabsState(tabs, scopeId)
  return tabs.tabs.length > 0
}

/** Rebinds a pending new-chat browser set to the chat id assigned by the server. */
export async function migrateBrowserScope(fromScopeId: string, toScopeId: string): Promise<void> {
  const tabs = await bridge()?.migrateScope?.(fromScopeId, toScopeId)
  if (tabs?.scopeId !== toScopeId) {
    // A material durable destination wins. Drop the provisional source rather
    // than moving renderer state ahead of a native migration that was refused
    // and leaving hidden WebContents orphaned under the pending id.
    await discardBrowserScope(fromScopeId)
    return
  }

  useBrowserSessionStore.getState().migrateScope(fromScopeId, toScopeId)
  if (activeScopeId === fromScopeId) activeScopeId = toScopeId
  if (latestPanelBoundsByScope.has(fromScopeId)) {
    latestPanelBoundsByScope.set(
      toScopeId,
      latestPanelBoundsByScope.get(toScopeId) ?? latestPanelBoundsByScope.get(fromScopeId) ?? null
    )
    latestPanelBoundsByScope.delete(fromScopeId)
  }
  if (panelOcclusionByScope.has(fromScopeId)) {
    panelOcclusionByScope.set(
      toScopeId,
      panelOcclusionByScope.get(toScopeId) ?? panelOcclusionByScope.get(fromScopeId) ?? false
    )
    panelOcclusionByScope.delete(fromScopeId)
  }
  useBrowserSessionStore.getState().setTabsSupported(true, toScopeId)
  useBrowserSessionStore.getState().setTabsState(tabs, toScopeId)
}

/** Drops an abandoned pre-chat browser group from renderer and native memory. */
export async function discardBrowserScope(scopeId: string): Promise<void> {
  if (!scopeId.startsWith('pending:')) return
  useBrowserSessionStore.getState().discardScope(scopeId)
  latestPanelBoundsByScope.delete(scopeId)
  panelOcclusionByScope.delete(scopeId)
  if (activeScopeId === scopeId) activeScopeId = LEGACY_BROWSER_SCOPE
  await bridge()?.disposeScope?.(scopeId)
}

/**
 * Stops a soft-deleted chat's native pages without removing its encrypted
 * restart descriptor. Its renderer bucket is dropped only after native
 * persistence succeeds, preventing stale tab ids from racing lazy hydration
 * when the chat is restored.
 */
export async function suspendBrowserScope(scopeId: string): Promise<boolean> {
  if (scopeId === LEGACY_BROWSER_SCOPE || scopeId.startsWith('pending:')) return false
  const suspended = (await bridge()?.suspendScope?.(scopeId)) ?? false
  if (!suspended) return false

  applyBrowserScopeSuspended(scopeId)
  return true
}

/** True when browser tools can run (gates the copilot's browserCapable flag). */
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
  scopeId = activeScopeId
): Promise<unknown> {
  const agent = bridge()
  if (!agent) {
    throw new Error('The Sim desktop browser agent is unavailable.')
  }
  const invocation = agent.executeTool(toolCallId, tool, params, scopeId)
  const response =
    timeoutMs === null
      ? await invocation
      : await Promise.race([
          invocation,
          new Promise<never>((_, reject) => {
            setTimeout(
              () => reject(new Error(`The browser did not respond within ${timeoutMs}ms`)),
              timeoutMs
            )
          }),
        ])
  if (!response.ok) {
    throw new Error(response.error || 'The browser agent reported an error')
  }
  return response.result
}

/** Browser-chrome commands from the panel header; fire-and-forget. */
export function sendBrowserPanelAction(
  action: BrowserPanelAction['action'],
  payload: Omit<BrowserPanelAction, 'action'> = {},
  scopeId = activeScopeId
): void {
  bridge()?.panelAction({ action, ...payload }, scopeId)
}

/** Whether the installed desktop shell supports durable browser-tab pinning. */
export function isBrowserTabPinningAvailable(): boolean {
  return typeof bridge()?.setTabPinned === 'function'
}

/** Pins or unpins a live browser tab when supported by the desktop shell. */
export function setBrowserTabPinned(tabId: string, pinned: boolean, scopeId = activeScopeId): void {
  bridge()?.setTabPinned?.(tabId, pinned, scopeId)
}

/** Whether the installed desktop shell supports user-driven browser-tab ordering. */
export function isBrowserTabReorderingAvailable(): boolean {
  return typeof bridge()?.reorderTab === 'function'
}

/** Moves a live browser tab to its final list index when supported by the shell. */
export function reorderBrowserTab(
  tabId: string,
  targetIndex: number,
  scopeId = activeScopeId
): void {
  bridge()?.reorderTab?.(tabId, targetIndex, scopeId)
}

/** Mirrors Sim's raw light/dark/system preference into embedded pages. */
export function reportBrowserTheme(theme: BrowserTheme): void {
  bridge()?.setTheme?.(theme)
}

/**
 * Subscribes to whether the active page can be filled with a saved password.
 * A bare boolean by design — the page learns nothing about which accounts
 * exist, and the chooser itself is a native shell surface.
 */
export function onBrowserFillAvailability(callback: (available: boolean) => void): () => void {
  return (
    getDesktopBridge()?.browserCredentials?.onFillAvailability?.(({ available }) =>
      callback(available)
    ) ?? (() => {})
  )
}

/**
 * Asks the shell to open its native account chooser at a point in the window.
 * Must be called straight from a click: the shell requires a live user gesture,
 * and it performs the fill itself rather than handing anything back here.
 */
export function showBrowserCredentialChooser(anchor: { x: number; y: number }): void {
  void getDesktopBridge()?.browserCredentials?.showChooser?.(anchor)
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
    desktop?.browserAgent?.getKnownSessions?.().catch(() => null) ?? null,
    desktop?.browserCredentials?.list().catch(() => []) ?? [],
    desktop?.browserImport?.listSites?.().catch(() => []) ?? [],
  ])
  return { sessions: known?.sessions ?? [], credentials, sites }
}

/** Subscribes to native browser shortcuts that target the renderer omnibox. */
export function onBrowserOmniboxFocus(
  callback: (mode: BrowserOmniboxFocusMode) => void,
  scopeId = activeScopeId
): () => void {
  return (
    bridge()?.onFocusOmnibox?.((mode, eventScopeId) => {
      if (eventScopeId === undefined || eventScopeId === scopeId) callback(mode)
    }) ?? (() => {})
  )
}

/** Whether the installed desktop shell supports find-in-page. */
export function isBrowserFindAvailable(): boolean {
  return typeof bridge()?.find === 'function'
}

/**
 * Runs Chromium's find against the active page. Counts arrive separately via
 * {@link onBrowserFindResult} — Chromium resolves them asynchronously and
 * streams several updates per request.
 */
export function findInBrowserPage(request: BrowserFindRequest, scopeId = activeScopeId): void {
  bridge()?.find?.(request, scopeId)
}

/**
 * Stops the running find and clears its highlights. Pass `focusPage` when the
 * user dismissed the bar, so focus lands back on the page instead of being
 * stranded on the removed input; leave it off when the bar is unmounting
 * because the panel is going away.
 */
export function stopBrowserFind(focusPage = false, scopeId = activeScopeId): void {
  bridge()?.stopFind?.(focusPage, scopeId)
}

/** Subscribes to Mod+F pressed while the embedded page held focus. */
export function onBrowserFindOpen(callback: () => void, scopeId = activeScopeId): () => void {
  return (
    bridge()?.onOpenFind?.((eventScopeId) => {
      if (eventScopeId === undefined || eventScopeId === scopeId) callback()
    }) ?? (() => {})
  )
}

/** Subscribes to the shell dismissing find (navigation, tab switch). */
export function onBrowserFindClose(callback: () => void, scopeId = activeScopeId): () => void {
  return (
    bridge()?.onCloseFind?.((eventScopeId) => {
      if (eventScopeId === undefined || eventScopeId === scopeId) callback()
    }) ?? (() => {})
  )
}

/** Subscribes to match counts for the running find. */
export function onBrowserFindResult(
  callback: (result: BrowserFindResult) => void,
  scopeId = activeScopeId
): () => void {
  return (
    bridge()?.onFindResult?.((result, eventScopeId) => {
      if (eventScopeId === undefined || eventScopeId === scopeId) callback(result)
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
  scopeId = activeScopeId
): void {
  latestPanelBoundsByScope.set(scopeId, bounds)
  const agent = bridge()
  if (!agent?.setPanelOccluded && panelOcclusionByScope.get(scopeId) && bounds !== null) return
  agent?.setPanelBounds(bounds, anchor, scopeId)
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
  scopeId = activeScopeId
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
export function reportBrowserPanelFocused(focused: boolean, scopeId = activeScopeId): void {
  bridge()?.setPanelFocused?.(focused, scopeId)
}

/**
 * Reports whether renderer-owned UI currently overlaps the native browser
 * surface. New desktop builds hide the still-attached view directly; older
 * builds fall back to temporarily clearing and restoring panel bounds.
 */
export function reportBrowserPanelOcclusion(occluded: boolean, scopeId = activeScopeId): void {
  if (panelOcclusionByScope.get(scopeId) === occluded) return
  panelOcclusionByScope.set(scopeId, occluded)
  const agent = bridge()
  if (agent?.setPanelOccluded) {
    agent.setPanelOccluded(occluded, scopeId)
    return
  }
  agent?.setPanelBounds(
    occluded ? null : (latestPanelBoundsByScope.get(scopeId) ?? null),
    null,
    scopeId
  )
}

/** Resets occlusion before the panel unmounts or its host document changes. */
export function resetBrowserPanelOcclusion(scopeId = activeScopeId): void {
  panelOcclusionByScope.set(scopeId, false)
  bridge()?.setPanelOccluded?.(false, scopeId)
}
