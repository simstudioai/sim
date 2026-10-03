import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/core/workspace-access`.
 *
 * `getWorkspaceOwnerSubscriptionAccess` is a bare `vi.fn()` (resolves `undefined`); set the
 * owner access snapshot a test needs per case.
 *
 * @example
 * ```ts
 * import { billingWorkspaceAccessMockFns } from '@sim/testing/mocks/billing-workspace-access.mock'
 *
 * billingWorkspaceAccessMockFns.mockGetWorkspaceOwnerSubscriptionAccess.mockResolvedValue({})
 * ```
 */
export const billingWorkspaceAccessMockFns = {
  mockGetWorkspaceOwnerSubscriptionAccess: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/core/workspace-access`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/core/workspace-access', () => billingWorkspaceAccessMock)
 * ```
 */
export const billingWorkspaceAccessMock = {
  getWorkspaceOwnerSubscriptionAccess:
    billingWorkspaceAccessMockFns.mockGetWorkspaceOwnerSubscriptionAccess,
}
