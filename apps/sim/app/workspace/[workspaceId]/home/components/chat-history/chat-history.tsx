'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { differenceInCalendarDays, isToday, isYesterday } from 'date-fns'
import { useParams, useRouter } from 'next/navigation'
import { Expandable, ExpandableContent, Skeleton } from '@/components/emcn'
import { Clock, Search } from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import { type TaskMetadata, usePrefetchChatHistory, useTasks } from '@/hooks/queries/tasks'

const CONFIG = {
  LIST_MAX_HEIGHT: 320,
  SKELETON_ROWS: 5,
} as const

/** A recency bucket of chats rendered as one section in the history list. */
interface ChatBucket {
  key: string
  label: string
  tasks: TaskMetadata[]
}

/**
 * Buckets chats into Codex-style recency sections. Pinned chats are lifted out
 * of their date bucket into a dedicated section at the top; everything else is
 * grouped by how recently it was last updated. The server already returns the
 * list ordered (pinned first, then desc by `updatedAt`), so per-bucket order is
 * preserved by simply appending as we iterate.
 */
function bucketChats(tasks: readonly TaskMetadata[]): ChatBucket[] {
  const now = new Date()
  const pinned: TaskMetadata[] = []
  const today: TaskMetadata[] = []
  const yesterday: TaskMetadata[] = []
  const last7: TaskMetadata[] = []
  const last30: TaskMetadata[] = []
  const older: TaskMetadata[] = []

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
function StatusDot({ task }: { task: TaskMetadata }) {
  if (!task.isActive && !task.isUnread) return null
  return (
    <span
      aria-hidden='true'
      className='size-[6px] flex-shrink-0 rounded-full'
      style={{ backgroundColor: task.isActive ? '#EAB308' : 'var(--brand-accent)' }}
    />
  )
}

/**
 * A launcher into the workspace's prior Mothership chats, docked into the grey
 * shelf beneath the home input (Codex tray pattern). Collapsed, it's a compact
 * "All Chats" chip; opening animates a searchable, recency-grouped list open
 * INSIDE the grey tray — the shelf grows downward while the centered input
 * rides upward, in lockstep (300ms ease). Lives on the new-chat home view so a
 * chat can be resumed without the (collapsible) sidebar.
 */
interface ChatHistoryProps {
  /**
   * Opens the selected chat. When provided, the chat opens inline (the home
   * input morphs into the docked chat view) instead of navigating. Falls back
   * to a route push when omitted.
   */
  onSelectChat?: (chatId: string) => void
}

export function ChatHistory({ onSelectChat }: ChatHistoryProps) {
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const router = useRouter()
  const prefetchChatHistory = usePrefetchChatHistory()
  const { data: tasks = [], isLoading } = useTasks(workspaceId)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const panelRef = useRef<HTMLDivElement>(null)
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

  /** Focus the search field and clear stale queries each time the panel opens. */
  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    } else {
      setQuery('')
    }
  }, [open])

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
    router.push(`/workspace/${workspaceId}/task/${chatId}`)
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
          <div className='flex flex-col px-1.5 pb-1.5'>
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
            <div
              className='flex flex-col overflow-y-auto overscroll-contain'
              style={{ maxHeight: CONFIG.LIST_MAX_HEIGHT }}
            >
              {isLoading ? (
                <div className='flex flex-col gap-1 px-1 py-1'>
                  {Array.from({ length: CONFIG.SKELETON_ROWS }, (_, i) => (
                    <Skeleton key={i} className='h-[28px] w-full' />
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
                        onClick={() => handleSelect(task.id)}
                        onMouseEnter={() => prefetchChatHistory(task.id)}
                        className='flex w-full items-center gap-2 rounded-[6px] px-2 py-1.5 text-left transition-colors hover-hover:bg-[var(--surface-active)]'
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
        </ExpandableContent>
      </Expandable>
    </div>
  )
}
