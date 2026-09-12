import { useEffect, useMemo, useRef } from 'react'
import type { BrowserTabState } from '@sim/browser-protocol'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { onOpenInBrowserPanel } from '@/lib/browser-agent/open-in-panel'
import { browserTabTitle } from '@/lib/browser-agent/tab-label'
import { openUrlInNewBrowserTab, sendBrowserPanelAction } from '@/lib/browser-agent/transport'
import {
  type DesktopTabStripOptions,
  useDesktopTabResources,
} from '@/app/workspace/[workspaceId]/home/hooks/use-desktop-tab-resources'
import { useBrowserSessionStore } from '@/stores/browser-session/store'

const logger = createLogger('BrowserTabResources')

const EMPTY_BROWSER_TABS: BrowserTabState[] = []

function switchBrowserTab(tabId: string, scopeId: string): void {
  sendBrowserPanelAction('switch-tab', { tabId, claim: false }, scopeId)
}

/**
 * Projects the desktop app's live browser pages into `browser` resource tabs,
 * one per page. See {@link useDesktopTabResources} for the shared model.
 */
export function useBrowserTabResources(options: DesktopTabStripOptions): void {
  const { scopeId, selectResource } = options
  const hasSession = useBrowserSessionStore((state) => state.sessions[scopeId] !== undefined)
  const browserTabs = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.tabs ?? EMPTY_BROWSER_TABS
  )
  const activeTabId = useBrowserSessionStore(
    (state) => state.sessions[scopeId]?.activeTabId ?? null
  )
  const agentTabId = useBrowserSessionStore((state) => {
    const session = state.sessions[scopeId]
    if (!session) return null
    return session.automationActive || session.agentRunIds.length > 0
      ? session.automationTabId
      : null
  })
  const tabs = useMemo(
    () => browserTabs.map((tab) => ({ id: tab.tabId, title: browserTabTitle(tab) })),
    [browserTabs]
  )
  const scopeIdRef = useRef(scopeId)
  scopeIdRef.current = scopeId
  const selectResourceRef = useRef(selectResource)
  selectResourceRef.current = selectResource

  useDesktopTabResources({
    ...options,
    type: 'browser',
    tabs,
    hasSession,
    activeTabId,
    agentTabId,
    switchTab: switchBrowserTab,
  })

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
