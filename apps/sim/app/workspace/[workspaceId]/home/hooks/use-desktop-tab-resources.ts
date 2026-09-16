import { useEffect, useMemo, useRef } from 'react'
import type { MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import { terminalResourceId } from '@/lib/terminal/resource-id'
import type { ResourceEventHandler } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import type { NativeActiveTabIds } from '@/app/workspace/[workspaceId]/home/resource-view-policy'
import { useBrowserSessionStore } from '@/stores/browser-session/store'
import { useCopilotTerminalStore } from '@/stores/copilot-terminal/store'

/**
 * The tab the desktop app currently shows for a chat, per kind, as resource
 * ids. The strip prefers these over its own last-resource fallback. Pass null
 * from a surface that projects no desktop tabs, so it never re-renders for a
 * native switch it cannot show.
 */
export function useNativeActiveTabIds(scopeId: string | null): NativeActiveTabIds {
  const browser = useBrowserSessionStore((state) =>
    scopeId === null ? null : (state.sessions[scopeId]?.activeTabId ?? null)
  )
  const terminal = useCopilotTerminalStore((state) =>
    scopeId === null ? null : (state.sessions[scopeId]?.tabs.activeTerminalId ?? null)
  )
  return useMemo(
    () => ({ browser, terminal: terminal ? terminalResourceId(terminal) : null }),
    [browser, terminal]
  )
}

/** One live desktop tab, as the strip needs to know it. */
export interface DesktopTab {
  id: string
  title: string
}

/** What the strip shares with every kind of desktop-backed resource tab. */
export interface DesktopTabResourceOptions {
  /** Desktop scope whose live tabs back this chat's resource tabs. */
  scopeId: string
  resources: readonly MothershipResource[]
  /** The resource the strip shows: the explicit selection or its fallback. */
  activeResourceId: string | null
  /** The explicit selection alone, without the strip's fallback. */
  selectedResourceId: string | null
  /** Adds a tab without activating it; activation goes through {@link onResourceEvent}. */
  addResource: (resource: MothershipResource) => void
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  /** Explicit user selection, which claims the strip's selection for the user. */
  selectResource: (resourceId: string) => void
  /** Agent activity on a tab, subject to the panel's user-ownership policy. */
  onResourceEvent: ResourceEventHandler
}

interface UseDesktopTabResourcesOptions extends DesktopTabResourceOptions {
  type: 'browser' | 'terminal'
  /** The desktop app's live tab list for the scope, in its order. */
  tabs: readonly DesktopTab[]
  /**
   * Whether the renderer holds a bucket for the scope at all. A missing bucket
   * means the scope has not been activated yet or was just migrated to its
   * durable id; it says nothing about the tabs themselves.
   */
  hasSession: boolean
  /** The tab the desktop app currently shows for the scope. */
  activeTabId: string | null
  /** The tab the agent is working in, while it is working. */
  agentTabId: string | null
  /** Shows a tab natively without claiming it for the user. */
  switchTab: (tabId: string, scopeId: string) => void
}

/** Whether the resource the strip shows is a tab of this kind. */
function stripShowsKind(
  resources: readonly MothershipResource[],
  activeResourceId: string | null,
  type: MothershipResourceType
): boolean {
  return resources.find((resource) => resource.id === activeResourceId)?.type === type
}

/**
 * Keeps one kind of desktop-backed resource tab equal to the desktop app's
 * live tab list, one resource per native tab.
 *
 * The desktop app owns the tabs, so its list is the source of truth: a tab
 * appearing there gains a resource tab and a tab leaving it loses one. Closing
 * a resource tab closes its native tab at the strip, which then comes back
 * through the same list. Visible selection is routed the same way — choosing
 * a resource tab switches the native tab, and a native switch follows into the
 * strip while the user is on that kind of tab. Which resource the strip shows
 * when nothing is selected is resolved by `resolveEffectiveResourceId`, not
 * here.
 *
 * The agent never moves the visible tab itself. Its tab is announced as
 * resource activity, so the existing view policy decides whether to show it or
 * only badge it while the user is reading something else.
 */
export function useDesktopTabResources({
  type,
  scopeId,
  tabs,
  hasSession,
  activeTabId,
  agentTabId,
  switchTab,
  resources,
  activeResourceId,
  selectedResourceId,
  addResource,
  removeResource,
  selectResource,
  onResourceEvent,
}: UseDesktopTabResourcesOptions): void {
  /**
   * Tab ids whose resource has been seen in the strip for the current scope.
   * A tab is projected until its resource shows up — chat hydration can
   * replace the list underneath a fresh add — and once it has been seen, its
   * absence means the user closed it and the native close is in flight.
   */
  const knownTabIdsRef = useRef<Set<string> | null>(null)
  knownTabIdsRef.current ??= new Set()
  const knownScopeRef = useRef(scopeId)
  /** The native switch this hook asked for and has not seen land yet. */
  const requestedTabIdRef = useRef<string | null>(null)
  const scopeIdRef = useRef(scopeId)
  scopeIdRef.current = scopeId
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources
  const activeResourceIdRef = useRef(activeResourceId)
  activeResourceIdRef.current = activeResourceId
  /**
   * The last tab the desktop app reported showing. Unset until its first
   * report, which carries the tab it remembers rather than a switch. Never
   * unset again by an empty tab list, so reopening a tab still reads as a move.
   */
  const previousActiveTabIdRef = useRef<string | null>(null)
  const switchTabRef = useRef(switchTab)
  switchTabRef.current = switchTab
  const selectResourceRef = useRef(selectResource)
  selectResourceRef.current = selectResource
  const onResourceEventRef = useRef(onResourceEvent)
  onResourceEventRef.current = onResourceEvent

  useEffect(() => {
    const known = knownTabIdsRef.current
    if (!known) return
    if (knownScopeRef.current !== scopeId) {
      knownScopeRef.current = scopeId
      known.clear()
      requestedTabIdRef.current = null
      previousActiveTabIdRef.current = null
    }
    const resourceTabIds = new Set(
      resources.filter((resource) => resource.type === type).map((resource) => resource.id)
    )

    for (const tab of tabs) {
      if (resourceTabIds.has(tab.id)) {
        known.add(tab.id)
        continue
      }
      if (!known.has(tab.id)) addResource({ type, id: tab.id, title: tab.title })
    }

    if (!hasSession) return
    const liveTabIds = new Set(tabs.map((tab) => tab.id))
    for (const tabId of known) {
      if (liveTabIds.has(tabId)) continue
      known.delete(tabId)
      if (resourceTabIds.has(tabId)) removeResource(type, tabId)
    }
  }, [addResource, hasSession, removeResource, resources, scopeId, tabs, type])

  const selectedTabIsLive =
    selectedResourceId !== null && tabs.some((tab) => tab.id === selectedResourceId)

  // Selecting a resource tab shows its native tab. Keyed on the explicit
  // selection alone — the strip's fallback is not a choice to impose on the
  // desktop app, and a native push must not re-assert a selection it just
  // moved away from, or the two sides would trade switches forever — and on
  // that tab being live, so a selection made before the desktop app published
  // its tab list is shown once the tab arrives rather than dropped.
  useEffect(() => {
    if (!selectedResourceId || !selectedTabIsLive) return
    if (selectedResourceId === activeTabIdRef.current) return
    requestedTabIdRef.current = selectedResourceId
    switchTabRef.current(selectedResourceId, scopeIdRef.current)
  }, [selectedResourceId, selectedTabIsLive])

  // A native switch while the user is on this kind of tab claims the selection
  // the way a click on the tab would, so later agent activity only badges
  // rather than taking the view. Measured against the tab the desktop app was
  // showing, not the one the strip shows: with no explicit selection those are
  // the same tab, and comparing them would never see a switch. Two switches
  // are not the user's — the one this hook requested itself, and the scope's
  // first report, which carries the tab the desktop app remembers.
  useEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current
    if (activeTabId !== null) previousActiveTabIdRef.current = activeTabId
    if (requestedTabIdRef.current === activeTabId) {
      requestedTabIdRef.current = null
      return
    }
    if (!activeTabId || previousActiveTabId === null) return
    if (activeTabId === previousActiveTabId) return
    if (!stripShowsKind(resourcesRef.current, activeResourceIdRef.current, type)) return
    selectResourceRef.current(activeTabId)
  }, [activeTabId, type])

  // The agent's tab surfaces like any other agent activity.
  useEffect(() => {
    if (agentTabId) onResourceEventRef.current(agentTabId, { activate: true })
  }, [agentTabId])
}
