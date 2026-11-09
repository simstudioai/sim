'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import type {
  ContractBodyInput,
  ContractParamsInput,
  ContractQueryInput,
} from '@/lib/api/contracts'
import {
  addOrganizationAccountMcpProviderContract,
  configureOrganizationMcpContract,
  getOrganizationDatabricksSetupContract,
  inviteOrganizationAccountPeopleContract,
  removeOrganizationAccountMcpProviderContract,
  resendOrganizationAccountInvitationContract,
  revokeOrganizationAccountEnrollmentContract,
  updateOrganizationAccountWorkspaceAccessContract,
} from '@/lib/api/contracts/organization-accounts'
import { personalCredentialKeys } from '@/hooks/queries/personal-credentials'
import { mcpKeys } from '@/hooks/queries/utils/mcp-keys'
import {
  ORGANIZATION_ACCOUNTS_STALE_TIME,
  organizationAccountsKeys,
} from '@/hooks/queries/utils/organization-accounts-keys'
import { resetOrganizationSearchAccess } from '@/hooks/queries/utils/reset-organization-search-access'
import { invalidateSelectorQueries } from '@/hooks/queries/utils/selector-keys'

/**
 * An organization's credential-group administration: its managed MCP connectors, Databricks
 * configuration, workspace access and the people asked to connect accounts.
 */

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
    }: { organizationId: string } & ContractBodyInput<typeof configureOrganizationMcpContract>) =>
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

export function useUpdateOrganizationAccountWorkspaceAccess() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & ContractBodyInput<
      typeof updateOrganizationAccountWorkspaceAccessContract
    >) =>
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

export function useInviteOrganizationAccountPeople() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({
      organizationId,
      ...body
    }: { organizationId: string } & ContractBodyInput<
      typeof inviteOrganizationAccountPeopleContract
    >) =>
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
    } & ContractQueryInput<typeof resendOrganizationAccountInvitationContract>) =>
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
    }: { organizationId: string } & ContractBodyInput<
      typeof addOrganizationAccountMcpProviderContract
    >) =>
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
      ContractParamsInput<typeof removeOrganizationAccountMcpProviderContract>,
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
