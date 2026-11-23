'use client'

import { useEffect, useRef } from 'react'
import { generateId } from '@sim/utils/id'
import {
  isServer,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { isApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { DesktopSourceRequest } from '@/lib/api/contracts/desktop-source-connect'
import {
  type AddOrganizationAccountMcpProviderBody,
  addOrganizationAccountMcpProviderContract,
  type ConfigureOrganizationMcpBody,
  configureOrganizationMcpContract,
  disconnectPersonalOrganizationAccountContract,
  type EnsureOrganizationAccountsBody,
  ensureOrganizationAccountsContract,
  getOrganizationAccountsContract,
  getOrganizationAccountWorkspaceAccessContract,
  getOrganizationDatabricksSetupContract,
  getWorkspaceOrganizationAccountsContract,
  type InviteOrganizationAccountPeopleBody,
  inviteOrganizationAccountPeopleContract,
  listOrganizationAccountPeopleContract,
  listPersonalOrganizationAccountsContract,
  type OrganizationAccountPeopleQuery,
  type RemoveOrganizationAccountMcpProviderParams,
  type ResendOrganizationAccountInvitationQuery,
  reconnectPersonalOrganizationAccountContract,
  removeOrganizationAccountMcpProviderContract,
  resendOrganizationAccountInvitationContract,
  revokeOrganizationAccountEnrollmentContract,
  type StartOrganizationAccountConnectionBody,
  startOrganizationAccountConnectionContract,
  type UpdateOrganizationAccountsBody,
  type UpdateOrganizationAccountWorkspaceAccessBody,
  updateOrganizationAccountsContract,
  updateOrganizationAccountWorkspaceAccessContract,
} from '@/lib/api/contracts/organization-accounts'
import { connectCredentialGroupInPopup } from '@/lib/credential-groups/oauth-popup'
import { isDesktopApp } from '@/lib/desktop'
import { connectDesktopSource } from '@/lib/desktop/source-connect'
import { assistantActionKeys } from '@/hooks/queries/assistant-actions'
import { personalCredentialKeys } from '@/hooks/queries/personal-credentials'
import { personalSearchIntegrationKeys } from '@/hooks/queries/personal-search-integrations'
import { knowledgeKeys } from '@/hooks/queries/utils/knowledge-keys'
import { mcpKeys } from '@/hooks/queries/utils/mcp-keys'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
import { searchSourceKeys } from '@/hooks/queries/utils/search-source-keys'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'

function useAccountConnectionMutation<Variables>(
  requestFor: (
    variables: Variables
  ) => Extract<DesktopSourceRequest, { kind: 'organization-account' | 'reconnect-account' }>
) {
  const client = useQueryClient()
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])
  return useMutation({
    mutationKey: organizationAccountsKeys.connection(),
    mutationFn: async (variables: Variables) => {
      if (client.isMutating({ mutationKey: organizationAccountsKeys.connection() }) > 1) {
        throw new Error('Finish or cancel your current account connection before starting another.')
      }
      pending.current?.abort()
      const controller = new AbortController()
      pending.current = controller
      const completionId = generateId()
      const input = requestFor(variables)
      const request =
        input.kind === 'organization-account'
          ? { ...input, body: { ...input.body, oauthCompletionId: completionId } }
          : { ...input, completionId }
      if (isDesktopApp()) {
        await connectDesktopSource(request, controller.signal)
      } else {
        await connectCredentialGroupInPopup(
          completionId,
          (signal) =>
            request.kind === 'organization-account'
              ? requestJson(startOrganizationAccountConnectionContract, {
                  params: { id: request.organizationId },
                  body: request.body,
                  signal,
                })
              : requestJson(reconnectPersonalOrganizationAccountContract, {
                  params: { credentialId: request.credentialId },
                  query: { oauthCompletionId: completionId },
                  signal,
                }),
          controller.signal
        )
      }
    },
    onSettled: () => refreshConnectedAccounts(client),
  })
}

export function useReconnectPersonalOrganizationAccount() {
  return useAccountConnectionMutation((credentialId: string) => ({
    kind: 'reconnect-account',
    credentialId,
  }))
}

/**
 * The accounts the viewer connected for any organization, including ones they
 * have since left — the only place a former member can still see their grants.
 */
export function usePersonalOrganizationAccounts() {
  return useInfiniteQuery({
    queryKey: organizationAccountsKeys.personal(),
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listPersonalOrganizationAccountsContract, {
        query: { cursor: pageParam },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
}

interface DisconnectPersonalOrganizationAccountVariables {
  credentialId: string
  organizationId: string
}

/** Disconnects an owned grant; indexing, source setup, and membership do not gate this operation. */
export function useDisconnectPersonalOrganizationAccount() {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: ({ credentialId }: DisconnectPersonalOrganizationAccountVariables) =>
      requestJson(disconnectPersonalOrganizationAccountContract, {
        params: { credentialId },
      }),
    onSuccess: async (_data, { organizationId }) => {
      await Promise.all([
        resetOrganizationSearchAccess(queryClient, organizationId),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
      ])
      router.refresh()
    },
  })
}

function organizationAccountsQueryOptions(organizationId?: string) {
  return queryOptions({
    queryKey: organizationAccountsKeys.detail(organizationId),
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    queryFn: ({ signal }) => {
      if (!organizationId) throw new Error('Organization is required')
      return requestJson(getOrganizationAccountsContract, {
        params: { id: organizationId },
        signal,
      })
    },
  })
}

export function useOrganizationAccounts(organizationId?: string) {
  return useQuery({
    ...organizationAccountsQueryOptions(organizationId),
    enabled: Boolean(organizationId),
  })
}

export function useEnsureOrganizationAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & EnsureOrganizationAccountsBody) =>
      requestJson(ensureOrganizationAccountsContract, { params: { id: organizationId }, body }),
    onSuccess: (_, { organizationId }) =>
      queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) }),
  })
}

export function useOrganizationDatabricksSetup(organizationId: string, enabled: boolean) {
  return useQuery({
    queryKey: organizationAccountsKeys.databricks(organizationId),
    enabled,
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    queryFn: ({ signal }) =>
      requestJson(getOrganizationDatabricksSetupContract, {
        params: { id: organizationId },
        signal,
      }),
  })
}

export function useConfigureOrganizationMcp() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & ConfigureOrganizationMcpBody) =>
      requestJson(configureOrganizationMcpContract, { params: { id: organizationId }, body }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.workspaces() }),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}

export function useUpdateOrganizationAccounts() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      groupId,
      update,
    }: {
      organizationId: string
      groupId: string
      update: UpdateOrganizationAccountsBody
    }) =>
      requestJson(updateOrganizationAccountsContract, {
        params: { id: organizationId, groupId },
        body: update,
      }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.workspaces() }),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
        queryClient.invalidateQueries({
          queryKey: slackSearchKeys.organizationManifests(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: slackSearchKeys.list(organizationId) }),
      ]),
  })
}

/** Everything a newly connected account changes, including what Search can now reach. */
export async function refreshConnectedAccounts(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: organizationAccountsKeys.all }),
    client.invalidateQueries({ queryKey: assistantActionKeys.permissions() }),
    client.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
    client.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
    client.invalidateQueries({ queryKey: searchSourceKeys.lists() }),
    client.invalidateQueries({ queryKey: knowledgeKeys.searches() }),
    client.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
    invalidateSelectorQueries(client),
  ])
}

export function useConnectOrganizationAccount() {
  return useAccountConnectionMutation(
    ({
      organizationId,
      ...body
    }: { organizationId: string } & StartOrganizationAccountConnectionBody) => ({
      kind: 'organization-account',
      organizationId,
      body,
    })
  )
}

export function useWorkspaceOrganizationAccounts(workspaceId?: string, enabled = true) {
  return useQuery({
    queryKey: organizationAccountsKeys.workspace(workspaceId),
    enabled: Boolean(workspaceId) && enabled,
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    queryFn: ({ signal }) => {
      if (!workspaceId) throw new Error('Workspace is required')
      return requestJson(getWorkspaceOrganizationAccountsContract, {
        params: { id: workspaceId },
        signal,
      })
    },
  })
}
export function useOrganizationAccountWorkspaceAccess(
  organizationId: string,
  options?: { enabled?: boolean }
) {
  return useQuery({
    queryKey: organizationAccountsKeys.access(organizationId),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    queryFn: ({ signal }) =>
      requestJson(getOrganizationAccountWorkspaceAccessContract, {
        params: { id: organizationId },
        signal,
      }),
  })
}
export function useUpdateOrganizationAccountWorkspaceAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & UpdateOrganizationAccountWorkspaceAccessBody) =>
      requestJson(updateOrganizationAccountWorkspaceAccessContract, {
        params: { id: organizationId },
        body,
      }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.access(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.workspaces() }),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}
export function useOrganizationAccountPeople(
  organizationId: string,
  search?: OrganizationAccountPeopleQuery['search'],
  options?: { enabled?: boolean; optionId?: OrganizationAccountPeopleQuery['optionId'] }
) {
  const normalizedSearch = search?.trim() || undefined
  return useInfiniteQuery({
    queryKey: organizationAccountsKeys.peopleList(
      organizationId,
      normalizedSearch,
      options?.optionId
    ),
    enabled: Boolean(organizationId) && (options?.enabled ?? true),
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    retry: (failureCount, error) =>
      !isServer &&
      failureCount < 1 &&
      (!isApiClientError(error) ||
        error.status === 408 ||
        error.status === 429 ||
        error.status >= 500),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listOrganizationAccountPeopleContract, {
        params: { id: organizationId },
        query: {
          limit: 50,
          cursor: pageParam,
          search: normalizedSearch,
          ...(options?.optionId ? { optionId: options.optionId } : {}),
        },
        signal,
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  })
}
export function useInviteOrganizationAccountPeople() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & InviteOrganizationAccountPeopleBody) =>
      requestJson(inviteOrganizationAccountPeopleContract, {
        params: { id: organizationId },
        body,
      }),
    onSuccess: (_, { organizationId }) =>
      queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.people(organizationId) }),
  })
}
export function useResendOrganizationAccountInvitation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      enrollmentId,
      ...query
    }: {
      organizationId: string
      enrollmentId: string
    } & ResendOrganizationAccountInvitationQuery) =>
      requestJson(resendOrganizationAccountInvitationContract, {
        params: { id: organizationId, enrollmentId },
        query,
      }),
    onSuccess: (_, { organizationId }) =>
      queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.people(organizationId) }),
  })
}
export function useRevokeOrganizationAccountEnrollment() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      enrollmentId,
    }: {
      organizationId: string
      enrollmentId: string
    }) =>
      requestJson(revokeOrganizationAccountEnrollmentContract, {
        params: { id: organizationId, enrollmentId },
      }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        resetOrganizationSearchAccess(queryClient, organizationId),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
      ]),
  })
}
export function useAddOrganizationAccountMcpProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & AddOrganizationAccountMcpProviderBody) =>
      requestJson(addOrganizationAccountMcpProviderContract, {
        params: { id: organizationId },
        body,
      }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.workspaces() }),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}
export function useRemoveOrganizationAccountMcpProvider() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      connectorId,
    }: { organizationId: string } & Pick<
      RemoveOrganizationAccountMcpProviderParams,
      'connectorId'
    >) =>
      requestJson(removeOrganizationAccountMcpProviderContract, {
        params: { id: organizationId, connectorId },
      }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.workspaces() }),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
      ]),
  })
}
