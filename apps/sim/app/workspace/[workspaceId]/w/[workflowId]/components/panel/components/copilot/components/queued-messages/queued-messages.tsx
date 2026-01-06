'use client'

import { useCallback, useState } from 'react'
import { ArrowUp, ChevronDown, ChevronRight, MoreHorizontal, Trash2 } from 'lucide-react'
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
    <div className='mx-2 overflow-hidden rounded-t-lg border border-b-0 border-black/[0.08] bg-[var(--bg-secondary)] dark:border-white/[0.08]'>
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
          <span className='text-xs font-medium text-[var(--text-secondary)]'>
            {messageQueue.length} Queued
          </span>
        </div>
        <MoreHorizontal className='h-3 w-3 text-[var(--text-tertiary)]' />
      </button>

      {/* Message list */}
      {isExpanded && (
        <div>
          {messageQueue.map((msg, index) => (
            <div
              key={msg.id}
              className='group flex items-center gap-2 border-t border-black/[0.04] px-2.5 py-1.5 hover:bg-[var(--bg-tertiary)] dark:border-white/[0.04]'
            >
              {/* Radio indicator */}
              <div className='flex h-3 w-3 shrink-0 items-center justify-center'>
                <div className='h-2.5 w-2.5 rounded-full border border-[var(--text-tertiary)]/50' />
              </div>

              {/* Message content */}
              <div className='min-w-0 flex-1'>
                <p className='truncate text-xs text-[var(--text-primary)]'>
                  {msg.content}
                </p>
              </div>

              {/* Actions */}
              <div className='flex shrink-0 items-center gap-1'>
                {/* Send immediately button */}
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSendNow(msg.id)
                  }}
                  className='rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  title='Send immediately (stops current)'
                >
                  <ArrowUp className='h-3.5 w-3.5' />
                </button>
                {/* Delete button */}
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(msg.id)
                  }}
                  className='rounded p-1 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-red-400'
                  title='Remove from queue'
                >
                  <Trash2 className='h-3.5 w-3.5' />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

