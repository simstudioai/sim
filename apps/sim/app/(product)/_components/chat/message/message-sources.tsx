'use client'

import { useRef, useState } from 'react'
import { ActivityRow } from '@sim/emcn/activity-row'
import { Button } from '@sim/emcn/button'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import type { ChatSource } from '@/app/(product)/_components/chat/model'
import { plural } from '@/platform/shared/plural'

interface MessageSourcesProps {
  sources: readonly ChatSource[]
  /** Opens the full list in the chat panel. */
  onViewAll?: () => void
}

/**
 * The documents an answer cited, once each, behind one action: the prose already cites each claim
 * inline, so the list waits here for whoever wants it.
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
          <ul className={styles.sourceList}>
            {sources.map((source) => (
              <ActivityRow
                key={source.url}
                title={source.title}
                detail={source.site}
                onOpen={() => window.open(source.url, '_blank', 'noopener,noreferrer')}
              />
            ))}
          </ul>
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
