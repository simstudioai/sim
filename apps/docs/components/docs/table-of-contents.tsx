'use client'

import { ChevronDown } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'
import { docsMenuClass } from '@/components/docs/primitives'
import type { DocsHeading } from '@/lib/content/types'

interface TableOfContentsProps {
  headings: DocsHeading[]
  active: string | undefined
  compact?: boolean
}

/** Native anchor navigation with one shared active section across responsive layouts. */
export function TableOfContents({ headings, active, compact = false }: TableOfContentsProps) {
  if (!headings.length) return null
  const links = (
    <ul className='space-y-4'>
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
              'block rounded-md pointer-coarse:py-3 text-docs-control leading-5 transition-colors focus-visible:outline-2 focus-visible:outline-[var(--docs-link)]',
              depth > 2 && 'pl-3',
              active === id
                ? 'text-[var(--docs-link)]'
                : 'text-[var(--docs-muted)] hover:text-[var(--docs-heading)]'
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
        <ChevronDown className='size-4 transition-transform group-open:rotate-180' />
      </summary>
      <nav
        aria-label='On this page'
        className={cn(
          docsMenuClass,
          'absolute top-full right-0 z-40 max-h-[60dvh] w-[min(320px,calc(100vw-40px))] overflow-y-auto overscroll-contain p-4'
        )}
      >
        {links}
      </nav>
    </details>
  ) : (
    <nav aria-label='On this page' className='pl-2'>
      <h2 className='mb-4 font-medium text-[var(--docs-heading)] text-docs-control leading-5'>
        On this page
      </h2>
      {links}
    </nav>
  )
}
