import { useCallback, useEffect, useMemo, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { usePathname, useRouter } from 'next/navigation'
import { useLeaveWorkspace } from '@/hooks/queries/invitations'
import {
  EMPTY_PINNED_WORKSPACE_IDS,
  useCreateWorkspace,
  useDeleteWorkspace,
  useOrderedWorkspacesQuery,
  usePinnedWorkspaceIds,
  useRecordWorkspaceVisit,
  useToggleWorkspacePin,
  useUpdateWorkspace,
  useWorkspaceCreationPolicy,
  type Workspace,
} from '@/hooks/queries/workspace'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'

const logger = createLogger('useWorkspaceManagement')

interface UseWorkspaceManagementProps {
  workspaceId: string
  sessionUserId?: string
}

interface ResolveWorkspaceSwitchHrefParams {
  pathname: string
  currentWorkspaceId: string
  targetWorkspaceId: string
}

/**
 * Keeps the active settings section across workspace switches without carrying
 * workspace-scoped detail IDs into the destination workspace.
 */
export function resolveWorkspaceSwitchHref({
  pathname,
  currentWorkspaceId,
  targetWorkspaceId,
}: ResolveWorkspaceSwitchHrefParams): string {
  const targetWorkspaceHref = `/workspace/${targetWorkspaceId}`
  const settingsPrefix = `/workspace/${currentWorkspaceId}/settings/`
  if (!pathname.startsWith(settingsPrefix)) return targetWorkspaceHref

  const [section] = pathname.slice(settingsPrefix.length).split('/')
  if (!section) {
    throw new Error(`Settings pathname is missing a section: ${pathname}`)
  }

  return `${targetWorkspaceHref}/settings/${section}`
}

/**
 * Manages workspace operations including fetching, switching, creating, deleting, and leaving workspaces.
 * Handles URL synchronization and recency-based ordering. Route access is
 * validated by the workspace layout so a denied deep link is never replaced by
 * an unrelated fallback workspace.
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
  const switchToWorkspace = useWorkflowRegistry((state) => state.switchToWorkspace)

  const { data: workspaces = [], isLoading: isWorkspacesLoading } = useOrderedWorkspacesQuery(
    Boolean(sessionUserId)
  )
  const { data: workspaceCreationPolicy = null } = useWorkspaceCreationPolicy(
    Boolean(sessionUserId)
  )
  const { data: pinnedWorkspaceIds = EMPTY_PINNED_WORKSPACE_IDS } = usePinnedWorkspaceIds(
    Boolean(sessionUserId)
  )
  const { mutate: toggleWorkspacePinMutate } = useToggleWorkspacePin()
  const { mutate: recordWorkspaceVisit } = useRecordWorkspaceVisit()

  const leaveWorkspaceMutation = useLeaveWorkspace()
  const createWorkspaceMutation = useCreateWorkspace()
  const deleteWorkspaceMutation = useDeleteWorkspace()
  const updateWorkspaceMutation = useUpdateWorkspace()

  const workspaceIdRef = useRef<string>(workspaceId)
  const workspacesRef = useRef<Workspace[]>(workspaces)
  const routerRef = useRef<ReturnType<typeof useRouter>>(router)

  workspaceIdRef.current = workspaceId
  workspacesRef.current = workspaces
  routerRef.current = router

  const toggleWorkspacePin = useCallback(
    (workspaceId: string) => {
      toggleWorkspacePinMutate({ workspaceId, pinned: !pinnedWorkspaceIds.has(workspaceId) })
    },
    [pinnedWorkspaceIds, toggleWorkspacePinMutate]
  )

  const activeWorkspace = useMemo(() => {
    if (!workspaces.length) return null
    return workspaces.find((w) => w.id === workspaceId) ?? null
  }, [workspaces, workspaceId])

  useEffect(() => {
    if (workspaceId && sessionUserId) recordWorkspaceVisit(workspaceId)
  }, [workspaceId, sessionUserId, recordWorkspaceVisit])

  const activeWorkspaceRef = useRef<Workspace | null>(activeWorkspace)
  activeWorkspaceRef.current = activeWorkspace

  const updateWorkspace = useCallback(
    async (
      workspaceId: string,
      updates: { name?: string; logoUrl?: string | null }
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

      const href = resolveWorkspaceSwitchHref({
        pathname,
        currentWorkspaceId: workspaceIdRef.current,
        targetWorkspaceId: workspace.id,
      })

      try {
        switchToWorkspace(workspace.id)
        routerRef.current.push(href)
        logger.info(`Switched to workspace: ${workspace.name} (${workspace.id})`)
      } catch (error) {
        logger.error('Error switching workspace:', error)
      }
    },
    [pathname, switchToWorkspace]
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
        throw error
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [switchWorkspace]
  )

  const confirmDeleteWorkspace = useCallback(
    async (workspaceToDelete: Workspace) => {
      try {
        logger.info('Deleting workspace:', workspaceToDelete.id)

        await deleteWorkspaceMutation.mutateAsync({
          workspaceId: workspaceToDelete.id,
        })

        logger.info('Workspace deleted successfully:', workspaceToDelete.id)

        const isDeletingCurrentWorkspace =
          workspaceIdRef.current === workspaceToDelete.id ||
          activeWorkspaceRef.current?.id === workspaceToDelete.id

        if (isDeletingCurrentWorkspace) {
          const nextWorkspace = workspacesRef.current.find((w) => w.id !== workspaceToDelete.id)
          if (nextWorkspace) await switchWorkspace(nextWorkspace)
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

        logger.info('Left workspace successfully:', workspaceToLeave.id)

        const isLeavingCurrentWorkspace =
          workspaceIdRef.current === workspaceToLeave.id ||
          activeWorkspaceRef.current?.id === workspaceToLeave.id

        if (isLeavingCurrentWorkspace) {
          const nextWorkspace = workspacesRef.current.find((w) => w.id !== workspaceToLeave.id)
          if (nextWorkspace) await switchWorkspace(nextWorkspace)
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
    workspaces,
    pinnedWorkspaceIds,
    toggleWorkspacePin,
    workspaceCreationPolicy,
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
