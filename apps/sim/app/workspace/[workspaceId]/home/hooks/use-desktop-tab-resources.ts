import { useEffect, useRef } from 'react'
import type { MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import type { ResourceEventHandler } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'

/** One live desktop tab, as the strip needs to know it. */
export interface DesktopTab {
  id: string
  title: string
}

export interface DesktopTabResourceCallbacks {
  /** Adds a tab without activating it; activation goes through {@link onResourceEvent}. */
  addResource: (resource: MothershipResource) => void
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  /** Explicit user selection, which claims the strip's selection for the user. */
  selectResource: (resourceId: string) => void
  /**
   * Adopts the desktop app's remembered tab as the shown resource without
   * claiming the selection for the user, so agent activity can still take the
   * view the way it does on any chat open.
   */
  restoreResource: (resourceId: string) => void
  /** Agent activity on a tab, subject to the panel's user-ownership policy. */
  onResourceEvent: ResourceEventHandler
}

/** What the strip shares with every kind of desktop-backed resource tab. */
export interface DesktopTabStripOptions extends DesktopTabResourceCallbacks {
  /** Desktop scope whose live tabs back this chat's resource tabs. */
  scopeId: string
  resources: readonly MothershipResource[]
  /** The resource the strip shows: the explicit selection or its fallback. */
  activeResourceId: string | null
  /** The explicit selection alone, without the strip's fallback. */
  selectedResourceId: string | null
  /**
   * Whether the chat's stored resources have been applied to the strip.
   *
   * Adopting a tab writes it to `activeResourceId`, which is the one place the
   * rest of the surface reads as the shown resource, so adopting on top of a
   * provisional fallback would let the arrival order of the tab list and the
   * chat history decide what the chat opens on. Waiting makes the outcome the
   * same either way: the history pins a stored resource, or it pins nothing
   * and the desktop app's remembered tab stands.
   */
  hydrated: boolean
}

interface UseDesktopTabResourcesOptions extends DesktopTabStripOptions {
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

/**
 * The desktop app's active tab to adopt in place of the strip's fallback: one
 * the strip does not show yet, of the same kind as the fallback, and still in
 * the strip — a tab just closed there stays the desktop app's active tab until
 * the close lands.
 */
function nativeTabToAdopt(
  resources: readonly MothershipResource[],
  activeResourceId: string | null,
  activeTabId: string | null,
  type: MothershipResourceType
): string | null {
  if (!activeTabId || activeTabId === activeResourceId) return null
  if (resources.find((resource) => resource.id === activeResourceId)?.type !== type) return null
  const live = resources.some((resource) => resource.type === type && resource.id === activeTabId)
  return live ? activeTabId : null
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
 * strip while the user is on that kind of tab. Without an explicit selection
 * the desktop app's own active tab wins: it remembers the tab the user left a
 * chat on, so reopening the chat lands there instead of on the strip's
 * last-tab fallback.
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
  hydrated,
  addResource,
  removeResource,
  selectResource,
  restoreResource,
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
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const activeTabIdRef = useRef(activeTabId)
  activeTabIdRef.current = activeTabId
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources
  const activeResourceIdRef = useRef(activeResourceId)
  activeResourceIdRef.current = activeResourceId
  /** Whether the strip shows an explicit selection rather than its fallback. */
  const explicitSelection = selectedResourceId !== null && selectedResourceId === activeResourceId
  const hydratedRef = useRef(hydrated)
  hydratedRef.current = hydrated
  /**
   * The tab the desktop app showed last, to tell a change of the shown tab
   * from the scope's first report. Starts unset, like the scope itself.
   */
  const previousActiveTabIdRef = useRef<string | null>(null)
  const switchTabRef = useRef(switchTab)
  switchTabRef.current = switchTab
  const selectResourceRef = useRef(selectResource)
  selectResourceRef.current = selectResource
  const restoreResourceRef = useRef(restoreResource)
  restoreResourceRef.current = restoreResource
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

  /** Whether the selected resource is one of this kind's live tabs. */
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

  // With no effective selection the strip falls back to a tab of its own
  // choosing. The desktop app still shows the tab the user was last on, so the
  // strip adopts that one rather than showing a page the user did not pick.
  useEffect(() => {
    if (!hydrated || explicitSelection) return
    const tabId = nativeTabToAdopt(
      resourcesRef.current,
      activeResourceId,
      activeTabIdRef.current,
      type
    )
    if (tabId) restoreResourceRef.current(tabId)
  }, [activeResourceId, explicitSelection, hydrated, type])

  // A native switch while the user is on this kind of tab follows into the
  // strip. The switch this hook requested itself is not a native change of
  // mind, and neither is the scope's first report: that one carries the tab
  // the desktop app remembers, so it is adopted rather than claimed. A move
  // away from a tab it was already showing is the user's own.
  useEffect(() => {
    const previousActiveTabId = previousActiveTabIdRef.current
    previousActiveTabIdRef.current = activeTabId
    if (requestedTabIdRef.current === activeTabId) {
      requestedTabIdRef.current = null
      return
    }
    const activeResourceId = activeResourceIdRef.current
    if (previousActiveTabId !== null) {
      const activeResource = resourcesRef.current.find(
        (resource) => resource.id === activeResourceId
      )
      if (activeTabId && activeResource?.type === type && activeResource.id !== activeTabId) {
        selectResourceRef.current(activeTabId)
      }
      return
    }
    if (!hydratedRef.current) return
    const tabId = nativeTabToAdopt(resourcesRef.current, activeResourceId, activeTabId, type)
    if (tabId) restoreResourceRef.current(tabId)
  }, [activeTabId, type])

  // The agent's tab surfaces like any other agent activity.
  useEffect(() => {
    if (agentTabId) onResourceEventRef.current(agentTabId, { activate: true })
  }, [agentTabId])
}
