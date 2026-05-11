'use client'

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type {
  ContractBodyInput,
  ContractParamsInput,
  ContractQueryInput,
} from '@/lib/api/contracts'
import {
  acceptCredentialSetInvitationContract,
  type CreateCredentialSetData,
  type CredentialSet,
  type CredentialSetInvitation,
  type CredentialSetInvitationDetail,
  type CredentialSetMember,
  type CredentialSetMembership,
  cancelCredentialSetInvitationContract,
  createCredentialSetContract,
  createCredentialSetInvitationContract,
  deleteCredentialSetContract,
  getCredentialSetContract,
  leaveCredentialSetContract,
  listCredentialSetInvitationDetailsContract,
  listCredentialSetInvitationsContract,
  listCredentialSetMembersContract,
  listCredentialSetMembershipsContract,
  listCredentialSetsContract,
  removeCredentialSetMemberContract,
  resendCredentialSetInvitationContract,
} from '@/lib/api/contracts'

export type {
  CreateCredentialSetData,
  CredentialSet,
  CredentialSetInvitation,
  CredentialSetInvitationDetail,
  CredentialSetMember,
  CredentialSetMembership,
}

export const credentialSetKeys = {
  all: ['credentialSets'] as const,
  lists: () => [...credentialSetKeys.all, 'list'] as const,
  list: (organizationId?: string) =>
    [...credentialSetKeys.lists(), organizationId ?? 'none'] as const,
  details: () => [...credentialSetKeys.all, 'detail'] as const,
  detail: (id?: string) => [...credentialSetKeys.details(), id ?? 'none'] as const,
  detailMembers: (credentialSetId?: string) =>
    [...credentialSetKeys.detail(credentialSetId), 'members'] as const,
  detailInvitations: (credentialSetId?: string) =>
    [...credentialSetKeys.detail(credentialSetId), 'invitations'] as const,
  memberships: () => [...credentialSetKeys.all, 'memberships'] as const,
  invitations: () => [...credentialSetKeys.all, 'invitations'] as const,
}

async function fetchCredentialSets(
  organizationId: string,
  signal?: AbortSignal
): Promise<CredentialSet[]> {
  if (!organizationId) return []
  const data = await requestJson(listCredentialSetsContract, {
    query: { organizationId },
    signal,
  })
  return data.credentialSets ?? []
}

export function useCredentialSets(organizationId?: string, enabled = true) {
  return useQuery<CredentialSet[]>({
    queryKey: credentialSetKeys.list(organizationId),
    queryFn: ({ signal }) => fetchCredentialSets(organizationId ?? '', signal),
    enabled: Boolean(organizationId) && enabled,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export async function fetchCredentialSetById(
  id: string,
  signal?: AbortSignal
): Promise<CredentialSet | null> {
  if (!id) return null
  const data = await requestJson(getCredentialSetContract, {
    params: { id },
    signal,
  })
  return data.credentialSet ?? null
}

export function useCredentialSetDetail(id?: string, enabled = true) {
  return useQuery<CredentialSet | null>({
    queryKey: credentialSetKeys.detail(id),
    queryFn: ({ signal }) => fetchCredentialSetById(id ?? '', signal),
    enabled: Boolean(id) && enabled,
    staleTime: 60 * 1000,
    placeholderData: keepPreviousData,
  })
}

export function useCredentialSetMemberships() {
  return useQuery<CredentialSetMembership[]>({
    queryKey: credentialSetKeys.memberships(),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listCredentialSetMembershipsContract, { signal })
      return data.memberships ?? []
    },
    staleTime: 60 * 1000,
  })
}

export function useCredentialSetInvitations() {
  return useQuery<CredentialSetInvitation[]>({
    queryKey: credentialSetKeys.invitations(),
    queryFn: async ({ signal }) => {
      const data = await requestJson(listCredentialSetInvitationsContract, { signal })
      return data.invitations ?? []
    },
    staleTime: 30 * 1000,
  })
}

export function useAcceptCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (token: string) => {
      return requestJson(acceptCredentialSetInvitationContract, {
        params: { token },
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.memberships() })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.invitations() })
    },
  })
}

export function useCreateCredentialSet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (data: CreateCredentialSetData) => {
      return requestJson(createCredentialSetContract, { body: data })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.list(variables.organizationId) })
    },
  })
}

export function useCreateCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      data: { credentialSetId: string } & ContractBodyInput<
        typeof createCredentialSetInvitationContract
      >
    ) => {
      return requestJson(createCredentialSetInvitationContract, {
        params: { id: data.credentialSetId },
        body: { email: data.email },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.detailInvitations(variables.credentialSetId),
      })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.invitations() })
    },
  })
}

export function useCredentialSetMembers(credentialSetId?: string) {
  return useQuery<CredentialSetMember[]>({
    queryKey: credentialSetKeys.detailMembers(credentialSetId),
    queryFn: async ({ signal }) => {
      if (!credentialSetId) return []
      const data = await requestJson(listCredentialSetMembersContract, {
        params: { id: credentialSetId },
        signal,
      })
      return data.members ?? []
    },
    enabled: Boolean(credentialSetId),
    staleTime: 30 * 1000,
  })
}

export function useRemoveCredentialSetMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      data: { credentialSetId: string } & ContractQueryInput<
        typeof removeCredentialSetMemberContract
      >
    ) => {
      return requestJson(removeCredentialSetMemberContract, {
        params: { id: data.credentialSetId },
        query: { memberId: data.memberId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.detailMembers(variables.credentialSetId),
      })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.memberships() })
    },
  })
}

export function useLeaveCredentialSet() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentialSetId: string) => {
      return requestJson(leaveCredentialSetContract, {
        query: { credentialSetId },
      })
    },
    onSettled: () => {
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
      return requestJson(deleteCredentialSetContract, {
        params: { id: credentialSetId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.list(variables.organizationId),
      })
      queryClient.invalidateQueries({ queryKey: credentialSetKeys.memberships() })
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.detail(variables.credentialSetId),
      })
    },
  })
}

export function useCredentialSetInvitationsDetail(credentialSetId?: string) {
  return useQuery<CredentialSetInvitationDetail[]>({
    queryKey: credentialSetKeys.detailInvitations(credentialSetId),
    queryFn: async ({ signal }) => {
      if (!credentialSetId) return []
      const data = await requestJson(listCredentialSetInvitationDetailsContract, {
        params: { id: credentialSetId },
        signal,
      })
      return (data.invitations ?? []).filter((inv) => inv.status === 'pending')
    },
    enabled: Boolean(credentialSetId),
    staleTime: 30 * 1000,
  })
}

export function useCancelCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      data: { credentialSetId: string } & ContractQueryInput<
        typeof cancelCredentialSetInvitationContract
      >
    ) => {
      return requestJson(cancelCredentialSetInvitationContract, {
        params: { id: data.credentialSetId },
        query: { invitationId: data.invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.detailInvitations(variables.credentialSetId),
      })
    },
  })
}

export function useResendCredentialSetInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      data: { credentialSetId: string; email: string } & Pick<
        ContractParamsInput<typeof resendCredentialSetInvitationContract>,
        'invitationId'
      >
    ) => {
      return requestJson(resendCredentialSetInvitationContract, {
        params: { id: data.credentialSetId, invitationId: data.invitationId },
      })
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialSetKeys.detailInvitations(variables.credentialSetId),
      })
    },
  })
}
