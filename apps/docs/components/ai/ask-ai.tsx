'use client'

import { useRef, useState } from 'react'
import { MessageCircle } from 'lucide-react'
import dynamic from 'next/dynamic'

const AskAIPanel = dynamic(() => import('./ask-ai-panel').then((m) => m.AskAIPanel), {
  ssr: false,
})

interface AskAIProps {
  /** Active docs locale, forwarded so retrieval is scoped to the reader's language. */
  locale: string
}

export function AskAI({ locale }: AskAIProps) {
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  const openButtonRef = useRef<HTMLButtonElement>(null)

  const handleOpen = () => {
    setHasOpened(true)
    setOpen(true)
  }

  const handleClose = () => {
    setOpen(false)
    openButtonRef.current?.focus()
  }

  return (
    <>
      {!open && (
        <button
          ref={openButtonRef}
          type='button'
          aria-label='Ask Sim'
          onClick={handleOpen}
          className='fixed right-4 bottom-4 z-50 flex h-11 items-center gap-1.5 rounded-full border border-[var(--border-1)] bg-[var(--surface-5)] px-4 font-season text-[var(--text-body)] text-sm shadow-[var(--shadow-medium)] transition-colors hover:bg-[var(--surface-active)] dark:bg-[var(--surface-4)]'
        >
          <MessageCircle className='size-[16px] text-[var(--text-icon)]' />
          Ask Sim
        </button>
      )}

      {hasOpened && <AskAIPanel locale={locale} open={open} onClose={handleClose} />}
    </>
  )
}
