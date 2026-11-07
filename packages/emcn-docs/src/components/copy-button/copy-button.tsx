'use client'

import { useState } from 'react'
import { useClipboard } from '@sim/emcn/feedback/use-clipboard'
import { useFeedbackExpiry } from '@sim/emcn/feedback/use-feedback-expiry'
import { Icon } from '@sim/emcn/icon'
import { DocsButton } from '#docs/components/button/button'

interface CopyButtonProps {
  text?: string
  getText?: () => string
  label?: string
  className?: string
}

/** Starts the clipboard write in the user gesture, using the currently displayed text. */
export function CopyButton({ text, getText, label = 'Copy code', className }: CopyButtonProps) {
  const { copied, copy: write } = useClipboard()
  const [failedAt, setFailedAt] = useState<number | null>(null)
  useFeedbackExpiry(failedAt, () => setFailedAt(null))
  const status = copied ? 'copied' : failedAt === null ? 'idle' : 'error'

  async function copy() {
    setFailedAt((await write(getText ? getText() : (text ?? ''))) ? null : performance.now())
  }

  const announcement =
    status === 'copied'
      ? 'Copied'
      : status === 'error'
        ? 'Copy failed. Select and copy the text manually.'
        : ''
  const glyph = status === 'copied' ? 'I072' : status === 'error' ? 'warning-triangle' : 'I006'
  return (
    <>
      <DocsButton
        iconOnly
        className={className}
        aria-label={announcement || label}
        title={announcement || label}
        onClick={copy}
      >
        <Icon name={glyph} className='size-4 text-[var(--docs-muted)]' />
      </DocsButton>
      <span className='sr-only' role='status'>
        {announcement}
      </span>
    </>
  )
}
