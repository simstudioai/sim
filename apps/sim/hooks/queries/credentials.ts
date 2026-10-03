'use client'

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
  removeWorkspaceCredentialMemberContract,
  type SecretUsageScope,
  updateWorkspaceCredentialContract,
  upsertWorkspaceCredentialMemberContract,
  type WorkspaceCredential,
  type WorkspaceCredentialMember,
  type WorkspaceCredentialRole,
  type WorkspaceCredentialType,
} from '@/lib/api/contracts'
import {
  type CreateOrganizationCredentialDraftBody,
  createOrganizationCredentialDraftContract,
} from '@/lib/api/contracts/organization-credentials'
import { environmentKeys } from '@/hooks/queries/environment'
import { oauthConnectionsKeys } from '@/hooks/queries/oauth/oauth-connections'
import { personalCredentialKeys } from '@/hooks/queries/personal-credentials'
import { workspaceCredentialKeys } from '@/hooks/queries/utils/credential-keys'
import { workspaceCredentialListQueryOptions } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'

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

export function useWorkspaceCredentials(params: {
  workspaceId?: string
  type?: WorkspaceCredentialType
  providerId?: string
  enabled?: boolean
}) {
  const { workspaceId, type, providerId, enabled = true } = params

  return useQuery({
    ...workspaceCredentialListQueryOptions(workspaceId, type, providerId),
    enabled: Boolean(workspaceId) && enabled,
  })
}

export function useWorkspaceCredential(
  credentialId?: string,
  enabled = true,
  workspaceId?: string
) {
  return useQuery<WorkspaceCredential | null>({
    queryKey: workspaceCredentialKeys.detailForWorkspace(credentialId, workspaceId),
    queryFn: async ({ signal }) => {
      if (!credentialId) return null
      const data = await requestJson(getWorkspaceCredentialContract, {
        params: { id: credentialId },
        query: { workspaceId },
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
    mutationFn: async (
      payload:
        | ContractBodyInput<typeof createCredentialDraftContract>
        | CreateOrganizationCredentialDraftBody
    ) => {
      if ('organizationId' in payload)
        return requestJson(createOrganizationCredentialDraftContract, { body: payload })
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
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.lists(),
        }),
        queryClient.invalidateQueries({
          queryKey: OAUTH_CREDENTIALS_KEY,
        }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}

export function useUpdateWorkspaceCredential(workspaceId?: string) {
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
        query: { workspaceId },
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
        workspaceCredentialKeys.detailForWorkspace(variables.credentialId, workspaceId)
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
        workspaceCredentialKeys.detailForWorkspace(variables.credentialId, workspaceId),
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
          workspaceCredentialKeys.detailForWorkspace(variables.credentialId, workspaceId),
          context.previousDetail
        )
      }
    },
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.detail(variables.credentialId),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.lists(),
        }),
        queryClient.invalidateQueries({
          queryKey: OAUTH_CREDENTIALS_KEY,
        }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}

export function useDeleteWorkspaceCredential(workspaceId?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (credentialId: string) => {
      return requestJson(deleteWorkspaceCredentialContract, {
        params: { id: credentialId },
        query: { workspaceId },
      })
    },
    onSettled: (_data, _error, credentialId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.detail(credentialId) }),
        queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: OAUTH_CREDENTIALS_KEY }),
        queryClient.invalidateQueries({ queryKey: environmentKeys.all }),
        queryClient.invalidateQueries({ queryKey: oauthConnectionsKeys.connections() }),
        invalidateSelectorQueries(queryClient),
      ]),
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
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.members(variables.credentialId),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.detail(variables.credentialId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.members(variables.credentialId),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceCredentialKeys.detail(variables.credentialId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
 * Always stale: the list mirrors the canvas, and the reader has usually just come from editing
 * it — deleting the block a row pointed at, then returning here to see it gone. A stale window
 * served the old list for its whole length, and no invalidation can cover a workflow someone
 * else changed. Cached data still shows while the scan refreshes, so a tab switch costs one
 * bounded, prefiltered query rather than a blank panel.
 */
export const SECRET_REFERENCES_STALE_TIME = 0

interface SecretReferencesParams {
  workspaceId?: string
  name?: string
}

/**
 * Reads where one secret is wired in. Takes no scope: a reference names a key, not a scope, and
 * the server authorizes against what the name resolves to. Only credential admins of a workspace
 * secret — or the owner of a personal one — are authorized server-side.
 *
 * Refetches on window focus even on the web, where the app default leaves it off: the edit that
 * moves a reference happens on a canvas, often in another tab, and this panel has no other
 * signal for it. `'always'`, not `true`: `true` refetches only a STALE query, which would tie
 * this guarantee to `SECRET_REFERENCES_STALE_TIME` staying exactly 0.
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
    refetchOnWindowFocus: 'always',
  })
}
