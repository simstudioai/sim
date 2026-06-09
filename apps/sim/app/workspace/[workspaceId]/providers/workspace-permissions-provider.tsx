'use client'

import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useToast } from '@/components/emcn'
import { useRegisterGlobalCommands } from '@/app/workspace/[workspaceId]/providers/global-commands-provider'
import { createCommands } from '@/app/workspace/[workspaceId]/utils/commands-utils'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  useWorkspacePermissionsQuery,
  type WorkspacePermissions,
  workspaceKeys,
} from '@/hooks/queries/workspace'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useOperationQueueStore } from '@/stores/operation-queue/store'

const logger = createLogger('WorkspacePermissionsProvider')

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
  const queryClient = useQueryClient()
  const { toast } = useToast()

  const [hasShownOfflineNotification, setHasShownOfflineNotification] = useState(false)
  const hasOperationError = useOperationQueueStore((state) => state.hasOperationError)
  const { isReconnecting, isRetryingWorkflowJoin } = useSocket()
  const realtimeStatusNotificationIdRef = useRef<string | null>(null)
  const realtimeStatusNotificationMessageRef = useRef<string | null>(null)

  const isOfflineMode = hasOperationError
  const realtimeStatusMessage = isReconnecting
    ? 'Reconnecting...'
    : isRetryingWorkflowJoin
      ? 'Joining workflow...'
      : null

  const clearRealtimeStatusNotification = useCallback(() => {
    if (!realtimeStatusNotificationIdRef.current) {
      return
    }

    toast.dismiss(realtimeStatusNotificationIdRef.current)
    realtimeStatusNotificationIdRef.current = null
    realtimeStatusNotificationMessageRef.current = null
  }, [])

  useEffect(() => {
    if (isOfflineMode || !realtimeStatusMessage) {
      clearRealtimeStatusNotification()
      return
    }

    if (
      realtimeStatusNotificationIdRef.current &&
      realtimeStatusNotificationMessageRef.current === realtimeStatusMessage
    ) {
      return
    }

    clearRealtimeStatusNotification()

    const id = toast.error(realtimeStatusMessage, { duration: 0, persistAcrossRoutes: true })

    realtimeStatusNotificationIdRef.current = id
    realtimeStatusNotificationMessageRef.current = realtimeStatusMessage
  }, [clearRealtimeStatusNotification, isOfflineMode, realtimeStatusMessage])

  useEffect(() => {
    return clearRealtimeStatusNotification
  }, [clearRealtimeStatusNotification])

  useRegisterGlobalCommands(() =>
    createCommands([
      {
        id: 'clear-notifications',
        handler: () => {
          toast.dismissAll()
        },
        overrides: {
          allowInEditable: false,
        },
      },
    ])
  )

  useEffect(() => {
    if (!isOfflineMode || hasShownOfflineNotification) {
      return
    }

    clearRealtimeStatusNotification()

    try {
      toast.error('Connection unavailable', {
        duration: 0,
        persistAcrossRoutes: true,
        action: { label: 'Refresh', onClick: () => window.location.reload() },
      })
      setHasShownOfflineNotification(true)
    } catch (error) {
      logger.error('Failed to add offline notification', { error })
    }
  }, [clearRealtimeStatusNotification, hasShownOfflineNotification, isOfflineMode])

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
    if (isOfflineMode) {
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        canRead: baseUserPermissions.canRead,
        isOfflineMode: true,
      }
    }

    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode])

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

/**
 * Lightweight permissions provider for sandbox/academy contexts.
 * Grants full edit access without any API calls or workspace dependencies.
 */
export function SandboxWorkspacePermissionsProvider({ children }: { children: React.ReactNode }) {
  const sandboxPermissions = useMemo(
    (): WorkspacePermissionsContextType => ({
      workspacePermissions: null,
      permissionsLoading: false,
      permissionsError: null,
      updatePermissions: () => {},
      refetchPermissions: async () => {},
      userPermissions: {
        canRead: true,
        canEdit: true,
        canAdmin: false,
        userPermissions: 'write',
        isLoading: false,
        error: null,
        isOfflineMode: false,
      },
    }),
    []
  )

  return (
    <WorkspacePermissionsContext.Provider value={sandboxPermissions}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}
