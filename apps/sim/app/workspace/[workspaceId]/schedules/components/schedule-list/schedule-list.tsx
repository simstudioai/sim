'use client'

import { useMemo, useState } from 'react'
import { Pause, Play, Search } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  Trash,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { formatAbsoluteDate, formatRelativeTime } from '@/lib/core/utils/formatting'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'
import {
  useDeleteSchedule,
  useDisableSchedule,
  useReactivateSchedule,
  useWorkspaceSchedules,
} from '@/hooks/queries/schedules'
import { useDebounce } from '@/hooks/use-debounce'

function getHumanReadable(s: WorkspaceScheduleData) {
  if (!s.cronExpression && s.nextRunAt) return `Once at ${formatAbsoluteDate(s.nextRunAt)}`
  if (s.cronExpression) return parseCronToHumanReadable(s.cronExpression, s.timezone)
  return 'Unknown schedule'
}

function getJobType(job: WorkspaceScheduleData): { label: string; color: string } {
  if (job.lifecycle === 'until_complete')
    return { label: 'Until done', color: 'text-amber-600 dark:text-amber-400' }
  if (!job.cronExpression && job.nextRunAt)
    return { label: 'One-time', color: 'text-blue-600 dark:text-blue-400' }
  return { label: 'Recurring', color: 'text-[var(--text-muted)]' }
}

function TimestampCell({ value }: { value: string | null }) {
  if (!value) return <span>—</span>
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span>{formatRelativeTime(value)}</span>
      </Tooltip.Trigger>
      <Tooltip.Content>{formatAbsoluteDate(value)}</Tooltip.Content>
    </Tooltip.Root>
  )
}

function ScheduleActions({
  item,
  workspaceId,
}: {
  item: WorkspaceScheduleData
  workspaceId: string
}) {
  const disable = useDisableSchedule()
  const reactivate = useReactivateSchedule()
  const remove = useDeleteSchedule()

  const isActive = item.status === 'active'

  return (
    <div className='flex items-center gap-[4px]'>
      {isActive ? (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                disable.mutate({ scheduleId: item.id, workspaceId })
              }}
              className='h-[28px] w-[28px] p-0'
              disabled={disable.isPending}
              aria-label='Disable schedule'
            >
              <Pause className='h-[14px] w-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Disable</Tooltip.Content>
        </Tooltip.Root>
      ) : (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                reactivate.mutate({
                  scheduleId: item.id,
                  workflowId: item.workflowId ?? '',
                  blockId: '',
                  workspaceId,
                })
              }}
              className='h-[28px] w-[28px] p-0'
              disabled={reactivate.isPending}
              aria-label='Enable schedule'
            >
              <Play className='h-[14px] w-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Enable</Tooltip.Content>
        </Tooltip.Root>
      )}
      {item.sourceType === 'job' && (
        <Tooltip.Root>
          <Tooltip.Trigger asChild>
            <Button
              variant='ghost'
              onClick={(e) => {
                e.stopPropagation()
                remove.mutate({ scheduleId: item.id, workspaceId })
              }}
              className='h-[28px] w-[28px] p-0'
              disabled={remove.isPending}
              aria-label='Delete job'
            >
              <Trash className='h-[14px] w-[14px]' />
            </Button>
          </Tooltip.Trigger>
          <Tooltip.Content>Delete</Tooltip.Content>
        </Tooltip.Root>
      )}
    </div>
  )
}

export function ScheduleList() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string

  const { data: allItems = [], isLoading, error } = useWorkspaceSchedules(workspaceId)

  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)

  const { workflowSchedules, jobs } = useMemo(() => {
    const ws: WorkspaceScheduleData[] = []
    const j: WorkspaceScheduleData[] = []
    for (const item of allItems) {
      if (item.status === 'completed') continue
      if (item.sourceType === 'job') j.push(item)
      else ws.push(item)
    }
    return { workflowSchedules: ws, jobs: j }
  }, [allItems])

  const filteredSchedules = useMemo(() => {
    if (!debouncedSearchQuery) return workflowSchedules
    const q = debouncedSearchQuery.toLowerCase()
    return workflowSchedules.filter(
      (s) =>
        s.workflowName?.toLowerCase().includes(q) || getHumanReadable(s).toLowerCase().includes(q)
    )
  }, [workflowSchedules, debouncedSearchQuery])

  const filteredJobs = useMemo(() => {
    if (!debouncedSearchQuery) return jobs
    const q = debouncedSearchQuery.toLowerCase()
    return jobs.filter(
      (j) =>
        j.jobTitle?.toLowerCase().includes(q) ||
        j.sourceTaskName?.toLowerCase().includes(q) ||
        getHumanReadable(j).toLowerCase().includes(q)
    )
  }, [jobs, debouncedSearchQuery])

  const handleScheduleClick = (workflowId: string) => {
    router.push(`/workspace/${workspaceId}/w/${workflowId}`)
  }

  return (
    <div className='flex h-full flex-col'>
      {/* Search */}
      <div className='mt-[14px] flex items-center justify-between'>
        <div className='flex h-[32px] w-[400px] items-center gap-[6px] rounded-[8px] bg-[var(--surface-4)] px-[8px]'>
          <Search className='h-[14px] w-[14px] text-[var(--text-subtle)]' />
          <Input
            placeholder='Search'
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className='flex-1 border-0 bg-transparent px-0 font-medium text-[var(--text-secondary)] text-small leading-none placeholder:text-[var(--text-subtle)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
      </div>

      {/* Content */}
      <div className='mt-[24px] min-h-0 flex-1 overflow-y-auto'>
        {isLoading ? (
          <ScheduleTableSkeleton />
        ) : error ? (
          <div className='flex h-full items-center justify-center text-[14px] text-[var(--text-muted)]'>
            Failed to load schedules
          </div>
        ) : filteredSchedules.length === 0 && filteredJobs.length === 0 ? (
          <div className='flex h-full items-center justify-center text-[14px] text-[var(--text-muted)]'>
            {debouncedSearchQuery
              ? `No results matching "${searchQuery}"`
              : 'No schedules or jobs yet'}
          </div>
        ) : (
          <div className='space-y-[32px]'>
            {/* Workflow schedules */}
            {filteredSchedules.length > 0 && (
              <section>
                <h2 className='mb-[12px] font-medium text-[15px] text-[var(--text-secondary)]'>
                  Schedules
                </h2>
                <Table className='table-fixed text-[14px]'>
                  <TableHeader>
                    <TableRow className='hover:bg-transparent'>
                      <TableHead className='w-[30%] px-[12px] py-[8px] text-[13px] text-[var(--text-secondary)]'>
                        Workflow
                      </TableHead>
                      <TableHead className='w-[26%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Schedule
                      </TableHead>
                      <TableHead className='w-[14%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Status
                      </TableHead>
                      <TableHead className='w-[15%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Next Run
                      </TableHead>
                      <TableHead className='w-[15%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSchedules.map((schedule) => (
                      <TableRow
                        key={schedule.id}
                        className='cursor-pointer hover:bg-[var(--surface-2)]'
                        onClick={() => {
                          if (schedule.workflowId) handleScheduleClick(schedule.workflowId)
                        }}
                      >
                        <TableCell className='px-[12px] py-[8px]'>
                          <div className='flex min-w-0 items-center gap-[8px]'>
                            <div
                              className='h-[8px] w-[8px] flex-shrink-0 rounded-full'
                              style={{
                                backgroundColor: schedule.workflowColor || '#3972F6',
                              }}
                            />
                            <span className='min-w-0 truncate font-normal text-[15px] text-[var(--text-primary)]'>
                              {schedule.workflowName}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px] text-[var(--text-muted)]'>
                          {getHumanReadable(schedule)}
                        </TableCell>
                        <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px]'>
                          <span
                            className={
                              schedule.status === 'active'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-[var(--text-muted)]'
                            }
                          >
                            {schedule.status}
                          </span>
                        </TableCell>
                        <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px] text-[var(--text-muted)]'>
                          <TimestampCell value={schedule.nextRunAt} />
                        </TableCell>
                        <TableCell className='px-[12px] py-[8px]'>
                          <ScheduleActions item={schedule} workspaceId={workspaceId} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}

            {/* Jobs */}
            {filteredJobs.length > 0 && (
              <section>
                <h2 className='mb-[12px] font-medium text-[15px] text-[var(--text-secondary)]'>
                  Jobs
                </h2>
                <Table className='table-fixed text-[14px]'>
                  <TableHeader>
                    <TableRow className='hover:bg-transparent'>
                      <TableHead className='w-[30%] px-[12px] py-[8px] text-[13px] text-[var(--text-secondary)]'>
                        Title
                      </TableHead>
                      <TableHead className='w-[22%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Schedule
                      </TableHead>
                      <TableHead className='w-[12%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Type
                      </TableHead>
                      <TableHead className='w-[10%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Status
                      </TableHead>
                      <TableHead className='w-[14%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Next Run
                      </TableHead>
                      <TableHead className='w-[12%] px-[12px] py-[8px] text-left text-[13px] text-[var(--text-secondary)]'>
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredJobs.map((job) => {
                      const jobType = getJobType(job)
                      return (
                        <TableRow key={job.id} className='hover:bg-[var(--surface-2)]'>
                          <TableCell className='px-[12px] py-[8px]'>
                            <div className='min-w-0 truncate font-normal text-[15px] text-[var(--text-primary)]'>
                              {job.jobTitle || job.sourceTaskName || '—'}
                            </div>
                          </TableCell>
                          <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px] text-[var(--text-muted)]'>
                            {getHumanReadable(job)}
                          </TableCell>
                          <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px]'>
                            <span className={jobType.color}>{jobType.label}</span>
                          </TableCell>
                          <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px]'>
                            <span
                              className={
                                job.status === 'active'
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-[var(--text-muted)]'
                              }
                            >
                              {job.status}
                            </span>
                          </TableCell>
                          <TableCell className='whitespace-nowrap px-[12px] py-[8px] text-[13px] text-[var(--text-muted)]'>
                            <TimestampCell value={job.nextRunAt} />
                          </TableCell>
                          <TableCell className='px-[12px] py-[8px]'>
                            <ScheduleActions item={job} workspaceId={workspaceId} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduleTableSkeleton() {
  return (
    <Table className='table-fixed text-[14px]'>
      <TableHeader>
        <TableRow className='hover:bg-transparent'>
          <TableHead className='w-[30%] px-[12px] py-[8px]'>
            <Skeleton className='h-[12px] w-[60px]' />
          </TableHead>
          <TableHead className='w-[26%] px-[12px] py-[8px]'>
            <Skeleton className='h-[12px] w-[56px]' />
          </TableHead>
          <TableHead className='w-[14%] px-[12px] py-[8px]'>
            <Skeleton className='h-[12px] w-[40px]' />
          </TableHead>
          <TableHead className='w-[15%] px-[12px] py-[8px]'>
            <Skeleton className='h-[12px] w-[52px]' />
          </TableHead>
          <TableHead className='w-[15%] px-[12px] py-[8px]'>
            <Skeleton className='h-[12px] w-[48px]' />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: 3 }, (_, i) => (
          <TableRow key={i} className='hover:bg-transparent'>
            <TableCell className='px-[12px] py-[8px]'>
              <div className='flex min-w-0 items-center gap-[8px]'>
                <Skeleton className='h-[8px] w-[8px] rounded-full' />
                <Skeleton className='h-[14px] w-[140px]' />
              </div>
            </TableCell>
            <TableCell className='whitespace-nowrap px-[12px] py-[8px]'>
              <Skeleton className='h-[12px] w-[120px]' />
            </TableCell>
            <TableCell className='whitespace-nowrap px-[12px] py-[8px]'>
              <Skeleton className='h-[12px] w-[48px]' />
            </TableCell>
            <TableCell className='whitespace-nowrap px-[12px] py-[8px]'>
              <Skeleton className='h-[12px] w-[56px]' />
            </TableCell>
            <TableCell className='px-[12px] py-[8px]'>
              <div className='flex items-center gap-[4px]'>
                <Skeleton className='h-[28px] w-[28px] rounded-[4px]' />
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
