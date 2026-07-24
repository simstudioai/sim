'use client'

import {
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { type BrowserTabState, MAX_BROWSER_TABS } from '@sim/browser-protocol'
import { Button, cn, Tooltip } from '@sim/emcn'
import { Link, Loader, Plus, X } from '@sim/emcn/icons'
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
  pinningSupported: boolean
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

export function isBrowserTabTitleTruncated(
  element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>
): boolean {
  const hiddenWidth = element.scrollWidth - element.clientWidth
  const tooltipThreshold = Math.max(32, element.clientWidth * 0.25)
  return hiddenWidth >= tooltipThreshold
}

function BrowserTabIcon({ tab }: { tab: BrowserTabState }) {
  if (tab.loading) {
    return <Loader className='size-[13px] shrink-0 animate-spin text-[var(--text-icon)]' />
  }

  const hostname = browserTabHostname(tab.url)
  if (!hostname) {
    return <Link className='size-[13px] shrink-0 text-[var(--text-icon)]' />
  }

  return (
    <img
      key={hostname}
      src={faviconUrl(hostname, 32)}
      alt=''
      className='size-[13px] shrink-0 rounded-[3px]'
      onError={(event) => {
        event.currentTarget.style.display = 'none'
      }}
    />
  )
}

interface BrowserTabProps {
  tab: BrowserTabState
  activeTabId: string | null
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => void
}

function BrowserTab({ tab, activeTabId, onSwitchTab, onCloseTab, onContextMenu }: BrowserTabProps) {
  const title = tabTitle(tab)
  const isActive = tab.tabId === activeTabId
  const titleRef = useRef<HTMLSpanElement>(null)
  const [titleTruncated, setTitleTruncated] = useState(false)

  useLayoutEffect(() => {
    const element = titleRef.current
    if (!element) return
    const update = () => setTitleTruncated(isBrowserTabTitleTruncated(element))
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [title])

  return (
    <div
      className={cn(
        'group relative select-none',
        tab.pinned
          ? 'w-[40px] min-w-[40px] max-w-[40px] flex-none'
          : 'min-w-[102px] max-w-[190px] flex-1 basis-[146px]'
      )}
      onContextMenu={(event) => onContextMenu(event, tab.tabId)}
    >
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='subtle'
            size='sm'
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.pinned ? title : undefined}
            className={cn(
              'h-[32px] w-full select-none rounded-b-none border py-0 font-normal text-[13px]',
              tab.pinned ? 'justify-center px-0' : 'justify-start gap-[7px] px-[9px] pr-[30px]',
              isActive
                ? 'relative z-10 border-[var(--border-1)] border-b-transparent bg-[var(--surface-4)] shadow-sm'
                : 'border-transparent bg-[var(--bg)]'
            )}
            onClick={() => onSwitchTab(tab.tabId)}
          >
            <BrowserTabIcon tab={tab} />
            {!tab.pinned && (
              <span ref={titleRef} className='min-w-0 flex-1 select-none truncate text-left'>
                {title}
              </span>
            )}
          </Button>
        </Tooltip.Trigger>
        {(tab.pinned || titleTruncated) && <Tooltip.Content side='bottom'>{title}</Tooltip.Content>}
      </Tooltip.Root>
      {!tab.pinned && (
        <Button
          type='button'
          variant='ghost-secondary'
          size='sm'
          aria-label={`Close ${title}`}
          className={cn(
            'absolute top-1 right-1 z-20 size-[24px] p-0 transition-opacity hover-hover:bg-[var(--surface-active)]',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onCloseTab(tab.tabId)
          }}
        >
          <X className='size-[13px]' />
        </Button>
      )}
    </div>
  )
}

/**
 * Chrome-style internal tab strip for the singleton Mothership browser
 * resource. The active Electron view remains the only native view attached
 * over the panel; this row switches which live view is attached.
 */
export function BrowserTabStrip({
  tabs,
  activeTabId,
  onNewTab,
  onSwitchTab,
  onCloseTab,
  onSetTabPinned,
  pinningSupported,
}: BrowserTabStripProps) {
  const atTabLimit = tabs.length >= MAX_BROWSER_TABS
  const [contextTabId, setContextTabId] = useState<string | null>(null)
  const {
    isOpen: isContextMenuOpen,
    position: contextMenuPosition,
    menuRef: contextMenuRef,
    handleContextMenu,
    closeMenu: closeContextMenu,
  } = useContextMenu()
  const contextTab = tabs.find((tab) => tab.tabId === contextTabId)
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
    <div className='flex h-[37px] shrink-0 select-none items-end gap-1 border-[var(--border)] border-b bg-[var(--surface-secondary)] px-2 pt-[5px]'>
      <div className='flex min-w-0 flex-1 select-none items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {tabs.map((tab) => (
          <BrowserTab
            key={tab.tabId}
            tab={tab}
            activeTabId={activeTabId}
            onSwitchTab={onSwitchTab}
            onCloseTab={onCloseTab}
            onContextMenu={openTabContextMenu}
          />
        ))}
      </div>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='ghost-secondary'
            size='sm'
            aria-label='New tab'
            className='mb-px size-[30px] shrink-0 p-0'
            disabled={atTabLimit}
            onClick={onNewTab}
          >
            <Plus className='size-[15px]' />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content side='bottom'>
          {atTabLimit ? `Maximum of ${MAX_BROWSER_TABS} tabs` : 'New tab'}
        </Tooltip.Content>
      </Tooltip.Root>
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
    </div>
  )
}
