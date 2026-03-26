'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'
import { Calendar } from '@/components/emcn/icons'
import { formatAbsoluteDate } from '@/lib/core/utils/formatting'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
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

  const visibleItems = useMemo(
    () => allItems.filter((item) => item.sourceType === 'job' && item.status !== 'completed'),
    [allItems]
  )

  const filteredItems = useMemo(() => {
    if (!debouncedSearchQuery) return visibleItems
    const q = debouncedSearchQuery.toLowerCase()
    return visibleItems.filter((item) => {
      const task = item.prompt || ''
      return (
        task.toLowerCase().includes(q) || getScheduleDescription(item).toLowerCase().includes(q)
      )
    })
  }, [visibleItems, debouncedSearchQuery])

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
        sortValues: {
          nextRun: item.nextRunAt ? -new Date(item.nextRunAt).getTime() : 0,
          lastRun: item.lastRanAt ? -new Date(item.lastRanAt).getTime() : 0,
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
        defaultSort='nextRun'
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
            <p className='text-[var(--text-secondary)] text-caption'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {activeTask?.jobTitle || 'this task'}
              </span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
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
