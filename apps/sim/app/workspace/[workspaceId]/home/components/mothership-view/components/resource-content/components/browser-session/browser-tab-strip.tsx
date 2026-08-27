'use client'

import {
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { BrowserTabState } from '@sim/browser-protocol'
import { cn, TabStrip, type TabStripItem, toast } from '@sim/emcn'
import { CircleAlert, Globe, Loader } from '@sim/emcn/icons'
import { ThinkingLoader } from '@/components/ui'
import { SIM_RESOURCE_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { getDesktopBridge } from '@/lib/desktop'
import {
  browserTabHostname,
  browserTabTitle,
  shouldShowBrowserTabSpinner,
} from '@/app/workspace/[workspaceId]/home/components/mothership-view/components/resource-content/components/browser-session/browser-tab-label'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'

interface BrowserTabStripProps {
  tabs: BrowserTabState[]
  activeTabId: string | null
  automationTabId: string | null
  automationActive: boolean
  automationNeedsAttention: boolean
  onNewTab: () => void
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onDuplicateTab: (tabId: string) => void
  onSetTabPinned: (tabId: string, pinned: boolean) => void
  /** Resolves true only when the renderer context menu may safely open. */
  onOpenTabMenu: (tabId: string) => Promise<boolean>
  onCloseTabMenu: () => void
  onReorderTab: (tabId: string, targetIndex: number) => void
  contextMenuOpen: boolean
}

function BrowserTabIcon({ tab }: { tab: BrowserTabState }) {
  const hostname = browserTabHostname(tab.url)
  const [loadedHostname, setLoadedHostname] = useState<string | null>(null)
  const [failedHostname, setFailedHostname] = useState<string | null>(null)
  const faviconLoaded = Boolean(hostname && loadedHostname === hostname)
  const faviconFailed = Boolean(hostname && failedHostname === hostname)
  const showSpinner = shouldShowBrowserTabSpinner(tab.loading, hostname, loadedHostname)

  if (tab.issue) {
    return (
      <span className='flex size-[16px] shrink-0 items-center justify-center'>
        <CircleAlert className='size-[12px] text-[var(--text-icon)]' />
      </span>
    )
  }

  return (
    <span className='relative flex size-[16px] shrink-0 items-center justify-center'>
      {hostname && !faviconFailed && (
        <img
          key={hostname}
          src={faviconUrl(hostname, 32)}
          alt=''
          className={cn(
            'size-[16px] rounded-[3px]',
            !faviconLoaded && 'pointer-events-none absolute opacity-0'
          )}
          onLoad={() => setLoadedHostname(hostname)}
          onError={() => setFailedHostname(hostname)}
        />
      )}
      {showSpinner ? (
        <Loader
          animate
          className='size-[14px] text-[var(--text-icon)]'
          strokeWidth={2}
          style={{ animationDuration: '650ms' }}
        />
      ) : !faviconLoaded || faviconFailed ? (
        <Globe className='size-[12px] text-[var(--text-icon)]' />
      ) : null}
    </span>
  )
}

/**
 * The browser panel's tab strip: the shared {@link TabStrip} plus the two
 * things only the browser has — favicons, and a Sim context menu carrying
 * pin/unpin alongside duplicate and close. The menu is opened only after the
 * panel swaps its native browser surface for a captured frame, so it can render
 * above the page without falling back to Electron's native menu styling. The
 * active Electron view remains the only native view attached over the panel;
 * selecting a tab switches which live view is attached.
 */
export function BrowserTabStrip({
  tabs,
  activeTabId,
  automationTabId,
  automationActive,
  automationNeedsAttention,
  onNewTab,
  onSwitchTab,
  onCloseTab,
  onDuplicateTab,
  onSetTabPinned,
  onOpenTabMenu,
  onCloseTabMenu,
  onReorderTab,
  contextMenuOpen,
}: BrowserTabStripProps) {
  const [contextTabId, setContextTabId] = useState<string | null>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState({ x: 0, y: 0 })
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const contextRequestRef = useRef(0)
  const contextTab = tabs.find((tab) => tab.tabId === contextTabId)

  const items = useMemo<TabStripItem[]>(
    () =>
      tabs.map((tab) => {
        const isAutomationRunning = automationActive && tab.tabId === automationTabId
        return {
          id: tab.tabId,
          title: browserTabTitle(tab),
          icon: (
            <span className='relative flex size-[16px] shrink-0 items-center justify-center'>
              <span className={cn(isAutomationRunning && 'invisible')}>
                <BrowserTabIcon tab={tab} />
              </span>
              {isAutomationRunning && (
                <span className='absolute inset-0 flex items-center justify-center'>
                  <ThinkingLoader size={14} startVariant='corners' />
                </span>
              )}
            </span>
          ),
          active: tab.tabId === activeTabId,
          attention:
            !automationActive &&
            automationNeedsAttention &&
            tab.tabId === automationTabId &&
            tab.tabId !== activeTabId,
          ...(tab.pinned ? { pinned: true } : {}),
        }
      }),
    [tabs, activeTabId, automationTabId, automationActive, automationNeedsAttention]
  )

  // Dragging a tab into the chat attaches it as context. `copyMove` because
  // the strip already set `move` for its own reordering, and a drop target
  // asking for `copy` is refused outright unless copying is allowed too.
  const startTabDrag = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
      const tab = tabs.find((entry) => entry.tabId === tabId)
      if (!tab) return
      event.dataTransfer.effectAllowed = 'copyMove'
      event.dataTransfer.setData(
        SIM_RESOURCE_DRAG_TYPE,
        JSON.stringify({ type: 'browser', id: tab.tabId, title: browserTabTitle(tab) })
      )
    },
    [tabs]
  )

  const openTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
      const request = ++contextRequestRef.current
      const position = { x: event.clientX, y: event.clientY }
      void onOpenTabMenu(tabId).then((opened) => {
        if (!opened || request !== contextRequestRef.current) return
        setContextTabId(tabId)
        setContextMenuPosition(position)
      })
    },
    [onOpenTabMenu]
  )

  const closeTabContextMenu = useCallback(() => {
    contextRequestRef.current++
    setContextTabId(null)
    onCloseTabMenu()
  }, [onCloseTabMenu])

  // An agent action can remove a background tab while its menu is open. The
  // Radix menu then has no item to render, so explicitly release the browser
  // surface instead of leaving its captured frame in place indefinitely.
  useEffect(() => {
    if (contextMenuOpen && contextTabId && !contextTab) closeTabContextMenu()
  }, [closeTabContextMenu, contextMenuOpen, contextTab, contextTabId])

  const openTabInExternalBrowser = useCallback(() => {
    const url = contextTab?.url
    const bridge = getDesktopBridge()
    if (!url || url === 'about:blank' || !bridge) return

    void bridge.openExternal(url).then(
      (opened) => {
        if (!opened) toast.error('Could not open this page in your browser.')
      },
      () => toast.error('Could not open this page in your browser.')
    )
  }, [contextTab?.url])

  return (
    <TabStrip
      tabs={items}
      onSelect={onSwitchTab}
      onClose={onCloseTab}
      onNew={onNewTab}
      onTabContextMenu={openTabContextMenu}
      onTabDragStart={startTabDrag}
      onReorder={onReorderTab}
      overlays={
        <ContextMenu
          isOpen={contextMenuOpen && Boolean(contextTab)}
          position={contextMenuPosition}
          menuRef={contextMenuRef}
          onClose={closeTabContextMenu}
          onOpenInNewTab={openTabInExternalBrowser}
          openInNewTabLabel='Open in External Browser'
          openInNewTabPosition='last'
          showOpenInNewTab={Boolean(contextTab?.url && contextTab.url !== 'about:blank')}
          onTogglePin={
            contextTab ? () => onSetTabPinned(contextTab.tabId, !contextTab.pinned) : undefined
          }
          onDuplicate={contextTab ? () => onDuplicateTab(contextTab.tabId) : undefined}
          // Pinned tabs are durable and deliberately have no close action.
          {...(contextTab && !contextTab.pinned
            ? { onCloseTab: () => onCloseTab(contextTab.tabId), showCloseTab: true }
            : {})}
          onDelete={() => {}}
          showPin={Boolean(contextTab)}
          isPinned={Boolean(contextTab?.pinned)}
          showRename={false}
          showDuplicate={Boolean(contextTab)}
          showDelete={false}
        />
      }
    />
  )
}
