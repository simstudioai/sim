import type { ComponentPropsWithoutRef, HTMLAttributes } from 'react'
import type { MDXComponents } from 'mdx/types'
import Link from 'next/link'
import { cn } from '@/components/docs/classnames'
import { docsInlineLinkClass } from '@/components/docs/primitives'
import { CodeBlock } from '@/components/ui/code-block'
import { Heading } from '@/components/ui/heading'
import { ScrollRegion } from '@/components/ui/scroll-region'

interface ProseTableProps extends ComponentPropsWithoutRef<'table'> {}
interface ProseLinkProps extends ComponentPropsWithoutRef<'a'> {}
interface CodeFrameProps extends HTMLAttributes<HTMLPreElement> {
  'data-language'?: string
  'data-title'?: string
  'data-code'?: string
}

export function ProseTable({ className, ...props }: ProseTableProps) {
  return (
    <ScrollRegion className='my-6' label='Scrollable reference table'>
      <table
        {...props}
        className={cn(
          'w-full border-collapse text-left text-docs-table dark:[&_td:first-child]:text-[var(--docs-text)] [&_td:last-child]:pr-0 [&_td>p]:my-0 [&_td>p]:text-docs-table dark:[&_td>p]:text-inherit [&_td]:py-3.5 [&_td]:pr-6 [&_td]:align-top dark:[&_td]:text-[var(--docs-muted)] [&_th:last-child]:pr-0 [&_th]:py-3 [&_th]:pr-6 [&_th]:align-bottom [&_th]:font-medium [&_thead]:border-[var(--docs-border)] [&_thead]:border-b [&_tr:not(:last-child)]:border-b [&_tr]:border-[var(--docs-border)]',
          className
        )}
      />
    </ScrollRegion>
  )
}

function ProseLink({ href = '', className, ...props }: ProseLinkProps) {
  const classes = cn(docsInlineLinkClass, className)
  if (href.startsWith('/') && !href.startsWith('//'))
    return <Link {...props} href={href} className={classes} />
  return <a {...props} href={href} className={classes} />
}

function CodeFrame({
  children,
  className,
  'data-language': language,
  'data-title': title,
  'data-code': code,
  ...props
}: CodeFrameProps) {
  return (
    <CodeBlock data-language={language} data-title={title} data-code={code}>
      <pre {...props} className={className}>
        {children}
      </pre>
    </CodeBlock>
  )
}

/** Central Markdown typography; pages import optional reading components explicitly. */
export function getMDXComponents(overrides: MDXComponents = {}): MDXComponents {
  return {
    h1: (props) => <Heading as='h1' {...props} />,
    h2: (props) => <Heading as='h2' {...props} />,
    h3: (props) => <Heading as='h3' {...props} />,
    h4: (props) => <Heading as='h4' {...props} />,
    h5: (props) => <Heading as='h5' {...props} />,
    h6: (props) => <Heading as='h6' {...props} />,
    p: ({ className, ...props }) => (
      <p
        {...props}
        className={cn(
          'my-5 text-[var(--docs-text)] text-docs-body [overflow-wrap:anywhere]',
          className
        )}
      />
    ),
    a: ProseLink,
    strong: ({ className, ...props }) => (
      <strong {...props} className={cn('font-medium', className)} />
    ),
    code: ({ className, ...props }) => (
      <code
        {...props}
        className={cn(
          'rounded bg-[var(--docs-surface)] px-1 py-px font-mono font-normal [font-size:0.875em]',
          className
        )}
      />
    ),
    pre: CodeFrame,
    ul: ({ className, ...props }) => (
      <ul
        {...props}
        className={cn(
          'my-5 list-disc space-y-2 pl-6 text-docs-body marker:text-[var(--docs-muted)]',
          className
        )}
      />
    ),
    ol: ({ className, ...props }) => (
      <ol
        {...props}
        className={cn(
          'my-5 list-decimal space-y-2 pl-6 text-docs-body marker:text-[var(--docs-muted)]',
          className
        )}
      />
    ),
    li: ({ className, ...props }) => <li {...props} className={cn('pl-1 [&>p]:my-2', className)} />,
    blockquote: ({ className, ...props }) => (
      <blockquote
        {...props}
        className={cn(
          'my-6 border-[var(--docs-rule)] border-l-2 py-1 pl-5 text-[var(--docs-muted)] text-docs-body [&>p]:my-0',
          className
        )}
      />
    ),
    table: ProseTable,
    hr: ({ className, ...props }) => (
      <hr {...props} className={cn('my-8 border-[var(--docs-border)]', className)} />
    ),
    img: ({ className, alt, ...props }) => (
      <img
        {...props}
        alt={alt ?? ''}
        loading='lazy'
        decoding='async'
        className={cn('my-6 h-auto max-w-full rounded-lg', className)}
      />
    ),
    ...overrides,
  }
}
