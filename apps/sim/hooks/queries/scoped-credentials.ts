'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  createWorkspaceCredentialContract,
  updateWorkspaceCredentialContract,
  type WorkspaceCredential,
  type WorkspaceCredentialType,
} from '@/lib/api/contracts/credentials'
import {
  type CreateOrganizationCredentialBody,
  createOrganizationCredentialContract,
  listOrganizationCredentialsContract,
  type OrganizationCredential,
  type UpdateOrganizationCredentialBody,
  updateOrganizationCredentialContract,
} from '@/lib/api/contracts/organization-credentials'
import { type ResourceOwner, resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { oauthCredentialKeys } from '@/hooks/queries/oauth/oauth-credentials'
import {
  organizationCredentialKeys,
  workspaceCredentialKeys,
} from '@/hooks/queries/utils/credential-keys'
import { fetchWorkspaceCredentialList } from '@/hooks/queries/utils/fetch-workspace-credentials'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'

export const SCOPED_CREDENTIALS_STALE_TIME = 60_000

export function useScopedCredentials(
  input: ResourceOwner & { type?: WorkspaceCredentialType; providerId?: string; enabled?: boolean }
) {
  const { enabled = true } = input
  const scope = input.workspaceId || input.organizationId ? resourceScopeFromOwner(input) : null
  return useQuery<Array<WorkspaceCredential | OrganizationCredential>>({
    queryKey:
      scope?.kind === 'organization'
        ? organizationCredentialKeys.list(scope.organizationId, input.type, input.providerId)
        : workspaceCredentialKeys.list(
            input.workspaceId ?? undefined,
            input.type,
            input.providerId
          ),
    queryFn: async ({ signal }) => {
      if (!scope) return []
      if (scope.kind === 'workspace')
        return fetchWorkspaceCredentialList(scope.workspaceId, signal, input.type, input.providerId)
      if (input.type && input.type !== 'oauth' && input.type !== 'service_account') return []
      return (
        await requestJson(listOrganizationCredentialsContract, {
          query: {
            organizationId: scope.organizationId,
            type: input.type,
            providerId: input.providerId,
          },
          signal,
        })
      ).credentials
    },
    enabled: Boolean(scope) && enabled,
    staleTime: SCOPED_CREDENTIALS_STALE_TIME,
  })
}

function useReconcileCredentials() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceCredentialKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: organizationCredentialKeys.lists() }),
      queryClient.invalidateQueries({ queryKey: oauthCredentialKeys.lists() }),
      invalidateSelectorQueries(queryClient),
    ])
}
export function useCreateScopedCredential() {
  const reconcile = useReconcileCredentials()
  return useMutation({
    mutationFn: async (
      body:
        | ContractBodyInput<typeof createWorkspaceCredentialContract>
        | CreateOrganizationCredentialBody
    ) =>
      'organizationId' in body
        ? requestJson(createOrganizationCredentialContract, { body })
        : requestJson(createWorkspaceCredentialContract, { body }),
    onSuccess: reconcile,
  })
}
export function useUpdateScopedCredential() {
  const reconcile = useReconcileCredentials()
  return useMutation({
    mutationFn: async (
      input: { credentialId: string } & (
        | (ContractBodyInput<typeof updateWorkspaceCredentialContract> & {
            workspaceId?: string
            organizationId?: never
          })
        | UpdateOrganizationCredentialBody
      )
    ) => {
      const { credentialId, ...body } = input
      if ('organizationId' in body && body.organizationId)
        return requestJson(updateOrganizationCredentialContract, {
          params: { id: credentialId },
          body: { ...body, organizationId: body.organizationId },
        })
      return requestJson(updateWorkspaceCredentialContract, { params: { id: credentialId }, body })
    },
    onSuccess: reconcile,
  })
}
