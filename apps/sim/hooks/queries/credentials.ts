'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { environmentKeys } from '@/hooks/queries/environment'
import { fetchJson } from '@/hooks/selectors/helpers'

export type WorkspaceCredentialType = 'oauth' | 'env_workspace' | 'env_personal'
export type WorkspaceCredentialRole = 'admin' | 'member'
export type WorkspaceCredentialMemberStatus = 'active' | 'pending' | 'revoked'

export interface WorkspaceCredential {
  id: string
  workspaceId: string
  type: WorkspaceCredentialType
  displayName: string
  description: string | null
  providerId: string | null
  accountId: string | null
  envKey: string | null
  envOwnerUserId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  role?: WorkspaceCredentialRole
  status?: WorkspaceCredentialMemberStatus
}

export interface WorkspaceCredentialMember {
  id: string
  userId: string
  role: WorkspaceCredentialRole
  status: WorkspaceCredentialMemberStatus
  joinedAt: string | null
  invitedBy: string | null
  createdAt: string
  updatedAt: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
}

interface CredentialListResponse {
  credentials?: WorkspaceCredential[]
}

interface CredentialResponse {
  credential?: WorkspaceCredential | null
}

interface MembersResponse {
  members?: WorkspaceCredentialMember[]
}

export const workspaceCredentialKeys = {
  all: ['workspaceCredentials'] as const,
  list: (workspaceId?: string, type?: string, providerId?: string) =>
    ['workspaceCredentials', workspaceId ?? 'none', type ?? 'all', providerId ?? 'all'] as const,
  detail: (credentialId?: string) =>
    ['workspaceCredentials', 'detail', credentialId ?? 'none'] as const,
  members: (credentialId?: string) =>
    ['workspaceCredentials', 'detail', credentialId ?? 'none', 'members'] as const,
}

export function useWorkspaceCredentials(params: {
  workspaceId?: string
  type?: WorkspaceCredentialType
  providerId?: string
  enabled?: boolean
}) {
  const { workspaceId, type, providerId, enabled = true } = params

  return useQuery<WorkspaceCredential[]>({
    queryKey: workspaceCredentialKeys.list(workspaceId, type, providerId),
    queryFn: async () => {
      if (!workspaceId) return []
      const data = await fetchJson<CredentialListResponse>('/api/credentials', {
        searchParams: {
          workspaceId,
          type,
          providerId,
        },
      })
      return data.credentials ?? []
    },
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useWorkspaceCredential(credentialId?: string, enabled = true) {
  return useQuery<WorkspaceCredential | null>({
    queryKey: workspaceCredentialKeys.detail(credentialId),
    queryFn: async () => {
      if (!credentialId) return null
      const data = await fetchJson<CredentialResponse>(`/api/credentials/${credentialId}`)
      return data.credential ?? null
    },
    enabled: Boolean(credentialId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useCreateWorkspaceCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      workspaceId: string
      type: WorkspaceCredentialType
      displayName?: string
      description?: string
      providerId?: string
      accountId?: string
      envKey?: string
      envOwnerUserId?: string
    }) => {
      const response = await fetch('/api/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create credential')
      }

      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.list(variables.workspaceId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.all,
      })
    },
  })
}

export function useUpdateWorkspaceCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      credentialId: string
      displayName?: string
      description?: string | null
      accountId?: string
    }) => {
      const response = await fetch(`/api/credentials/${payload.credentialId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: payload.displayName,
          description: payload.description,
          accountId: payload.accountId,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update credential')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.all,
      })
    },
  })
}

export function useDeleteWorkspaceCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentialId: string) => {
      const response = await fetch(`/api/credentials/${credentialId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete credential')
      }
      return response.json()
    },
    onSuccess: (_data, credentialId) => {
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.detail(credentialId) })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.all })
      queryClient.invalidateQueries({ queryKey: environmentKeys.all })
    },
  })
}

export function useWorkspaceCredentialMembers(credentialId?: string) {
  return useQuery<WorkspaceCredentialMember[]>({
    queryKey: workspaceCredentialKeys.members(credentialId),
    queryFn: async () => {
      if (!credentialId) return []
      const data = await fetchJson<MembersResponse>(`/api/credentials/${credentialId}/members`)
      return data.members ?? []
    },
    enabled: Boolean(credentialId),
    staleTime: 30 * 1000,
  })
}

export function useUpsertWorkspaceCredentialMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: {
      credentialId: string
      userId: string
      role: WorkspaceCredentialRole
    }) => {
      const response = await fetch(`/api/credentials/${payload.credentialId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: payload.userId,
          role: payload.role,
        }),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update credential member')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.members(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.all })
    },
  })
}

export function useRemoveWorkspaceCredentialMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: { credentialId: string; userId: string }) => {
      const response = await fetch(
        `/api/credentials/${payload.credentialId}/members?userId=${encodeURIComponent(payload.userId)}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to remove credential member')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.members(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.all })
    },
  })
}
