'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type CredentialGroupAccessResponse,
  createCredentialGroupContract,
  deleteCredentialGroupContract,
  deleteCredentialGroupEnrollmentContract,
  getCredentialGroupAccessContract,
  getCredentialGroupContract,
  inviteCredentialGroupEnrollmentsContract,
  resendCredentialGroupEnrollmentContract,
  startSlackCredentialGroupConfigurationContract,
  updateCredentialGroupAccessContract,
  updateCredentialGroupContract,
} from '@/lib/api/contracts/credential-groups'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import {
  CREDENTIAL_GROUP_ACCESS_STALE_TIME,
  CREDENTIAL_GROUP_DETAIL_STALE_TIME,
  CREDENTIAL_GROUP_LIST_STALE_TIME,
  credentialGroupKeys,
  fetchCredentialGroupList,
} from '@/hooks/queries/utils/credential-group-queries'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'

export function useCredentialGroups(workspaceId?: string) {
  return useQuery({
    queryKey: credentialGroupKeys.list(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) return []
      return fetchCredentialGroupList(workspaceId, signal)
    },
    enabled: Boolean(workspaceId),
    staleTime: CREDENTIAL_GROUP_LIST_STALE_TIME,
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
    staleTime: CREDENTIAL_GROUP_DETAIL_STALE_TIME,
    // An infinite staleTime never goes stale, so the app-wide `retryOnMount: false`
    // would cache one transient failure for the life of the QueryClient.
    retryOnMount: true,
  })
}

interface UseCredentialGroupAccessOptions {
  enabled?: boolean
}

export function useCredentialGroupAccess(
  workspaceId?: string,
  groupId?: string,
  { enabled = true }: UseCredentialGroupAccessOptions = {}
) {
  return useQuery({
    queryKey: credentialGroupKeys.access(workspaceId, groupId),
    queryFn: ({ signal }) => {
      if (!workspaceId || !groupId) {
        throw new Error('Credential Group access identifiers are required')
      }
      return requestJson(getCredentialGroupAccessContract, {
        params: { id: workspaceId, groupId },
        signal,
      })
    },
    enabled: Boolean(workspaceId && groupId && enabled),
    staleTime: CREDENTIAL_GROUP_ACCESS_STALE_TIME,
    retryOnMount: true,
  })
}

export function useUpdateCredentialGroupAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      body,
    }: {
      workspaceId: string
      groupId: string
      body: ContractBodyInput<typeof updateCredentialGroupAccessContract>
    }) =>
      requestJson(updateCredentialGroupAccessContract, {
        params: { id: workspaceId, groupId },
        body,
      }),
    onMutate: async (variables) => {
      const queryKey = credentialGroupKeys.access(variables.workspaceId, variables.groupId)
      await queryClient.cancelQueries({ queryKey, exact: true })
      const cachedAccess = queryClient.getQueryData<CredentialGroupAccessResponse>(queryKey)
      if (!cachedAccess) {
        throw new Error('Credential Group access must be loaded before it can be updated')
      }
      return { queryKey, workflows: cachedAccess.workflows }
    },
    onSuccess: (access, _variables, context) => {
      if (!context) throw new Error('Credential Group access mutation context is unavailable')
      queryClient.setQueryData<CredentialGroupAccessResponse>(context.queryKey, {
        ...access,
        workflows: context.workflows,
      })
    },
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.access(variables.workspaceId, variables.groupId),
          exact: true,
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
      invalidateSelectorQueries(queryClient)
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
      queryClient.removeQueries({
        queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
      })
      invalidateSelectorQueries(queryClient)
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
    // Returned so `mutateAsync` resolves only once the refetch has landed. Callers
    // clear their edit buffer on success, which would otherwise fall back onto the
    // pre-save cache and flash the old values.
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.list(variables.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
      invalidateSelectorQueries(queryClient)
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
      invalidateSelectorQueries(queryClient)
    },
  })
}

export function useDeleteCredentialGroupEnrollment() {
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
      requestJson(deleteCredentialGroupEnrollmentContract, {
        params: { id: workspaceId, groupId, enrollmentId },
      }),
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
      })
      invalidateSelectorQueries(queryClient)
    },
  })
}
