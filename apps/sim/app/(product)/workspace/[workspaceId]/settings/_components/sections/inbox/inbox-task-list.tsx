'use client'

import { ActivityRow } from '@sim/emcn/activity-row'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { LoadMoreFooter } from '@sim/emcn/scroll-area/load-more-footer'
import { SearchField } from '@sim/emcn/search-field'
import { getErrorMessage } from '@sim/utils/errors'
import { SettingsList } from '@/app/(product)/_components/settings-parts/settings-list'
import {
  ResourceList,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import { SettingsRead } from '@/app/(product)/_components/settings-parts/settings-read'
import { useMinuteClock } from '@/platform/lib/data/clock'
import {
  INBOX_STATUS_FILTERS,
  type InboxTaskItem,
  useInboxTaskFilters,
  useInboxTasks,
} from '@/platform/lib/data/inbox'
import { surfaceHref } from '@/platform/lib/data/organization-model'
import { usePlatformHref } from '@/platform/lib/platform-href'
import { useSurfaceScope } from '@/platform/lib/surface-scope'
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

/** Email tasks this workspace received, a page at a time; a finished one opens its chat. */
export function InboxTaskList({ workspaceId, address }: InboxTaskListProps) {
  const hrefFor = usePlatformHref()
  const scope = useSurfaceScope()
  const filters = useInboxTaskFilters()
  const tasks = useInboxTasks(workspaceId, { status: filters.status })
  const now = useMinuteClock()

  const term = filters.search.trim().toLowerCase()
  const filtering = term !== '' || filters.status !== 'all'

  return (
    <SettingsRead query={tasks} failureMessage='Couldn’t load email tasks'>
      {(data) => {
        const all = data.pages.flatMap((page) => page.tasks)
        const filtered = all.filter(
          (task) =>
            !term ||
            task.subject.toLowerCase().includes(term) ||
            task.fromEmail.toLowerCase().includes(term) ||
            task.bodyPreview?.toLowerCase().includes(term)
        )
        return (
          <>
            {(all.length > 0 || filtering) && (
              <SectionToolbar
                grow={
                  <SearchField
                    label='Search tasks'
                    placeholder='Search tasks…'
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
            )}
            <SettingsList
              title='Tasks'
              empty={
                filtered.length > 0
                  ? undefined
                  : filtering
                    ? { title: 'No matching tasks' }
                    : {
                        title: 'No email tasks yet',
                        description: address ? `Email ${address} to start a task` : undefined,
                      }
              }
            >
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
                  return task.chatId &&
                    (task.status === 'completed' || task.status === 'failed') ? (
                    <ActivityRow
                      key={task.id}
                      title={task.subject}
                      detail={detail}
                      textMetadata={metadata}
                      href={hrefFor(surfaceHref(scope, `/chat/${task.chatId}`))}
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
              <LoadMoreFooter
                state={{
                  hasMore: tasks.hasNextPage,
                  loading: tasks.isFetchingNextPage,
                  error: tasks.isFetchNextPageError
                    ? getErrorMessage(tasks.error, 'Couldn’t load more tasks')
                    : undefined,
                  onLoadMore: () => void tasks.fetchNextPage(),
                }}
              />
            </SettingsList>
          </>
        )
      }}
    </SettingsRead>
  )
}
