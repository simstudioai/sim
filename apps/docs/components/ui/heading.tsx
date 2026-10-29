import type { HTMLAttributes } from 'react'
import { Link } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'

type HeadingTag = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
interface HeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: HeadingTag
}

const SIZES = {
  h1: 'mt-10 mb-5 text-docs-title tracking-[-0.02em]',
  h2: 'mt-8 mb-3 text-docs-h2 tracking-[-0.02em]',
  h3: 'mt-7 mb-3 text-docs-h3',
  h4: 'mt-6 mb-2 text-docs-body',
  h5: 'mt-5 mb-2 text-docs-table',
  h6: 'mt-5 mb-2 text-docs-table',
} as const

/** Server-rendered headings expose real links without hydrating article prose. */
export function Heading({ as: Tag = 'h2', className, children, id, ...props }: HeadingProps) {
  return (
    <Tag
      {...props}
      id={id}
      className={cn(
        'group/heading scroll-mt-[var(--docs-sticky-offset)] font-medium text-[var(--docs-heading)]',
        SIZES[Tag],
        className
      )}
    >
      {children}
      {id && (
        <a
          href={`#${id}`}
          aria-label='Link to this section'
          className='ml-2 inline-flex rounded align-middle text-[var(--docs-muted)] opacity-0 pointer-coarse:opacity-100 transition-opacity hover:text-[var(--docs-link)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 group-hover/heading:opacity-100 motion-reduce:transition-none'
        >
          <Link className='size-4' />
        </a>
      )}
    </Tag>
  )
}
