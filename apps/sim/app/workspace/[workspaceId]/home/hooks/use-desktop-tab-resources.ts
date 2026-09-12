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

interface UseDesktopTabResourcesOptions extends DesktopTabResourceCallbacks {
  type: 'browser' | 'terminal'
  /** Desktop scope whose live tabs back this chat's resource tabs. */
  scopeId: string
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
  resources: readonly MothershipResource[]
  /** The resource the strip shows: the explicit selection or its fallback. */
  activeResourceId: string | null
  /** The explicit selection alone, without the strip's fallback. */
  selectedResourceId: string | null
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
  /** A selected tab that is not live yet, such as a reload with the tab in the URL. */
  const pendingSelectedTabIdRef = useRef<string | null>(null)
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
      pendingSelectedTabIdRef.current = null
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

    const pendingSelectedTabId = pendingSelectedTabIdRef.current
    if (pendingSelectedTabId && tabs.some((tab) => tab.id === pendingSelectedTabId)) {
      pendingSelectedTabIdRef.current = null
      if (pendingSelectedTabId !== activeTabIdRef.current) {
        requestedTabIdRef.current = pendingSelectedTabId
        switchTabRef.current(pendingSelectedTabId, scopeId)
      }
    }

    if (!hasSession) return
    const liveTabIds = new Set(tabs.map((tab) => tab.id))
    for (const tabId of known) {
      if (liveTabIds.has(tabId)) continue
      known.delete(tabId)
      if (resourceTabIds.has(tabId)) removeResource(type, tabId)
    }
  }, [addResource, hasSession, removeResource, resources, scopeId, tabs, type])

  // Selecting a resource tab shows its native tab. Keyed on the explicit
  // selection alone: a native push must not re-assert a selection it just
  // moved away from, or the two sides would trade switches forever, and the
  // strip's fallback is not a choice to impose on the desktop app. A selected
  // tab that has not landed yet is switched to by the projection above once it
  // does, so a reload with the tab in the URL still shows that page.
  useEffect(() => {
    pendingSelectedTabIdRef.current = null
    if (!selectedResourceId || selectedResourceId === activeTabIdRef.current) return
    if (!tabsRef.current.some((tab) => tab.id === selectedResourceId)) {
      pendingSelectedTabIdRef.current = selectedResourceId
      return
    }
    requestedTabIdRef.current = selectedResourceId
    switchTabRef.current(selectedResourceId, scopeIdRef.current)
  }, [selectedResourceId])

  // With no effective selection the strip falls back to a tab of its own
  // choosing. The desktop app still shows the tab the user was last on, so the
  // strip adopts that one rather than showing a page the user did not pick.
  useEffect(() => {
    if (selectedResourceId && selectedResourceId === activeResourceId) return
    const activeTabId = activeTabIdRef.current
    if (!activeTabId || activeTabId === activeResourceId) return
    const activeResource = resourcesRef.current.find((resource) => resource.id === activeResourceId)
    if (activeResource?.type !== type) return
    if (!tabsRef.current.some((tab) => tab.id === activeTabId)) return
    restoreResourceRef.current(activeTabId)
  }, [activeResourceId, selectedResourceId, type])

  // A native switch while the user is on this kind of tab follows into the
  // strip. The switch this hook requested itself is not a native change of mind.
  useEffect(() => {
    if (requestedTabIdRef.current === activeTabId) {
      requestedTabIdRef.current = null
      return
    }
    const activeResource = resourcesRef.current.find(
      (resource) => resource.id === activeResourceIdRef.current
    )
    if (!activeTabId || activeResource?.type !== type || activeResource.id === activeTabId) {
      return
    }
    selectResourceRef.current(activeTabId)
  }, [activeTabId, type])

  // The agent's tab surfaces like any other agent activity.
  useEffect(() => {
    if (agentTabId) onResourceEventRef.current(agentTabId, { activate: true })
  }, [agentTabId])
}
