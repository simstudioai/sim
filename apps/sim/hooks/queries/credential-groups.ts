'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  createCredentialGroupContract,
  deleteCredentialGroupContract,
  getCredentialGroupContract,
  inviteCredentialGroupEnrollmentsContract,
  resendCredentialGroupEnrollmentContract,
  revokeCredentialGroupEnrollmentContract,
  startSlackCredentialGroupConfigurationContract,
  updateCredentialGroupContract,
} from '@/lib/api/contracts/credential-groups'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import {
  CREDENTIAL_GROUP_DETAIL_STALE_TIME,
  CREDENTIAL_GROUP_LIST_STALE_TIME,
  credentialGroupKeys,
  fetchCredentialGroupList,
} from '@/hooks/queries/utils/credential-group-queries'

export function useCredentialGroups(workspaceId?: string) {
  return useQuery({
    queryKey: credentialGroupKeys.list(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) return []
      return fetchCredentialGroupList(workspaceId, signal)
    },
    enabled: Boolean(workspaceId),
    staleTime: CREDENTIAL_GROUP_DETAIL_STALE_TIME,
  })
}

export function useCredentialGroupDetail(workspaceId?: string, groupId?: string) {
  return useInfiniteQuery({
    queryKey: credentialGroupKeys.detail(workspaceId, groupId),
    queryFn: ({ signal, pageParam }) => {
      if (!workspaceId || !groupId)
        throw new Error('Credential group detail identifiers are required')
      return requestJson(getCredentialGroupContract, {
        params: { id: workspaceId, groupId },
        query: { limit: 50, ...(pageParam ? { cursor: pageParam } : {}) },
        signal,
      })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage: ContractJsonResponse<typeof getCredentialGroupContract>) =>
      lastPage.nextCursor ?? undefined,
    enabled: Boolean(workspaceId && groupId),
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
  })
}

export function useCreateCredentialGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      body,
    }: {
      workspaceId: string
      body: ContractBodyInput<typeof createCredentialGroupContract>
    }) => requestJson(createCredentialGroupContract, { params: { id: workspaceId }, body }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: credentialGroupKeys.list(variables.workspaceId) })
    },
  })
}

export function useDeleteCredentialGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId, groupId }: { workspaceId: string; groupId: string }) =>
      requestJson(deleteCredentialGroupContract, {
        params: { id: workspaceId, groupId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: credentialGroupKeys.list(variables.workspaceId) })
    },
  })
}

export function useUpdateCredentialGroup() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      body,
    }: {
      workspaceId: string
      groupId: string
      body: ContractBodyInput<typeof updateCredentialGroupContract>
    }) =>
      requestJson(updateCredentialGroupContract, {
        params: { id: workspaceId, groupId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: credentialGroupKeys.list(variables.workspaceId) })
      queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
      })
    },
  })
}

export function useStartSlackCredentialGroupConfiguration() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      credentialGroupId,
      body,
    }: {
      workspaceId: string
      credentialGroupId: string
      body: ContractBodyInput<typeof startSlackCredentialGroupConfigurationContract>
    }) =>
      requestJson(startSlackCredentialGroupConfigurationContract, {
        params: { id: workspaceId, groupId: credentialGroupId },
        body,
      }),
  })
}

export function useInviteCredentialGroupEnrollments() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      body,
    }: {
      workspaceId: string
      groupId: string
      body: ContractBodyInput<typeof inviteCredentialGroupEnrollmentsContract>
    }) =>
      requestJson(inviteCredentialGroupEnrollmentsContract, {
        params: { id: workspaceId, groupId },
        body,
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
      })
    },
  })
}

export function useResendCredentialGroupEnrollment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      enrollmentId,
    }: {
      workspaceId: string
      groupId: string
      enrollmentId: string
    }) =>
      requestJson(resendCredentialGroupEnrollmentContract, {
        params: { id: workspaceId, groupId, enrollmentId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
      })
    },
  })
}

export function useRevokeCredentialGroupEnrollment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      enrollmentId,
    }: {
      workspaceId: string
      groupId: string
      enrollmentId: string
    }) =>
      requestJson(revokeCredentialGroupEnrollmentContract, {
        params: { id: workspaceId, groupId, enrollmentId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
      })
    },
  })
}
