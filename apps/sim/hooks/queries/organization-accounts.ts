'use client'

import { useEffect, useRef } from 'react'
import { generateId } from '@sim/utils/id'
import {
  type QueryClient,
  queryOptions,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { requestJson } from '@/lib/api/client/request'
import type { ContractBodyInput } from '@/lib/api/contracts'
import type { UpdateCredentialGroupBody } from '@/lib/api/contracts/credential-groups'
import type { DesktopSourceRequest } from '@/lib/api/contracts/desktop-source-connect'
import {
  disconnectPersonalOrganizationAccountContract,
  ensureOrganizationAccountsContract,
  getOrganizationAccountsContract,
  getWorkspaceOrganizationAccountsContract,
  listPersonalOrganizationAccountsContract,
  reconnectPersonalOrganizationAccountContract,
  type StartOrganizationAccountConnectionBody,
  startOrganizationAccountConnectionContract,
  updateOrganizationAccountsContract,
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
import { organizationHomeKeys } from '@/hooks/queries/utils/organization-home-keys'
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
        return true
      }
      return connectCredentialGroupInPopup(
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
        invalidateOrganizationAccounts(queryClient, organizationId),
        queryClient.invalidateQueries({
          queryKey: organizationHomeKeys.organization(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: personalSearchIntegrationKeys.lists() }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
      ])
      router.refresh()
    },
  })
}

export function organizationAccountsQueryOptions(organizationId?: string) {
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
    }: { organizationId: string } & ContractBodyInput<typeof ensureOrganizationAccountsContract>) =>
      requestJson(ensureOrganizationAccountsContract, { params: { id: organizationId }, body }),
    onSuccess: (_, { organizationId }) =>
      queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) }),
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
      update: UpdateCredentialGroupBody
    }) =>
      requestJson(updateOrganizationAccountsContract, {
        params: { id: organizationId, groupId },
        body: update,
      }),
    onSuccess: (_, { organizationId }) =>
      Promise.all([
        invalidateOrganizationAccounts(queryClient, organizationId),
        queryClient.invalidateQueries({
          queryKey: slackSearchKeys.organizationManifests(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: slackSearchKeys.list(organizationId) }),
      ]),
  })
}

/**
 * Everything an organization's account configuration feeds: its accounts, their workspace access,
 * people and setup, the viewer's personal credentials, the managed MCP catalog and the credential
 * selectors. Every mutation of that configuration invalidates this one list.
 */
export function invalidateOrganizationAccounts(queryClient: QueryClient, organizationId: string) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.detail(organizationId) }),
    queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.workspaces() }),
    queryClient.invalidateQueries({ queryKey: personalCredentialKeys.lists() }),
    queryClient.invalidateQueries({ queryKey: mcpKeys.managedCatalog() }),
    invalidateSelectorQueries(queryClient),
  ])
}

/** Everything a newly connected account changes, including what Search and Home can now reach. */
export async function refreshConnectedAccounts(client: ReturnType<typeof useQueryClient>) {
  await Promise.all([
    client.invalidateQueries({ queryKey: organizationAccountsKeys.all }),
    client.invalidateQueries({ queryKey: organizationHomeKeys.all }),
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
