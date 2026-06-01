'use client'

import { useCallback, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, ChevronRight, Paperclip, Pencil, Trash2, X } from 'lucide-react'
import { Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { UserMessageContent } from '@/app/workspace/[workspaceId]/home/components/user-message-content'
import type { QueuedMessage } from '@/app/workspace/[workspaceId]/home/types'

const NARROW_WIDTH_PX = 320

interface QueuedMessagesProps {
  messageQueue: QueuedMessage[]
  editingQueuedId: string | null
  dispatchingHeadId: string | null
  onRemove: (id: string) => void
  onSendNow: (id: string) => Promise<void>
  onEdit: (id: string) => void
  onCancelEdit: () => void
}

export function QueuedMessages({
  messageQueue,
  editingQueuedId,
  dispatchingHeadId,
  onRemove,
  onSendNow,
  onEdit,
  onCancelEdit,
}: QueuedMessagesProps) {
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
          <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
        ) : (
          <ChevronRight className='size-[14px] text-[var(--text-icon)]' />
        )}
        <span className='font-medium text-[var(--text-secondary)] text-small'>
          {messageQueue.length} Queued
        </span>
      </button>

      {isExpanded && (
        <div>
          {messageQueue.map((msg) => {
            const isEditing = msg.id === editingQueuedId
            const isDispatching = msg.id === dispatchingHeadId
            return (
              <div
                key={msg.id}
                className={cn(
                  'flex items-center gap-2 py-1.5 pr-2 pl-3.5 transition-colors hover-hover:bg-[var(--surface-active)]',
                  isEditing && 'bg-[var(--surface-active)]'
                )}
              >
                <div className='flex size-[16px] shrink-0 items-center justify-center'>
                  <div
                    className={cn(
                      'size-[10px] rounded-full border-[1.5px] border-[color-mix(in_srgb,var(--text-tertiary)_40%,transparent)]',
                      isEditing &&
                        'border-[color-mix(in_srgb,var(--text-secondary)_60%,transparent)] border-dashed'
                    )}
                  />
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
                    <Paperclip className='size-[12px] shrink-0 text-[var(--text-icon)]' />
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
                  {isEditing ? (
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <button
                          type='button'
                          onClick={(e) => {
                            e.stopPropagation()
                            onCancelEdit()
                          }}
                          className='rounded-md p-[5px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)]'
                        >
                          <X className='size-[13px]' />
                        </button>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top' sideOffset={4}>
                        Cancel edit
                      </Tooltip.Content>
                    </Tooltip.Root>
                  ) : (
                    <>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            type='button'
                            disabled={isDispatching}
                            onClick={(e) => {
                              e.stopPropagation()
                              onEdit(msg.id)
                            }}
                            className='rounded-md p-[5px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover-hover:bg-transparent disabled:hover-hover:text-[var(--text-icon)]'
                          >
                            <Pencil className='size-[13px]' />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Content side='top' sideOffset={4}>
                          {isDispatching ? 'Sending now' : 'Edit queued message'}
                        </Tooltip.Content>
                      </Tooltip.Root>

                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            type='button'
                            disabled={isDispatching}
                            onClick={(e) => {
                              e.stopPropagation()
                              void onSendNow(msg.id)
                            }}
                            className='rounded-md p-[5px] text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-active)] hover-hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover-hover:bg-transparent disabled:hover-hover:text-[var(--text-icon)]'
                          >
                            <ArrowUp className='size-[13px]' />
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
                            <Trash2 className='size-[13px]' />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Content side='top' sideOffset={4}>
                          Remove from queue
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
