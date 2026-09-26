import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/knowledge/search/integration-policy`. All are bare
 * `vi.fn()`s.
 *
 * @example
 * ```ts
 * import { knowledgeSearchIntegrationPolicyMockFns } from '@sim/testing/mocks/knowledge-search-integration-policy.mock'
 *
 * knowledgeSearchIntegrationPolicyMockFns.mockListOrganizationSearchApprovals.mockResolvedValue(new Map())
 * ```
 */
export const knowledgeSearchIntegrationPolicyMockFns = {
  mockListOrganizationSearchApprovals: vi.fn(),
  mockRequireOrganizationSearchApproval: vi.fn(),
  mockSearchIntegrationAccessCondition: vi.fn(),
}

/**
 * Static mock module for `@/lib/knowledge/search/integration-policy`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/knowledge/search/integration-policy', () => knowledgeSearchIntegrationPolicyMock)
 * ```
 */
export const knowledgeSearchIntegrationPolicyMock = {
  listOrganizationSearchApprovals:
    knowledgeSearchIntegrationPolicyMockFns.mockListOrganizationSearchApprovals,
  requireOrganizationSearchApproval:
    knowledgeSearchIntegrationPolicyMockFns.mockRequireOrganizationSearchApproval,
  searchIntegrationAccessCondition:
    knowledgeSearchIntegrationPolicyMockFns.mockSearchIntegrationAccessCondition,
}
