'use client'

import { useState } from 'react'
import { Button } from '@sim/emcn/button'
import { OverlayDialog } from '@sim/emcn/modal/overlay-dialog'
import styles from '@/app/(product)/_components/chat/message/message.module.css'
import type { ChatContext } from '@/platform/lib/data/chat-types'

type PageSnapshot = Extract<ChatContext, { kind: 'browser_page' }>['snapshot']

interface PageContextProps {
  snapshot: PageSnapshot
  label: string
}

/** Session replay's block marker: nothing inside it, portals included, is recorded. */
const REPLAY_BLOCK_CLASS = 'ph-no-capture'

/**
 * A browser page saved with a message. Its title, address and text never reach session replay,
 * and the capture opens for review in place.
 */
export function PageContext({ snapshot, label }: PageContextProps) {
  const [open, setOpen] = useState(false)
  const hostname = new URL(snapshot.url).hostname
  const title = snapshot.title || hostname
  return (
    <span
      className={styles.pageContext}
      ref={(node) => {
        node?.classList.add(REPLAY_BLOCK_CLASS)
      }}
    >
      <Button
        variant='muted'
        size='compact'
        icon='I041'
        aria-label={`Review page context: ${title}${snapshot.truncated ? ' (partial capture)' : ''}`}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <OverlayDialog
        open={open}
        title={title}
        accessibleName='Page context'
        description={snapshot.truncated ? `${hostname} · Partial capture` : hostname}
        onClose={() => setOpen(false)}
      >
        <p className={styles.pageContextText} data-type='T048'>
          {snapshot.text}
        </p>
      </OverlayDialog>
    </span>
  )
}
