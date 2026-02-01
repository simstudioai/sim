'use client'

import type React from 'react'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { useQueryClient } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useSocket } from '@/app/workspace/providers/socket-provider'
import {
  useWorkspacePermissionsQuery,
  type WorkspacePermissions,
  workspaceKeys,
} from '@/hooks/queries/workspace'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import { useNotificationStore } from '@/stores/notifications'
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

  const [hasShownOfflineNotification, setHasShownOfflineNotification] = useState(false)
  const hasOperationError = useOperationQueueStore((state) => state.hasOperationError)
  const addNotification = useNotificationStore((state) => state.addNotification)
  const removeNotification = useNotificationStore((state) => state.removeNotification)
  const { isReconnecting } = useSocket()
  const reconnectingNotificationIdRef = useRef<string | null>(null)

  const isOfflineMode = hasOperationError

  useEffect(() => {
    if (isReconnecting && !reconnectingNotificationIdRef.current && !isOfflineMode) {
      const id = addNotification({
        level: 'error',
        message: 'Reconnecting...',
      })
      reconnectingNotificationIdRef.current = id
    } else if (!isReconnecting && reconnectingNotificationIdRef.current) {
      removeNotification(reconnectingNotificationIdRef.current)
      reconnectingNotificationIdRef.current = null
    }

    return () => {
      if (reconnectingNotificationIdRef.current) {
        removeNotification(reconnectingNotificationIdRef.current)
        reconnectingNotificationIdRef.current = null
      }
    }
  }, [isReconnecting, isOfflineMode, addNotification, removeNotification])

  useEffect(() => {
    if (!isOfflineMode || hasShownOfflineNotification) {
      return
    }

    if (reconnectingNotificationIdRef.current) {
      removeNotification(reconnectingNotificationIdRef.current)
      reconnectingNotificationIdRef.current = null
    }

    try {
      addNotification({
        level: 'error',
        message: 'Connection unavailable',
        action: {
          type: 'refresh',
          message: '',
        },
      })
      setHasShownOfflineNotification(true)
    } catch (error) {
      logger.error('Failed to add offline notification', { error })
    }
  }, [addNotification, removeNotification, hasShownOfflineNotification, isOfflineMode])

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
