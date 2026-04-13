import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useRouter } from 'next/navigation'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { useLeaveWorkspace } from '@/hooks/queries/invitations'
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useUpdateWorkspace,
  useWorkspacesQuery,
  type Workspace,
} from '@/hooks/queries/workspace'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useWorkspaceManagement')

interface UseWorkspaceManagementProps {
  workspaceId: string
  sessionUserId?: string
}

/**
 * Manages workspace operations including fetching, switching, creating, deleting, and leaving workspaces.
 * Handles workspace validation, URL synchronization, and recency-based ordering.
 *
 * @param props.workspaceId - The current workspace ID from the URL
 * @param props.sessionUserId - The current user's session ID
 * @returns Workspace state and operations
 */
export function useWorkspaceManagement({
  workspaceId,
  sessionUserId,
}: UseWorkspaceManagementProps) {
  const router = useRouter()
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)

  const {
    data: workspaces = [],
    isLoading: isWorkspacesLoading,
    isFetching: isWorkspacesFetching,
  } = useWorkspacesQuery(Boolean(sessionUserId))

  const leaveWorkspaceMutation = useLeaveWorkspace()
  const createWorkspaceMutation = useCreateWorkspace()
  const deleteWorkspaceMutation = useDeleteWorkspace()
  const updateWorkspaceMutation = useUpdateWorkspace()

  const workspaceIdRef = useRef<string>(workspaceId)
  const workspacesRef = useRef<Workspace[]>(workspaces)
  const routerRef = useRef<ReturnType<typeof useRouter>>(router)
  const hasValidatedRef = useRef<boolean>(false)
  const lastTouchedRef = useRef<string | null>(null)
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  workspaceIdRef.current = workspaceId
  workspacesRef.current = workspaces
  routerRef.current = router

  const [recencySortKey, setRecencySortKey] = useState(0)

  useEffect(() => {
    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    }
  }, [])

  const touchRecency = useCallback((id: string) => {
    if (lastTouchedRef.current === id) return
    lastTouchedRef.current = id
    WorkspaceRecencyStorage.touch(id)
    const validIds = workspacesRef.current.map((w) => w.id)
    if (validIds.length > 0) {
      WorkspaceRecencyStorage.prune(new Set(validIds))
    }
    setRecencySortKey((k) => k + 1)

    if (syncTimerRef.current) clearTimeout(syncTimerRef.current)
    syncTimerRef.current = setTimeout(() => {
      fetch('/api/users/me/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastActiveWorkspaceId: id }),
      }).catch(() => {})
    }, 1000)
  }, [])

  const sortedWorkspaces = useMemo(
    () => WorkspaceRecencyStorage.sortByRecency(workspaces),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaces, recencySortKey]
  )

  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null
    return workspaces.find((w) => w.id === workspaceId) ?? null
  }, [workspaces, workspaceId])

  useEffect(() => {
    if (workspaceId) {
      touchRecency(workspaceId)
    }
  }, [workspaceId, touchRecency])

  const activeWorkspaceRef = useRef<Workspace | null>(activeWorkspace)
  activeWorkspaceRef.current = activeWorkspace

  useEffect(() => {
    if (isWorkspacesLoading || hasValidatedRef.current || !workspaces.length) {
      return
    }

    const currentWorkspaceId = workspaceIdRef.current
    const matchingWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)

    if (!matchingWorkspace) {
      if (isWorkspacesFetching) {
        return
      }
      logger.warn(`Workspace ${currentWorkspaceId} not found in user's workspaces`)
      const sorted = WorkspaceRecencyStorage.sortByRecency(workspaces)
      const fallbackWorkspace = sorted[0]
      logger.info(`Redirecting to fallback workspace: ${fallbackWorkspace.id}`)
      routerRef.current?.push(`/workspace/${fallbackWorkspace.id}/home`)
    }

    hasValidatedRef.current = true
  }, [workspaces, isWorkspacesLoading, isWorkspacesFetching])

  const updateWorkspace = useCallback(
    async (
      workspaceId: string,
      updates: { name?: string; color?: string; logoUrl?: string | null }
    ): Promise<boolean> => {
      try {
        await updateWorkspaceMutation.mutateAsync({ workspaceId, ...updates })
        logger.info('Successfully updated workspace:', updates)
        return true
      } catch (error) {
        logger.error('Error updating workspace:', error)
        return false
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  )

  const switchWorkspace = useCallback(
    async (workspace: Workspace) => {
      if (activeWorkspaceRef.current?.id === workspace.id) {
        return
      }

      try {
        switchToWorkspace(workspace.id)
        routerRef.current?.push(`/workspace/${workspace.id}/home`)
        logger.info(`Switched to workspace: ${workspace.name} (${workspace.id})`)
      } catch (error) {
        logger.error('Error switching workspace:', error)
      }
    },
    [switchToWorkspace]
  )

  const handleCreateWorkspace = useCallback(
    async (name: string) => {
      try {
        logger.info(`Creating new workspace: ${name}`)

        const newWorkspace = await createWorkspaceMutation.mutateAsync({ name })
        logger.info('Created new workspace:', newWorkspace)

        await switchWorkspace(newWorkspace)
      } catch (error) {
        logger.error('Error creating workspace:', error)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchWorkspace]
  )

  const confirmDeleteWorkspace = useCallback(
    async (workspaceToDelete: Workspace, templateAction?: 'keep' | 'delete') => {
      try {
        logger.info('Deleting workspace:', workspaceToDelete.id)

        const deleteTemplates = templateAction === 'delete'

        await deleteWorkspaceMutation.mutateAsync({
          workspaceId: workspaceToDelete.id,
          deleteTemplates,
        })

        WorkspaceRecencyStorage.remove(workspaceToDelete.id)
        logger.info('Workspace deleted successfully:', workspaceToDelete.id)

        const isDeletingCurrentWorkspace =
          workspaceIdRef.current === workspaceToDelete.id ||
          activeWorkspaceRef.current?.id === workspaceToDelete.id

        if (isDeletingCurrentWorkspace) {
          hasValidatedRef.current = false
          const remainingWorkspaces = WorkspaceRecencyStorage.sortByRecency(
            workspacesRef.current.filter((w) => w.id !== workspaceToDelete.id)
          )
          if (remainingWorkspaces.length > 0) {
            await switchWorkspace(remainingWorkspaces[0])
          }
        }
      } catch (error) {
        logger.error('Error deleting workspace:', error)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchWorkspace]
  )

  const handleLeaveWorkspace = useCallback(
    async (workspaceToLeave: Workspace) => {
      if (!sessionUserId) {
        logger.error('Cannot leave workspace: no session user ID')
        return
      }

      logger.info('Leaving workspace:', workspaceToLeave.id)

      try {
        await leaveWorkspaceMutation.mutateAsync({
          userId: sessionUserId,
          workspaceId: workspaceToLeave.id,
        })

        WorkspaceRecencyStorage.remove(workspaceToLeave.id)
        logger.info('Left workspace successfully:', workspaceToLeave.id)

        const isLeavingCurrentWorkspace =
          workspaceIdRef.current === workspaceToLeave.id ||
          activeWorkspaceRef.current?.id === workspaceToLeave.id

        if (isLeavingCurrentWorkspace) {
          hasValidatedRef.current = false
          const remainingWorkspaces = WorkspaceRecencyStorage.sortByRecency(
            workspacesRef.current.filter((w) => w.id !== workspaceToLeave.id)
          )
          if (remainingWorkspaces.length > 0) {
            await switchWorkspace(remainingWorkspaces[0])
          }
        }
      } catch (error) {
        logger.error('Error leaving workspace:', error)
        throw error
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchWorkspace, sessionUserId]
  )

  return {
    workspaces: sortedWorkspaces,
    activeWorkspace,
    isWorkspacesLoading,
    isCreatingWorkspace: createWorkspaceMutation.isPending,
    isDeletingWorkspace: deleteWorkspaceMutation.isPending,
    isLeavingWorkspace: leaveWorkspaceMutation.isPending,
    updateWorkspace,
    switchWorkspace,
    handleCreateWorkspace,
    confirmDeleteWorkspace,
    handleLeaveWorkspace,
  }
}
