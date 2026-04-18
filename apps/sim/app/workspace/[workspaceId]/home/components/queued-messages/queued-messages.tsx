'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, ChevronRight, Paperclip, Pencil, Trash2 } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { UserMessageContent } from '@/app/workspace/[workspaceId]/home/components/user-message-content'
import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'

const NARROW_WIDTH_PX = 320

interface QueuedMessagesProps {
  messageQueue: QueuedMessage[]
  onRemove: (id: string) => void
  onSendNow: (id: string) => Promise<void>
  onEdit: (id: string) => void
}

export function QueuedMessages({ messageQueue, onRemove, onSendNow, onEdit }: QueuedMessagesProps) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [isNarrow, setIsNarrow] = useState(false)
  const roRef = useRef<ResizeObserver | null>(null)

  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) {
      roRef.current.disconnect()
      roRef.current = null
    }
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      setIsNarrow(entries[0].contentRect.width < NARROW_WIDTH_PX)
    })
    ro.observe(el)
    roRef.current = ro
  }, [])

  if (messageQueue.length === 0) return null

  return (
    <div
      ref={containerRef}
      className='-mb-3 mx-3.5 overflow-hidden rounded-t-[16px] border border-[var(--border-1)] border-b-0 bg-[var(--surface-3)] pb-3'
    >
      <button
        type='button'
        onClick={() => setIsExpanded(!isExpanded)}
        className='flex w-full items-center gap-1.5 px-3.5 py-2 transition-colors hover-hover:bg-[var(--surface-active)]'
      >
        {isExpanded ? (
          <ChevronDown className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        ) : (
          <ChevronRight className='h-[14px] w-[14px] text-[var(--text-icon)]' />
        )}
        <span className='font-medium text-[var(--text-secondary)] text-small'>
          {messageQueue.length} Queued
        </span>
      </button>

      {isExpanded && (
        <div>
          {messageQueue.map((msg) => (
            <div
              key={msg.id}
              className='flex items-center gap-2 py-1.5 pr-2 pl-3.5 transition-colors hover-hover:bg-[var(--surface-active)]'
            >
              <div className='flex h-[16px] w-[16px] shrink-0 items-center justify-center'>
                <div className='h-[10px] w-[10px] rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--text-tertiary)_40%,transparent)]' />
              </div>

              <div className='min-w-0 flex-1 overflow-hidden'>
                <UserMessageContent
                  content={msg.content}
                  contexts={msg.contexts}
                  plainMentions
                  compact
                />
              </div>

              {msg.fileAttachments && msg.fileAttachments.length > 0 && (
                <span className='inline-flex min-w-0 max-w-[40%] shrink items-center gap-1 rounded-[5px] bg-[var(--surface-5)] px-[5px] py-0.5 text-[var(--text-primary)] text-small'>
                  <Paperclip className='h-[12px] w-[12px] shrink-0 text-[var(--text-icon)]' />
                  {isNarrow ? (
                    <span className='shrink-0 text-[var(--text-secondary)]'>
                      {msg.fileAttachments.length}
                    </span>
                  ) : (
                    <>
                      <span className='truncate'>{msg.fileAttachments[0].filename}</span>
                      {msg.fileAttachments.length > 1 && (
                        <span className='shrink-0 text-[var(--text-secondary)]'>
                          +{msg.fileAttachments.length - 1}
                        </span>
                      )}
                    </>
                  )}
                </span>
              )}

              <div className='flex shrink-0 items-center gap-0.5'>
                <Tooltip.Root>
                  <Tooltip.Trigger asChild>
                    <button
                      type='button'
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(msg.id)
                      }}
                      className='rounded-md p-[5px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
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
                      className='rounded-md p-[5px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
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
                      className='rounded-md p-[5px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
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
