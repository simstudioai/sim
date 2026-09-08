'use client'

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
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
  type RemoveOrganizationAccountMcpProviderParams,
  reconnectPersonalOrganizationAccountContract,
  removeOrganizationAccountMcpProviderContract,
  resendOrganizationAccountInvitationContract,
  revokeOrganizationAccountEnrollmentContract,
  startOrganizationAccountConnectionContract,
  type UpdateOrganizationAccountsBody,
  type UpdateOrganizationAccountWorkspaceAccessBody,
  updateOrganizationAccountsContract,
  updateOrganizationAccountWorkspaceAccessContract,
} from '@/lib/api/contracts/organization-accounts'

export const ORGANIZATION_ACCOUNTS_STALE_TIME = 30_000

export const organizationAccountsKeys = {
  all: ['organization-accounts'] as const,
  personal: () => [...organizationAccountsKeys.all, 'personal'] as const,
  workspaces: () => [...organizationAccountsKeys.all, 'workspace'] as const,
  workspace: (workspaceId?: string) =>
    [...organizationAccountsKeys.workspaces(), workspaceId ?? ''] as const,
  access: (id?: string) => [...organizationAccountsKeys.detail(id), 'access'] as const,
  people: (id?: string) => [...organizationAccountsKeys.detail(id), 'people'] as const,
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
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
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
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
      ]),
  })
}

export function useConnectOrganizationAccount() {
  return useMutation({
    mutationFn: ({ organizationId, optionId }: { organizationId: string; optionId: string }) =>
      requestJson(startOrganizationAccountConnectionContract, {
        params: { id: organizationId },
        body: { optionId },
      }),
  })
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
export function useOrganizationAccountWorkspaceAccess(organizationId: string) {
  return useQuery({
    queryKey: organizationAccountsKeys.access(organizationId),
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
      ]),
  })
}
export function useOrganizationAccountPeople(organizationId: string) {
  return useInfiniteQuery({
    queryKey: organizationAccountsKeys.people(organizationId),
    staleTime: ORGANIZATION_ACCOUNTS_STALE_TIME,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ signal, pageParam }) =>
      requestJson(listOrganizationAccountPeopleContract, {
        params: { id: organizationId },
        query: { limit: 50, cursor: pageParam },
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
    }: {
      organizationId: string
      enrollmentId: string
    }) =>
      requestJson(resendOrganizationAccountInvitationContract, {
        params: { id: organizationId, enrollmentId },
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
        queryClient.invalidateQueries({
          queryKey: organizationAccountsKeys.people(organizationId),
        }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
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
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
      ]),
  })
}

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
export function useReconnectPersonalOrganizationAccount() {
  return useMutation({
    mutationFn: (credentialId: string) =>
      requestJson(reconnectPersonalOrganizationAccountContract, { params: { credentialId } }),
  })
}
export function useDisconnectPersonalOrganizationAccount() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (credentialId: string) =>
      requestJson(disconnectPersonalOrganizationAccountContract, { params: { credentialId } }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.personal() }),
        queryClient.invalidateQueries({ queryKey: organizationAccountsKeys.details() }),
      ]),
  })
}
