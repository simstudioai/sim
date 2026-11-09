'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { EmptyState } from '@sim/emcn/empty-state'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SearchField } from '@sim/emcn/search-field'
import { FailureNotice } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import { useSearchParams } from 'next/navigation'
import {
  ResourceList,
  SectionToolbar,
} from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import {
  INBOX_STATUS_FILTERS,
  type InboxTaskItem,
  useInboxTaskFilters,
  useInboxTasks,
} from '@/platform/lib/data/inbox'
import { platformHref } from '@/platform/lib/navigation'
import { formatRelativeTime } from '@/platform/shared/time'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'completed', label: 'Completed' },
  { value: 'processing', label: 'Processing' },
  { value: 'received', label: 'Received' },
  { value: 'failed', label: 'Failed' },
  { value: 'rejected', label: 'Rejected' },
]

const STATUS_LABEL: Record<InboxTaskItem['status'], string> = {
  received: 'Received',
  processing: 'Processing',
  completed: 'Complete',
  failed: 'Failed',
  rejected: 'Rejected',
}

const REJECTION_REASONS: Record<string, string> = {
  sender_not_allowed: 'Sender not allowed',
  automated_sender: 'Automated sender',
  rate_limit_exceeded: 'Rate limit exceeded',
  not_entitled: 'Plan no longer includes Sim Mailer',
}

/** The line under the sender that says how the task ended, or what it asked while it runs. */
function outcome(task: InboxTaskItem): string | null {
  switch (task.status) {
    case 'rejected':
      return task.rejectionReason
        ? (REJECTION_REASONS[task.rejectionReason] ?? task.rejectionReason)
        : null
    case 'failed':
      return task.errorMessage
    case 'completed':
      return task.resultSummary
    default:
      return task.bodyPreview
  }
}

interface InboxTaskListProps {
  workspaceId: string
  address: string | null
}

/** Email tasks this workspace received; a finished one opens its chat. */
export function InboxTaskList({ workspaceId, address }: InboxTaskListProps) {
  const search = useSearchParams()
  const filters = useInboxTaskFilters()
  const tasks = useInboxTasks(workspaceId, { status: filters.status })
  const now = Date.now()

  const term = filters.search.trim().toLowerCase()
  const filtered = (tasks.data?.tasks ?? []).filter(
    (task) =>
      !term ||
      task.subject.toLowerCase().includes(term) ||
      task.fromEmail.toLowerCase().includes(term) ||
      task.bodyPreview?.toLowerCase().includes(term)
  )

  return (
    <>
      <SectionToolbar
        grow={
          <SearchField
            label='Search tasks'
            placeholder='Search tasks...'
            value={filters.search}
            onValueChange={filters.setSearch}
          />
        }
      >
        <ChoiceMenu
          label='Status'
          options={STATUS_OPTIONS}
          value={filters.status}
          onValueChange={(value) => {
            const next = INBOX_STATUS_FILTERS.find((filter) => filter === value)
            if (next) filters.setStatus(next)
          }}
        />
      </SectionToolbar>
      {tasks.isPending ? null : tasks.data === undefined ? (
        <FailureNotice
          message={getErrorMessage(tasks.error, 'Failed to load email tasks')}
          retrying={tasks.isFetching}
          onRetry={() => void tasks.refetch()}
        />
      ) : filtered.length === 0 ? (
        term ? (
          <EmptyState title={`No tasks matching "${filters.search}"`} />
        ) : (
          <EmptyState
            title='No email tasks yet'
            description={address ? `Send an email to ${address} to get started.` : undefined}
          />
        )
      ) : (
        <ResourceList>
          {filtered.map((task) => {
            const detail = [
              task.fromName || task.fromEmail,
              outcome(task),
              task.hasAttachments ? 'Has attachments' : null,
            ]
              .filter(Boolean)
              .join(' · ')
            const metadata = `${STATUS_LABEL[task.status]} · ${formatRelativeTime(new Date(task.createdAt).getTime(), now)}`
            return task.chatId && (task.status === 'completed' || task.status === 'failed') ? (
              <ActivityRow
                key={task.id}
                title={task.subject}
                detail={detail}
                textMetadata={metadata}
                href={platformHref(`/chat/${task.chatId}`, search)}
              />
            ) : (
              <ActivityRow
                key={task.id}
                title={task.subject}
                detail={detail}
                textMetadata={metadata}
                readOnly
              />
            )
          })}
        </ResourceList>
      )}
    </>
  )
}
