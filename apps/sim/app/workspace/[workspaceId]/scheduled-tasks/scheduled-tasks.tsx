'use client'

import { useCallback, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Calendar, Plus } from '@/components/emcn'
import type { ResourceAction } from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import { ScheduleCalendar } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar'
import { ScheduleListContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-list-context-menu'
import { TaskContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-context-menu'
import { TaskDeleteDialog } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-delete-dialog'
import { TaskDetailsModal } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-details-modal'
import {
  TaskModal,
  type TaskPrefill,
} from '@/app/workspace/[workspaceId]/scheduled-tasks/components/task-modal'
import { useCalendar } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-calendar'
import { useScheduledTasks } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-scheduled-tasks'
import { visibleRange } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/calendar-grid'
import type { ScheduledTask } from '@/app/workspace/[workspaceId]/scheduled-tasks/utils/schedule-events'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'
import { useTimezone } from '@/hooks/queries/general-settings'

export function ScheduledTasks() {
  const t = useTranslations('auto')
  const { workspaceId } = useParams<{ workspaceId: string }>()
  const timezone = useTimezone()
  const calendar = useCalendar(timezone)

  const range = useMemo(
    () => visibleRange(calendar.scope, calendar.anchor),
    [calendar.scope, calendar.anchor]
  )
  const tasks = useScheduledTasks({ workspaceId, rangeStart: range.start, rangeEnd: range.end })

  /** Pending tasks open the editable TaskModal; running/finished open the record. */
  const editTask = tasks.selectedTask?.status === 'pending' ? tasks.selectedTask : null
  const recordTask = tasks.selectedTask?.status !== 'pending' ? tasks.selectedTask : null
  const editSeed = editTask ? tasks.editSeedFor(editTask) : null

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

  /** The right-clicked task — drives the context menu items. */
  const [contextTask, setContextTask] = useState<ScheduledTask | null>(null)
  /** The task targeted for deletion — drives the (recurring-aware) delete dialog. */
  const [deletingTask, setDeletingTask] = useState<ScheduledTask | null>(null)
  /** Pre-fill for a duplicate — opens the create modal seeded from an existing task. */
  const [duplicatePrefill, setDuplicatePrefill] = useState<TaskPrefill | null>(null)

  /** Starts a blank create. The three modal sources are mutually exclusive, so it closes the others. */
  const handleOpenCreate = useCallback(() => {
    setDuplicatePrefill(null)
    tasks.closeTask()
    calendar.openCreate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.openCreate])

  /** Starts a slot-seeded create, closing any other open modal. */
  const handleSelectSlot = useCallback(
    (date: Date, time?: string) => {
      setDuplicatePrefill(null)
      tasks.closeTask()
      calendar.selectSlot(date, time)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendar.selectSlot]
  )

  /** Opens a task's edit/record modal, closing any create/duplicate flow. */
  const handleOpenTask = useCallback(
    (task: ScheduledTask) => {
      setDuplicatePrefill(null)
      calendar.closeCreate()
      tasks.openTask(task)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [calendar.closeCreate]
  )

  const handleDuplicate = useCallback(() => {
    if (!contextTask) return
    const seed = tasks.editSeedFor(contextTask)
    if (!seed) return
    const { scheduleId: _scheduleId, ...prefill } = seed
    calendar.closeCreate()
    tasks.closeTask()
    setDuplicatePrefill(prefill)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTask, calendar.closeCreate])

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
    if (contextTask) handleOpenTask(contextTask)
  }, [contextTask, handleOpenTask])

  const handlePauseContextTask = useCallback(() => {
    if (contextTask) tasks.pauseTask(contextTask.scheduleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTask])

  const handleResumeContextTask = useCallback(() => {
    if (contextTask) tasks.resumeTask(contextTask.scheduleId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextTask])

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
        onSelect: handleOpenCreate,
        variant: 'primary',
      },
    ],
    [handleOpenCreate]
  )

  return (
    <>
      <Resource onContextMenu={handleContentContextMenu}>
        <Resource.Header icon={Calendar} title={t('scheduled_tasks')} actions={headerActions} />
        <ScheduleCalendar
          scope={calendar.scope}
          anchor={calendar.anchor}
          today={calendar.today}
          timezone={timezone}
          onScopeChange={calendar.setScope}
          onPrev={calendar.prev}
          onNext={calendar.next}
          onToday={calendar.goToday}
          onSelectDate={calendar.goToDate}
          onSelectSlot={handleSelectSlot}
          onSelectTask={handleOpenTask}
          onTaskContextMenu={handleTaskContextMenu}
          onShowDay={calendar.openDay}
          eventsByDay={tasks.eventsByDay}
        />
      </Resource>

      <ScheduleListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateSchedule={handleOpenCreate}
      />

      <TaskContextMenu
        isOpen={isTaskContextMenuOpen}
        position={taskContextMenuPosition}
        onClose={closeTaskContextMenu}
        task={contextTask}
        onEdit={openContextTask}
        onDuplicate={handleDuplicate}
        onPause={handlePauseContextTask}
        onResume={handleResumeContextTask}
        onDelete={() => setDeletingTask(contextTask)}
      />

      <TaskDeleteDialog
        task={deletingTask}
        onClose={() => setDeletingTask(null)}
        onDeleteOccurrence={(task) => tasks.deleteOccurrence(task.scheduleId, task.runAt)}
        onDeleteSeries={(task) => tasks.deleteTask(task.scheduleId)}
      />

      <TaskModal
        open={calendar.isCreateOpen || duplicatePrefill !== null}
        onOpenChange={(open) => {
          if (!open) {
            calendar.closeCreate()
            setDuplicatePrefill(null)
          }
        }}
        slot={duplicatePrefill ? null : calendar.selectedSlot}
        prefill={duplicatePrefill}
        onSubmit={tasks.createTask}
      />

      <TaskModal
        open={editTask !== null && editSeed !== null}
        onOpenChange={(open) => {
          if (!open) tasks.closeTask()
        }}
        edit={editSeed}
        onSubmit={(draft) => {
          if (editTask) return tasks.updateTask(editTask.scheduleId, draft)
        }}
        onRequestDelete={() => {
          setDeletingTask(editTask)
          tasks.closeTask()
        }}
      />

      <TaskDetailsModal task={recordTask} onClose={tasks.closeTask} />
    </>
  )
}
