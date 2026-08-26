'use client'

import type { QueryClient } from '@tanstack/react-query'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput, ContractQueryInput } from '@/lib/api/contracts'
import {
  createCredentialDraftContract,
  createWorkspaceCredentialContract,
  deleteWorkspaceCredentialContract,
  getSecretReferencesContract,
  getSecretUsageContract,
  getWorkspaceCredentialContract,
  listWorkspaceCredentialMembersContract,
  listWorkspaceCredentialsContract,
  removeWorkspaceCredentialMemberContract,
  type SecretUsageScope,
  updateWorkspaceCredentialContract,
  upsertWorkspaceCredentialMemberContract,
  type WorkspaceCredential,
  type WorkspaceCredentialMember,
  type WorkspaceCredentialRole,
  type WorkspaceCredentialType,
} from '@/lib/api/contracts'
import { environmentKeys } from '@/hooks/queries/environment'
import { oauthConnectionsKeys } from '@/hooks/queries/oauth/oauth-connections'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import {
  fetchWorkspaceCredentialList,
  requireWorkspaceCredentialListResponse,
  WORKSPACE_CREDENTIAL_LIST_STALE_TIME,
} from '@/hooks/queries/utils/fetch-workspace-credentials'

/**
 * Key prefix for OAuth credential queries.
 * Duplicated here to avoid circular imports with oauth-credentials.ts.
 */
const OAUTH_CREDENTIALS_KEY = ['oauthCredentials'] as const

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
export function prefetchWorkspaceCredentials(
  queryClient: QueryClient,
  workspaceId: string,
  type?: WorkspaceCredentialType
) {
  queryClient.prefetchQuery({
    queryKey: workspaceCredentialKeys.list(workspaceId, type),
    queryFn: ({ signal }) => fetchWorkspaceCredentialList(workspaceId, signal, type),
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
      return requireWorkspaceCredentialListResponse(data)
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
    // The credential-detail form seeds editable name/description fields from
    // this data, so a background focus refetch during an edit could clobber
    // an unsaved draft. Off the desktop focus-refetch default; no-op on web.
    refetchOnWindowFocus: false,
  })
}

export function useCreateCredentialDraft() {
  return useMutation({
    mutationFn: async (payload: ContractBodyInput<typeof createCredentialDraftContract>) => {
      return requestJson(createCredentialDraftContract, { body: payload })
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
      // Forward the whole contract body rather than re-listing its fields: a
      // hand-maintained allowlist silently drops any field added to the
      // contract later, and the payload type makes that invisible to `tsc`.
      const { credentialId, ...body } = payload
      return requestJson(updateWorkspaceCredentialContract, {
        params: { id: credentialId },
        body,
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
      const previousDetail = queryClient.getQueryData<WorkspaceCredential | null>(
        workspaceCredentialKeys.detail(variables.credentialId)
      )

      /** Applies the in-flight edit to one cached credential. */
      const withEdit = (cred: WorkspaceCredential): WorkspaceCredential => ({
        ...cred,
        ...(variables.displayName !== undefined ? { displayName: variables.displayName } : {}),
        ...(variables.description !== undefined
          ? { description: variables.description ?? null }
          : {}),
        ...(variables.unredacted !== undefined ? { unredacted: variables.unredacted } : {}),
      })

      /*
       * The detail cache is patched alongside the lists, not just cancelled: a
       * detail-backed editor compares its drafts against this entry to decide
       * whether it is dirty, so leaving it stale keeps the surface dirty after a
       * successful save until the `onSettled` refetch lands — long enough for
       * Discard to restore the pre-save value over the committed one.
       */
      queryClient.setQueryData<WorkspaceCredential | null>(
        workspaceCredentialKeys.detail(variables.credentialId),
        (old) => (old ? withEdit(old) : old)
      )

      queryClient.setQueriesData<WorkspaceCredential[]>(
        { queryKey: workspaceCredentialKeys.lists() },
        (old) => {
          if (!old) return old
          return old.map((cred) => (cred.id === variables.credentialId ? withEdit(cred) : cred))
        }
      )

      return { previousLists, previousDetail }
    },
    onError: (_err, variables, context) => {
      if (context?.previousLists) {
        for (const [queryKey, data] of context.previousLists) {
          queryClient.setQueryData(queryKey, data)
        }
      }
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(
          workspaceCredentialKeys.detail(variables.credentialId),
          context.previousDetail
        )
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
      queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() })
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

/**
 * The trail is written by every run that resolves the secret, so it goes stale quickly. A
 * short window keeps "last used" meaningful without refetching on every panel interaction.
 */
export const SECRET_USAGE_STALE_TIME = 30 * 1000

interface SecretUsageParams {
  workspaceId?: string
  name?: string
  scope?: SecretUsageScope
}

/** Reads one secret's usage trail. Only credential admins are authorized server-side. */
export function useSecretUsage({ workspaceId, name, scope }: SecretUsageParams, enabled = true) {
  return useQuery({
    queryKey: workspaceCredentialKeys.usage(workspaceId, name, scope),
    queryFn: ({ signal }) =>
      requestJson(getSecretUsageContract, {
        query: {
          workspaceId: workspaceId as string,
          name: name as string,
          scope: scope as SecretUsageScope,
        },
        signal,
      }),
    enabled: Boolean(workspaceId && name && scope) && enabled,
    staleTime: SECRET_USAGE_STALE_TIME,
  })
}

/**
 * References only move when someone edits a workflow, a custom tool, or an MCP server — far
 * less often than the usage trail, which every run appends to. A longer window keeps the scan
 * (which reads every candidate block in the workspace) off the wire on tab switches.
 */
export const SECRET_REFERENCES_STALE_TIME = 5 * 60 * 1000

interface SecretReferencesParams {
  workspaceId?: string
  name?: string
}

/**
 * Reads where one secret is wired in. Takes no scope: a reference names a key, not a scope, and
 * the server authorizes against what the name resolves to. Only credential admins of a workspace
 * secret — or the owner of a personal one — are authorized server-side.
 */
export function useSecretReferences({ workspaceId, name }: SecretReferencesParams, enabled = true) {
  return useQuery({
    queryKey: workspaceCredentialKeys.references(workspaceId, name),
    queryFn: ({ signal }) =>
      requestJson(getSecretReferencesContract, {
        query: { workspaceId: workspaceId as string, name: name as string },
        signal,
      }),
    enabled: Boolean(workspaceId && name) && enabled,
    staleTime: SECRET_REFERENCES_STALE_TIME,
  })
}
