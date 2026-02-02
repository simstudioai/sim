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
    <div className='mx-[14px] overflow-hidden rounded-t-[4px] border border-[var(--border)] border-b-0 bg-[var(--bg-secondary)]'>
      {/* Header */}
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='flex w-full items-center justify-between px-[10px] py-[6px] transition-colors hover:bg-[var(--surface-3)]'
      >
        <div className='flex items-center gap-[6px]'>
          {isExpanded ? (
            <ChevronDown className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
          ) : (
            <ChevronRight className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
          )}
          <span className='font-medium text-[12px] text-[var(--text-primary)]'>Queued</span>
          <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
            {messageQueue.length}
          </span>
        </div>
      </button>

      {/* Message list */}
      {isExpanded && (
        <div>
          {messageQueue.map((msg) => (
            <div
              key={msg.id}
              className='group flex items-center gap-[8px] border-[var(--border)] border-t px-[10px] py-[6px] hover:bg-[var(--surface-3)]'
            >
              {/* Radio indicator */}
              <div className='flex h-[14px] w-[14px] shrink-0 items-center justify-center'>
                <div className='h-[10px] w-[10px] rounded-full border border-[var(--text-tertiary)]/50' />
              </div>

              {/* Message content */}
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[13px] text-[var(--text-primary)]'>{msg.content}</p>
              </div>

              {/* Actions - always visible */}
              <div className='flex shrink-0 items-center gap-[4px]'>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleSendNow(msg.id)
                  }}
                  className='rounded p-[3px] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-quaternary)] hover:text-[var(--text-primary)]'
                  title='Send now (aborts current stream)'
                >
                  <ArrowUp className='h-[14px] w-[14px]' />
                </button>
                <button
                  type='button'
                  onClick={(e) => {
                    e.stopPropagation()
                    handleRemove(msg.id)
                  }}
                  className='rounded p-[3px] text-[var(--text-tertiary)] transition-colors hover:bg-red-500/10 hover:text-red-400'
                  title='Remove from queue'
                >
                  <Trash2 className='h-[14px] w-[14px]' />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
