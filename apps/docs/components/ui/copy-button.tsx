'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Duplicate, TriangleAlert } from '@sim/emcn/icons'
import { DocsButton } from '@/components/docs/primitives'

interface CopyButtonProps {
  text?: string
  getText?: () => string
  label?: string
  className?: string
}

/** Starts the clipboard write in the user gesture, using the currently displayed text. */
export function CopyButton({ text, getText, label = 'Copy code', className }: CopyButtonProps) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  async function copy() {
    if (timer.current) clearTimeout(timer.current)
    try {
      await navigator.clipboard.writeText(getText ? getText() : (text ?? ''))
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    timer.current = setTimeout(() => setStatus('idle'), 2000)
  }

  const announcement =
    status === 'copied'
      ? 'Copied'
      : status === 'error'
        ? 'Copy failed. Select and copy the text manually.'
        : ''
  const Icon = status === 'copied' ? Check : status === 'error' ? TriangleAlert : Duplicate
  return (
    <>
      <DocsButton
        iconOnly
        className={className}
        aria-label={announcement || label}
        title={announcement || label}
        onClick={copy}
      >
        <Icon className='size-4 text-[var(--docs-muted)]' />
      </DocsButton>
      <span className='sr-only' role='status'>
        {announcement}
      </span>
    </>
  )
}
