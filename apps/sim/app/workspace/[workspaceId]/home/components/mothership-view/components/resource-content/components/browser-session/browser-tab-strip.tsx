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
import { TabStrip, type TabStripItem } from '@sim/emcn'
import { Link, Loader } from '@sim/emcn/icons'
import { SIM_RESOURCE_DRAG_TYPE } from '@/lib/copilot/resource-types'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'

interface BrowserTabStripProps {
  tabs: BrowserTabState[]
  activeTabId: string | null
  onNewTab: () => void
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onDuplicateTab: (tabId: string) => void
  onSetTabPinned: (tabId: string, pinned: boolean) => void
  onOpenTabMenu: (tabId: string) => void
  onCloseTabMenu: () => void
  onReorderTab: (tabId: string, targetIndex: number) => void
  contextMenuOpen: boolean
}

function tabTitle(tab: BrowserTabState): string {
  return tab.title.trim() || (tab.url ? 'Loading…' : 'New tab')
}

export function browserTabHostname(url: string): string | null {
  if (!/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

function BrowserTabIcon({ tab }: { tab: BrowserTabState }) {
  if (tab.loading) {
    return <Loader className='size-[12px] shrink-0 animate-spin text-[var(--text-icon)]' />
  }

  const hostname = browserTabHostname(tab.url)
  if (!hostname) {
    return <Link className='size-[12px] shrink-0 text-[var(--text-icon)]' />
  }

  return (
    <img
      key={hostname}
      src={faviconUrl(hostname, 32)}
      alt=''
      className='size-[12px] shrink-0 scale-[1.333] rounded-[3px]'
      onError={(event) => {
        event.currentTarget.style.display = 'none'
      }}
    />
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
  const contextTab = tabs.find((tab) => tab.tabId === contextTabId)

  const items = useMemo<TabStripItem[]>(
    () =>
      tabs.map((tab) => ({
        id: tab.tabId,
        title: tabTitle(tab),
        icon: <BrowserTabIcon tab={tab} />,
        active: tab.tabId === activeTabId,
        ...(tab.pinned ? { pinned: true } : {}),
      })),
    [tabs, activeTabId]
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
        JSON.stringify({ type: 'browser', id: tab.tabId, title: tabTitle(tab) })
      )
    },
    [tabs]
  )

  const openTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
      event.preventDefault()
      event.stopPropagation()
      window.getSelection()?.removeAllRanges()
      setContextTabId(tabId)
      setContextMenuPosition({ x: event.clientX, y: event.clientY })
      onOpenTabMenu(tabId)
    },
    [onOpenTabMenu]
  )

  const closeTabContextMenu = useCallback(() => {
    setContextTabId(null)
    onCloseTabMenu()
  }, [onCloseTabMenu])

  // An agent action can remove a background tab while its menu is open. The
  // Radix menu then has no item to render, so explicitly release the browser
  // surface instead of leaving its captured frame in place indefinitely.
  useEffect(() => {
    if (contextMenuOpen && contextTabId && !contextTab) closeTabContextMenu()
  }, [closeTabContextMenu, contextMenuOpen, contextTab, contextTabId])

  return (
    <TabStrip
      tabs={items}
      onSelect={onSwitchTab}
      onClose={onCloseTab}
      onNew={onNewTab}
      onTabContextMenu={openTabContextMenu}
      onTabDragStart={startTabDrag}
      onReorder={onReorderTab}
    >
      <ContextMenu
        isOpen={contextMenuOpen && Boolean(contextTab)}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        onClose={closeTabContextMenu}
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
    </TabStrip>
  )
}
