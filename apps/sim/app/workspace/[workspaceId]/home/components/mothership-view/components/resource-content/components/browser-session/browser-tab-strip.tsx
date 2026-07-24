'use client'

import {
  type DragEvent as ReactDragEvent,
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

export function isBrowserTabTitleTruncated(
  element: Pick<HTMLElement, 'clientWidth' | 'scrollWidth'>
): boolean {
  const hiddenWidth = element.scrollWidth - element.clientWidth
  const tooltipThreshold = Math.max(32, element.clientWidth * 0.25)
  return hiddenWidth >= tooltipThreshold
}

export function browserTabDropIndex(
  tabs: BrowserTabState[],
  draggedTabId: string,
  gapIndex: number
): number | null {
  const fromIndex = tabs.findIndex((tab) => tab.tabId === draggedTabId)
  if (fromIndex < 0 || !Number.isFinite(gapIndex)) return null

  const pinnedCount = tabs.filter((tab) => tab.pinned).length
  const draggedTab = tabs[fromIndex]
  const minGapIndex = draggedTab.pinned ? 0 : pinnedCount
  const maxGapIndex = draggedTab.pinned ? pinnedCount : tabs.length
  const boundedGapIndex = Math.max(minGapIndex, Math.min(maxGapIndex, Math.trunc(gapIndex)))
  const targetIndex = boundedGapIndex > fromIndex ? boundedGapIndex - 1 : boundedGapIndex
  return targetIndex === fromIndex ? null : targetIndex
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

interface BrowserTabProps {
  tab: BrowserTabState
  activeTabId: string | null
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>, tabId: string) => void
  draggable: boolean
  dragging: boolean
  showDropBefore: boolean
  showDropAfter: boolean
  onDragStart: (event: ReactDragEvent<HTMLDivElement>, tabId: string) => void
  onDragOver: (event: ReactDragEvent<HTMLDivElement>, tabIndex: number) => void
  onDragLeave: (event: ReactDragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  tabIndex: number
}

function BrowserTab({
  tab,
  activeTabId,
  onSwitchTab,
  onCloseTab,
  onContextMenu,
  draggable,
  dragging,
  showDropBefore,
  showDropAfter,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDragEnd,
  tabIndex,
}: BrowserTabProps) {
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
          ? 'w-[34px] min-w-[34px] max-w-[34px] flex-none'
          : 'min-w-[96px] max-w-[180px] flex-1 basis-[140px]',
        dragging && 'opacity-30'
      )}
      draggable={draggable}
      onDragStart={(event) => onDragStart(event, tab.tabId)}
      onDragOver={(event) => onDragOver(event, tabIndex)}
      onDragLeave={onDragLeave}
      onDragEnd={onDragEnd}
      onContextMenu={(event) => onContextMenu(event, tab.tabId)}
    >
      {showDropBefore && (
        <div className='-translate-x-1/2 -translate-y-1/2 pointer-events-none absolute top-1/2 left-0 z-30 h-[16px] w-[2px] rounded-full bg-[var(--text-subtle)]' />
      )}
      {showDropAfter && (
        <div className='-translate-y-1/2 pointer-events-none absolute top-1/2 right-0 z-30 h-[16px] w-[2px] translate-x-1/2 rounded-full bg-[var(--text-subtle)]' />
      )}
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          <Button
            type='button'
            variant='subtle'
            size='sm'
            aria-current={isActive ? 'page' : undefined}
            aria-label={tab.pinned ? title : undefined}
            className={cn(
              '-mb-px h-[30px] w-full select-none rounded-b-none border border-transparent border-b-0 bg-transparent py-0 font-normal text-caption',
              tab.pinned ? 'justify-center px-0' : 'justify-start gap-1.5 px-2 pr-7',
              isActive &&
                'hover-hover:!border-[var(--border)] hover-hover:!bg-[var(--bg)] hover-hover:!text-[var(--text-primary)] hover-hover:!brightness-100 hover-hover:!opacity-100 relative z-10 border-[var(--border)] bg-[var(--bg)] text-[var(--text-primary)] transition-none'
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
            'absolute top-[5px] right-1 z-20 size-[20px] p-0 transition-opacity',
            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
          onClick={(event) => {
            event.stopPropagation()
            onCloseTab(tab.tabId)
          }}
        >
          <X className='size-[11px]' />
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
  onReorderTab,
  pinningSupported,
  reorderingSupported,
}: BrowserTabStripProps) {
  const atTabLimit = tabs.length >= MAX_BROWSER_TABS
  const draggedTabIdRef = useRef<string | null>(null)
  const dropTargetIndexRef = useRef<number | null>(null)
  const [contextTabId, setContextTabId] = useState<string | null>(null)
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
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
  const resetTabDrag = useCallback(() => {
    draggedTabIdRef.current = null
    dropTargetIndexRef.current = null
    setDraggedTabId(null)
    setDropTargetIndex(null)
  }, [])
  const handleTabDragStart = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, tabId: string) => {
      if (!reorderingSupported) {
        event.preventDefault()
        return
      }
      draggedTabIdRef.current = tabId
      setDraggedTabId(tabId)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', tabId)
    },
    [reorderingSupported]
  )
  const handleTabDragOver = useCallback(
    (event: ReactDragEvent<HTMLDivElement>, tabIndex: number) => {
      const tabId = draggedTabIdRef.current
      if (!reorderingSupported || !tabId) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const gapIndex = event.clientX < rect.left + rect.width / 2 ? tabIndex : tabIndex + 1
      const targetIndex = browserTabDropIndex(tabs, tabId, gapIndex)
      dropTargetIndexRef.current = targetIndex
      setDropTargetIndex(targetIndex)
    },
    [reorderingSupported, tabs]
  )
  const handleTabDrop = useCallback(
    (event: ReactDragEvent<HTMLDivElement>) => {
      event.preventDefault()
      const tabId = draggedTabIdRef.current
      const targetIndex = dropTargetIndexRef.current
      if (tabId && targetIndex !== null) {
        onReorderTab(tabId, targetIndex)
      }
      resetTabDrag()
    },
    [onReorderTab, resetTabDrag]
  )
  const draggedTabIndex = tabs.findIndex((tab) => tab.tabId === draggedTabId)

  return (
    <div className='flex h-[34px] shrink-0 select-none items-end gap-1 border-[var(--border)] border-b bg-transparent px-2 pt-1'>
      <div
        className='flex min-w-0 flex-1 select-none items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
        onDragOver={(event) => {
          if (draggedTabIdRef.current) event.preventDefault()
        }}
        onDrop={handleTabDrop}
      >
        {tabs.map((tab, tabIndex) => (
          <BrowserTab
            key={tab.tabId}
            tab={tab}
            tabIndex={tabIndex}
            activeTabId={activeTabId}
            draggable={reorderingSupported}
            dragging={draggedTabId === tab.tabId}
            showDropBefore={
              dropTargetIndex === tabIndex && draggedTabIndex >= 0 && draggedTabIndex > tabIndex
            }
            showDropAfter={
              dropTargetIndex === tabIndex && draggedTabIndex >= 0 && draggedTabIndex < tabIndex
            }
            onSwitchTab={onSwitchTab}
            onCloseTab={onCloseTab}
            onContextMenu={openTabContextMenu}
            onDragStart={handleTabDragStart}
            onDragOver={handleTabDragOver}
            onDragLeave={(event) => {
              if (
                event.relatedTarget instanceof Node &&
                event.currentTarget.contains(event.relatedTarget)
              ) {
                return
              }
              dropTargetIndexRef.current = null
              setDropTargetIndex(null)
            }}
            onDragEnd={resetTabDrag}
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
            className='mb-px size-[28px] shrink-0 p-0'
            disabled={atTabLimit}
            onClick={onNewTab}
          >
            <Plus className='size-[14px]' />
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
