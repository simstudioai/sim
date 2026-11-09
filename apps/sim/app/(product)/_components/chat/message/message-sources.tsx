'use client'

import { useRef, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { AnchoredPopover } from '@sim/emcn/menu/anchored-popover'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import { SourceRow, type SourceRowData } from '@/app/(product)/_components/source-row/source-row'

/**
 * The documents a reply cited, behind one button in its action row: the prose already cites each
 * claim inline, so the list is there for whoever wants it, one row per document.
 */
export function MessageSources({ sources }: { sources: readonly SourceRowData[] }) {
  const anchor = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const label = `${sources.length} ${sources.length === 1 ? 'source' : 'sources'}`
  return (
    <span ref={anchor} className={styles.sourcesAnchor}>
      <AnchoredPopover
        label='Sources'
        triggerLabel={label}
        presentation='panel'
        anchor={anchor}
        open={open}
        onOpenChange={setOpen}
        trigger={(button) => (
          <Button render={button} variant='quiet' size='compact' icon='I082'>
            {label}
          </Button>
        )}
      >
        <div className={styles.sources}>
          {sources.map((source) => (
            <SourceRow key={source.id} row={source} onLeave={() => setOpen(false)} />
          ))}
        </div>
      </AnchoredPopover>
    </span>
  )
}
