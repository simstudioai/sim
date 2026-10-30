'use client'

import { useRef, useState } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { useCopyToClipboard } from '@sim/emcn'
import { Check, ChevronDown, Duplicate, SquareArrowUpRight } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'
import { docsControlClass, docsMenuClass, docsMenuItemClass } from '@/components/docs/primitives'
import { getMarkdownPath } from '@/lib/urls'

interface PageActionsProps {
  url: string
}

export function PageActions({ url }: PageActionsProps) {
  const { copied, copy } = useCopyToClipboard()
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const prepared = useRef<string | null>(null)
  const markdownUrl = getMarkdownPath(url)
  const showCopied = copied && status === 'idle'
  async function copyPage() {
    setStatus('loading')
    const prepare = async () => {
      const signal =
        typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(10000) : undefined
      const response = await fetch(markdownUrl, { signal })
      if (!response.ok) throw new Error('Page could not be loaded')
      const markdown = await response.text()
      if (!markdown.trim()) throw new Error('Page is empty')
      return markdown
    }
    try {
      if (
        typeof ClipboardItem !== 'undefined' &&
        typeof navigator.clipboard?.write === 'function'
      ) {
        setStatus((await copy({ prepare, fallback: '' })) ? 'idle' : 'error')
      } else if (prepared.current === null) {
        prepared.current = await prepare()
        setStatus('ready')
      } else {
        setStatus((await copy(prepared.current)) ? 'idle' : 'error')
      }
    } catch {
      setStatus('error')
    }
  }
  return (
    <div className='relative'>
      <Dropdown.Root modal={false}>
        <Dropdown.Trigger className={cn(docsControlClass, 'h-8')} aria-label='Copy page options'>
          {showCopied ? <Check className='size-4' /> : null}
          {showCopied ? 'Copied' : 'Copy page'}
          <ChevronDown className='size-4' />
        </Dropdown.Trigger>
        <Dropdown.Portal>
          <Dropdown.Content
            align='end'
            sideOffset={6}
            className={cn('docs-root z-[100] min-w-52', docsMenuClass)}
          >
            <Dropdown.Item
              disabled={status === 'loading'}
              onSelect={(event) => {
                event.preventDefault()
                void copyPage()
              }}
              className={docsMenuItemClass}
            >
              <Duplicate className='size-4' />
              {status === 'loading'
                ? 'Copying…'
                : status === 'ready'
                  ? 'Copy prepared Markdown'
                  : showCopied
                    ? 'Copied'
                    : 'Copy Markdown'}
            </Dropdown.Item>
            <Dropdown.Item asChild>
              <a href={markdownUrl} target='_blank' rel='noreferrer' className={docsMenuItemClass}>
                <SquareArrowUpRight className='size-4' />
                View Markdown
              </a>
            </Dropdown.Item>
          </Dropdown.Content>
        </Dropdown.Portal>
      </Dropdown.Root>
      <span
        role='status'
        className='absolute top-full right-0 z-10 whitespace-nowrap text-[var(--docs-muted)] text-docs-caption'
      >
        {status === 'error'
          ? 'Could not copy. Try again or view Markdown.'
          : status === 'ready'
            ? 'Select again to copy.'
            : ''}
      </span>
    </div>
  )
}
