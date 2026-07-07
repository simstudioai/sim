'use client'

import { useCallback, useMemo } from 'react'
import { Badge, ChipInput, ChipSelect, Search } from '@sim/emcn'
import { formatRelativeTime } from '@sim/utils/formatting'
import { ArrowRight, Paperclip } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { debounce, useQueryStates } from 'nuqs'
import {
  type InboxStatusFilter,
  inboxTaskParsers,
  inboxTaskUrlKeys,
} from '@/app/workspace/[workspaceId]/settings/components/inbox/search-params'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
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

type StatusFilter = InboxStatusFilter

/** Debounce window for `search` URL writes; the input itself stays instant. */
const SEARCH_DEBOUNCE_MS = 300 as const

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

  const [{ status: statusFilter, search: searchTerm }, setInboxFilters] = useQueryStates(
    inboxTaskParsers,
    inboxTaskUrlKeys
  )

  /**
   * The input is controlled directly by the instant nuqs value; only the URL
   * write is debounced. Filtering below is cheap in-memory over the loaded
   * tasks, so it reads the instant value too.
   */
  const setSearchTerm = useCallback(
    (value: string) => {
      const next = value.length > 0 ? value : null
      setInboxFilters(
        { search: next },
        next === null ? undefined : { limitUrlUpdates: debounce(SEARCH_DEBOUNCE_MS) }
      )
    },
    [setInboxFilters]
  )

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
        router.push(`/workspace/${workspaceId}/chat/${task.chatId}`)
      }
    },
    [workspaceId, router]
  )

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder='Search tasks...'
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className='min-w-0 flex-1'
        />
        <ChipSelect
          align='start'
          value={statusFilter}
          onChange={(value) => {
            if (STATUS_OPTIONS.some((option) => option.value === value)) {
              setInboxFilters({ status: value as StatusFilter })
            }
          }}
          options={STATUS_OPTIONS.map((opt) => ({ label: opt.label, value: opt.value }))}
        />
      </div>

      <div className='min-h-0 flex-1 overflow-y-auto'>
        {isLoading ? null : filteredTasks.length === 0 ? (
          searchTerm.trim() ? (
            <SettingsEmptyState variant='inline'>
              {`No tasks matching "${searchTerm}"`}
            </SettingsEmptyState>
          ) : (
            <SettingsEmptyState>
              {config?.address
                ? `No email tasks yet. Send an email to ${config.address} to get started.`
                : 'No email tasks yet.'}
            </SettingsEmptyState>
          )
        ) : (
          <div className='flex flex-col gap-0.5'>
            {filteredTasks.map((task) => {
              const statusBadge = STATUS_BADGES[task.status] || STATUS_BADGES.received
              const isClickable =
                task.chatId && (task.status === 'completed' || task.status === 'failed')
              const rowClassName = `flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors ${
                isClickable
                  ? 'cursor-pointer hover-hover:bg-[var(--surface-active)]'
                  : 'cursor-default'
              }`
              const rowContent = (
                <>
                  <div className='flex min-w-0 flex-1 flex-col'>
                    <div className='flex min-w-0 items-center gap-1.5'>
                      <span className='truncate text-[var(--text-body)] text-sm'>
                        {task.subject}
                      </span>
                      {task.hasAttachments && (
                        <Paperclip className='size-[12px] flex-shrink-0 text-[var(--text-muted)]' />
                      )}
                    </div>
                    <span className='truncate text-[var(--text-muted)] text-caption'>
                      {task.fromName || task.fromEmail}
                    </span>
                    {task.status === 'rejected' && task.rejectionReason && (
                      <span className='truncate text-[var(--text-muted)] text-caption line-through'>
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
                  <div className='flex flex-shrink-0 items-center gap-2'>
                    <span className='whitespace-nowrap text-[var(--text-muted)] text-caption'>
                      {formatRelativeTime(task.createdAt)}
                    </span>
                    <Badge variant={statusBadge.variant} className='text-xs'>
                      {task.status === 'processing' && (
                        <span className='mr-1 inline-block size-[6px] animate-pulse rounded-full bg-[var(--badge-amber-text)]' />
                      )}
                      {statusBadge.label}
                    </Badge>
                    {isClickable && (
                      <ArrowRight className='size-4 flex-shrink-0 text-[var(--text-icon)]' />
                    )}
                  </div>
                </>
              )

              return isClickable ? (
                <button
                  key={task.id}
                  type='button'
                  className={rowClassName}
                  onClick={() => handleTaskClick(task)}
                >
                  {rowContent}
                </button>
              ) : (
                <div key={task.id} className={rowClassName}>
                  {rowContent}
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
    case 'not_entitled':
      return 'Plan no longer includes Sim Mailer'
    default:
      return reason
  }
}
