import { useEffect, useState } from 'react'
import { createLogger } from '@/lib/logs/console-logger'
import type { permissionTypeEnum } from '@/db/schema'
import { API_ENDPOINTS } from '@/stores/constants'

const logger = createLogger('useWorkspacePermissions')

export type PermissionType = (typeof permissionTypeEnum.enumValues)[number]

export interface WorkspaceUser {
  userId: string
  email: string
  name: string | null
  image: string | null
  permissionType: PermissionType
}

export interface WorkspacePermissions {
  users: WorkspaceUser[]
  total: number
}

interface UseWorkspacePermissionsReturn {
  permissions: WorkspacePermissions | null
  loading: boolean
  error: string | null
  updatePermissions: (newPermissions: WorkspacePermissions) => void
}

/**
 * Custom hook to fetch and manage workspace permissions
 *
 * @param workspaceId - The workspace ID to fetch permissions for
 * @returns Object containing permissions data, loading state, error state, and refetch function
 */
export function useWorkspacePermissions(workspaceId: string | null): UseWorkspacePermissionsReturn {
  const [permissions, setPermissions] = useState<WorkspacePermissions | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchPermissions = async (id: string): Promise<void> => {
    try {
      setLoading(true)
      setError(null)

      const response = await fetch(API_ENDPOINTS.WORKSPACE_PERMISSIONS(id))

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Workspace not found or access denied')
        }
        if (response.status === 401) {
          throw new Error('Authentication required')
        }
        throw new Error(`Failed to fetch permissions: ${response.statusText}`)
      }

      const data: WorkspacePermissions = await response.json()
      setPermissions(data)

      logger.info('Workspace permissions loaded', {
        workspaceId: id,
        userCount: data.total,
        users: data.users.map((u) => ({ email: u.email, permissions: u.permissionType })),
      })
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'
      setError(errorMessage)
      logger.error('Failed to fetch workspace permissions', {
        workspaceId: id,
        error: errorMessage,
      })
    } finally {
      setLoading(false)
    }
  }

  const updatePermissions = (newPermissions: WorkspacePermissions): void => {
    setPermissions(newPermissions)
  }

  useEffect(() => {
    if (workspaceId) {
      fetchPermissions(workspaceId)
    } else {
      // Clear state if no workspace ID
      setPermissions(null)
      setError(null)
      setLoading(false)
    }
  }, [workspaceId])

  return {
    permissions,
    loading,
    error,
    updatePermissions,
  }
}
