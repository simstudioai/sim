import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { usePathname, useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import { updateUserSettingsContract } from '@/lib/api/contracts'
import { WorkspaceRecencyStorage } from '@/lib/core/utils/browser-storage'
import { useLeaveWorkspace } from '@/hooks/queries/invitations'
import {
  EMPTY_PINNED_WORKSPACE_IDS,
  useCreateWorkspace,
  useDeleteWorkspace,
  usePinnedWorkspaceIds,
  useToggleWorkspacePin,
  useUpdateWorkspace,
  useWorkspaceCreationPolicy,
  useWorkspacesQuery,
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

  const { data: workspaces = [], isLoading: isWorkspacesLoading } = useWorkspacesQuery(
    Boolean(sessionUserId)
  )
  const { data: workspaceCreationPolicy = null } = useWorkspaceCreationPolicy(
    Boolean(sessionUserId)
  )
  const { data: pinnedWorkspaceIds = EMPTY_PINNED_WORKSPACE_IDS } = usePinnedWorkspaceIds(
    Boolean(sessionUserId)
  )
  const { mutate: toggleWorkspacePinMutate } = useToggleWorkspacePin()

  const leaveWorkspaceMutation = useLeaveWorkspace()
  const createWorkspaceMutation = useCreateWorkspace()
  const deleteWorkspaceMutation = useDeleteWorkspace()
  const updateWorkspaceMutation = useUpdateWorkspace()

  const workspaceIdRef = useRef<string>(workspaceId)
  const workspacesRef = useRef<Workspace[]>(workspaces)
  const routerRef = useRef<ReturnType<typeof useRouter>>(router)
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
      requestJson(updateUserSettingsContract, {
        body: { lastActiveWorkspaceId: id },
      }).catch(() => {})
    }, 1000)
  }, [])

  /**
   * Pinned workspaces float to the top, recency ordering them within each group.
   * Matches `resource-sort.ts`: pinning is a user-declared priority layered over
   * the list's own sort, not a competing sort key.
   */
  const sortedWorkspaces = useMemo(() => {
    const byRecency = WorkspaceRecencyStorage.sortByRecency(workspaces)
    if (pinnedWorkspaceIds.size === 0) return byRecency
    const pinned: Workspace[] = []
    const unpinned: Workspace[] = []
    for (const workspace of byRecency) {
      if (pinnedWorkspaceIds.has(workspace.id)) pinned.push(workspace)
      else unpinned.push(workspace)
    }
    return [...pinned, ...unpinned]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaces, recencySortKey, pinnedWorkspaceIds])

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
    if (workspaceId) {
      touchRecency(workspaceId)
    }
  }, [workspaceId, touchRecency])

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

        WorkspaceRecencyStorage.remove(workspaceToDelete.id)
        logger.info('Workspace deleted successfully:', workspaceToDelete.id)

        const isDeletingCurrentWorkspace =
          workspaceIdRef.current === workspaceToDelete.id ||
          activeWorkspaceRef.current?.id === workspaceToDelete.id

        if (isDeletingCurrentWorkspace) {
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
