import { useCallback, useEffect, useRef } from 'react'
import { getWorkflowLockToggleIds } from '@/app/workspace/[workspaceId]/w/[workflowId]/utils'
import type { AddNotificationParams } from '@/stores/notifications'
import { useNotificationStore } from '@/stores/notifications'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface UseLockNotificationsProps {
  allBlocksLocked: boolean
  isWorkflowReady: boolean
  canAdmin: boolean
  addNotification: (params: AddNotificationParams) => string
  activeWorkflowId: string | null
  collaborativeBatchToggleLocked: (ids: string[]) => void
}

export function useLockNotifications({
  allBlocksLocked,
  isWorkflowReady,
  canAdmin,
  addNotification,
  activeWorkflowId,
  collaborativeBatchToggleLocked,
}: UseLockNotificationsProps) {
  const lockNotificationIdRef = useRef<string | null>(null)

  const clearLockNotification = useCallback(() => {
    if (lockNotificationIdRef.current) {
      useNotificationStore.getState().removeNotification(lockNotificationIdRef.current)
      lockNotificationIdRef.current = null
    }
  }, [])

  useEffect(() => {
    clearLockNotification()

    if (!activeWorkflowId) return
    const store = useNotificationStore.getState()
    const stale = store.notifications.filter(
      (n) =>
        n.workflowId === activeWorkflowId &&
        (n.action?.type === 'unlock-workflow' || n.message.startsWith('This workflow is locked'))
    )
    for (const n of stale) {
      store.removeNotification(n.id)
    }
  }, [activeWorkflowId, clearLockNotification])

  const prevCanAdminRef = useRef(canAdmin)
  useEffect(() => {
    if (!isWorkflowReady) return

    const canAdminChanged = prevCanAdminRef.current !== canAdmin
    prevCanAdminRef.current = canAdmin

    if (canAdminChanged) {
      clearLockNotification()
    }

    if (allBlocksLocked) {
      if (lockNotificationIdRef.current) return

      lockNotificationIdRef.current = addNotification({
        level: 'info',
        message: canAdmin
          ? 'This workflow is locked'
          : 'This workflow is locked. Ask an admin to unlock it.',
        workflowId: activeWorkflowId || undefined,
        ...(canAdmin ? { action: { type: 'unlock-workflow' as const, message: '' } } : {}),
      })
    } else {
      clearLockNotification()
    }
  }, [
    allBlocksLocked,
    isWorkflowReady,
    canAdmin,
    addNotification,
    activeWorkflowId,
    clearLockNotification,
  ])

  useEffect(() => clearLockNotification, [clearLockNotification])

  useEffect(() => {
    const handleUnlockWorkflow = () => {
      const currentBlocks = useWorkflowStore.getState().blocks
      const ids = getWorkflowLockToggleIds(currentBlocks, false)
      if (ids.length > 0) collaborativeBatchToggleLocked(ids)
    }

    const handleToggleWorkflowLockEvent = (e: Event) => {
      const detail = (e as CustomEvent<{ blockIds: string[] }>).detail
      collaborativeBatchToggleLocked(detail.blockIds)
    }

    window.addEventListener('unlock-workflow', handleUnlockWorkflow)
    window.addEventListener('toggle-workflow-lock', handleToggleWorkflowLockEvent as EventListener)
    return () => {
      window.removeEventListener('unlock-workflow', handleUnlockWorkflow)
      window.removeEventListener(
        'toggle-workflow-lock',
        handleToggleWorkflowLockEvent as EventListener
      )
    }
  }, [collaborativeBatchToggleLocked])

  const handleToggleWorkflowLock = useCallback(() => {
    const currentBlocks = useWorkflowStore.getState().blocks
    const allLocked = Object.values(currentBlocks).every((b) => b.locked)
    const ids = getWorkflowLockToggleIds(currentBlocks, !allLocked)
    if (ids.length > 0) collaborativeBatchToggleLocked(ids)
  }, [collaborativeBatchToggleLocked])

  return { handleToggleWorkflowLock }
}
