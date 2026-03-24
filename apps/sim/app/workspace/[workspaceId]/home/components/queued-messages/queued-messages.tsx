'use client'

import { useState } from 'react'
import { ArrowUp, ChevronDown, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'

interface QueuedMessagesProps {
  messageQueue: QueuedMessage[]
  onRemove: (id: string) => void
  onSendNow: (id: string) => Promise<void>
  onEdit: (id: string) => void
}

export function QueuedMessages({ messageQueue, onRemove, onSendNow, onEdit }: QueuedMessagesProps) {
  const [isExpanded, setIsExpanded] = useState(true)

  if (messageQueue.length === 0) return null

  return (
    <div className='-mb-[12px] mx-[14px] overflow-hidden rounded-t-[16px] border border-[var(--border-1)] border-b-0 bg-[var(--surface-3)] pb-[12px]'>
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='flex w-full items-center gap-[6px] px-[14px] py-[8px] transition-colors hover:bg-[var(--surface-active)]'
      >
        {isExpanded ? (
          <ChevronDown className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        ) : (
          <ChevronRight className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        )}
        <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
          {messageQueue.length} Queued
        </span>
      </button>

      {isExpanded && (
        <div>
          {messageQueue.map((msg) => (
            <div
              key={msg.id}
              className='flex items-center gap-[8px] px-[14px] py-[6px] transition-colors hover:bg-[var(--surface-active)]'
            >
              <div className='flex h-[16px] w-[16px] shrink-0 items-center justify-center'>
                <div className='h-[10px] w-[10px] rounded-full border-[1.5px] border-[var(--text-tertiary)]/40' />
              </div>

              <div className='min-w-0 flex-1'>
                <p className='truncate text-[13px] text-[var(--text-primary)]'>{msg.content}</p>
              </div>

              <div className='flex shrink-0 items-center gap-[2px]'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(msg.id)
                      }}
                      className='rounded-[6px] p-[5px] text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)] hover:text-[var(--text-primary)]'
                    >
                      <Pencil className='h-[13px] w-[13px]' />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top' sideOffset={4}>
                    Edit queued message
                  </Tooltip.Content>
                </Tooltip.Root>

                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation()
                        void onSendNow(msg.id)
                      }}
                      className='rounded-[6px] p-[5px] text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)] hover:text-[var(--text-primary)]'
                    >
                      <ArrowUp className='h-[13px] w-[13px]' />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top' sideOffset={4}>
                    Send now
                  </Tooltip.Content>
                </Tooltip.Root>

                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(msg.id)
                      }}
                      className='rounded-[6px] p-[5px] text-[var(--text-icon)] transition-colors hover:bg-[var(--surface-active)] hover:text-[var(--text-primary)]'
                    >
                      <Trash2 className='h-[13px] w-[13px]' />
                    </button>
                  </Tooltip.Trigger>
                  <Tooltip.Content side='top' sideOffset={4}>
                    Remove from queue
                  </Tooltip.Content>
                </Tooltip.Root>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
