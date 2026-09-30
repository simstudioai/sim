'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { MockComposer } from '@/app/playground/org/components/mock-composer'

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
}

const SEED: ChatMessage[] = [
  { role: 'user', text: 'Why is churn-agent slow on batch 3?' },
  {
    role: 'assistant',
    text: 'Batch 3 has 214 accounts with no plan field, so each one falls back to a full usage scan. I can backfill plan from Stripe first — want me to add that as a step on SUP-131?',
  },
]

interface ChatThreadProps {
  placeholder: string
  seed?: ChatMessage[]
  attachments?: React.ReactNode
  /** Called with each message the person sends. */
  onSend?: (text: string) => void
  /** Shown in place of messages while there are none. */
  emptyTitle?: string
  className?: string
}

/** Static chat thread; replies are canned so the layout can be judged without Mothership. */
export function ChatThread({
  placeholder,
  seed = SEED,
  attachments,
  onSend,
  emptyTitle,
  className,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(seed)
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      <div className='flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4'>
        {messages.length === 0 && emptyTitle && (
          <h1 className='m-auto max-w-chat text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em]'>
            {emptyTitle}
          </h1>
        )}
        {messages.map((message, index) =>
          message.role === 'user' ? (
            <div
              key={index}
              className='max-w-[85%] self-end rounded-xl bg-[var(--surface-5)] px-3 py-2 text-[var(--text-body)] text-sm'
            >
              {message.text}
            </div>
          ) : (
            <p key={index} className='text-[var(--text-body)] text-sm leading-relaxed'>
              {message.text}
            </p>
          )
        )}
      </div>
      <div className='shrink-0 px-3 pb-3'>
        <MockComposer
          placeholder={placeholder}
          attachments={attachments}
          onSubmit={(text) => {
            onSend?.(text)
            setMessages((prev) => [
              ...prev,
              { role: 'user', text },
              { role: 'assistant', text: 'On it — this is a prototype, so this reply is canned.' },
            ])
          }}
        />
      </div>
    </div>
  )
}
