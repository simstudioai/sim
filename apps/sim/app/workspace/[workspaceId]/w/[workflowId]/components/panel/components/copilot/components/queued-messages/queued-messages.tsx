'use client'

import { useCallback, useState } from 'react'
import { ArrowUp, ChevronDown, ChevronRight, Trash2 } from 'lucide-react'
import { useCopilotStore } from '@/stores/panel/copilot/store'

/**
 * Displays queued messages in a Cursor-style collapsible panel above the input box.
 */
export function QueuedMessages() {
  const messageQueue = useCopilotStore((s) => s.messageQueue)
  const removeFromQueue = useCopilotStore((s) => s.removeFromQueue)
  const sendNow = useCopilotStore((s) => s.sendNow)

  const [isExpanded, setIsExpanded] = useState(true)

  const handleRemove = useCallback(
    (id: string) => {
      removeFromQueue(id)
    },
    [removeFromQueue]
  )

  const handleSendNow = useCallback(
    async (id: string) => {
      await sendNow(id)
    },
    [sendNow]
  )

  if (messageQueue.length === 0) return null

  return (
    <div className='mx-2 overflow-hidden rounded-t-lg border border-black/[0.08] border-b-0 bg-[var(--bg-secondary)] dark:border-white/[0.08]'>
      {/* Header */}
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='flex w-full items-center justify-between px-2.5 py-1.5 transition-colors hover:bg-[var(--bg-tertiary)]'
      >
        <div className='flex items-center gap-1.5'>
          {isExpanded ? (
            <ChevronDown className='h-3 w-3 text-[var(--text-tertiary)]' />
          ) : (
            <ChevronRight className='h-3 w-3 text-[var(--text-tertiary)]' />
          )}
          <span className='font-medium text-[var(--text-secondary)] text-xs'>
            {messageQueue.length} Queued
          </span>
        </div>
      </button>

      {/* Message list */}
      {isExpanded && (
        <div>
          {messageQueue.map((msg) => (
            <div
              key={msg.id}
              className='group flex items-center gap-2 border-black/[0.04] border-t px-2.5 py-1.5 hover:bg-[var(--bg-tertiary)] dark:border-white/[0.04]'
            >
              {/* Radio indicator */}
              <div className='flex h-3 w-3 shrink-0 items-center justify-center'>
                <div className='h-2.5 w-2.5 rounded-full border border-[var(--text-tertiary)]/50' />
              </div>

              {/* Message content */}
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[var(--text-primary)] text-xs'>{msg.content}</p>
              </div>

              {/* Actions - always visible */}
              <div className='flex shrink-0 items-center gap-0.5'>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSendNow(msg.id)
                  }}
                  className='rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-quaternary)] hover:text-[var(--text-primary)]'
                  title='Send now (aborts current stream)'
                >
                  <ArrowUp className='h-3 w-3' />
                </button>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(msg.id)
                  }}
                  className='rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:bg-red-500/10 hover:text-red-400'
                  title='Remove from queue'
                >
                  <Trash2 className='h-3 w-3' />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
