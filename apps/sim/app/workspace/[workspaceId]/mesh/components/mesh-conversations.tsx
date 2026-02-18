'use client'

import { useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ArrowUpDown, Loader2, MessageSquare, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Button, Tooltip } from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { useMeshThreads } from '@/hooks/queries/mesh'
import type { MeshThread } from '@/hooks/queries/mesh'
import { AgentAvatarGroup } from '@/app/workspace/[workspaceId]/mesh/components/agent-avatar'
import { ThreadStatusBadge } from '@/app/workspace/[workspaceId]/mesh/components/thread-status-badge'

const logger = createLogger('MeshConversations')

type SortField = 'updatedAt' | 'createdAt' | 'turnCount' | 'title'
type SortDir = 'asc' | 'desc'

/**
 * Mesh conversations list page. Displays all mesh bus threads with
 * agent badges, status, turn count, and relative timestamps.
 */
export function MeshConversations() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState<SortField>('updatedAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const { data, isLoading, isError, error, refetch, isFetching } = useMeshThreads({
    refetchInterval: 10_000,
  })

  const threads = useMemo(() => {
    if (!data?.threads) return []

    let filtered = data.threads
    if (search.trim()) {
      const q = search.toLowerCase()
      filtered = filtered.filter(
        (t) =>
          t.title.toLowerCase().includes(q) ||
          t.agents.some((a) => a.name.toLowerCase().includes(q))
      )
    }

    return [...filtered].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortField === 'title') return dir * a.title.localeCompare(b.title)
      if (sortField === 'turnCount') return dir * (a.turnCount - b.turnCount)
      const aDate = new Date(a[sortField]).getTime()
      const bDate = new Date(b[sortField]).getTime()
      return dir * (aDate - bDate)
    })
  }, [data?.threads, search, sortField, sortDir])

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  return (
    <div className='flex h-full flex-1 flex-col overflow-auto bg-white pt-[28px] pl-[24px] dark:bg-[var(--bg)]'>
      <div className='pr-[24px]'>
        {/* Header */}
        <div className='flex items-center justify-between'>
          <div className='flex items-center gap-[12px]'>
            <MessageSquare className='h-[20px] w-[20px] text-[var(--text-secondary)]' />
            <h1 className='font-semibold text-[20px] text-[var(--text-primary)]'>
              Mesh Conversations
            </h1>
            {data?.total != null && (
              <span className='rounded-[6px] bg-[var(--surface-3)] px-[8px] py-[2px] font-medium text-[12px] text-[var(--text-tertiary)]'>
                {data.total}
              </span>
            )}
          </div>
          <div className='flex items-center gap-[8px]'>
            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Button variant='ghost' onClick={() => refetch()} disabled={isFetching}>
                  <RefreshCw
                    className={cn('h-[14px] w-[14px]', isFetching && 'animate-spin')}
                  />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content>
                <p>Refresh</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        </div>

        {/* Search */}
        <div className='mt-[16px] flex items-center gap-[8px]'>
          <div className='relative flex-1'>
            <Search className='absolute top-1/2 left-[10px] h-[14px] w-[14px] -translate-y-1/2 text-[var(--text-subtle)]' />
            <input
              type='text'
              placeholder='Search threads by title or agent...'
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className='h-[34px] w-full rounded-[8px] border border-[var(--border)] bg-transparent py-[6px] pr-[12px] pl-[32px] text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-subtle)] focus:border-[var(--border-1)] focus:outline-none'
            />
          </div>
        </div>

        {/* Table Header */}
        <div className='mt-[20px] flex items-center rounded-t-[6px] bg-[var(--surface-3)] px-[16px] py-[10px] dark:bg-[var(--surface-3)]'>
          <SortableHeader
            label='Title'
            field='title'
            current={sortField}
            dir={sortDir}
            onToggle={toggleSort}
            className='flex-1 min-w-[200px]'
          />
          <span className='w-[160px] font-medium text-[12px] text-[var(--text-tertiary)]'>
            Agents
          </span>
          <span className='w-[90px] font-medium text-[12px] text-[var(--text-tertiary)]'>
            Status
          </span>
          <SortableHeader
            label='Turns'
            field='turnCount'
            current={sortField}
            dir={sortDir}
            onToggle={toggleSort}
            className='w-[70px]'
          />
          <SortableHeader
            label='Updated'
            field='updatedAt'
            current={sortField}
            dir={sortDir}
            onToggle={toggleSort}
            className='w-[120px]'
          />
        </div>
      </div>

      {/* Table Body */}
      <div className='flex-1 overflow-y-auto pr-[24px]'>
        <div className='rounded-b-[6px] bg-[var(--surface-2)] dark:bg-[var(--surface-1)]'>
          {isLoading ? (
            <div className='flex items-center justify-center py-[60px]'>
              <Loader2 className='h-[16px] w-[16px] animate-spin text-[var(--text-secondary)]' />
              <span className='ml-[8px] text-[13px] text-[var(--text-secondary)]'>
                Loading mesh threads...
              </span>
            </div>
          ) : isError ? (
            <div className='flex items-center justify-center py-[60px]'>
              <span className='text-[13px] text-[var(--text-error)]'>
                {error?.message || 'Failed to load threads'}
              </span>
            </div>
          ) : threads.length === 0 ? (
            <div className='flex flex-col items-center justify-center py-[60px]'>
              <MessageSquare className='mb-[8px] h-[24px] w-[24px] text-[var(--text-subtle)]' />
              <span className='text-[13px] text-[var(--text-secondary)]'>
                {search ? 'No threads match your search' : 'No mesh conversations yet'}
              </span>
            </div>
          ) : (
            threads.map((thread) => (
              <ThreadRow
                key={thread.contextId}
                thread={thread}
                workspaceId={workspaceId}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}

interface ThreadRowProps {
  thread: MeshThread
  workspaceId: string
}

function ThreadRow({ thread, workspaceId }: ThreadRowProps) {
  const displayTitle = thread.title
    .replace(/^conv:\s*/i, '')
    .replace(/^mesh::\s*/i, '')

  const threadType = thread.title.startsWith('mesh::')
    ? 'mesh'
    : thread.title.startsWith('conv:')
      ? 'conv'
      : 'other'

  return (
    <Link
      href={`/workspace/${workspaceId}/mesh/${thread.contextId}`}
      className='group flex items-center border-b border-[var(--border)] px-[16px] py-[12px] transition-colors hover:bg-[var(--surface-6)] dark:hover:bg-[var(--surface-5)]'
    >
      {/* Title */}
      <div className='flex flex-1 min-w-[200px] items-center gap-[8px]'>
        {threadType !== 'other' && (
          <span
            className={cn(
              'rounded-[4px] px-[6px] py-[1px] font-mono text-[10px]',
              threadType === 'mesh'
                ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
            )}
          >
            {threadType}
          </span>
        )}
        <span className='truncate font-medium text-[13px] text-[var(--text-primary)] group-hover:text-[var(--text-link)]'>
          {displayTitle}
        </span>
      </div>

      {/* Agents */}
      <div className='w-[160px]'>
        <AgentAvatarGroup agents={thread.agents} max={4} />
      </div>

      {/* Status */}
      <div className='w-[90px]'>
        <ThreadStatusBadge status={thread.status} />
      </div>

      {/* Turn Count */}
      <div className='w-[70px]'>
        <span className='font-mono text-[12px] text-[var(--text-secondary)]'>
          {thread.turnCount}
        </span>
      </div>

      {/* Updated */}
      <div className='w-[120px]'>
        <span className='text-[12px] text-[var(--text-tertiary)]'>
          {formatRelativeTime(thread.updatedAt)}
        </span>
      </div>
    </Link>
  )
}

interface SortableHeaderProps {
  label: string
  field: SortField
  current: SortField
  dir: SortDir
  onToggle: (field: SortField) => void
  className?: string
}

function SortableHeader({ label, field, current, dir, onToggle, className }: SortableHeaderProps) {
  const isActive = current === field
  return (
    <button
      type='button'
      onClick={() => onToggle(field)}
      className={cn(
        'flex items-center gap-[4px] font-medium text-[12px]',
        isActive ? 'text-[var(--text-secondary)]' : 'text-[var(--text-tertiary)]',
        className
      )}
    >
      {label}
      <ArrowUpDown
        className={cn(
          'h-[10px] w-[10px]',
          isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'
        )}
      />
      {isActive && (
        <span className='text-[10px]'>{dir === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  )
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)

  if (diffSeconds < 60) return 'just now'
  const diffMinutes = Math.floor(diffSeconds / 60)
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
