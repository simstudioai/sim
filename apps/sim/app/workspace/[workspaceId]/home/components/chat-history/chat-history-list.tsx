'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { differenceInCalendarDays, isToday, isYesterday } from 'date-fns'
import { useParams } from 'next/navigation'
import { Skeleton } from '@/components/emcn'
import { Search } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import {
  type MothershipChatMetadata,
  useMothershipChats,
  usePrefetchChatHistory,
} from '@/hooks/queries/mothership-chats'

const CONFIG = {
  LIST_MAX_HEIGHT: 320,
  SKELETON_ROWS: 5,
} as const

/** A recency bucket of chats rendered as one section in the history list. */
interface ChatBucket {
  key: string
  label: string
  tasks: MothershipChatMetadata[]
}

/**
 * Buckets chats into Codex-style recency sections. Pinned chats are lifted out
 * of their date bucket into a dedicated section at the top; everything else is
 * grouped by how recently it was last updated. The server already returns the
 * list ordered (pinned first, then desc by `updatedAt`), so per-bucket order is
 * preserved by simply appending as we iterate.
 */
function bucketChats(tasks: readonly MothershipChatMetadata[]): ChatBucket[] {
  const now = new Date()
  const pinned: MothershipChatMetadata[] = []
  const today: MothershipChatMetadata[] = []
  const yesterday: MothershipChatMetadata[] = []
  const last7: MothershipChatMetadata[] = []
  const last30: MothershipChatMetadata[] = []
  const older: MothershipChatMetadata[] = []

  for (const task of tasks) {
    if (task.isPinned) {
      pinned.push(task)
      continue
    }
    const date = task.updatedAt
    if (isToday(date)) {
      today.push(task)
    } else if (isYesterday(date)) {
      yesterday.push(task)
    } else {
      const days = differenceInCalendarDays(now, date)
      if (days <= 7) last7.push(task)
      else if (days <= 30) last30.push(task)
      else older.push(task)
    }
  }

  return (
    [
      { key: 'pinned', label: 'Pinned', tasks: pinned },
      { key: 'today', label: 'Today', tasks: today },
      { key: 'yesterday', label: 'Yesterday', tasks: yesterday },
      { key: 'last7', label: 'Previous 7 Days', tasks: last7 },
      { key: 'last30', label: 'Previous 30 Days', tasks: last30 },
      { key: 'older', label: 'Older', tasks: older },
    ] as const
  ).filter((bucket) => bucket.tasks.length > 0)
}

/**
 * A small status dot mirroring the sidebar's semantics: yellow while a chat is
 * actively streaming, brand accent when it has unread activity. Rendered only
 * when one of those states applies.
 */
function StatusDot({ task }: { task: MothershipChatMetadata }) {
  if (!task.isActive && !task.isUnread) return null
  return (
    <span
      aria-hidden='true'
      className='size-[6px] flex-shrink-0 rounded-full'
      style={{ backgroundColor: task.isActive ? '#EAB308' : 'var(--brand-accent)' }}
    />
  )
}

interface ChatHistoryListProps {
  /** Invoked with the chat id when a row is chosen. */
  onSelect: (chatId: string) => void
  /** The currently-open chat, highlighted in the list. */
  activeChatId?: string
  /** Focus the search field (and reset the query when it goes false). */
  autoFocus?: boolean
}

/**
 * The searchable, recency-grouped list of a workspace's Mothership chats. Shared
 * by the home "All Chats" tray and the open-chat title-bar switcher; the host
 * supplies `onSelect` (inline open, route push, etc.). Hovering a row warms its
 * history cache so opening it is instant.
 */
export function ChatHistoryList({
  onSelect,
  activeChatId,
  autoFocus = false,
}: ChatHistoryListProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const prefetchChatHistory = usePrefetchChatHistory()
  const { data: tasks = [], isLoading } = useMothershipChats(workspaceId)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const buckets = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    const filtered = trimmed
      ? tasks.filter((task) => task.name.toLowerCase().includes(trimmed))
      : tasks
    return bucketChats(filtered)
  }, [tasks, query])

  const hasChats = tasks.length > 0
  const hasResults = buckets.length > 0

  /** Focus search when activated; clear a stale query when deactivated. */
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
    else setQuery('')
  }, [autoFocus])

  return (
    <div className='flex flex-col px-2 pb-2'>
      <div className='flex items-center gap-2 px-2 py-1.5'>
        <Search className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder='Search chats'
          aria-label='Search chats'
          className='w-full bg-transparent text-[var(--text-body)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none'
        />
      </div>
      {/* The scroller bleeds to the dropdown's edge (-mx-2) so the scrollbar
          hugs it instead of floating mid-panel; the thumb is clipped to a 4px
          pill inset 2px from the edge. Right padding is just 2px — the
          scrollbar gutter supplies the rest of the row's visual inset. */}
      <div
        className='-mx-2 flex flex-col overflow-y-auto overscroll-contain pr-0.5 pl-2 [scrollbar-width:thin] [&::-webkit-scrollbar-thumb]:bg-clip-content [&::-webkit-scrollbar-thumb]:[border:2px_solid_transparent]'
        style={{ maxHeight: CONFIG.LIST_MAX_HEIGHT }}
      >
        {isLoading ? (
          <div className='flex flex-col gap-1 px-1 py-1'>
            {Array.from({ length: CONFIG.SKELETON_ROWS }, (_, i) => (
              <Skeleton key={i} className='h-[30px] w-full' />
            ))}
          </div>
        ) : !hasChats ? (
          <p className='px-2 py-6 text-center text-[var(--text-muted)] text-caption'>
            No chats yet
          </p>
        ) : !hasResults ? (
          <p className='px-2 py-6 text-center text-[var(--text-muted)] text-caption'>
            No chats found
          </p>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.key} className='mt-1.5 first:mt-0'>
              <p className='px-2 py-1 font-medium text-[var(--text-muted)] text-caption'>
                {bucket.label}
              </p>
              {bucket.tasks.map((task) => (
                <button
                  key={task.id}
                  type='button'
                  onClick={() => onSelect(task.id)}
                  onMouseEnter={() => prefetchChatHistory(task.id)}
                  className={cn(
                    'flex h-[30px] w-full items-center gap-2 rounded-lg px-2 text-left transition-colors hover-hover:bg-[var(--surface-active)]',
                    task.id === activeChatId && 'bg-[var(--surface-active)]'
                  )}
                >
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[var(--text-body)] text-sm',
                      task.isUnread && 'font-medium text-[var(--text-primary)]'
                    )}
                  >
                    {task.name}
                  </span>
                  <StatusDot task={task} />
                </button>
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
