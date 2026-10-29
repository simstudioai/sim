'use client'

import { useState } from 'react'
import type { PageSnapshot } from '@sim/browser-extension-protocol'
import {
  Button,
  Chip,
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalHeader,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { Globe, X } from '@sim/emcn/icons'

interface PageContextProps {
  snapshot: PageSnapshot
  onRemove: () => void
}

export function PageContext({ snapshot, onRemove }: PageContextProps) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<HTMLPreElement | null>(null)
  const edges = useScrollEdges(preview)
  const hostname = new URL(snapshot.url).hostname
  const title = snapshot.title || hostname

  return (
    <section
      className='ph-no-capture flex min-w-0 items-center gap-1'
      aria-label='Page attached to next message'
    >
      <Chip
        variant='border'
        leftIcon={Globe}
        className='min-w-0 flex-1'
        aria-label={`Review page context: ${title}`}
        onClick={() => setOpen(true)}
      >
        {snapshot.kind === 'selection' ? `Selection · ${title}` : title}
      </Chip>
      {snapshot.truncated && <span className='text-[var(--text-muted)] text-caption'>Partial</span>}
      <Button variant='ghost' size='icon' onClick={onRemove} aria-label='Remove page context'>
        <X className='size-[14px]' />
      </Button>
      <ChipModal open={open} onOpenChange={setOpen} srTitle='Page context' size='sm'>
        <ChipModalHeader onClose={() => setOpen(false)}>{title}</ChipModalHeader>
        <ChipModalBody>
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <ChipLink
              href={snapshot.url}
              target='_blank'
              rel='noopener noreferrer'
              title={snapshot.url}
            >
              {hostname}
            </ChipLink>
            <time className='text-[var(--text-muted)] text-caption' dateTime={snapshot.capturedAt}>
              {new Date(snapshot.capturedAt).toLocaleString(undefined, {
                dateStyle: 'short',
                timeStyle: 'short',
              })}
            </time>
          </div>
          <pre
            ref={setPreview}
            {...scrollFadeAttributes(edges)}
            className={cn(
              'max-h-[50dvh] overflow-auto whitespace-pre-wrap break-words py-3 font-sans text-small',
              scrollFadeClass
            )}
          >
            {snapshot.text}
          </pre>
          <p className='text-[var(--text-muted)] text-caption'>
            Saved in this chat when you send your message.
          </p>
        </ChipModalBody>
      </ChipModal>
    </section>
  )
}
