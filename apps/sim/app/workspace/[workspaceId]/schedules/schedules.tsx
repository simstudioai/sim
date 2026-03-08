'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { Calendar } from '@/components/emcn/icons'
import { formatAbsoluteDate } from '@/lib/core/utils/formatting'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'
import { useWorkspaceSchedules } from '@/hooks/queries/schedules'
import { useDebounce } from '@/hooks/use-debounce'

const logger = createLogger('Schedules')

function getHumanReadable(s: WorkspaceScheduleData) {
  if (!s.cronExpression && s.nextRunAt) return `Once at ${formatAbsoluteDate(s.nextRunAt)}`
  if (s.cronExpression) return parseCronToHumanReadable(s.cronExpression, s.timezone)
  return 'Unknown schedule'
}

const COLUMNS: ResourceColumn[] = [
  { id: 'name', header: 'Name' },
  { id: 'nextRun', header: 'Next Run' },
  { id: 'lastRun', header: 'Last Run' },
  { id: 'schedule', header: 'Schedule' },
  { id: 'from', header: 'From' },
  { id: 'lifecycle', header: 'Lifecycle' },
]

export function Schedules() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { data: allItems = [], isLoading, error } = useWorkspaceSchedules(workspaceId)

  if (error) {
    logger.error('Failed to load schedules:', error)
  }

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
        const name = isJob ? item.jobTitle || item.sourceTaskName : item.workflowName

        return {
          id: item.id,
          cells: {
            name: {
              icon: <Calendar className='h-[14px] w-[14px]' />,
              label: name,
            },
            nextRun: timeCell(item.nextRunAt),
            lastRun: timeCell(item.lastRanAt),
            schedule: { label: getHumanReadable(item) },
            from: { label: isJob ? item.prompt : item.workflowName },
            lifecycle: { label: item.cronExpression ? 'Recurring' : 'One-time' },
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

  return (
    <Resource
      icon={Calendar}
      title='Schedules'
      create={{
        label: 'New schedule',
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
    />
  )
}
