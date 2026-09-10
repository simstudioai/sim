import { useEffect, useRef } from 'react'
import type { BrowserTabState } from '@sim/browser-protocol'
import { browserTabTitle } from '@/lib/browser-agent/tab-label'
import { sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import type { MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import type { ResourceEventHandler } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const EMPTY_BROWSER_TABS: BrowserTabState[] = []

interface UseBrowserTabResourcesOptions {
  /** Desktop browser scope whose pages back this chat's browser tabs. */
  scopeId: string
  resources: readonly MothershipResource[]
  activeResourceId: string | null
  /** Adds a tab without activating it; activation goes through {@link onResourceEvent}. */
  addResource: (resource: MothershipResource) => void
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  /** Explicit user selection, which claims the visible tab. */
  selectResource: (resourceId: string) => void
  /** Agent activity on a tab, subject to the panel's user-ownership policy. */
  onResourceEvent: ResourceEventHandler
}

/**
 * Keeps the chat's `browser` resource tabs equal to the desktop app's live
 * page list, one resource per native tab.
 *
 * The desktop app owns the pages, so its tab list is the source of truth: a
 * page appearing there (agent, `+ Browser`, popup, restore) gains a resource
 * tab and a page leaving it loses one. Closing a browser resource tab closes
 * its page at the strip, which then comes back through the same list. Visible
 * selection is routed the same way — choosing a browser resource tab switches
 * the native page, and a native switch (Ctrl+Tab in the page, a popup the user
 * opened) follows into the strip while the user is on the browser.
 *
 * The agent never moves the visible page itself. Its tab is announced as
 * resource activity, so the existing view policy decides whether to show it or
 * only badge it while the user is reading something else.
 */
export function useBrowserTabResources({
  scopeId,
  resources,
  activeResourceId,
  addResource,
  removeResource,
  selectResource,
  onResourceEvent,
}: UseBrowserTabResourcesOptions): void {
  const tabs = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.tabs ?? EMPTY_BROWSER_TABS
  )
  const activeTabId = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.activeTabId ?? null
  )
  const automationTabId = useBrowserSessionStore((state) => {
    const session = state.sessions[scopeId]
    if (!session) return null
    return session.automationActive || session.agentRunIds.length > 0
      ? session.automationTabId
      : null
  })
  /** Tab ids this hook has projected into the strip for the current scope. */
  const knownTabIdsRef = useRef<Set<string> | null>(null)
  knownTabIdsRef.current ??= new Set()
  const knownScopeRef = useRef(scopeId)
  const resourcesRef = useRef(resources)
  resourcesRef.current = resources
  const activeResourceIdRef = useRef(activeResourceId)
  activeResourceIdRef.current = activeResourceId
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
    }
    const liveTabIds = new Set(tabs.map((tab) => tab.tabId))
    const resourceTabIds = new Set(
      resources.filter((resource) => resource.type === 'browser').map((resource) => resource.id)
    )

    for (const tab of tabs) {
      // A known tab without a resource is a close still in flight natively.
      if (known.has(tab.tabId)) continue
      known.add(tab.tabId)
      if (!resourceTabIds.has(tab.tabId)) {
        addResource({ type: 'browser', id: tab.tabId, title: browserTabTitle(tab) })
      }
    }

    for (const tabId of known) {
      if (liveTabIds.has(tabId)) continue
      known.delete(tabId)
      if (resourceTabIds.has(tabId)) removeResource('browser', tabId)
    }
  }, [addResource, removeResource, resources, scopeId, tabs])

  // Selecting a browser resource tab shows its native page.
  useEffect(() => {
    if (!activeResourceId || activeResourceId === activeTabId) return
    if (!tabs.some((tab) => tab.tabId === activeResourceId)) return
    sendBrowserPanelAction('switch-tab', { tabId: activeResourceId }, scopeId)
  }, [activeResourceId, activeTabId, scopeId, tabs])

  // A native switch while the user is on the browser follows into the strip.
  const followedActiveTabIdRef = useRef(activeTabId)
  useEffect(() => {
    if (followedActiveTabIdRef.current === activeTabId) return
    followedActiveTabIdRef.current = activeTabId
    const activeResource = resourcesRef.current.find(
      (resource) => resource.id === activeResourceIdRef.current
    )
    if (!activeTabId || activeResource?.type !== 'browser' || activeResource.id === activeTabId) {
      return
    }
    selectResourceRef.current(activeTabId)
  }, [activeTabId])

  // The agent's tab surfaces like any other agent activity.
  useEffect(() => {
    if (automationTabId) onResourceEventRef.current(automationTabId, { activate: true })
  }, [automationTabId])
}
