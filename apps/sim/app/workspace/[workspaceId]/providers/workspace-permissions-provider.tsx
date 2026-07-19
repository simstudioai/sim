'use client'

import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react'
import { useToast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  useWorkspacePermissionsQuery,
  type WorkspacePermissions,
  workspaceKeys,
} from '@/hooks/queries/workspace'
import { useStableFlag } from '@/hooks/use-stable-flag'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useOperationQueueStore } from '@/stores/operation-queue/store'

const logger = createLogger('WorkspacePermissionsProvider')

/**
 * Anti-flicker timing for the "Reconnecting..." toast. Socket.IO flips
 * `isReconnecting` on any disconnect — including sub-second transport hiccups
 * that recover on the first retry — so we delay surfacing the toast until the
 * drop has lasted long enough to matter, then hold it on screen long enough to
 * read. Together these suppress both flicker modes (flash-on and flash-off)
 * while still alerting on real outages.
 */
const RECONNECTING_TOAST_DELAY_MS = 2000
const RECONNECTING_TOAST_MIN_VISIBLE_MS = 1500

interface PersistentToastOptions {
  description?: string
  action?: { label: string; onClick: () => void }
}

/**
 * Shows a persistent error toast while `message` is non-null, replaces it when
 * the message changes, and dismisses it when the message becomes null or the
 * owning component unmounts.
 */
function usePersistentErrorToast(message: string | null, options?: PersistentToastOptions) {
  const { toast } = useToast()
  const toastIdRef = useRef<string | null>(null)
  const shownMessageRef = useRef<string | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options

  const dismiss = useCallback(() => {
    if (!toastIdRef.current) {
      return
    }

    toast.dismiss(toastIdRef.current)
    toastIdRef.current = null
    shownMessageRef.current = null
  }, [])

  useEffect(() => {
    if (!message) {
      dismiss()
      return
    }

    if (toastIdRef.current && shownMessageRef.current === message) {
      return
    }

    dismiss()

    try {
      toastIdRef.current = toast.error(message, {
        ...optionsRef.current,
        duration: 0,
        persistAcrossRoutes: true,
      })
      shownMessageRef.current = message
    } catch (error) {
      logger.error('Failed to show persistent notification', { error, message })
    }
  }, [dismiss, message])

  useEffect(() => dismiss, [dismiss])
}

interface WorkspacePermissionsContextType {
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
  refetchPermissions: () => Promise<void>
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }
}

const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType>({
  workspacePermissions: null,
  permissionsLoading: false,
  permissionsError: null,
  updatePermissions: () => {},
  refetchPermissions: async () => {},
  userPermissions: {
    canRead: false,
    canEdit: false,
    canAdmin: false,
    userPermissions: 'read',
    isLoading: false,
    error: null,
  },
})

interface WorkspacePermissionsProviderProps {
  children: React.ReactNode
}

/**
 * Provides workspace permissions and connection-aware user access throughout the app.
 * Enforces read-only mode when offline to prevent data loss.
 */
export function WorkspacePermissionsProvider({ children }: WorkspacePermissionsProviderProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const urlWorkflowId = params?.workflowId as string | undefined
  const queryClient = useQueryClient()

  const hasOperationError = useOperationQueueStore((state) => state.hasOperationError)
  const { isReconnecting, isRetryingWorkflowJoin, blockedJoinWorkflowId } = useSocket()

  const isOfflineMode = hasOperationError
  const isJoinBlocked = Boolean(blockedJoinWorkflowId) && blockedJoinWorkflowId === urlWorkflowId
  const showReconnecting = useStableFlag(isReconnecting, {
    delayMs: RECONNECTING_TOAST_DELAY_MS,
    minVisibleMs: RECONNECTING_TOAST_MIN_VISIBLE_MS,
  })
  const realtimeStatusMessage = isOfflineMode
    ? null
    : showReconnecting
      ? 'Reconnecting...'
      : isRetryingWorkflowJoin
        ? 'Joining workflow...'
        : null

  usePersistentErrorToast(realtimeStatusMessage)
  // Offline mode only recovers via workspace switch or refresh; the join block
  // lifts when the user targets a different workflow or refreshes.
  usePersistentErrorToast(isOfflineMode ? 'Connection unavailable' : null, {
    description: 'Recent changes may not have been saved. Refresh to resync.',
    action: { label: 'Refresh', onClick: () => window.location.reload() },
  })
  usePersistentErrorToast(isJoinBlocked ? 'Unable to connect to workflow' : null, {
    description: 'Changes cannot be saved. Refresh to retry.',
    action: { label: 'Refresh', onClick: () => window.location.reload() },
  })

  const {
    data: workspacePermissions,
    isLoading: permissionsLoading,
    error: permissionsErrorObj,
    refetch,
  } = useWorkspacePermissionsQuery(workspaceId)

  const permissionsError = permissionsErrorObj?.message ?? null

  const updatePermissions = useCallback(
    (newPermissions: WorkspacePermissions) => {
      if (!workspaceId) return
      queryClient.setQueryData(workspaceKeys.permissions(workspaceId), newPermissions)
    },
    [workspaceId, queryClient]
  )

  const refetchPermissions = useCallback(async () => {
    await refetch()
  }, [refetch])

  const baseUserPermissions = useUserPermissions(
    workspacePermissions ?? null,
    permissionsLoading,
    permissionsError
  )

  const userPermissions = useMemo((): WorkspaceUserPermissions & { isOfflineMode?: boolean } => {
    if (isOfflineMode || isJoinBlocked) {
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        canRead: baseUserPermissions.canRead,
        isOfflineMode,
      }
    }

    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode, isJoinBlocked])

  const contextValue = useMemo(
    () => ({
      workspacePermissions: workspacePermissions ?? null,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    }),
    [
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      refetchPermissions,
      userPermissions,
    ]
  )

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}

/**
 * Accesses workspace permissions data and operations from context.
 * Must be used within a WorkspacePermissionsProvider.
 */
export function useWorkspacePermissionsContext(): WorkspacePermissionsContextType {
  const context = useContext(WorkspacePermissionsContext)
  if (!context) {
    throw new Error(
      'useWorkspacePermissionsContext must be used within a WorkspacePermissionsProvider'
    )
  }
  return context
}

/**
 * Accesses the current user's computed permissions including offline mode status.
 * Convenience hook that extracts userPermissions from the context.
 */
export function useUserPermissionsContext(): WorkspaceUserPermissions & {
  isOfflineMode?: boolean
} {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}
