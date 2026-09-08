'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import {
  type CredentialGroupAccessResponse,
  createCredentialGroupMcpConnectorContract,
  deleteCredentialGroupEnrollmentContract,
  deleteCredentialGroupMcpConnectorContract,
  ensureWorkspaceAccountsContract,
  getCredentialGroupAccessContract,
  getCredentialGroupContract,
  inviteCredentialGroupEnrollmentsContract,
  resendCredentialGroupEnrollmentContract,
  type StartSlackCredentialGroupConfigurationBody,
  startSlackCredentialGroupConfigurationContract,
  updateCredentialGroupAccessContract,
  updateCredentialGroupContract,
  updateCredentialGroupMcpConnectorContract,
} from '@/lib/api/contracts/credential-groups'
import { startOrganizationSlackConfigurationContract } from '@/lib/api/contracts/organization-accounts'
import type { ContractJsonResponse } from '@/lib/api/contracts/types'
import { resourceScopeFromOwner } from '@/lib/core/resource-scope'
import { mcpKeys } from '@/hooks/queries/mcp'
import {
  CREDENTIAL_GROUP_ACCESS_STALE_TIME,
  CREDENTIAL_GROUP_DETAIL_STALE_TIME,
  credentialGroupKeys,
  fetchWorkspaceAccounts,
  WORKSPACE_ACCOUNTS_STALE_TIME,
} from '@/hooks/queries/utils/credential-group-queries'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'

export function useWorkspaceAccounts(workspaceId?: string) {
  return useQuery({
    queryKey: credentialGroupKeys.workspace(workspaceId),
    queryFn: async ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace ID is required')
      return fetchWorkspaceAccounts(workspaceId, signal)
    },
    enabled: Boolean(workspaceId),
    staleTime: WORKSPACE_ACCOUNTS_STALE_TIME,
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

export function useEnsureWorkspaceAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspaceId }: { workspaceId: string }) =>
      requestJson(ensureWorkspaceAccountsContract, { params: { id: workspaceId } }),
    onSuccess: (_data, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.workspace(variables.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: mcpKeys.managedCatalogList(variables.workspaceId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
          queryKey: credentialGroupKeys.workspace(variables.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
        }),
        queryClient.invalidateQueries({
          queryKey: mcpKeys.managedCatalogList(variables.workspaceId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}

function invalidateManagedMcpConnectorQueries(
  queryClient: ReturnType<typeof useQueryClient>,
  workspaceId: string,
  groupId: string
) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: credentialGroupKeys.workspace(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: credentialGroupKeys.detail(workspaceId, groupId) }),
    queryClient.invalidateQueries({ queryKey: mcpKeys.serversList(workspaceId) }),
    queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalogList(workspaceId) }),
    invalidateSelectorQueries(queryClient),
  ])
}

export function useCreateCredentialGroupMcpConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      body,
    }: {
      workspaceId: string
      groupId: string
      body: ContractBodyInput<typeof createCredentialGroupMcpConnectorContract>
    }) =>
      requestJson(createCredentialGroupMcpConnectorContract, {
        params: { id: workspaceId, groupId },
        body,
      }),
    onSettled: (_data, _error, variables) =>
      invalidateManagedMcpConnectorQueries(queryClient, variables.workspaceId, variables.groupId),
  })
}

export function useUpdateCredentialGroupMcpConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      connectorId,
      body,
    }: {
      workspaceId: string
      groupId: string
      connectorId: 'fireflies' | 'granola' | 'databricks'
      body: ContractBodyInput<typeof updateCredentialGroupMcpConnectorContract>
    }) =>
      requestJson(updateCredentialGroupMcpConnectorContract, {
        params: { id: workspaceId, groupId, connectorId },
        body,
      }),
    onSettled: (_data, _error, variables) =>
      invalidateManagedMcpConnectorQueries(queryClient, variables.workspaceId, variables.groupId),
  })
}

export function useDeleteCredentialGroupMcpConnector() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      workspaceId,
      groupId,
      connectorId,
    }: {
      workspaceId: string
      groupId: string
      connectorId: 'fireflies' | 'granola' | 'databricks'
    }) =>
      requestJson(deleteCredentialGroupMcpConnectorContract, {
        params: { id: workspaceId, groupId, connectorId },
      }),
    onSettled: (_data, _error, variables) =>
      invalidateManagedMcpConnectorQueries(queryClient, variables.workspaceId, variables.groupId),
  })
}

export function useStartSlackCredentialGroupConfiguration() {
  return useMutation({
    mutationFn: async ({
      workspaceId,
      organizationId,
      credentialGroupId,
      body,
    }: {
      credentialGroupId: string
      body: StartSlackCredentialGroupConfigurationBody
    } & (
      | { workspaceId: string; organizationId?: never }
      | { organizationId: string; workspaceId?: never }
    )) => {
      const scope = resourceScopeFromOwner({ workspaceId, organizationId })
      if (scope.kind === 'organization') {
        if (!body.appId || !body.teamId)
          throw new Error('Slack App ID and workspace ID are required')
        return requestJson(startOrganizationSlackConfigurationContract, {
          params: { id: scope.organizationId, groupId: credentialGroupId },
          body: {
            clientId: body.clientId,
            clientSecret: body.clientSecret,
            appId: body.appId,
            teamId: body.teamId,
            requiredScopes: body.requiredScopes,
          },
        })
      }
      return requestJson(startSlackCredentialGroupConfigurationContract, {
        params: { id: scope.workspaceId, groupId: credentialGroupId },
        body,
      })
    },
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
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
        }),
        queryClient.invalidateQueries({
          queryKey: mcpKeys.managedCatalogList(variables.workspaceId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
        }),
        queryClient.invalidateQueries({
          queryKey: mcpKeys.managedCatalogList(variables.workspaceId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
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
    onSettled: (_data, _error, variables) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: credentialGroupKeys.detail(variables.workspaceId, variables.groupId),
        }),
        queryClient.invalidateQueries({
          queryKey: mcpKeys.managedCatalogList(variables.workspaceId),
        }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}
