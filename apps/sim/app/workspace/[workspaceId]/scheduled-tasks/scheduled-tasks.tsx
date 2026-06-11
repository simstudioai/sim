'use client'

import { useCallback, useMemo } from 'react'
import { format } from 'date-fns'
import { Calendar, Plus } from '@/components/emcn'
import type { ResourceAction } from '@/app/workspace/[workspaceId]/components'
import { Resource } from '@/app/workspace/[workspaceId]/components'
import { CreateTaskModal } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/create-task-modal'
import { ScheduleCalendar } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-calendar'
import { ScheduleListContextMenu } from '@/app/workspace/[workspaceId]/scheduled-tasks/components/schedule-list-context-menu'
import { useCalendar } from '@/app/workspace/[workspaceId]/scheduled-tasks/hooks/use-calendar'
import { useContextMenu } from '@/app/workspace/[workspaceId]/w/components/sidebar/hooks'

export function ScheduledTasks() {
  const calendar = useCalendar()

  const {
    isOpen: isListContextMenuOpen,
    position: listContextMenuPosition,
    handleContextMenu: handleListContextMenu,
    closeMenu: closeListContextMenu,
  } = useContextMenu()

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

  const slotKey = calendar.selectedSlot
    ? `${format(calendar.selectedSlot.date, 'yyyy-MM-dd')}T${calendar.selectedSlot.time ?? ''}`
    : 'none'

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
          onSelectSlot={calendar.selectSlot}
        />
      </Resource>

      <ScheduleListContextMenu
        isOpen={isListContextMenuOpen}
        position={listContextMenuPosition}
        onClose={closeListContextMenu}
        onCreateSchedule={calendar.openCreate}
      />

      <CreateTaskModal
        key={slotKey}
        open={calendar.isCreateOpen}
        onOpenChange={(open) => {
          if (!open) calendar.closeCreate()
        }}
        slot={calendar.selectedSlot}
      />
    </>
  )
}
