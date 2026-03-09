'use client'

import { useCallback, useMemo, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useParams, useRouter } from 'next/navigation'
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@/components/emcn'
import { Calendar } from '@/components/emcn/icons'
import { formatAbsoluteDate } from '@/lib/core/utils/formatting'
import { parseCronToHumanReadable } from '@/lib/workflows/schedules/utils'
import type { ResourceColumn, ResourceRow } from '@/app/workspace/[workspaceId]/components'
import { Resource, timeCell } from '@/app/workspace/[workspaceId]/components'
import { ScheduleModal } from '@/app/workspace/[workspaceId]/schedules/components/create-schedule-modal'
import { ScheduleContextMenu } from '@/app/workspace/[workspaceId]/schedules/components/schedule-context-menu'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import type { WorkspaceScheduleData } from '@/hooks/queries/schedules'
import {
  useDeleteSchedule,
  useDisableSchedule,
  useReactivateSchedule,
  useWorkspaceSchedules,
} from '@/hooks/queries/schedules'
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
  const deleteSchedule = useDeleteSchedule()
  const disableSchedule = useDisableSchedule()
  const reactivateSchedule = useReactivateSchedule()

  if (error) {
    logger.error('Failed to load schedules:', error)
  }

  const {
    isOpen: isRowContextMenuOpen,
    position: rowContextMenuPosition,
    menuRef: rowMenuRef,
    handleContextMenu: handleRowCtxMenu,
    closeMenu: closeRowContextMenu,
  } = useContextMenu()

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [activeSchedule, setActiveSchedule] = useState<WorkspaceScheduleData | null>(null)
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
          sortValues: {
            nextRun: item.nextRunAt ? -new Date(item.nextRunAt).getTime() : 0,
            lastRun: item.lastRanAt ? -new Date(item.lastRanAt).getTime() : 0,
          },
        }
      }),
    [filteredItems]
  )

  const itemById = useMemo(() => new Map(filteredItems.map((i) => [i.id, i])), [filteredItems])

  const handleRowClick = useCallback(
    (rowId: string) => {
      if (isRowContextMenuOpen) return
      const item = itemById.get(rowId)
      if (item?.workflowId) {
        router.push(`/workspace/${workspaceId}/w/${item.workflowId}`)
      }
    },
    [itemById, isRowContextMenuOpen, router, workspaceId]
  )

  const handleRowContextMenu = useCallback(
    (e: React.MouseEvent, rowId: string) => {
      const item = itemById.get(rowId) ?? null
      setActiveSchedule(item)
      handleRowCtxMenu(e)
    },
    [itemById, handleRowCtxMenu]
  )

  const handleDelete = async () => {
    if (!activeSchedule) return
    try {
      await deleteSchedule.mutateAsync({
        scheduleId: activeSchedule.id,
        workspaceId,
      })
      setIsDeleteDialogOpen(false)
      setActiveSchedule(null)
    } catch (err) {
      logger.error('Failed to delete schedule:', err)
    }
  }

  const handlePause = async () => {
    if (!activeSchedule) return
    try {
      await disableSchedule.mutateAsync({
        scheduleId: activeSchedule.id,
        workspaceId,
      })
    } catch (err) {
      logger.error('Failed to pause schedule:', err)
    }
  }

  const handleResume = async () => {
    if (!activeSchedule) return
    try {
      await reactivateSchedule.mutateAsync({
        scheduleId: activeSchedule.id,
        workflowId: activeSchedule.workflowId || '',
        blockId: '',
        workspaceId,
      })
    } catch (err) {
      logger.error('Failed to resume schedule:', err)
    }
  }

  return (
    <>
      <Resource
        icon={Calendar}
        title='Schedules'
        create={{
          label: 'New schedule',
          onClick: () => setIsCreateModalOpen(true),
        }}
        search={{
          value: searchQuery,
          onChange: setSearchQuery,
          placeholder: 'Search schedules...',
        }}
        defaultSort='nextRun'
        onSort={() => {}}
        onFilter={() => {}}
        columns={COLUMNS}
        rows={rows}
        onRowClick={handleRowClick}
        onRowContextMenu={handleRowContextMenu}
        isLoading={isLoading}
      />

      <ScheduleContextMenu
        isOpen={isRowContextMenuOpen}
        position={rowContextMenuPosition}
        menuRef={rowMenuRef}
        onClose={closeRowContextMenu}
        isJob={activeSchedule?.sourceType === 'job'}
        isActive={activeSchedule?.status === 'active'}
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
          if (!open) setActiveSchedule(null)
        }}
        workspaceId={workspaceId}
        schedule={activeSchedule ?? undefined}
      />

      <Modal open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <ModalContent className='w-[400px]'>
          <ModalHeader>Delete Schedule</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Are you sure you want to delete{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {activeSchedule?.jobTitle || activeSchedule?.workflowName || 'this schedule'}
              </span>
              ? <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setIsDeleteDialogOpen(false)
                setActiveSchedule(null)
              }}
              disabled={deleteSchedule.isPending}
            >
              Cancel
            </Button>
            <Button variant='default' onClick={handleDelete} disabled={deleteSchedule.isPending}>
              {deleteSchedule.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
