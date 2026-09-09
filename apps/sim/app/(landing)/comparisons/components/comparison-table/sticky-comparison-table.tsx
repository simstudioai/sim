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
  labelHeader: ReactNode
  header: ReactNode
  children: ReactNode
}

/**
 * Equal rails center the data-column divider; equal grid tracks align headers and body rows.
 * A cover clipped below the verification row hides pinned category top rules without masking its fill.
 * Native border dividers share the data cells' device-pixel rounding at browser zoom levels.
 */
export function StickyComparisonTable({
  label,
  labelHeader,
  header,
  children,
}: StickyComparisonTableProps) {
  const { layoutRef, tableRef, headerRef, activeId } = useComparisonNavigation(children)

  return (
    <div
      ref={layoutRef}
      className='grid grid-cols-1 [--comparison-header-height:106.5px] [--comparison-navbar-height:calc(1.95rem_+_62px)] [--comparison-rail-width:220px] [--comparison-row-height:72px] [--comparison-section-height:36px] lg:grid-cols-[minmax(0,1fr)_var(--comparison-rail-width)] lg:[--comparison-header-height:var(--comparison-row-height)] lg:[--comparison-section-height:0px]'
    >
      <div
        ref={tableRef}
        role='table'
        aria-label={label}
        className='relative isolate grid min-w-0 grid-cols-1 border-[var(--border)] border-x border-b lg:auto-rows-[var(--comparison-row-height)] lg:grid-cols-[var(--comparison-rail-width)_minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-[var(--comparison-row-height)] lg:border-x-0'
      >
        <div
          ref={headerRef}
          role='row'
          className='before:-inset-x-[calc(var(--comparison-page-gutter)+var(--border-width))] sticky top-[var(--comparison-navbar-height)] z-20 col-span-full grid grid-cols-2 bg-[var(--bg)] before:pointer-events-none before:absolute before:top-0 before:h-0 before:border-[var(--border)] before:border-t after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-0 after:border-[var(--border)] after:border-t lg:row-start-1 lg:min-h-0 lg:grid-cols-subgrid lg:after:left-[var(--comparison-rail-width)] lg:before:hidden'
        >
          <div
            role='columnheader'
            className='-ml-[var(--comparison-page-gutter)] hidden min-w-0 bg-[var(--comparison-column-bg)] lg:flex'
          >
            <span className='sr-only'>Feature</span>
            {labelHeader}
          </div>
          {header}
          <span
            aria-hidden='true'
            className='-translate-x-1/2 pointer-events-none absolute inset-y-0 left-1/2 flex items-center justify-center text-[var(--text-muted)] text-sm lg:hidden'
          >
            vs
          </span>
        </div>
        <div
          aria-hidden='true'
          className='-left-[var(--comparison-page-gutter)] pointer-events-none absolute inset-y-0 z-40 hidden w-[calc(var(--comparison-page-gutter)+var(--comparison-rail-width))] [clip-path:inset(var(--comparison-row-height)_0_0)] lg:block'
        >
          <div className='sticky top-[var(--comparison-navbar-height)] h-[var(--comparison-row-height)] before:absolute before:inset-x-0 before:top-[-1px] before:h-[calc(var(--border-width)+2px)] before:bg-[var(--comparison-column-bg)]' />
        </div>
        {children}
      </div>
      <aside className='sticky top-[var(--comparison-navbar-height)] hidden max-h-[calc(100svh-var(--comparison-navbar-height))] self-start overflow-y-auto bg-[var(--comparison-column-bg)] px-6 pt-6 pb-8 text-base lg:block'>
        <TableOfContents title='Comparison' items={SECTION_LINKS} activeId={activeId} />
      </aside>
    </div>
  )
}
