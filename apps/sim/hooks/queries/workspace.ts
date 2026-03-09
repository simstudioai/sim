import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

/**
 * Query key factory for workspace-related queries.
 * Provides hierarchical cache keys for workspaces, settings, and permissions.
 */
export const workspaceKeys = {
  all: ['workspace'] as const,
  lists: () => [...workspaceKeys.all, 'list'] as const,
  list: () => [...workspaceKeys.lists(), 'user'] as const,
  details: () => [...workspaceKeys.all, 'detail'] as const,
  detail: (id: string) => [...workspaceKeys.details(), id] as const,
  settings: (id: string) => [...workspaceKeys.detail(id), 'settings'] as const,
  permissions: (id: string) => [...workspaceKeys.detail(id), 'permissions'] as const,
  adminLists: () => [...workspaceKeys.all, 'adminList'] as const,
  adminList: (userId: string | undefined) => [...workspaceKeys.adminLists(), userId ?? ''] as const,
}

/** Represents a workspace in the user's workspace list. */
export interface Workspace {
  id: string
  name: string
  ownerId: string
  role?: string
  membershipId?: string
  permissions?: 'admin' | 'write' | 'read' | null
}

async function fetchWorkspaces(): Promise<Workspace[]> {
  const response = await fetch('/api/workspaces')

  if (!response.ok) {
    throw new Error('Failed to fetch workspaces')
  }

  const data = await response.json()
  return data.workspaces || []
}

/**
 * Fetches the current user's workspaces.
 * @param enabled - Whether the query should execute (defaults to true)
 */
export function useWorkspacesQuery(enabled = true) {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: fetchWorkspaces,
    enabled,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface CreateWorkspaceParams {
  name: string
}

/**
 * Creates a new workspace.
 * Automatically invalidates the workspace list cache on success.
 */
export function useCreateWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ name }: CreateWorkspaceParams) => {
      const response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create workspace')
      }

      const data = await response.json()
      return data.workspace as Workspace
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

interface DeleteWorkspaceParams {
  workspaceId: string
  deleteTemplates?: boolean
}

/**
 * Deletes a workspace.
 * Automatically invalidates the workspace list cache on success.
 */
export function useDeleteWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, deleteTemplates = false }: DeleteWorkspaceParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deleteTemplates }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete workspace')
      }

      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
    },
  })
}

interface UpdateWorkspaceNameParams {
  workspaceId: string
  name: string
}

/**
 * Updates a workspace's name.
 * Invalidates both the workspace list and the specific workspace detail cache.
 */
export function useUpdateWorkspaceName() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, name }: UpdateWorkspaceNameParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update workspace name')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.lists() })
      queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(variables.workspaceId) })
    },
  })
}

/** Represents a user with permissions in a workspace. */
export interface WorkspaceUser {
  userId: string
  email: string
  name: string | null
  image: string | null
  permissionType: 'admin' | 'write' | 'read'
}

/** Workspace permissions data containing all users and their access levels. */
export interface WorkspacePermissions {
  users: WorkspaceUser[]
  total: number
}

async function fetchWorkspacePermissions(workspaceId: string): Promise<WorkspacePermissions> {
  const response = await fetch(`/api/workspaces/${workspaceId}/permissions`)

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Workspace not found or access denied')
    }
    if (response.status === 401) {
      throw new Error('Authentication required')
    }
    throw new Error(`Failed to fetch permissions: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Fetches permissions for a specific workspace.
 * @param workspaceId - The workspace ID to fetch permissions for
 */
export function useWorkspacePermissionsQuery(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: workspaceKeys.permissions(workspaceId ?? ''),
    queryFn: () => fetchWorkspacePermissions(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

async function fetchWorkspaceSettings(workspaceId: string) {
  const [settingsResponse, permissionsResponse] = await Promise.all([
    fetch(`/api/workspaces/${workspaceId}`),
    fetch(`/api/workspaces/${workspaceId}/permissions`),
  ])

  if (!settingsResponse.ok || !permissionsResponse.ok) {
    throw new Error('Failed to fetch workspace settings')
  }

  const [settings, permissions] = await Promise.all([
    settingsResponse.json(),
    permissionsResponse.json(),
  ])

  return {
    settings,
    permissions,
  }
}

/**
 * Fetches workspace settings including permissions.
 * @param workspaceId - The workspace ID to fetch settings for
 */
export function useWorkspaceSettings(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.settings(workspaceId),
    queryFn: () => fetchWorkspaceSettings(workspaceId),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface UpdateWorkspaceSettingsParams {
  workspaceId: string
  billedAccountUserId?: string
  billingAccountUserEmail?: string
}

/**
 * Updates workspace settings (e.g., billing configuration).
 * Invalidates the workspace settings cache on success.
 */
export function useUpdateWorkspaceSettings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, ...updates }: UpdateWorkspaceSettingsParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.message || 'Failed to update workspace settings')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.settings(variables.workspaceId),
      })
    },
  })
}

/** Workspace with admin access metadata. */
export interface AdminWorkspace {
  id: string
  name: string
  isOwner: boolean
  ownerId?: string
  canInvite: boolean
}

async function fetchAdminWorkspaces(userId: string | undefined): Promise<AdminWorkspace[]> {
  if (!userId) {
    return []
  }

  const workspacesResponse = await fetch('/api/workspaces')
  if (!workspacesResponse.ok) {
    throw new Error('Failed to fetch workspaces')
  }

  const workspacesData = await workspacesResponse.json()
  const allUserWorkspaces = workspacesData.workspaces || []

  const permissionPromises = allUserWorkspaces.map(
    async (workspace: { id: string; name: string; isOwner?: boolean; ownerId?: string }) => {
      try {
        const permissionResponse = await fetch(`/api/workspaces/${workspace.id}/permissions`)
        if (!permissionResponse.ok) {
          return null
        }
        const permissionData = await permissionResponse.json()
        return { workspace, permissionData }
      } catch (_error) {
        return null
      }
    }
  )

  const results = await Promise.all(permissionPromises)

  const adminWorkspaces: AdminWorkspace[] = []
  for (const result of results) {
    if (!result) continue

    const { workspace, permissionData } = result
    let hasAdminAccess = false

    if (permissionData.users) {
      const currentUserPermission = permissionData.users.find(
        (user: { id: string; userId?: string; permissionType: string }) =>
          user.id === userId || user.userId === userId
      )
      hasAdminAccess = currentUserPermission?.permissionType === 'admin'
    }

    const isOwner = workspace.isOwner || workspace.ownerId === userId

    if (hasAdminAccess || isOwner) {
      adminWorkspaces.push({
        id: workspace.id,
        name: workspace.name,
        isOwner,
        ownerId: workspace.ownerId,
        canInvite: true,
      })
    }
  }

  return adminWorkspaces
}

/**
 * Fetches workspaces where the user has admin access.
 * @param userId - The user ID to check admin access for
 */
export function useAdminWorkspaces(userId: string | undefined) {
  return useQuery({
    queryKey: workspaceKeys.adminList(userId),
    queryFn: () => fetchAdminWorkspaces(userId),
    enabled: Boolean(userId),
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}
