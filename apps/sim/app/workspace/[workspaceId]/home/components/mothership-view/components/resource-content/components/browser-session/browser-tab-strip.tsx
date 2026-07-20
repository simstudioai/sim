'use client'

import { type BrowserTabState, MAX_BROWSER_TABS } from '@sim/browser-protocol'
import { Button, cn, Tooltip } from '@sim/emcn'
import { Link, Loader, Plus, X } from '@sim/emcn/icons'
import { faviconUrl } from '@/lib/core/utils/favicon'

interface BrowserTabStripProps {
  tabs: BrowserTabState[]
  activeTabId: string | null
  onNewTab: () => void
  onSwitchTab: (tabId: string) => void
  onCloseTab: (tabId: string) => void
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
}: BrowserTabStripProps) {
  const atTabLimit = tabs.length >= MAX_BROWSER_TABS

  return (
    <div className='flex h-[34px] shrink-0 items-end gap-1 border-[var(--border)] border-b bg-[var(--surface-secondary)] px-2 pt-1'>
      <div className='flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'>
        {tabs.map((tab) => {
          const title = tabTitle(tab)
          const isActive = tab.tabId === activeTabId
          return (
            <div
              key={tab.tabId}
              className='group relative min-w-[96px] max-w-[180px] flex-1 basis-[140px]'
            >
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    type='button'
                    variant='subtle'
                    size='sm'
                    aria-current={isActive ? 'page' : undefined}
                    className={cn(
                      'h-[29px] w-full justify-start gap-1.5 rounded-b-none bg-transparent px-2 py-0 pr-7 font-normal text-caption',
                      isActive &&
                        '-mb-px relative z-10 h-[30px] border border-[var(--border)] border-b-0 bg-[var(--bg)]'
                    )}
                    onClick={() => onSwitchTab(tab.tabId)}
                  >
                    <BrowserTabIcon tab={tab} />
                    <span className='min-w-0 flex-1 truncate text-left'>{title}</span>
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content side='bottom'>{title}</Tooltip.Content>
              </Tooltip.Root>
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
            </div>
          )
        })}
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
    </div>
  )
}
