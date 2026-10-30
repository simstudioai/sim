'use client'

import { useState } from 'react'
import type { PageSnapshot } from '@sim/browser-extension-protocol'
import {
  ChipLink,
  ChipModal,
  ChipModalBody,
  ChipModalHeader,
  cn,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { Globe } from '@sim/emcn/icons'
import { ResourceMention } from '@/app/workspace/[workspaceId]/home/components/message-content/components/resource-mention'

interface PageContextProps {
  snapshot: PageSnapshot
  onRemove?: () => void
  label?: string
}

export function PageContext({ snapshot, onRemove, label }: PageContextProps) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<HTMLPreElement | null>(null)
  const edges = useScrollEdges(preview)
  const hostname = new URL(snapshot.url).hostname
  const title = snapshot.title || hostname

  return (
    <span
      className='ph-no-capture inline-flex min-w-0 max-w-[min(220px,100%)] align-middle'
      role={onRemove ? 'group' : undefined}
      aria-label={onRemove ? 'Page attached to next message' : undefined}
    >
      <ResourceMention
        variant={onRemove ? 'field' : 'mono'}
        icon={<Globe className='size-[12px] shrink-0 text-[var(--text-icon)]' />}
        title={
          label ??
          `${snapshot.kind === 'selection' ? `Selection · ${title}` : title}${snapshot.truncated ? ' · Partial' : ''}`
        }
        ariaLabel={`Review page context: ${title}${snapshot.truncated ? ' (partial capture)' : ''}`}
        onSelect={() => setOpen(true)}
        onRemove={onRemove}
        removeLabel='Remove page context'
      />
      <ChipModal
        open={open}
        onOpenChange={setOpen}
        srTitle='Page context'
        size='sm'
        className='ph-no-capture'
      >
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
          {snapshot.truncated && (
            <p className='text-[var(--text-muted)] text-caption'>
              Partial capture. Some page text is omitted.
            </p>
          )}
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
          {onRemove && (
            <p className='text-[var(--text-muted)] text-caption'>
              Saved in this chat when you send your message.
            </p>
          )}
        </ChipModalBody>
      </ChipModal>
    </span>
  )
}
