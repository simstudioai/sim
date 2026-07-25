'use client'

import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput, ContractQueryInput } from '@/lib/api/contracts'
import {
  createCredentialDraftContract,
  createWorkspaceCredentialContract,
  deleteWorkspaceCredentialContract,
  getWorkspaceCredentialContract,
  listWorkspaceCredentialMembersContract,
  listWorkspaceCredentialsContract,
  removeWorkspaceCredentialMemberContract,
  updateWorkspaceCredentialContract,
  upsertWorkspaceCredentialMemberContract,
  type WorkspaceCredential,
  type WorkspaceCredentialMember,
  type WorkspaceCredentialRole,
  type WorkspaceCredentialType,
} from '@/lib/api/contracts'
import { environmentKeys } from '@/hooks/queries/environment'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { fetchWorkspaceCredentialList } from '@/hooks/queries/utils/fetch-workspace-credentials'

/**
 * Key prefix for OAuth credential queries.
 * Duplicated here to avoid circular imports with oauth-credentials.ts.
 */
const OAUTH_CREDENTIALS_KEY = ['oauthCredentials'] as const

export const WORKSPACE_CREDENTIAL_LIST_STALE_TIME = 60 * 1000
export const WORKSPACE_CREDENTIAL_DETAIL_STALE_TIME = 60 * 1000
export const WORKSPACE_CREDENTIAL_MEMBER_LIST_STALE_TIME = 30 * 1000

export type {
  WorkspaceCredential,
  WorkspaceCredentialMember,
  WorkspaceCredentialRole,
  WorkspaceCredentialType,
}

/**
 * Prefetch workspace credentials into a QueryClient cache.
 * Use on hover to warm data before navigation.
 */
export function prefetchWorkspaceCredentials(queryClient: QueryClient, workspaceId: string) {
  queryClient.prefetchQuery({
    queryKey: workspaceCredentialKeys.list(workspaceId),
    queryFn: ({ signal }) => fetchWorkspaceCredentialList(workspaceId, signal),
    staleTime: WORKSPACE_CREDENTIAL_LIST_STALE_TIME,
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
      const data = await requestJson(listWorkspaceCredentialsContract, {
        query: {
          workspaceId,
          type,
          providerId,
        },
        signal,
      })
      return data.credentials ?? []
    },
    enabled: Boolean(workspaceId) && enabled,
    staleTime: WORKSPACE_CREDENTIAL_LIST_STALE_TIME,
  })
}

export function useWorkspaceCredential(credentialId?: string, enabled = true) {
  return useQuery<WorkspaceCredential | null>({
    queryKey: workspaceCredentialKeys.detail(credentialId),
    queryFn: async ({ signal }) => {
      if (!credentialId) return null
      const data = await requestJson(getWorkspaceCredentialContract, {
        params: { id: credentialId },
        signal,
      })
      return data.credential ?? null
    },
    enabled: Boolean(credentialId) && enabled,
    staleTime: WORKSPACE_CREDENTIAL_DETAIL_STALE_TIME,
  })
}

export function useCreateCredentialDraft() {
  return useMutation({
    mutationFn: async (payload: ContractBodyInput<typeof createCredentialDraftContract>) => {
      await requestJson(createCredentialDraftContract, { body: payload })
    },
  })
}

export function useCreateWorkspaceCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: ContractBodyInput<typeof createWorkspaceCredentialContract>) => {
      return requestJson(createWorkspaceCredentialContract, { body: payload })
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: OAUTH_CREDENTIALS_KEY,
      })
    },
  })
}

export function useUpdateWorkspaceCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: {
        credentialId: string
      } & ContractBodyInput<typeof updateWorkspaceCredentialContract>
    ) => {
      return requestJson(updateWorkspaceCredentialContract, {
        params: { id: payload.credentialId },
        body: {
          displayName: payload.displayName,
          description: payload.description,
          serviceAccountJson: payload.serviceAccountJson,
          signingSecret: payload.signingSecret,
          botToken: payload.botToken,
          apiToken: payload.apiToken,
          domain: payload.domain,
          clientId: payload.clientId,
          clientSecret: payload.clientSecret,
          orgId: payload.orgId,
        },
      })
    },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
      await queryClient.cancelQueries({ queryKey: workspaceCredentialKeys.lists() })

      const previousLists = queryClient.getQueriesData<WorkspaceCredential[]>({
        queryKey: workspaceCredentialKeys.lists(),
      })

      queryClient.setQueriesData<WorkspaceCredential[]>(
        { queryKey: workspaceCredentialKeys.lists() },
        (old) => {
          if (!old) return old
          return old.map((cred) =>
            cred.id === variables.credentialId
              ? {
                  ...cred,
                  ...(variables.displayName !== undefined
                    ? { displayName: variables.displayName }
                    : {}),
                  ...(variables.description !== undefined
                    ? { description: variables.description ?? null }
                    : {}),
                }
              : cred
          )
        }
      )

      return { previousLists }
    },
    onError: (_err, _variables, context) => {
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data)
        }
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.detail(variables.credentialId),
      })
      queryClient.invalidateQueries({
        queryKey: workspaceCredentialKeys.lists(),
      })
      queryClient.invalidateQueries({
        queryKey: OAUTH_CREDENTIALS_KEY,
      })
    },
  })
}

export function useDeleteWorkspaceCredential() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentialId: string) => {
      return requestJson(deleteWorkspaceCredentialContract, { params: { id: credentialId } })
    },
    onSettled: (_data, _error, credentialId) => {
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.detail(credentialId) })
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() })
      queryClient.invalidateQueries({ queryKey: OAUTH_CREDENTIALS_KEY })
      queryClient.invalidateQueries({ queryKey: environmentKeys.all })
    },
  })
}

export function useWorkspaceCredentialMembers(credentialId?: string) {
  return useQuery<WorkspaceCredentialMember[]>({
    queryKey: workspaceCredentialKeys.members(credentialId),
    queryFn: async ({ signal }) => {
      if (!credentialId) return []
      const data = await requestJson(listWorkspaceCredentialMembersContract, {
        params: { id: credentialId },
        signal,
      })
      return data.members ?? []
    },
    enabled: Boolean(credentialId),
    staleTime: WORKSPACE_CREDENTIAL_MEMBER_LIST_STALE_TIME,
  })
}

export function useUpsertWorkspaceCredentialMember() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (
      payload: {
        credentialId: string
      } & ContractBodyInput<typeof upsertWorkspaceCredentialMemberContract>
    ) => {
      return requestJson(upsertWorkspaceCredentialMemberContract, {
        params: { id: payload.credentialId },
        body: {
          userId: payload.userId,
          role: payload.role,
        },
      })
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
    mutationFn: async (
      payload: {
        credentialId: string
      } & ContractQueryInput<typeof removeWorkspaceCredentialMemberContract>
    ) => {
      return requestJson(removeWorkspaceCredentialMemberContract, {
        params: { id: payload.credentialId },
        query: { userId: payload.userId },
      })
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
