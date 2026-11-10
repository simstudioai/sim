'use client'

import { useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import { SourceRow } from '@/app/(product)/_components/search/source-row'
import type { ChatSource } from '@/platform/lib/data/models/chat'
import { plural } from '@/platform/shared/plural'

interface MessageSourcesProps {
  sources: readonly ChatSource[]
  /** Opens the full list in the chat panel. */
  onViewAll?: () => void
}

/**
 * The documents an answer cited, once each, behind one action: the prose already cites each claim
 * inline, so the list waits here for whoever wants it, one row per document.
 */
export function MessageSources({ sources, onViewAll }: MessageSourcesProps) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const label = plural(sources.length, 'source')
  return (
    <span ref={anchor} className={styles.sourcesAnchor}>
      <AnchoredPopover
        presentation='panel'
        label='Sources'
        triggerLabel={label}
        anchor={anchor}
        open={open}
        onOpenChange={setOpen}
        trigger={(button) => (
          <Button variant='quiet' size='compact' icon='I082' render={button}>
            {label}
          </Button>
        )}
      >
        <div className={styles.sources}>
          <div className={styles.sourceList}>
            {sources.map((source) => (
              <SourceRow key={source.id} row={source} onLeave={() => setOpen(false)} />
            ))}
          </div>
          {onViewAll && (
            <Button
              variant='quiet'
              size='compact'
              icon='I082'
              onClick={() => {
                setOpen(false)
                onViewAll()
              }}
            >
              View all sources
            </Button>
          )}
        </div>
      </AnchoredPopover>
    </span>
  )
}
