'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Expandable, ExpandableContent } from '@/components/emcn'
import { Clock } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { ChatHistoryList } from '@/app/workspace/[workspaceId]/home/components/chat-history/chat-history-list'

interface ChatHistoryProps {
  /**
   * Opens the selected chat. When provided, the chat opens inline (the home
   * input morphs into the docked chat view) instead of navigating. Falls back
   * to a route push when omitted.
   */
  onSelectChat?: (chatId: string) => void
}

/**
 * A launcher into the workspace's prior Mothership chats, docked into the grey
 * shelf beneath the home input (Codex tray pattern). Collapsed, it's a compact
 * "All Chats" chip; opening animates a searchable, recency-grouped list open
 * INSIDE the grey tray — the shelf grows downward while the centered input
 * rides upward, in lockstep (300ms ease). Lives on the new-chat home view so a
 * chat can be resumed without the (collapsible) sidebar.
 */
export function ChatHistory({ onSelectChat }: ChatHistoryProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  /** Collapse on outside click or Escape, matching popover dismissal. */
  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: MouseEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  const handleSelect = (chatId: string) => {
    setOpen(false)
    if (onSelectChat) {
      onSelectChat(chatId)
      return
    }
    router.push(`/workspace/${workspaceId}/chat/${chatId}`)
  }

  return (
    <div ref={panelRef} className='w-full'>
      <div className='flex items-center px-2 py-1.5'>
        <button
          type='button'
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label='All chats'
          className={cn(
            'flex items-center gap-1.5 rounded-[8px] px-2 py-1 transition-colors',
            'hover-hover:bg-[var(--surface-active)]',
            open && 'bg-[var(--surface-active)]'
          )}
        >
          <Clock className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
          <span className='text-[var(--text-body)] text-sm'>All Chats</span>
        </button>
      </div>

      <Expandable expanded={open}>
        <ExpandableContent>
          <ChatHistoryList onSelect={handleSelect} autoFocus={open} />
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
