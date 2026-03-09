import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { generateWorkspaceName } from '@/lib/workspaces/naming'
import { useLeaveWorkspace } from '@/hooks/queries/invitations'
import {
  useCreateWorkspace,
  useDeleteWorkspace,
  useUpdateWorkspaceName,
  useWorkspacesQuery,
  type Workspace,
  workspaceKeys,
} from '@/hooks/queries/workspace'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useWorkspaceManagement')

interface UseWorkspaceManagementProps {
  workspaceId: string
  sessionUserId?: string
}

/**
 * Manages workspace operations including fetching, switching, creating, deleting, and leaving workspaces.
 * Handles workspace validation and URL synchronization.
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
  const pathname = usePathname()
  const queryClient = useQueryClient()
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)

  const {
    data: workspaces = [],
    isLoading: isWorkspacesLoading,
    refetch: refetchWorkspaces,
  } = useWorkspacesQuery(Boolean(sessionUserId))

  const leaveWorkspaceMutation = useLeaveWorkspace()
  const createWorkspaceMutation = useCreateWorkspace()
  const deleteWorkspaceMutation = useDeleteWorkspace()
  const updateWorkspaceNameMutation = useUpdateWorkspaceName()

  const workspaceIdRef = useRef<string>(workspaceId)
  const routerRef = useRef<ReturnType<typeof useRouter>>(router)
  const pathnameRef = useRef<string | null>(pathname || null)
  const hasValidatedRef = useRef<boolean>(false)

  workspaceIdRef.current = workspaceId
  routerRef.current = router
  pathnameRef.current = pathname || null

  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null
    return workspaces.find((w) => w.id === workspaceId) ?? null
  }, [workspaces, workspaceId])

  const activeWorkspaceRef = useRef<Workspace | null>(activeWorkspace)
  activeWorkspaceRef.current = activeWorkspace

  useEffect(() => {
    if (isWorkspacesLoading || hasValidatedRef.current || !workspaces.length) {
      return
    }

    const currentWorkspaceId = workspaceIdRef.current
    const matchingWorkspace = workspaces.find((w) => w.id === currentWorkspaceId)

    if (!matchingWorkspace) {
      logger.warn(`Workspace ${currentWorkspaceId} not found in user's workspaces`)
      const fallbackWorkspace = workspaces[0]
      logger.info(`Redirecting to fallback workspace: ${fallbackWorkspace.id}`)
      routerRef.current?.push(`/workspace/${fallbackWorkspace.id}/w`)
    }

    hasValidatedRef.current = true
  }, [workspaces, isWorkspacesLoading])

  const refreshWorkspaceList = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
  }, [queryClient])

  const fetchWorkspaces = useCallback(async () => {
    hasValidatedRef.current = false
    await refetchWorkspaces()
  }, [refetchWorkspaces])

  const updateWorkspaceName = useCallback(
    async (workspaceId: string, newName: string): Promise<boolean> => {
      try {
        await updateWorkspaceNameMutation.mutateAsync({ workspaceId, name: newName })
        logger.info('Successfully updated workspace name to:', newName.trim())
        return true
      } catch (error) {
        logger.error('Error updating workspace name:', error)
        return false
      }
    },
    [updateWorkspaceNameMutation]
  )

  const switchWorkspace = useCallback(
    async (workspace: Workspace) => {
      if (activeWorkspaceRef.current?.id === workspace.id) {
        return
      }

      try {
        await switchToWorkspace(workspace.id)
        const currentPath = pathnameRef.current || ''
        const templateDetailMatch = currentPath.match(/^\/workspace\/[^/]+\/templates\/([^/]+)$/)
        if (templateDetailMatch) {
          const templateId = templateDetailMatch[1]
          routerRef.current?.push(`/workspace/${workspace.id}/templates/${templateId}`)
        } else if (/^\/workspace\/[^/]+\/templates$/.test(currentPath)) {
          routerRef.current?.push(`/workspace/${workspace.id}/templates`)
        } else {
          routerRef.current?.push(`/workspace/${workspace.id}/w`)
        }
        logger.info(`Switched to workspace: ${workspace.name} (${workspace.id})`)
      } catch (error) {
        logger.error('Error switching workspace:', error)
      }
    },
    [switchToWorkspace]
  )

  const handleCreateWorkspace = useCallback(async () => {
    if (createWorkspaceMutation.isPending) {
      logger.info('Workspace creation already in progress, ignoring request')
      return
    }

    try {
      logger.info('Creating new workspace')
      const workspaceName = await generateWorkspaceName()
      logger.info(`Generated workspace name: ${workspaceName}`)

      const newWorkspace = await createWorkspaceMutation.mutateAsync({ name: workspaceName })
      logger.info('Created new workspace:', newWorkspace)

      await switchWorkspace(newWorkspace)
    } catch (error) {
      logger.error('Error creating workspace:', error)
    }
  }, [createWorkspaceMutation, switchWorkspace])

  const confirmDeleteWorkspace = useCallback(
    async (workspaceToDelete: Workspace, templateAction?: 'keep' | 'delete') => {
      try {
        logger.info('Deleting workspace:', workspaceToDelete.id)

        const deleteTemplates = templateAction === 'delete'

        await deleteWorkspaceMutation.mutateAsync({
          workspaceId: workspaceToDelete.id,
          deleteTemplates,
        })

        logger.info('Workspace deleted successfully:', workspaceToDelete.id)

        const isDeletingCurrentWorkspace =
          workspaceIdRef.current === workspaceToDelete.id ||
          activeWorkspaceRef.current?.id === workspaceToDelete.id

        if (isDeletingCurrentWorkspace) {
          logger.info(
            'Deleting current workspace - using full workspace refresh with URL validation'
          )
          hasValidatedRef.current = false
          const { data: updatedWorkspaces } = await refetchWorkspaces()

          const remainingWorkspaces = (updatedWorkspaces || []).filter(
            (w) => w.id !== workspaceToDelete.id
          )
          if (remainingWorkspaces.length > 0) {
            await switchWorkspace(remainingWorkspaces[0])
          }
        }
      } catch (error) {
        logger.error('Error deleting workspace:', error)
      }
    },
    [deleteWorkspaceMutation, refetchWorkspaces, switchWorkspace]
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

        logger.info('Left workspace successfully:', workspaceToLeave.id)

        const isLeavingCurrentWorkspace =
          workspaceIdRef.current === workspaceToLeave.id ||
          activeWorkspaceRef.current?.id === workspaceToLeave.id

        if (isLeavingCurrentWorkspace) {
          logger.info(
            'Leaving current workspace - using full workspace refresh with URL validation'
          )
          hasValidatedRef.current = false
          const { data: updatedWorkspaces } = await refetchWorkspaces()

          const remainingWorkspaces = (updatedWorkspaces || []).filter(
            (w) => w.id !== workspaceToLeave.id
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
    [refetchWorkspaces, switchWorkspace, sessionUserId, leaveWorkspaceMutation]
  )

  const isWorkspaceValid = useCallback(
    (targetWorkspaceId: string) => {
      return workspaces.some((w) => w.id === targetWorkspaceId)
    },
    [workspaces]
  )

  return {
    workspaces,
    activeWorkspace,
    isWorkspacesLoading,
    isCreatingWorkspace: createWorkspaceMutation.isPending,
    isDeleting: deleteWorkspaceMutation.isPending,
    isLeaving: leaveWorkspaceMutation.isPending,
    fetchWorkspaces,
    refreshWorkspaceList,
    updateWorkspaceName,
    switchWorkspace,
    handleCreateWorkspace,
    confirmDeleteWorkspace,
    handleLeaveWorkspace,
    isWorkspaceValid,
  }
}

export type { Workspace }
