'use client'

import type React from 'react'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
import { useCollaborativeWorkflow } from '@/hooks/use-collaborative-workflow'
import { useUserPermissions, type WorkspaceUserPermissions } from '@/hooks/use-user-permissions'
import {
  useWorkspacePermissions,
  type WorkspacePermissions,
} from '@/hooks/use-workspace-permissions'

const logger = createLogger('WorkspacePermissionsProvider')

interface WorkspacePermissionsContextType {
  // Raw workspace permissions data
  workspacePermissions: WorkspacePermissions | null
  permissionsLoading: boolean
  permissionsError: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void

  // Computed user permissions (connection-aware)
  userPermissions: WorkspaceUserPermissions & { isOfflineMode?: boolean }

  // Connection state management
  setOfflineMode: (isOffline: boolean) => void
}

const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType>({
  workspacePermissions: null,
  permissionsLoading: false,
  permissionsError: null,
  updatePermissions: () => {},
  userPermissions: {
    canRead: false,
    canEdit: false,
    canAdmin: false,
    userPermissions: 'read',
    isLoading: false,
    error: null,
  },
  setOfflineMode: () => {},
})

interface WorkspacePermissionsProviderProps {
  children: React.ReactNode
}

/**
 * Provider that manages workspace permissions and user access
 * Also provides connection-aware permissions that enforce read-only mode when offline
 */
export function WorkspacePermissionsProvider({ children }: WorkspacePermissionsProviderProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string

  // Manage offline mode state locally
  const [isOfflineMode, setIsOfflineMode] = useState(false)

  // Get operation error state from collaborative workflow
  const { hasOperationError } = useCollaborativeWorkflow()

  // Set offline mode when there are operation errors
  useEffect(() => {
    if (hasOperationError) {
      setIsOfflineMode(true)
    }
  }, [hasOperationError])

  // Fetch workspace permissions and loading state
  const {
    permissions: workspacePermissions,
    loading: permissionsLoading,
    error: permissionsError,
    updatePermissions,
  } = useWorkspacePermissions(workspaceId)

  // Get base user permissions from workspace permissions
  const baseUserPermissions = useUserPermissions(
    workspacePermissions,
    permissionsLoading,
    permissionsError
  )

  // Note: Connection-based error detection removed - only rely on operation timeouts
  // The 5-second operation timeout system will handle all error cases

  // Create connection-aware permissions that override user permissions when offline
  const userPermissions = useMemo((): WorkspaceUserPermissions & { isOfflineMode?: boolean } => {
    if (isOfflineMode) {
      // In offline mode, force read-only permissions regardless of actual user permissions
      return {
        ...baseUserPermissions,
        canEdit: false,
        canAdmin: false,
        // Keep canRead true so users can still view content
        canRead: baseUserPermissions.canRead,
        isOfflineMode: true,
      }
    }

    // When online, use normal permissions
    return {
      ...baseUserPermissions,
      isOfflineMode: false,
    }
  }, [baseUserPermissions, isOfflineMode])

  const contextValue = useMemo(
    () => ({
      workspacePermissions,
      permissionsLoading,
      permissionsError,
      updatePermissions,
      userPermissions,
      setOfflineMode: setIsOfflineMode,
    }),
    [workspacePermissions, permissionsLoading, permissionsError, updatePermissions, userPermissions]
  )

  return (
    <WorkspacePermissionsContext.Provider value={contextValue}>
      {children}
    </WorkspacePermissionsContext.Provider>
  )
}

/**
 * Hook to access workspace permissions and data from context
 * This provides both raw workspace permissions and computed user permissions
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
 * Hook to access user permissions from context
 * This replaces individual useUserPermissions calls and includes connection-aware permissions
 */
export function useUserPermissionsContext(): WorkspaceUserPermissions & {
  isOfflineMode?: boolean
} {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}
