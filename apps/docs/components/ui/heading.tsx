import type { HTMLAttributes } from 'react'
import { cn } from '@/components/docs/classnames'
import { HeadingLink } from '@/components/ui/heading-link'

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
        'group/heading font-medium text-[var(--docs-heading)] [&+p]:mt-3',
        SIZES[Tag],
        className
      )}
    >
      {children}
      {id && <HeadingLink id={id} />}
    </Tag>
  )
}
