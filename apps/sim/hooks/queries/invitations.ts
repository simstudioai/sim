import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { workspaceKeys } from './workspace'

/**
 * Query key factory for invitation-related queries.
 * Provides hierarchical cache keys for workspace invitations.
 */
export const invitationKeys = {
  all: ['invitations'] as const,
  lists: () => [...invitationKeys.all, 'list'] as const,
  list: (workspaceId: string) => [...invitationKeys.lists(), workspaceId] as const,
}

/** Raw invitation data from the API. */
export interface PendingInvitation {
  id: string
  workspaceId: string
  email: string
  permissions: 'admin' | 'write' | 'read'
  status: string
  createdAt: string
}

/** Normalized invitation for display in the UI. */
export interface WorkspaceInvitation {
  email: string
  permissionType: 'admin' | 'write' | 'read'
  isPendingInvitation: boolean
  invitationId?: string
}

async function fetchPendingInvitations(workspaceId: string): Promise<WorkspaceInvitation[]> {
  const response = await fetch('/api/workspaces/invitations')

  if (!response.ok) {
    throw new Error('Failed to fetch pending invitations')
  }

  const data = await response.json()

  return (
    data.invitations
      ?.filter(
        (inv: PendingInvitation) => inv.status === 'pending' && inv.workspaceId === workspaceId
      )
      .map((inv: PendingInvitation) => ({
        email: inv.email,
        permissionType: inv.permissions,
        isPendingInvitation: true,
        invitationId: inv.id,
      })) || []
  )
}

/**
 * Fetches pending invitations for a workspace.
 * @param workspaceId - The workspace ID to fetch invitations for
 */
export function usePendingInvitations(workspaceId: string | undefined) {
  return useQuery({
    queryKey: invitationKeys.list(workspaceId ?? ''),
    queryFn: () => fetchPendingInvitations(workspaceId as string),
    enabled: Boolean(workspaceId),
    staleTime: 30 * 1000,
    placeholderData: keepPreviousData,
  })
}

interface BatchSendInvitationsParams {
  workspaceId: string
  invitations: Array<{ email: string; permission: 'admin' | 'write' | 'read' }>
}

interface BatchInvitationResult {
  successful: string[]
  failed: Array<{ email: string; error: string }>
}

/**
 * Sends multiple workspace invitations in parallel.
 * Returns results for each invitation indicating success or failure.
 */
export function useBatchSendWorkspaceInvitations() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      workspaceId,
      invitations,
    }: BatchSendInvitationsParams): Promise<BatchInvitationResult> => {
      const results = await Promise.allSettled(
        invitations.map(async ({ email, permission }) => {
          const response = await fetch('/api/workspaces/invitations', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              workspaceId,
              email,
              role: 'member',
              permission,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Failed to send invitation')
          }

          return { email, data: await response.json() }
        })
      )

      const successful: string[] = []
      const failed: Array<{ email: string; error: string }> = []

      results.forEach((result, index) => {
        const email = invitations[index].email
        if (result.status === 'fulfilled') {
          successful.push(email)
        } else {
          failed.push({ email, error: result.reason?.message || 'Unknown error' })
        }
      })

      return { successful, failed }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
    },
  })
}

interface CancelInvitationParams {
  invitationId: string
  workspaceId: string
}

/**
 * Cancels a pending workspace invitation.
 * Invalidates the invitation list cache on success.
 */
export function useCancelWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: CancelInvitationParams) => {
      const response = await fetch(`/api/workspaces/invitations/${invitationId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to cancel invitation')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
    },
  })
}

interface ResendInvitationParams {
  invitationId: string
  workspaceId: string
}

/**
 * Resends a pending workspace invitation email.
 * Invalidates the invitation list cache on success.
 */
export function useResendWorkspaceInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ invitationId }: ResendInvitationParams) => {
      const response = await fetch(`/api/workspaces/invitations/${invitationId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to resend invitation')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: invitationKeys.list(variables.workspaceId),
      })
    },
  })
}

interface RemoveMemberParams {
  userId: string
  workspaceId: string
}

/**
 * Removes a member from a workspace.
 * Invalidates the workspace permissions cache on success.
 */
export function useRemoveWorkspaceMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, workspaceId }: RemoveMemberParams) => {
      const response = await fetch(`/api/workspaces/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to remove member')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
    },
  })
}

interface LeaveWorkspaceParams {
  userId: string
  workspaceId: string
}

/**
 * Allows the current user to leave a workspace.
 * Invalidates both permissions and workspace list caches on success.
 */
export function useLeaveWorkspace() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ userId, workspaceId }: LeaveWorkspaceParams) => {
      const response = await fetch(`/api/workspaces/members/${userId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to leave workspace')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.all,
      })
    },
  })
}

interface UpdatePermissionsParams {
  workspaceId: string
  updates: Array<{ userId: string; permissions: 'admin' | 'write' | 'read' }>
}

/**
 * Updates permissions for one or more workspace members.
 * Invalidates the workspace permissions cache on success.
 */
export function useUpdateWorkspacePermissions() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ workspaceId, updates }: UpdatePermissionsParams) => {
      const response = await fetch(`/api/workspaces/${workspaceId}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update permissions')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceKeys.permissions(variables.workspaceId),
      })
    },
  })
}
