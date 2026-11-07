'use client'

import { useRef, useState } from 'react'
import { Menu } from '@base-ui/react/menu'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { Icon } from '@sim/emcn/icon'
import { cn } from '@sim/emcn/lib/cn'
import { docsControlClass, docsMenuClass, docsMenuItemClass } from '@sim/emcn-docs/chrome'
import { getMarkdownPath } from '@/lib/urls'

interface PageActionsProps {
  url: string
}

export function PageActions({ url }: PageActionsProps) {
  const { copied, copy } = useClipboard()
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
      <Menu.Root modal={false}>
        <Menu.Trigger className={cn(docsControlClass, 'h-8')} aria-label='Copy page options'>
          {showCopied ? <Icon name='I072' className='size-4' /> : null}
          {showCopied ? 'Copied' : 'Copy page'}
          <Icon name='I051' className='size-4' />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align='end' sideOffset={6} collisionPadding={12} className='z-[100]'>
            <Menu.Popup data-emcn='' className={cn('docs-portal min-w-52', docsMenuClass)}>
              <Menu.Item
                disabled={status === 'loading'}
                closeOnClick={false}
                onClick={() => {
                  void copyPage()
                }}
                className={docsMenuItemClass}
              >
                <Icon name='I006' className='size-4' />
                {status === 'loading'
                  ? 'Copying…'
                  : status === 'ready'
                    ? 'Copy prepared Markdown'
                    : showCopied
                      ? 'Copied'
                      : 'Copy Markdown'}
              </Menu.Item>
              <Menu.LinkItem
                href={markdownUrl}
                target='_blank'
                rel='noreferrer'
                className={docsMenuItemClass}
              >
                <Icon name='I037' className='size-4' />
                View Markdown
              </Menu.LinkItem>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <span
        role='status'
        className={
          showCopied
            ? 'sr-only'
            : 'absolute top-full right-0 z-10 whitespace-nowrap text-[var(--docs-muted)] text-docs-caption'
        }
      >
        {status === 'error'
          ? 'Could not copy. Try again or view Markdown.'
          : status === 'ready'
            ? 'Select again to copy.'
            : showCopied
              ? 'Copied to clipboard.'
              : ''}
      </span>
    </div>
  )
}
