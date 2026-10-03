'use client'

import { useEffect, useRef } from 'react'
import { generateId } from '@sim/utils/id'
import {
  isServer,
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
import { personalCredentialKeys } from '@/hooks/queries/personal-credentials'
import { mcpKeys } from '@/hooks/queries/utils/mcp-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'
import { slackSearchKeys } from '@/hooks/queries/utils/slack-search-keys'

export const ORGANIZATION_ACCOUNTS_STALE_TIME = 30_000

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
    onSettled: () => refreshAccounts(client),
  })
}

export function useReconnectPersonalOrganizationAccount() {
  return useAccountConnectionMutation((credentialId: string) => ({
    kind: 'reconnect-account',
    credentialId,
  }))
}

/** Disconnects an owned grant; indexing and source setup do not gate this operation. */
export function useDisconnectPersonalOrganizationAccount(organizationId: string) {
  const queryClient = useQueryClient()
  const router = useRouter()
  return useMutation({
    mutationFn: (credentialId: string) =>
      requestJson(disconnectPersonalOrganizationAccountContract, {
        params: { credentialId },
      }),
    onSuccess: async () => {
      await Promise.all([
        resetOrganizationSearchAccess(queryClient, organizationId),
        queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
        invalidateSelectorQueries(queryClient),
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.detail(organizationId),
        }),
      ])
      router.refresh()
    },
  })
}

export const organizationAccountsKeys = {
  all: ['organization-accounts'] as const,
  connection: () => [...organizationAccountsKeys.all, 'connection'] as const,
  workspaces: () => [...organizationAccountsKeys.all, 'workspace'] as const,
  workspace: (workspaceId?: string) =>
    [...organizationAccountsKeys.workspaces(), workspaceId ?? ''] as const,
  access: (id?: string) => [...organizationAccountsKeys.detail(id), 'access'] as const,
  people: (id?: string) => [...organizationAccountsKeys.detail(id), 'people'] as const,
  peopleList: (id: string, search?: string, optionId?: string) =>
    [
      ...organizationAccountsKeys.people(id),
      { search: search ?? '', optionId: optionId ?? '' },
    ] as const,
  databricks: (id?: string) => [...organizationAccountsKeys.detail(id), 'databricks'] as const,
  details: () => [...organizationAccountsKeys.all, 'detail'] as const,
  detail: (organizationId?: string) =>
    [...organizationAccountsKeys.details(), organizationId ?? ''] as const,
}

export function useOrganizationAccounts(organizationId?: string) {
  return useQuery({
    queryKey: organizationAccountsKeys.detail(organizationId),
    enabled: Boolean(organizationId),
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
      ]),
  })
}

async function refreshAccounts(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: organizationAccountsKeys.all }),
    client.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
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
