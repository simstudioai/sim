import { vi } from 'vitest'
import { createMutationResultMock, createQueryResultMock } from './react-query.mock'

const organizationAccountsKeys = {
  all: ['organization-accounts'] as const,
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

const queryHook = () => vi.fn((..._args: unknown[]): unknown => createQueryResultMock())
const mutationHook = () => vi.fn((..._args: unknown[]): unknown => createMutationResultMock())

/**
 * Controllable mock functions for `@/hooks/queries/organization-accounts`.
 *
 * Query hooks (`useOrganizationAccounts`, `useOrganizationDatabricksSetup`,
 * `useWorkspaceOrganizationAccounts`, `useOrganizationAccountWorkspaceAccess`,
 * `useOrganizationAccountPeople`) return a fresh {@link createQueryResultMock} (not-yet-fetched:
 * `data: undefined`, `isPending: true`). Every mutation hook returns a fresh
 * {@link createMutationResultMock} (`idle`, no-op `mutate`/`reset`, `mutateAsync` resolves
 * `undefined`). Results are fresh per call, so to assert on `mutate` give the hook a stable
 * return: `mockUseUpdateOrganizationAccounts.mockReturnValue({ mutate, isPending: false })`.
 *
 * @example
 * ```ts
 * import { organizationAccountsQueriesMockFns } from '@sim/testing/mocks/organization-accounts-queries.mock'
 *
 * organizationAccountsQueriesMockFns.mockUseOrganizationAccounts.mockReturnValue({ data: inventory, isPending: false })
 * ```
 */
export const organizationAccountsQueriesMockFns = {
  mockUseReconnectPersonalOrganizationAccount: mutationHook(),
  mockUseDisconnectPersonalOrganizationAccount: mutationHook(),
  mockUseOrganizationAccounts: queryHook(),
  mockUseEnsureOrganizationAccounts: mutationHook(),
  mockUseOrganizationDatabricksSetup: queryHook(),
  mockUseConfigureOrganizationMcp: mutationHook(),
  mockUseUpdateOrganizationAccounts: mutationHook(),
  mockUseConnectOrganizationAccount: mutationHook(),
  mockUseWorkspaceOrganizationAccounts: queryHook(),
  mockUseOrganizationAccountWorkspaceAccess: queryHook(),
  mockUseUpdateOrganizationAccountWorkspaceAccess: mutationHook(),
  mockUseOrganizationAccountPeople: queryHook(),
  mockUseInviteOrganizationAccountPeople: mutationHook(),
  mockUseResendOrganizationAccountInvitation: mutationHook(),
  mockUseRevokeOrganizationAccountEnrollment: mutationHook(),
  mockUseAddOrganizationAccountMcpProvider: mutationHook(),
  mockUseRemoveOrganizationAccountMcpProvider: mutationHook(),
}

/**
 * Static mock module for `@/hooks/queries/organization-accounts`. Covers every runtime export;
 * `ORGANIZATION_ACCOUNTS_STALE_TIME` and the `organizationAccountsKeys` factory are the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
 * ```
 */
export const organizationAccountsQueriesMock = {
  ORGANIZATION_ACCOUNTS_STALE_TIME: 30_000,
  organizationAccountsKeys,
  useReconnectPersonalOrganizationAccount:
    organizationAccountsQueriesMockFns.mockUseReconnectPersonalOrganizationAccount,
  useDisconnectPersonalOrganizationAccount:
    organizationAccountsQueriesMockFns.mockUseDisconnectPersonalOrganizationAccount,
  useOrganizationAccounts: organizationAccountsQueriesMockFns.mockUseOrganizationAccounts,
  useEnsureOrganizationAccounts:
    organizationAccountsQueriesMockFns.mockUseEnsureOrganizationAccounts,
  useOrganizationDatabricksSetup:
    organizationAccountsQueriesMockFns.mockUseOrganizationDatabricksSetup,
  useConfigureOrganizationMcp: organizationAccountsQueriesMockFns.mockUseConfigureOrganizationMcp,
  useUpdateOrganizationAccounts:
    organizationAccountsQueriesMockFns.mockUseUpdateOrganizationAccounts,
  useConnectOrganizationAccount:
    organizationAccountsQueriesMockFns.mockUseConnectOrganizationAccount,
  useWorkspaceOrganizationAccounts:
    organizationAccountsQueriesMockFns.mockUseWorkspaceOrganizationAccounts,
  useOrganizationAccountWorkspaceAccess:
    organizationAccountsQueriesMockFns.mockUseOrganizationAccountWorkspaceAccess,
  useUpdateOrganizationAccountWorkspaceAccess:
    organizationAccountsQueriesMockFns.mockUseUpdateOrganizationAccountWorkspaceAccess,
  useOrganizationAccountPeople: organizationAccountsQueriesMockFns.mockUseOrganizationAccountPeople,
  useInviteOrganizationAccountPeople:
    organizationAccountsQueriesMockFns.mockUseInviteOrganizationAccountPeople,
  useResendOrganizationAccountInvitation:
    organizationAccountsQueriesMockFns.mockUseResendOrganizationAccountInvitation,
  useRevokeOrganizationAccountEnrollment:
    organizationAccountsQueriesMockFns.mockUseRevokeOrganizationAccountEnrollment,
  useAddOrganizationAccountMcpProvider:
    organizationAccountsQueriesMockFns.mockUseAddOrganizationAccountMcpProvider,
  useRemoveOrganizationAccountMcpProvider:
    organizationAccountsQueriesMockFns.mockUseRemoveOrganizationAccountMcpProvider,
}
