import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/payer-organization`.
 *
 * Defaults treat every organization a test names as a team that pays for its own resources;
 * personal organizations are exercised against real PostgreSQL.
 *
 * @example
 * ```ts
 * import { payerOrganizationMockFns } from '@sim/testing/mocks/payer-organization.mock'
 *
 * payerOrganizationMockFns.mockIsTeamOrganization.mockResolvedValueOnce(false)
 * ```
 */
export const payerOrganizationMockFns = {
  mockPayerOrganizationIdSql: vi.fn((organizationId: unknown) => organizationId),
  mockSelectPayerOrganizationIds: vi.fn(
    async (_executor: unknown, organizationIds: Array<string | null>) =>
      new Set(organizationIds.filter((id): id is string => id !== null))
  ),
  mockResolvePayerOrganizationId: vi.fn(
    async (_executor: unknown, organizationId: string | null) => organizationId
  ),
  mockIsTeamOrganization: vi.fn(async (_organizationId: string, _executor?: unknown) => true),
}

/**
 * Static mock module for `@/lib/billing/core/payer-organization`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/payer-organization', () => payerOrganizationMock)
 * ```
 */
export const payerOrganizationMock = {
  payerOrganizationIdSql: payerOrganizationMockFns.mockPayerOrganizationIdSql,
  selectPayerOrganizationIds: payerOrganizationMockFns.mockSelectPayerOrganizationIds,
  resolvePayerOrganizationId: payerOrganizationMockFns.mockResolvePayerOrganizationId,
  isTeamOrganization: payerOrganizationMockFns.mockIsTeamOrganization,
}
