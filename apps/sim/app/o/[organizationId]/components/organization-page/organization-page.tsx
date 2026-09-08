'use client'

import { type ReactNode, useRef, useState } from 'react'
import {
  Button,
  Chip,
  ChipInput,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  scrollFadeXClass,
  useScrollEdges,
} from '@sim/emcn'
import { Search, X } from '@sim/emcn/icons'
import { HEADER_ACTION_CLUSTER, PAGE_HEADER_BAR } from '@/components/page-header-bar'
import { useOrganizationPageFilters } from '@/app/o/[organizationId]/components/organization-page/use-organization-page-filters'
import {
  SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
  SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/constants'

/** The home surface's reading column, so every organization page shares its width. */
export const PAGE_COLUMN_CLASS = 'mx-auto w-full max-w-chat px-6'

export interface OrganizationPageTab {
  id: string
  label: string
}

interface OrganizationPageProps {
  title: string
  description?: string
  /** Header tabs; the first is the default. Omit for a page with one view. */
  tabs?: readonly OrganizationPageTab[]
  /** The page's primary action, a chip. Omit for a page without one. */
  action?: ReactNode
  children?: ReactNode
}

/**
 * The shell every organization page renders into: the top bar the workspace pages
 * wear, then a fixed page header — title, description, tabs, search, and the
 * optional action — over a scroll region that fades at both edges the way the
 * sidebar does. Pages supply their content and logic; nothing else.
 *
 * The shell paints at once and never waits on data: a page renders each piece —
 * a tab, a list, a count — the moment it is known and nothing before, with no
 * skeleton standing in for it. Pass `tabs` only once they are known; the row
 * simply gains them.
 */
export function OrganizationPage({
  title,
  description,
  tabs,
  action,
  children,
}: OrganizationPageProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const scrollContentRef = useRef<HTMLDivElement>(null)
  const scrollEdges = useScrollEdges(scrollContainerRef, { contentRef: scrollContentRef })
  const tabsRef = useRef<HTMLDivElement>(null)
  const tabEdges = useScrollEdges(tabsRef, { axis: 'x' })

  const { tab, search, setTab, setSearch } = useOrganizationPageFilters()
  const defaultTab = tabs?.[0]?.id
  const activeTab = tab ?? defaultTab

  /**
   * The field stays open while it holds text, across tab switches and reloads,
   * since the text lives in the URL; this only remembers an empty field the
   * viewer opened and has not dismissed.
   */
  const [searchOpened, setSearchOpened] = useState(false)
  const searchOpen = searchOpened || search.length > 0

  const closeSearch = () => {
    setSearch('')
    setSearchOpened(false)
  }

  return (
    <div className='flex h-full flex-col bg-[var(--bg)]'>
      {/* Reserved even while empty so the page header sits where the workspace's does. */}
      <div className={PAGE_HEADER_BAR}>
        <div className={HEADER_ACTION_CLUSTER} />
      </div>

      <div
        className={cn(PAGE_COLUMN_CLASS, SIDEBAR_DIVIDER_PAD_ABOVE_CLASS, 'flex shrink-0 flex-col')}
      >
        <div className='flex flex-col gap-1 pt-8'>
          <h1 className='text-[var(--text-primary)] text-lg'>{title}</h1>
          {description && <p className='text-[var(--text-muted)] text-small'>{description}</p>}
        </div>
        <div className='mt-4 flex items-center justify-between gap-2'>
          {/* The row yields to the controls beside it and scrolls sideways under a fade
              once it can no longer fit; the scrollbar itself never shows. */}
          <div
            ref={tabsRef}
            className={cn(
              scrollFadeXClass,
              'flex min-w-0 flex-1 items-center gap-[1px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'
            )}
            {...scrollFadeAttributes(tabEdges)}
          >
            {tabs?.map((item) => {
              const active = item.id === activeTab
              return (
                <Chip
                  key={item.id}
                  shape='round'
                  active={active}
                  aria-pressed={active}
                  onClick={() => setTab(item.id === defaultTab ? null : item.id)}
                  className='min-w-[44px] shrink-0 text-center'
                >
                  {item.label}
                </Chip>
              )
            })}
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {searchOpen ? (
              <ChipInput
                autoFocus
                icon={Search}
                value={search}
                placeholder='Search'
                aria-label='Search'
                spellCheck={false}
                autoComplete='off'
                className='w-[240px]'
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeSearch()
                }}
                endAdornment={
                  <Button
                    type='button'
                    variant='quiet'
                    size='icon'
                    className='-mr-1 shrink-0'
                    aria-label='Close search'
                    onClick={closeSearch}
                  >
                    <X className='size-[14px]' />
                  </Button>
                }
              />
            ) : (
              <Chip leftIcon={Search} aria-label='Search' onClick={() => setSearchOpened(true)} />
            )}
            {action}
          </div>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className={cn(
          SIDEBAR_DIVIDER_PAD_BELOW_CLASS,
          SIDEBAR_DIVIDER_PAD_ABOVE_CLASS,
          scrollFadeClass,
          'min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]'
        )}
        {...scrollFadeAttributes(scrollEdges)}
      >
        <div ref={scrollContentRef} className={PAGE_COLUMN_CLASS}>
          {children}
        </div>
      </div>
    </div>
  )
}
