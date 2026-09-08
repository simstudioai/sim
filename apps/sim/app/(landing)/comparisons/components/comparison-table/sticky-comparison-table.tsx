'use client'

import type { ReactNode } from 'react'
import { TableOfContents } from '@sim/emcn'
import { COMPARISON_SECTIONS } from '@/app/(landing)/comparisons/comparison-sections'
import { useComparisonNavigation } from '@/app/(landing)/comparisons/components/comparison-table/use-comparison-navigation'

const SECTION_LINKS = COMPARISON_SECTIONS.map((section) => ({
  id: section.id,
  label: section.title,
}))

interface StickyComparisonTableProps {
  label: string
  header: ReactNode
  children: ReactNode
}

/**
 * Equal rails center the data-column divider; equal grid tracks align headers and body rows.
 * A sticky cover hides pinned category top rules, overlapping their edges for fractional pixels.
 * Native border dividers share the data cells' device-pixel rounding at browser zoom levels.
 */
export function StickyComparisonTable({ label, header, children }: StickyComparisonTableProps) {
  const { layoutRef, tableRef, headerRef, activeId } = useComparisonNavigation(children)

  return (
    <div
      ref={layoutRef}
      className='grid grid-cols-1 [--comparison-header-height:106.5px] [--comparison-navbar-height:calc(1.95rem_+_62px)] [--comparison-rail-width:220px] [--comparison-section-height:36px] lg:grid-cols-[minmax(0,1fr)_var(--comparison-rail-width)] sm:[--comparison-header-height:72px] lg:[--comparison-section-height:0px]'
    >
      <div
        ref={tableRef}
        role='table'
        aria-label={label}
        className='relative isolate grid min-w-0 grid-cols-1 overflow-clip border-[var(--border)] border-x border-b lg:auto-rows-fr lg:grid-cols-[var(--comparison-rail-width)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[1fr] lg:overflow-visible lg:border-x-0'
      >
        <div
          ref={headerRef}
          role='row'
          className='sticky top-[var(--comparison-navbar-height)] z-20 col-span-full grid grid-cols-2 bg-[var(--bg)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-0 after:border-[var(--border)] after:border-t lg:row-start-1 lg:grid-cols-subgrid lg:after:left-[var(--comparison-rail-width)]'
        >
          <div role='columnheader' className='hidden bg-[var(--comparison-column-bg)] lg:block'>
            <span className='sr-only'>Feature</span>
          </div>
          {header}
        </div>
        <div
          aria-hidden='true'
          className='-ml-[var(--comparison-page-gutter)] pointer-events-none sticky top-[var(--comparison-navbar-height)] z-40 col-start-1 row-start-1 hidden before:absolute before:inset-x-0 before:top-[-1px] before:h-[calc(var(--border-width)+2px)] before:bg-[var(--comparison-column-bg)] lg:block'
        />
        {children}
      </div>
      <aside className='sticky top-[var(--comparison-navbar-height)] hidden max-h-[calc(100svh-var(--comparison-navbar-height))] self-start overflow-y-auto bg-[var(--comparison-column-bg)] px-6 pt-6 pb-8 text-base lg:block'>
        <TableOfContents title='Comparison' items={SECTION_LINKS} activeId={activeId} />
      </aside>
    </div>
  )
}
