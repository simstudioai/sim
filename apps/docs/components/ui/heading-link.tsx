'use client'

import { useState } from 'react'
import { useCopyToClipboard } from '@sim/emcn'
import { Check, Link, TriangleAlert } from '@sim/emcn/icons'
import { cn } from '@/components/docs/classnames'

interface HeadingLinkProps {
  id: string
}

/** Copies a section permalink while retaining native anchor navigation. */
export function HeadingLink({ id }: HeadingLinkProps) {
  const { copied, copy } = useCopyToClipboard()
  const [failed, setFailed] = useState(false)
  const announcement = failed
    ? 'Could not copy. Copy the link from the address bar.'
    : copied
      ? 'Link copied'
      : ''
  const Icon = failed ? TriangleAlert : copied ? Check : Link

  return (
    <>
      <a
        href={`#${encodeURIComponent(id)}`}
        aria-label={announcement || 'Copy link to this section'}
        title={announcement || 'Copy link to this section'}
        onClick={async (event) => {
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          )
            return
          setFailed(!(await copy(event.currentTarget.href)))
        }}
        className={cn(
          'pointer-coarse:before:-inset-3.5 relative ml-2 inline-flex rounded align-middle text-[var(--docs-muted)] opacity-0 pointer-coarse:opacity-100 transition-opacity pointer-coarse:before:absolute hover:text-[var(--docs-link)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--docs-link)] focus-visible:outline-offset-2 group-hover/heading:opacity-100 motion-reduce:transition-none',
          (copied || failed) && 'opacity-100'
        )}
      >
        <Icon className='size-4' />
      </a>
      <span className='sr-only' role='status'>
        {announcement}
      </span>
    </>
  )
}
