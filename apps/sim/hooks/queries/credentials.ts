'use client'

import type { QueryClient } from '@tanstack/react-query'
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
  lists: () => [...workspaceCredentialKeys.all, 'list'] as const,
  list: (workspaceId?: string, type?: string, providerId?: string) =>
    [
      ...workspaceCredentialKeys.lists(),
      workspaceId ?? 'none',
      type ?? 'all',
      providerId ?? 'all',
    ] as const,
  details: () => [...workspaceCredentialKeys.all, 'detail'] as const,
  detail: (credentialId?: string) =>
    [...workspaceCredentialKeys.details(), credentialId ?? 'none'] as const,
  members: (credentialId?: string) =>
    [...workspaceCredentialKeys.detail(credentialId), 'members'] as const,
}

/**
 * Fetch workspace credential list from API.
 * Used by the prefetch function for hover-based cache warming.
 */
async function fetchWorkspaceCredentialList(
  workspaceId: string,
  signal?: AbortSignal
): Promise<WorkspaceCredential[]> {
  const data = await fetchJson<CredentialListResponse>('/api/credentials', {
    searchParams: { workspaceId },
    signal,
  })
  return data.credentials ?? []
}

/**
 * Prefetch workspace credentials into a QueryClient cache.
 * Use on hover to warm data before navigation.
 */
export function prefetchWorkspaceCredentials(queryClient: QueryClient, workspaceId: string) {
  queryClient.prefetchQuery({
    queryKey: workspaceCredentialKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceCredentialList(workspaceId, signal),
    staleTime: 60 * 1000,
  })
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
    queryFn: async ({ signal }) => {
      if (!workspaceId) return []
      const data = await fetchJson<CredentialListResponse>('/api/credentials', {
        searchParams: {
          workspaceId,
          type,
          providerId,
        },
        signal,
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
    queryFn: async ({ signal }) => {
      if (!credentialId) return null
      const data = await fetchJson<CredentialResponse>(`/api/credentials/${credentialId}`, {
        signal,
      })
      return data.credential ?? null
    },
    enabled: Boolean(credentialId) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useCreateCredentialDraft() {
  return useMutation({
    mutationFn: async (payload: {
      workspaceId: string
      providerId: string
      displayName: string
      description?: string
      credentialId?: string
    }) => {
      const response = await fetch('/api/credentials/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create credential draft')
      }
    },
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
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.lists(),
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
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.lists(),
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
    onSettled: (_data, _error, credentialId) => {
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.detail(credentialId) })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })
      queryClient.invalidateQueries({ queryKey: environmentKeys.all })
    },
  })
}

export function useWorkspaceCredentialMembers(credentialId?: string) {
  return useQuery<WorkspaceCredentialMember[]>({
    queryKey: workspaceCredentialKeys.members(credentialId),
    queryFn: async ({ signal }) => {
      if (!credentialId) return []
      const data = await fetchJson<MembersResponse>(`/api/credentials/${credentialId}/members`, {
        signal,
      })
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
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.members(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
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
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.members(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
    },
  })
}
