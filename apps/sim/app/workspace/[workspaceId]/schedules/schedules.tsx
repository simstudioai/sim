'use client'

import { useCallback, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Calendar, MoreHorizontal } from '@/components/emcn/icons'
import { formatAbsoluteDate, formatRelativeTime } from '@/lib/core/utils/formatting'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'
import { useWorkspaceSchedules } from '@/hooks/queries/schedules'
import { useDebounce } from '@/hooks/use-debounce'

function getHumanReadable(s: WorkspaceScheduleData) {
  if (!s.cronExpression && s.nextRunAt) return `Once at ${formatAbsoluteDate(s.nextRunAt)}`
  if (s.cronExpression) return parseCronToHumanReadable(s.cronExpression, s.timezone)
  return 'Unknown schedule'
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name', width: 'w-[25%]' },
  { id: 'type', header: 'Type', width: 'w-[13%]' },
  { id: 'schedule', header: 'Schedule', width: 'w-[24%]' },
  { id: 'status', header: 'Status', width: 'w-[10%]' },
  { id: 'nextRun', header: 'Next Run', width: 'w-[18%]' },
  { id: 'actions', header: 'Actions', width: 'w-[10%]' },
]

export function Schedules() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { data: allItems = [], isLoading, error } = useWorkspaceSchedules(workspaceId)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const visibleItems = useMemo(
    () => allItems.filter((item) => item.status !== 'completed'),
    [allItems]
  )

  const filteredItems = useMemo(() => {
    if (!debouncedSearchQuery) return visibleItems
    const q = debouncedSearchQuery.toLowerCase()
    return visibleItems.filter((item) => {
      const name =
        item.sourceType === 'job'
          ? item.jobTitle || item.sourceTaskName || ''
          : item.workflowName || ''
      return name.toLowerCase().includes(q) || getHumanReadable(item).toLowerCase().includes(q)
    })
  }, [visibleItems, debouncedSearchQuery])

  const rows: ResourceRow[] = useMemo(
    () =>
      filteredItems.map((item) => {
        const isJob = item.sourceType === 'job'
        const name = isJob ? item.jobTitle || item.sourceTaskName || '—' : item.workflowName || '—'

        return {
          id: item.id,
          cells: {
            name: {
              icon: <Calendar className='h-[14px] w-[14px]' />,
              label: name,
            },
            type: { label: isJob ? 'Scheduled Task' : 'Workflow' },
            schedule: { label: getHumanReadable(item) },
            status: { label: item.status },
            nextRun: { label: item.nextRunAt ? formatRelativeTime(item.nextRunAt) : '—' },
            actions: {
              icon: <MoreHorizontal className='h-[14px] w-[14px]' />,
              label: '',
            },
          },
        }
      }),
    [filteredItems]
  )

  const handleRowClick = useCallback(
    (rowId: string) => {
      const item = filteredItems.find((i) => i.id === rowId)
      if (item?.workflowId) {
        router.push(`/workspace/${workspaceId}/w/${item.workflowId}`)
      }
    },
    [filteredItems, router, workspaceId]
  )

  const emptyState = useMemo(() => {
    if (debouncedSearchQuery) {
      return { title: 'No schedules found', description: 'Try a different search term' }
    }
    return {
      title: 'No schedules yet',
      description: 'Scheduled workflows and tasks will appear here',
    }
  }, [debouncedSearchQuery])

  return (
    <Resource
      icon={Calendar}
      title='Schedules'
      create={{
        label: 'Create',
        onClick: () => {},
      }}
      search={{
        value: searchQuery,
        onChange: setSearchQuery,
        placeholder: 'Search schedules...',
      }}
      onSort={() => {}}
      onFilter={() => {}}
      columns={COLUMNS}
      rows={rows}
      onRowClick={handleRowClick}
      isLoading={isLoading}
      error={
        error
          ? {
              title: 'Error loading schedules',
              description: error instanceof Error ? error.message : 'An error occurred',
            }
          : undefined
      }
      emptyState={emptyState}
    />
  )
}
