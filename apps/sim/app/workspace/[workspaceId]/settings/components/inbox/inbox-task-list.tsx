'use client'

import { useCallback, useMemo, useState } from 'react'
import { formatRelativeTime } from '@sim/utils/formatting'
import { ChevronDown, Paperclip, Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/emcn'
import { Input } from '@/components/ui'
import { InboxTaskSkeleton } from '@/app/workspace/[workspaceId]/settings/components/inbox/inbox-skeleton'
import type { InboxTaskItem } from '@/hooks/queries/inbox'
import { useInboxConfig, useInboxTasks } from '@/hooks/queries/inbox'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'processing', label: 'Processing' },
  { value: 'received', label: 'Received' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
] as const

const STATUS_BADGES: Record<
  string,
  { label: string; variant: 'gray' | 'amber' | 'green' | 'red' | 'gray-secondary' }
> = {
  received: { label: 'Received', variant: 'gray' },
  processing: { label: 'Processing', variant: 'amber' },
  completed: { label: 'Complete', variant: 'green' },
  failed: { label: 'Failed', variant: 'red' },
  rejected: { label: 'Rejected', variant: 'gray-secondary' },
}

export function InboxTaskList() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const [statusFilter, setStatusFilter] = useState('all')
  const [searchTerm, setSearchTerm] = useState('')

  const { data: config } = useInboxConfig(workspaceId)
  const { data: tasksData, isLoading } = useInboxTasks(workspaceId, {
    status: statusFilter,
  })

  const filteredTasks = useMemo(() => {
    if (!tasksData?.tasks) return []
    if (!searchTerm.trim()) return tasksData.tasks
    const term = searchTerm.toLowerCase()
    return tasksData.tasks.filter(
      (t) =>
        t.subject?.toLowerCase().includes(term) ||
        t.fromEmail?.toLowerCase().includes(term) ||
        t.bodyPreview?.toLowerCase().includes(term)
    )
  }, [tasksData?.tasks, searchTerm])

  const handleTaskClick = useCallback(
    (task: InboxTaskItem) => {
      if (task.chatId && (task.status === 'completed' || task.status === 'failed')) {
        router.push(`/workspace/${workspaceId}/task/${task.chatId}`)
      }
    },
    [workspaceId, router]
  )

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
          <Search
            className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
            strokeWidth={2}
          />
          <Input
            placeholder='Search tasks...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              className='h-[32px] gap-1 px-2 text-[var(--text-secondary)] text-small'
            >
              {STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label ?? 'All statuses'}
              <ChevronDown className='h-[12px] w-[12px]' />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuRadioGroup value={statusFilter} onValueChange={setStatusFilter}>
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuRadioItem key={opt.value} value={opt.value}>
                  {opt.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {isLoading ? (
          <div className='flex flex-col gap-1'>
            {Array.from({ length: 3 }).map((_, i) => (
              <InboxTaskSkeleton key={i} />
            ))}
          </div>
        ) : filteredTasks.length === 0 ? (
          <div className='flex h-[200px] items-center justify-center text-[var(--text-muted)] text-sm'>
            {searchTerm.trim()
              ? `No tasks matching "${searchTerm}"`
              : config?.address
                ? `No email tasks yet. Send an email to ${config.address} to get started.`
                : 'No email tasks yet.'}
          </div>
        ) : (
          <div className='flex flex-col gap-1'>
            {filteredTasks.map((task) => {
              const statusBadge = STATUS_BADGES[task.status] || STATUS_BADGES.received
              const isClickable =
                task.chatId && (task.status === 'completed' || task.status === 'failed')
              return (
                <div
                  key={task.id}
                  className={`flex flex-col gap-1 rounded-lg border border-[var(--border)] p-3 transition-colors ${
                    isClickable ? 'cursor-pointer hover-hover:bg-[var(--surface-2)]' : ''
                  }`}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                  onClick={() => handleTaskClick(task)}
                  onKeyDown={(e) => {
                    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      handleTaskClick(task)
                    }
                  }}
                >
                  <div className='flex items-center justify-between'>
                    <span className='max-w-[70%] truncate font-medium text-[var(--text-primary)] text-sm'>
                      {task.subject}
                    </span>
                    <div className='flex items-center gap-1.5'>
                      {task.hasAttachments && (
                        <Paperclip className='h-[12px] w-[12px] text-[var(--text-muted)]' />
                      )}
                      <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>
                        {formatRelativeTime(task.createdAt)}
                      </span>
                    </div>
                  </div>
                  <div className='flex items-center justify-between'>
                    <span className='max-w-[60%] truncate text-[var(--text-muted)] text-caption'>
                      {task.fromName || task.fromEmail}
                    </span>
                    <Badge variant={statusBadge.variant} className='text-xs'>
                      {task.status === 'processing' && (
                        <span className='mr-1 inline-block h-[6px] w-[6px] animate-pulse rounded-full bg-yellow-500' />
                      )}
                      {statusBadge.label}
                    </Badge>
                  </div>
                  {task.status === 'rejected' && task.rejectionReason && (
                    <span className='text-[var(--text-muted)] text-caption line-through'>
                      {formatRejectionReason(task.rejectionReason)}
                    </span>
                  )}
                  {task.status === 'failed' && task.errorMessage && (
                    <span className='truncate text-[var(--text-error)] text-caption'>
                      {task.errorMessage}
                    </span>
                  )}
                  {task.status === 'completed' && task.resultSummary && (
                    <span className='truncate text-[var(--text-muted)] text-caption'>
                      {task.resultSummary}
                    </span>
                  )}
                  {task.status !== 'completed' &&
                    task.status !== 'failed' &&
                    task.status !== 'rejected' &&
                    task.bodyPreview && (
                      <span className='truncate text-[var(--text-muted)] text-caption'>
                        {task.bodyPreview}
                      </span>
                    )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function formatRejectionReason(reason: string): string {
  switch (reason) {
    case 'sender_not_allowed':
      return 'Sender not allowed'
    case 'automated_sender':
      return 'Automated sender'
    case 'rate_limit_exceeded':
      return 'Rate limit exceeded'
    default:
      return reason
  }
}
