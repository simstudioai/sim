'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchJson } from '@/hooks/selectors/helpers'

export interface CredentialSet {
  id: string
  name: string
  description: string | null
  providerId: string | null
  createdBy: string
  createdAt: string
  updatedAt: string
  creatorName: string | null
  creatorEmail: string | null
  memberCount: number
}

export interface CredentialSetMembership {
  membershipId: string
  status: string
  joinedAt: string | null
  credentialSetId: string
  credentialSetName: string
  credentialSetDescription: string | null
  providerId: string | null
  organizationId: string
  organizationName: string
}

export interface CredentialSetInvitation {
  invitationId: string
  token: string
  status: string
  expiresAt: string
  createdAt: string
  credentialSetId: string
  credentialSetName: string
  providerId: string | null
  organizationId: string
  organizationName: string
  invitedByName: string | null
  invitedByEmail: string | null
}

interface CredentialSetsResponse {
  credentialSets?: CredentialSet[]
}

interface MembershipsResponse {
  memberships?: CredentialSetMembership[]
}

interface InvitationsResponse {
  invitations?: CredentialSetInvitation[]
}

export const credentialSetKeys = {
  all: ['credentialSets'] as const,
  list: (organizationId?: string) => ['credentialSets', 'list', organizationId ?? 'none'] as const,
  detail: (id?: string) => ['credentialSets', 'detail', id ?? 'none'] as const,
  memberships: () => ['credentialSets', 'memberships'] as const,
  invitations: () => ['credentialSets', 'invitations'] as const,
}

export async function fetchCredentialSets(organizationId: string): Promise<CredentialSet[]> {
  if (!organizationId) return []
  const data = await fetchJson<CredentialSetsResponse>('/api/credential-sets', {
    searchParams: { organizationId },
  })
  return data.credentialSets ?? []
}

export function useCredentialSets(organizationId?: string, enabled = true) {
  return useQuery<CredentialSet[]>({
    queryKey: credentialSetKeys.list(organizationId),
    queryFn: () => fetchCredentialSets(organizationId ?? ''),
    enabled: Boolean(organizationId) && enabled,
    staleTime: 60 * 1000,
  })
}

interface CredentialSetDetailResponse {
  credentialSet?: CredentialSet
}

export async function fetchCredentialSetById(id: string): Promise<CredentialSet | null> {
  if (!id) return null
  const data = await fetchJson<CredentialSetDetailResponse>(`/api/credential-sets/${id}`)
  return data.credentialSet ?? null
}

export function useCredentialSetDetail(id?: string, enabled = true) {
  return useQuery<CredentialSet | null>({
    queryKey: credentialSetKeys.detail(id),
    queryFn: () => fetchCredentialSetById(id ?? ''),
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 1000,
  })
}

export function useCredentialSetMemberships() {
  return useQuery<CredentialSetMembership[]>({
    queryKey: credentialSetKeys.memberships(),
    queryFn: async () => {
      const data = await fetchJson<MembershipsResponse>('/api/credential-sets/memberships')
      return data.memberships ?? []
    },
    staleTime: 60 * 1000,
  })
}

export function useCredentialSetInvitations() {
  return useQuery<CredentialSetInvitation[]>({
    queryKey: credentialSetKeys.invitations(),
    queryFn: async () => {
      const data = await fetchJson<InvitationsResponse>('/api/credential-sets/invitations')
      return data.invitations ?? []
    },
    staleTime: 30 * 1000,
  })
}

export function useAcceptCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (token: string) => {
      const response = await fetch(`/api/credential-sets/invite/${token}`, {
        method: 'POST',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to accept invitation')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.memberships() })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.invitations() })
    },
  })
}

export interface CreateCredentialSetData {
  organizationId: string
  name: string
  description?: string
  providerId?: string
}

export function useCreateCredentialSet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateCredentialSetData) => {
      const response = await fetch('/api/credential-sets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to create credential set')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.list(variables.organizationId) })
    },
  })
}

export function useCreateCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { credentialSetId: string; email?: string }) => {
      const response = await fetch(`/api/credential-sets/${data.credentialSetId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      })
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to create invitation')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.all })
    },
  })
}

export interface CredentialSetMember {
  id: string
  userId: string
  status: string
  joinedAt: string | null
  createdAt: string
  userName: string | null
  userEmail: string | null
  userImage: string | null
  credentials: { providerId: string; accountId: string }[]
}

interface MembersResponse {
  members?: CredentialSetMember[]
}

export function useCredentialSetMembers(credentialSetId?: string) {
  return useQuery<CredentialSetMember[]>({
    queryKey: [...credentialSetKeys.detail(credentialSetId), 'members'],
    queryFn: async () => {
      const data = await fetchJson<MembersResponse>(
        `/api/credential-sets/${credentialSetId}/members`
      )
      return data.members ?? []
    },
    enabled: Boolean(credentialSetId),
    staleTime: 30 * 1000,
  })
}

export function useRemoveCredentialSetMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { credentialSetId: string; memberId: string }) => {
      const response = await fetch(
        `/api/credential-sets/${data.credentialSetId}/members?memberId=${data.memberId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to remove member')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...credentialSetKeys.detail(variables.credentialSetId), 'members'],
      })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.all })
    },
  })
}

export function useLeaveCredentialSet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentialSetId: string) => {
      const response = await fetch(
        `/api/credential-sets/memberships?credentialSetId=${credentialSetId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to leave credential set')
      }
      return response.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.memberships() })
    },
  })
}

export interface DeleteCredentialSetParams {
  credentialSetId: string
  organizationId: string
}

export function useDeleteCredentialSet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ credentialSetId }: DeleteCredentialSetParams) => {
      const response = await fetch(`/api/credential-sets/${credentialSetId}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete credential set')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.list(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.memberships() })
    },
  })
}

export interface CredentialSetInvitationDetail {
  id: string
  credentialSetId: string
  email: string | null
  token: string
  status: string
  expiresAt: string
  createdAt: string
  invitedBy: string
}

interface InvitationsDetailResponse {
  invitations?: CredentialSetInvitationDetail[]
}

export function useCredentialSetInvitationsDetail(credentialSetId?: string) {
  return useQuery<CredentialSetInvitationDetail[]>({
    queryKey: [...credentialSetKeys.detail(credentialSetId), 'invitations'],
    queryFn: async () => {
      const data = await fetchJson<InvitationsDetailResponse>(
        `/api/credential-sets/${credentialSetId}/invite`
      )
      return (data.invitations ?? []).filter((inv) => inv.status === 'pending')
    },
    enabled: Boolean(credentialSetId),
    staleTime: 30 * 1000,
  })
}

export function useCancelCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { credentialSetId: string; invitationId: string }) => {
      const response = await fetch(
        `/api/credential-sets/${data.credentialSetId}/invite?invitationId=${data.invitationId}`,
        { method: 'DELETE' }
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to cancel invitation')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...credentialSetKeys.detail(variables.credentialSetId), 'invitations'],
      })
    },
  })
}

export function useResendCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: { credentialSetId: string; invitationId: string; email: string }) => {
      const response = await fetch(
        `/api/credential-sets/${data.credentialSetId}/invite/${data.invitationId}`,
        { method: 'POST' }
      )
      if (!response.ok) {
        const result = await response.json()
        throw new Error(result.error || 'Failed to resend invitation')
      }
      return response.json()
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...credentialSetKeys.detail(variables.credentialSetId), 'invitations'],
      })
    },
  })
}
