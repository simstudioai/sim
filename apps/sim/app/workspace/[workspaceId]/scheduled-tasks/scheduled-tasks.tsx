'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import {
  Button,
  Combobox,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
} from '@/components/emcn'
import { Calendar } from '@/components/emcn/icons'
import { formatAbsoluteDate } from '@/lib/core/utils/formatting'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import type {
  FilterTag,
  ResourceColumn,
  ResourceRow,
  SortConfig,
} from '@/app/workspace/[workspaceId]/components'
import { Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import { ScheduleModal } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/create-schedule-modal'
import { ScheduleContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-context-menu'
import { ScheduleListContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-list-context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'
import {
  useDeleteSchedule,
  useDisableSchedule,
  useReactivateSchedule,
  useWorkspaceSchedules,
} from '@/hooks/queries/schedules'
import { useDebounce } from '@/hooks/use-debounce'

const logger = createLogger('ScheduledTasks')

function getScheduleDescription(s: WorkspaceScheduleData) {
  if (!s.cronExpression && s.nextRunAt) return `Once, at ${formatAbsoluteDate(s.nextRunAt)}`
  if (s.cronExpression) {
    const timing = parseCronToHumanReadable(s.cronExpression, s.timezone)
    return `Recurring, ${timing.charAt(0).toLowerCase()}${timing.slice(1)}`
  }
  return '-  -  -'
}

const COLUMNS: ResourceColumn[] = [
  { id: 'task', header: 'Task' },
  { id: 'schedule', header: 'Schedule', widthMultiplier: 1.5 },
  { id: 'nextRun', header: 'Next Run' },
  { id: 'lastRun', header: 'Last Run' },
]

export function ScheduledTasks() {
  const params = useParams()
  const workspaceId = params.workspaceId as string

  const { data: allItems = [], isLoading, error } = useWorkspaceSchedules(workspaceId)
  const deleteSchedule = useDeleteSchedule()
  const disableSchedule = useDisableSchedule()
  const reactivateSchedule = useReactivateSchedule()

  if (error) {
    logger.error('Failed to load scheduled tasks:', error)
  }

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    menuRef: rowMenuRef,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [activeTask, setActiveTask] = useState<WorkspaceScheduleData | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const [activeSort, setActiveSort] = useState<{
    column: string
    direction: 'asc' | 'desc'
  } | null>(null)
  const [scheduleTypeFilter, setScheduleTypeFilter] = useState<string[]>([])
  const [statusFilter, setStatusFilter] = useState<string[]>([])
  const [healthFilter, setHealthFilter] = useState<string[]>([])

  const visibleItems = useMemo(
    () => allItems.filter((item) => item.sourceType === 'job' && item.status !== 'completed'),
    [allItems]
  )

  const filteredItems = useMemo(() => {
    let result = debouncedSearchQuery
      ? visibleItems.filter((item) => {
          const task = item.prompt || ''
          return (
            task.toLowerCase().includes(debouncedSearchQuery.toLowerCase()) ||
            getScheduleDescription(item).toLowerCase().includes(debouncedSearchQuery.toLowerCase())
          )
        })
      : visibleItems

    if (scheduleTypeFilter.length > 0) {
      result = result.filter((item) => {
        if (scheduleTypeFilter.includes('recurring') && Boolean(item.cronExpression)) return true
        if (scheduleTypeFilter.includes('once') && !item.cronExpression) return true
        return false
      })
    }

    if (statusFilter.length > 0) {
      result = result.filter((item) => {
        if (statusFilter.includes('active') && item.status === 'active') return true
        if (statusFilter.includes('paused') && item.status === 'disabled') return true
        return false
      })
    }

    if (healthFilter.includes('has-failures')) {
      result = result.filter((item) => (item.failedCount ?? 0) > 0)
    }

    const col = activeSort?.column ?? 'nextRun'
    const dir = activeSort?.direction ?? 'desc'
    return [...result].sort((a, b) => {
      let cmp = 0
      switch (col) {
        case 'task':
          cmp = (a.prompt || '').localeCompare(b.prompt || '')
          break
        case 'nextRun':
          cmp =
            (a.nextRunAt ? new Date(a.nextRunAt).getTime() : 0) -
            (b.nextRunAt ? new Date(b.nextRunAt).getTime() : 0)
          break
        case 'lastRun':
          cmp =
            (a.lastRanAt ? new Date(a.lastRanAt).getTime() : 0) -
            (b.lastRanAt ? new Date(b.lastRanAt).getTime() : 0)
          break
        case 'schedule':
          cmp = getScheduleDescription(a).localeCompare(getScheduleDescription(b))
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }, [
    visibleItems,
    debouncedSearchQuery,
    scheduleTypeFilter,
    statusFilter,
    healthFilter,
    activeSort,
  ])

  const rows: ResourceRow[] = useMemo(
    () =>
      filteredItems.map((item) => ({
        id: item.id,
        cells: {
          task: {
            icon: <Calendar className='h-[14px] w-[14px]' />,
            label: item.prompt,
          },
          schedule: { label: getScheduleDescription(item) },
          nextRun: timeCell(item.nextRunAt),
          lastRun: timeCell(item.lastRanAt),
        },
      })),
    [filteredItems]
  )

  const itemById = useMemo(() => new Map(filteredItems.map((i) => [i.id, i])), [filteredItems])

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      setActiveTask(itemById.get(rowId) ?? null)
      handleRowCtxMenu(e)
    },
    [itemById, handleRowCtxMenu]
  )

  const handleContentContextMenu = useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (
        target.closest('[data-resource-row]') ||
        target.closest('button, input, a, [role="button"]')
      ) {
        return
      }
      handleListContextMenu(e)
    },
    [handleListContextMenu]
  )

  const handleDelete = async () => {
    if (!activeTask) return
    try {
      await deleteSchedule.mutateAsync({ scheduleId: activeTask.id, workspaceId })
      setIsDeleteDialogOpen(false)
      setActiveTask(null)
    } catch (err) {
      logger.error('Failed to delete scheduled task:', err)
    }
  }

  const handlePause = async () => {
    if (!activeTask) return
    try {
      await disableSchedule.mutateAsync({ scheduleId: activeTask.id, workspaceId })
    } catch (err) {
      logger.error('Failed to pause scheduled task:', err)
    }
  }

  const handleResume = async () => {
    if (!activeTask) return
    try {
      await reactivateSchedule.mutateAsync({
        scheduleId: activeTask.id,
        workflowId: activeTask.workflowId || '',
        blockId: '',
        workspaceId,
      })
    } catch (err) {
      logger.error('Failed to resume scheduled task:', err)
    }
  }

  const sortConfig: SortConfig = useMemo(
    () => ({
      options: [
        { id: 'task', label: 'Task' },
        { id: 'schedule', label: 'Schedule' },
        { id: 'nextRun', label: 'Next Run' },
        { id: 'lastRun', label: 'Last Run' },
      ],
      active: activeSort,
      onSort: (column, direction) => setActiveSort({ column, direction }),
      onClear: () => setActiveSort(null),
    }),
    [activeSort]
  )

  const scheduleTypeDisplayLabel = useMemo(() => {
    if (scheduleTypeFilter.length === 0) return 'All'
    if (scheduleTypeFilter.length === 1)
      return scheduleTypeFilter[0] === 'recurring' ? 'Recurring' : 'One-time'
    return `${scheduleTypeFilter.length} selected`
  }, [scheduleTypeFilter])

  const statusDisplayLabel = useMemo(() => {
    if (statusFilter.length === 0) return 'All'
    if (statusFilter.length === 1) return statusFilter[0] === 'active' ? 'Active' : 'Paused'
    return `${statusFilter.length} selected`
  }, [statusFilter])

  const healthDisplayLabel = useMemo(() => {
    if (healthFilter.length === 0) return 'All'
    return 'Has failures'
  }, [healthFilter])

  const hasActiveFilters =
    scheduleTypeFilter.length > 0 || statusFilter.length > 0 || healthFilter.length > 0

  const filterContent = useMemo(
    () => (
      <div className='flex w-[240px] flex-col gap-3 p-3'>
        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>
            Schedule Type
          </span>
          <Combobox
            options={[
              { value: 'recurring', label: 'Recurring' },
              { value: 'once', label: 'One-time' },
            ]}
            multiSelect
            multiSelectValues={scheduleTypeFilter}
            onMultiSelectChange={setScheduleTypeFilter}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>
                {scheduleTypeDisplayLabel}
              </span>
            }
            showAllOption
            allOptionLabel='All'
            size='sm'
            className='h-[32px] w-full rounded-md'
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>Status</span>
          <Combobox
            options={[
              { value: 'active', label: 'Active' },
              { value: 'paused', label: 'Paused' },
            ]}
            multiSelect
            multiSelectValues={statusFilter}
            onMultiSelectChange={setStatusFilter}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{statusDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All'
            size='sm'
            className='h-[32px] w-full rounded-md'
          />
        </div>
        <div className='flex flex-col gap-1.5'>
          <span className='font-medium text-[var(--text-secondary)] text-caption'>Health</span>
          <Combobox
            options={[{ value: 'has-failures', label: 'Has failures' }]}
            multiSelect
            multiSelectValues={healthFilter}
            onMultiSelectChange={setHealthFilter}
            overlayContent={
              <span className='truncate text-[var(--text-primary)]'>{healthDisplayLabel}</span>
            }
            showAllOption
            allOptionLabel='All'
            size='sm'
            className='h-[32px] w-full rounded-md'
          />
        </div>
        {hasActiveFilters && (
          <button
            type='button'
            onClick={() => {
              setScheduleTypeFilter([])
              setStatusFilter([])
              setHealthFilter([])
            }}
            className='flex h-[32px] w-full items-center justify-center rounded-md text-[var(--text-secondary)] text-caption transition-colors hover-hover:bg-[var(--surface-active)]'
          >
            Clear all filters
          </button>
        )}
      </div>
    ),
    [
      scheduleTypeFilter,
      statusFilter,
      healthFilter,
      scheduleTypeDisplayLabel,
      statusDisplayLabel,
      healthDisplayLabel,
      hasActiveFilters,
    ]
  )

  const filterTags: FilterTag[] = useMemo(() => {
    const tags: FilterTag[] = []
    if (scheduleTypeFilter.length > 0) {
      const label =
        scheduleTypeFilter.length === 1
          ? `Type: ${scheduleTypeFilter[0] === 'recurring' ? 'Recurring' : 'One-time'}`
          : `Type: ${scheduleTypeFilter.length} selected`
      tags.push({ label, onRemove: () => setScheduleTypeFilter([]) })
    }
    if (statusFilter.length > 0) {
      const label =
        statusFilter.length === 1
          ? `Status: ${statusFilter[0] === 'active' ? 'Active' : 'Paused'}`
          : `Status: ${statusFilter.length} selected`
      tags.push({ label, onRemove: () => setStatusFilter([]) })
    }
    if (healthFilter.length > 0) {
      tags.push({ label: 'Health: Has failures', onRemove: () => setHealthFilter([]) })
    }
    return tags
  }, [scheduleTypeFilter, statusFilter, healthFilter])

  return (
    <>
      <Resource
        icon={Calendar}
        title='Scheduled Tasks'
        create={{
          label: 'New scheduled task',
          onClick: () => setIsCreateModalOpen(true),
        }}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search scheduled tasks...',
        }}
        sort={sortConfig}
        filter={filterContent}
        filterTags={filterTags}
        columns={COLUMNS}
        rows={rows}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
        onContextMenu={handleContentContextMenu}
      />

      <ScheduleListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateSchedule={() => setIsCreateModalOpen(true)}
      />

      <ScheduleContextMenu
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        onClose={closeRowContextMenu}
        isActive={activeTask?.status === 'active'}
        onEdit={() => setIsEditModalOpen(true)}
        onPause={handlePause}
        onResume={handleResume}
        onDelete={() => setIsDeleteDialogOpen(true)}
      />

      <ScheduleModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        workspaceId={workspaceId}
      />

      <ScheduleModal
        key={activeTask?.id ?? 'new'}
        open={isEditModalOpen}
        onOpenChange={(open) => {
          setIsEditModalOpen(open)
          if (!open) setActiveTask(null)
        }}
        workspaceId={workspaceId}
        schedule={activeTask ?? undefined}
      />

      <Modal open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Delete Scheduled Task</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {activeTask?.jobTitle || 'this task'}
              </span>
              ? This action cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setIsDeleteDialogOpen(false)
                setActiveTask(null)
              }}
              disabled={deleteSchedule.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDelete}
              disabled={deleteSchedule.isPending}
            >
              {deleteSchedule.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
