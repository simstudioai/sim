'use client'

import { type HTMLAttributes, type ReactNode, useRef } from 'react'
import { cn } from '@/components/docs/classnames'
import { CopyButton } from '@/components/ui/copy-button'
import { ScrollRegion } from '@/components/ui/scroll-region'

interface CodeBlockProps extends HTMLAttributes<HTMLElement> {
  title?: string
  lang?: string
  code?: string
  toolbar?: ReactNode
  'data-language'?: string
  'data-title'?: string
  'data-code'?: string
}

interface CodeContentProps {
  children: ReactNode
  label?: string
}

export function CodeContent({ children, label = 'Code sample' }: CodeContentProps) {
  return (
    <ScrollRegion
      label={label}
      className='focus-visible:-outline-offset-2 p-4 [&_code]:block [&_code]:bg-transparent [&_code]:p-0 [&_code]:font-normal [&_code]:text-docs-code [&_pre]:m-0 [&_pre]:w-max [&_pre]:min-w-full [&_pre]:bg-transparent! [&_pre]:p-0 [&_pre]:font-mono [&_pre]:text-docs-code'
    >
      {children}
    </ScrollRegion>
  )
}

/** Shared code frame; highlighting remains a build-time/server concern. */
export function CodeBlock({
  children,
  className,
  title,
  lang,
  code,
  toolbar,
  'data-language': language,
  'data-title': sourceTitle,
  'data-code': sourceCode,
  ...props
}: CodeBlockProps) {
  const frame = useRef<HTMLElement>(null)
  return (
    <figure
      {...props}
      ref={frame}
      className={cn(
        'not-prose my-6 min-w-0 overflow-hidden rounded-lg bg-[var(--docs-surface)]',
        className
      )}
    >
      <figcaption className='flex min-h-11 items-center justify-between gap-3 px-4 py-2'>
        <span className='min-w-0 font-medium text-[var(--docs-text)] text-docs-control'>
          {title || sourceTitle || lang || language || 'Code'}
        </span>
        <div className='flex min-w-0 items-center gap-2'>
          {toolbar}
          <CopyButton
            getText={() =>
              code ?? sourceCode ?? frame.current?.querySelector('pre')?.textContent ?? ''
            }
          />
        </div>
      </figcaption>
      <CodeContent label={title || sourceTitle || 'Code sample'}>
        {code !== undefined ? (
          <pre>
            <code>{code}</code>
          </pre>
        ) : (
          children
        )}
      </CodeContent>
    </figure>
  )
}
