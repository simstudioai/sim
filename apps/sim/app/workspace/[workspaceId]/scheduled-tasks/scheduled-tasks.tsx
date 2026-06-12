'use client'

import { useCallback, useMemo, useState } from 'react'
import { Calendar, ChipConfirmModal, Plus } from '@/components/emcn'
import type { ResourceAction } from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import { ScheduleCalendar } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar'
import { ScheduleListContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-list-context-menu'
import { TaskContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-context-menu'
import { TaskDetailsModal } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-details-modal'
import { TaskModal } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal'
import { useCalendar } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-calendar'
import { useScheduledTasks } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-scheduled-tasks'
import type { ScheduledTask } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

export function ScheduledTasks() {
  const calendar = useCalendar()
  const tasks = useScheduledTasks()

  /** Pending tasks open the editable TaskModal; running/finished open the record. */
  const editTask = tasks.selectedTask?.status === 'pending' ? tasks.selectedTask : null
  const recordTask = tasks.selectedTask?.status !== 'pending' ? tasks.selectedTask : null

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

  const {
    isOpen: isTaskContextMenuOpen,
    position: taskContextMenuPosition,
    handleContextMenu: handleTaskCtxMenu,
    closeMenu: closeTaskContextMenu,
  } = useContextMenu()

  /** The right-clicked task — drives the context menu items and delete confirm. */
  const [contextTask, setContextTask] = useState<ScheduledTask | null>(null)
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false)

  const handleTaskContextMenu = useCallback(
    (task: ScheduledTask, e: React.MouseEvent) => {
      closeListContextMenu()
      setContextTask(task)
      handleTaskCtxMenu(e)
    },
    [closeListContextMenu, handleTaskCtxMenu]
  )

  /** Opens the right-clicked task's modal (edit for pending, record otherwise). */
  const openContextTask = useCallback(() => {
    if (contextTask) tasks.openTask(contextTask)
  }, [contextTask, tasks.openTask])

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

  const headerActions: ResourceAction[] = useMemo(
    () => [
      {
        text: 'New scheduled task',
        icon: Plus,
        onSelect: calendar.openCreate,
        variant: 'primary',
      },
    ],
    [calendar.openCreate]
  )

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header icon={Calendar} title='Scheduled Tasks' actions={headerActions} />
        <ScheduleCalendar
          scope={calendar.scope}
          anchor={calendar.anchor}
          today={calendar.today}
          onScopeChange={calendar.setScope}
          onPrev={calendar.prev}
          onNext={calendar.next}
          onToday={calendar.goToday}
          onSelectDate={calendar.goToDate}
          onSelectSlot={calendar.selectSlot}
          onSelectTask={tasks.openTask}
          onTaskContextMenu={handleTaskContextMenu}
          onShowDay={calendar.openDay}
          eventsByDay={tasks.eventsByDay}
          eventsByHour={tasks.eventsByHour}
        />
      </Resource>

      <ScheduleListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateSchedule={calendar.openCreate}
      />

      <TaskContextMenu
        isOpen={isTaskContextMenuOpen}
        position={taskContextMenuPosition}
        onClose={closeTaskContextMenu}
        task={contextTask}
        onSeeDetails={openContextTask}
        onEdit={openContextTask}
        onDelete={() => setIsConfirmDeleteOpen(true)}
      />

      <ChipConfirmModal
        open={isConfirmDeleteOpen}
        onOpenChange={(open) => {
          setIsConfirmDeleteOpen(open)
          if (!open) setContextTask(null)
        }}
        title='Delete scheduled task'
        text='This task will be removed from the calendar and will not run.'
        confirm={{
          label: 'Delete',
          onClick: () => {
            if (contextTask) tasks.deleteTask(contextTask.id)
            setIsConfirmDeleteOpen(false)
            setContextTask(null)
          },
        }}
      />

      {/* No seed-derived keys needed: modal content remounts on every open
          (the Radix portal unmounts closed content), re-seeding from `slot`/`task`. */}
      <TaskModal
        open={calendar.isCreateOpen}
        onOpenChange={(open) => {
          if (!open) calendar.closeCreate()
        }}
        slot={calendar.selectedSlot}
        onSubmit={tasks.addTask}
      />

      <TaskModal
        open={editTask !== null}
        onOpenChange={(open) => {
          if (!open) tasks.closeTask()
        }}
        task={editTask}
        onSubmit={(draft) => {
          if (editTask) tasks.updateTask(editTask.id, draft)
        }}
        onDelete={tasks.deleteTask}
      />

      <TaskDetailsModal task={recordTask} onClose={tasks.closeTask} />
    </>
  )
}
