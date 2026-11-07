'use client'

import type { ReactNode } from 'react'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { docsScrollAreaClass } from '@sim/emcn-docs/chrome'
import { DocsNavigationTrigger } from '@/components/docs/navigation-drawer/navigation-drawer'
import { DocsSearchTrigger } from '@/components/docs/search/search'
import { TableOfContents } from '@/components/docs/table-of-contents/table-of-contents'
import type { DocsHeading } from '@/lib/content/types'
import { useActiveHeading } from '@/hooks/use-active-heading'

interface DocsPageFrameProps {
  children: ReactNode
  headings: DocsHeading[]
  api?: boolean
}

/** Page-specific reading columns and responsive outline inside the persistent shell. */
export function DocsPageFrame({ children, headings, api = false }: DocsPageFrameProps) {
  const scrollRef = useScrollEdges()
  const activeHeading = useActiveHeading(headings)
  return (
    <div className='min-w-0'>
      <div className='sticky top-[104px] z-30 flex h-11 items-center justify-between border-[var(--docs-border)] border-y bg-[var(--docs-glass)] px-5 backdrop-blur-[var(--docs-chrome-blur)] lg:hidden'>
        <DocsNavigationTrigger className='flex min-h-11 items-center gap-2 text-docs-control'>
          <Icon name='menu' className='size-4' />
          Menu
        </DocsNavigationTrigger>
        <DocsSearchTrigger compact />
        <TableOfContents headings={headings} active={activeHeading} compact />
      </div>
      <div
        className={cn(
          'grid min-w-0 grid-cols-[minmax(0,1fr)] items-start gap-x-12 px-5 pt-7 md:pt-10 lg:px-0 lg:pt-0',
          !api && 'xl:grid-cols-[minmax(0,1fr)_208px]'
        )}
      >
        <div className='min-w-0'>
          {!api && (
            <div className='mb-4 hidden justify-end lg:flex xl:hidden'>
              <TableOfContents headings={headings} active={activeHeading} compact />
            </div>
          )}
          {children}
        </div>
        {!api && (
          <aside
            ref={scrollRef}
            className={cn(
              docsScrollAreaClass,
              'sticky top-24 hidden max-h-[calc(100dvh-120px)] overflow-y-auto pb-5 xl:block'
            )}
          >
            <TableOfContents headings={headings} active={activeHeading} />
          </aside>
        )}
      </div>
    </div>
  )
}
