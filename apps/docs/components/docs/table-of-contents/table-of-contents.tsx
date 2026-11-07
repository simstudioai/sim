'use client'

import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { docsMenuClass, docsScrollAreaClass } from '@sim/emcn-docs/chrome'
import type { DocsHeading } from '@/lib/content/types'

interface TableOfContentsProps {
  headings: DocsHeading[]
  active: string | undefined
  compact?: boolean
}

/** Native anchor navigation with one shared active section across responsive layouts. */
export function TableOfContents({ headings, active, compact = false }: TableOfContentsProps) {
  const scrollRef = useScrollEdges()
  if (!headings.length) return null
  const links = (
    <ul className='flex flex-col gap-4'>
      {headings.map(({ id, title, depth }) => (
        <li key={id}>
          <a
            href={`#${id}`}
            aria-current={active === id ? 'location' : undefined}
            onClick={(event) => {
              const details = event.currentTarget.closest('details')
              if (details) details.open = false
            }}
            className={cn(
              'dark:-mx-2 block rounded-md pointer-coarse:py-3 text-docs-control leading-5 transition-colors dark:px-2 dark:hover:bg-[var(--docs-hover)]',
              depth > 2 && 'pl-3 dark:pl-5',
              active === id
                ? 'text-[var(--docs-toc-current)] dark:underline dark:underline-offset-[3px]'
                : 'text-[var(--docs-muted)] hover:text-[var(--docs-heading)] dark:hover:text-[var(--docs-muted)]'
            )}
          >
            {title}
          </a>
        </li>
      ))}
    </ul>
  )
  return compact ? (
    <details className='group relative min-w-0'>
      <summary className='flex min-h-11 list-none items-center gap-2 text-docs-control [&::-webkit-details-marker]:hidden'>
        On this page
        <Icon name='I051' className='size-4 transition-transform group-open:rotate-180' />
      </summary>
      <nav
        ref={scrollRef}
        aria-label='On this page'
        className={cn(
          docsMenuClass,
          docsScrollAreaClass,
          'absolute top-full right-0 z-40 max-h-[60dvh] w-[min(320px,calc(100vw-40px))] overflow-y-auto overscroll-contain p-4'
        )}
      >
        {links}
      </nav>
    </details>
  ) : (
    <nav aria-label='On this page' className='px-2'>
      <h2 className='mb-4 font-medium text-[var(--docs-heading)] text-docs-control leading-5'>
        On this page
      </h2>
      {links}
    </nav>
  )
}
