import { useEffect, useRef } from 'react'
import type { BrowserTabState } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { onOpenInBrowserPanel } from '@/lib/browser-agent/open-in-panel'
import { browserTabTitle } from '@/lib/browser-agent/tab-label'
import { openUrlInNewBrowserTab, sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import type { MothershipResource, MothershipResourceType } from '@/lib/copilot/resources/types'
import type { ResourceEventHandler } from '@/app/workspace/[workspaceId]/home/hooks/use-chat'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const logger = createLogger('BrowserTabResources')

const EMPTY_BROWSER_TABS: BrowserTabState[] = []

interface UseBrowserTabResourcesOptions {
  /** Desktop browser scope whose pages back this chat's browser tabs. */
  scopeId: string
  resources: readonly MothershipResource[]
  activeResourceId: string | null
  /** Adds a tab without activating it; activation goes through {@link onResourceEvent}. */
  addResource: (resource: MothershipResource) => void
  removeResource: (resourceType: MothershipResourceType, resourceId: string) => void
  /** Explicit user selection, which claims the strip's selection for the user. */
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
  // A missing bucket means the scope has not been activated yet or was just
  // migrated to its durable id; it says nothing about the pages themselves.
  const hasSession = useBrowserSessionStore((state) => state.sessions[scopeId] !== undefined)
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
    }
    const resourceTabIds = new Set(
      resources.filter((resource) => resource.type === 'browser').map((resource) => resource.id)
    )

    for (const tab of tabs) {
      if (resourceTabIds.has(tab.tabId)) {
        known.add(tab.tabId)
        continue
      }
      if (!known.has(tab.tabId)) {
        addResource({ type: 'browser', id: tab.tabId, title: browserTabTitle(tab) })
      }
    }

    if (!hasSession) return
    const liveTabIds = new Set(tabs.map((tab) => tab.tabId))
    for (const tabId of known) {
      if (liveTabIds.has(tabId)) continue
      known.delete(tabId)
      if (resourceTabIds.has(tabId)) removeResource('browser', tabId)
    }
  }, [addResource, hasSession, removeResource, resources, scopeId, tabs])

  // Selecting a browser resource tab shows its native page. Keyed on the
  // selection alone: a native push must not re-assert a selection it just
  // moved away from, or the two sides would trade switches forever.
  useEffect(() => {
    if (!activeResourceId || activeResourceId === activeTabIdRef.current) return
    if (!tabsRef.current.some((tab) => tab.tabId === activeResourceId)) return
    requestedTabIdRef.current = activeResourceId
    sendBrowserPanelAction(
      'switch-tab',
      { tabId: activeResourceId, claim: false },
      scopeIdRef.current
    )
  }, [activeResourceId])

  // A native switch while the user is on the browser follows into the strip.
  // The switch this hook requested itself is not a native change of mind.
  useEffect(() => {
    if (requestedTabIdRef.current === activeTabId) {
      requestedTabIdRef.current = null
      return
    }
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

  // Chat links clicked in the desktop app open in a new browser tab. The user
  // asked to see it, so it is selected as their own choice rather than offered
  // through the agent-activity policy.
  useEffect(() => {
    return onOpenInBrowserPanel((url) => {
      void openUrlInNewBrowserTab(url, scopeIdRef.current)
        .then((tabId) => {
          if (tabId) selectResourceRef.current(tabId)
        })
        .catch((error) => {
          logger.warn('Failed to open chat link in a new browser tab', {
            error: getErrorMessage(error),
          })
        })
    })
  }, [])
}
