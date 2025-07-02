'use client'

import React, { createContext, useContext, useMemo } from 'react'
import { useParams } from 'next/navigation'
import { createLogger } from '@/lib/logs/console-logger'
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

  // Computed user permissions
  userPermissions: WorkspaceUserPermissions
}

const WorkspacePermissionsContext = createContext<WorkspacePermissionsContextType | null>(null)

interface WorkspacePermissionsProviderProps {
  children: React.ReactNode
}

const WorkspacePermissionsProvider = React.memo<WorkspacePermissionsProviderProps>(
  ({ children }) => {
    const params = useParams()
    const workspaceId = params.workspaceId as string

    if (!workspaceId) {
      logger.warn('Workspace ID is undefined from params:', params)
    }

    const {
      permissions: workspacePermissions,
      loading: permissionsLoading,
      error: permissionsError,
      updatePermissions,
    } = useWorkspacePermissions(workspaceId)

    const userPermissions = useUserPermissions(
      workspacePermissions,
      permissionsLoading,
      permissionsError
    )

    const contextValue = useMemo(
      () => ({
        workspacePermissions,
        permissionsLoading,
        permissionsError,
        updatePermissions,
        userPermissions,
      }),
      [
        workspacePermissions,
        permissionsLoading,
        permissionsError,
        updatePermissions,
        userPermissions,
      ]
    )

    return (
      <WorkspacePermissionsContext.Provider value={contextValue}>
        {children}
      </WorkspacePermissionsContext.Provider>
    )
  }
)

WorkspacePermissionsProvider.displayName = 'WorkspacePermissionsProvider'

export { WorkspacePermissionsProvider }

/**
 * Hook to access workspace permissions context
 * This replaces individual useWorkspacePermissions calls to avoid duplicate API requests
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
 * This replaces individual useUserPermissions calls
 */
export function useUserPermissionsContext(): WorkspaceUserPermissions {
  const { userPermissions } = useWorkspacePermissionsContext()
  return userPermissions
}
