'use client'

import { type MouseEvent as ReactMouseEvent, useCallback, useMemo, useState } from 'react'
import { type BrowserTabState, MAX_BROWSER_TABS } from '@sim/browser-protocol'
import { TabStrip, type TabStripItem } from '@sim/emcn'
import { Link, Loader } from '@sim/emcn/icons'
import { faviconUrl } from '@/lib/core/utils/favicon'
import { ContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/context-menu/context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

interface BrowserTabStripProps {
  tabs: BrowserTabState[]
  activeTabId: string | null
  onNewTab: () => void
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onSetTabPinned: (tabId: string, pinned: boolean) => void
  onReorderTab: (tabId: string, targetIndex: number) => void
  pinningSupported: boolean
  reorderingSupported: boolean
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
      className='size-[12px] shrink-0 rounded-[3px]'
      onError={(event) => {
        event.currentTarget.style.display = 'none'
      }}
    />
  )
}

/**
 * The browser panel's tab strip: the shared {@link TabStrip} plus the two
 * things only the browser has — favicons, and a pin/unpin context menu. The
 * active Electron view remains the only native view attached over the panel;
 * selecting a tab switches which live view is attached.
 */
export function BrowserTabStrip({
  tabs,
  activeTabId,
  onNewTab,
  onSwitchTab,
  onCloseTab,
  onSetTabPinned,
  onReorderTab,
  pinningSupported,
  reorderingSupported,
}: BrowserTabStripProps) {
  const [contextTabId, setContextTabId] = useState<string | null>(null)
  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()
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

  const openTabContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => {
      window.getSelection()?.removeAllRanges()
      if (!pinningSupported) {
        event.preventDefault()
        event.stopPropagation()
        return
      }
      setContextTabId(tabId)
      handleContextMenu(event)
    },
    [handleContextMenu, pinningSupported]
  )

  return (
    <TabStrip
      tabs={items}
      onSelect={onSwitchTab}
      onClose={onCloseTab}
      onNew={onNewTab}
      onTabContextMenu={openTabContextMenu}
      maxTabs={MAX_BROWSER_TABS}
      {...(reorderingSupported ? { onReorder: onReorderTab } : {})}
    >
      <ContextMenu
        isOpen={isContextMenuOpen && Boolean(contextTab) && pinningSupported}
        position={contextMenuPosition}
        menuRef={contextMenuRef}
        onClose={closeContextMenu}
        onTogglePin={
          contextTab && pinningSupported
            ? () => onSetTabPinned(contextTab.tabId, !contextTab.pinned)
            : undefined
        }
        onDelete={() => {}}
        showPin={Boolean(contextTab) && pinningSupported}
        isPinned={Boolean(contextTab?.pinned)}
        showRename={false}
        showDuplicate={false}
        showDelete={false}
      />
    </TabStrip>
  )
}
