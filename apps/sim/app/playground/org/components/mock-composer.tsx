'use client'

import { useState } from 'react'
import { ComposerActionButton, cn } from '@sim/emcn'
import { ArrowUp } from '@sim/emcn/icons'

interface MockComposerProps {
  placeholder: string
  /** Context chips shown above the text, like resources dropped into the real composer. */
  attachments?: React.ReactNode
  onSubmit?: (message: string) => void
  rows?: number
  className?: string
}

/** Static stand-in for the chat composer: textarea plus send, no attachments or skills. */
export function MockComposer({
  placeholder,
  attachments,
  onSubmit,
  rows = 2,
  className,
}: MockComposerProps) {
  const [value, setValue] = useState('')
  const submit = () => {
    const message = value.trim()
    if (!message) return
    onSubmit?.(message)
    setValue('')
  }
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2.5',
        className
      )}
    >
      {attachments && <div className='flex flex-wrap gap-1'>{attachments}</div>}
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
        className='w-full resize-none bg-transparent text-[var(--text-body)] text-sm outline-none placeholder:text-[var(--text-muted)]'
      />
      <div className='flex justify-end'>
        <ComposerActionButton aria-label='Send' active={Boolean(value.trim())} onClick={submit}>
          <ArrowUp className='size-[14px]' />
        </ComposerActionButton>
      </div>
    </div>
  )
}
