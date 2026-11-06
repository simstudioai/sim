import { vi } from 'vitest'
import { createMutationResultMock, createQueryResultMock } from './react-query.mock'

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
 * Static mock module for `@/hooks/queries/organization-accounts`. Covers every runtime hook; its keys
 * and stale time live in `@/hooks/queries/utils/organization-accounts-keys`, which stays real.
 *
 * @example
 * ```ts
 * vi.mock('@/hooks/queries/organization-accounts', () => organizationAccountsQueriesMock)
 * ```
 */
export const organizationAccountsQueriesMock = {
  refreshConnectedAccounts: vi.fn(async () => undefined),
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
