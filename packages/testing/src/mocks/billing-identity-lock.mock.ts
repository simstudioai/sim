import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/organizations/billing-identity-lock`.
 *
 * Default: `mockAcquireUserBillingIdentityLock` resolves `undefined` (an instant no-op lock,
 * matching the real `Promise<void>` signature).
 *
 * @example
 * ```ts
 * import { billingIdentityLockMockFns } from '@sim/testing/mocks/billing-identity-lock.mock'
 *
 * expect(billingIdentityLockMockFns.mockAcquireUserBillingIdentityLock).toHaveBeenCalledWith(tx, 'user-1')
 * ```
 */
export const billingIdentityLockMockFns = {
  mockAcquireUserBillingIdentityLock: vi.fn(
    async (_tx: unknown, _userId: string): Promise<void> => undefined
  ),
}

/**
 * Static mock module for `@/lib/billing/organizations/billing-identity-lock`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/organizations/billing-identity-lock', () => billingIdentityLockMock)
 * ```
 */
export const billingIdentityLockMock = {
  acquireUserBillingIdentityLock: billingIdentityLockMockFns.mockAcquireUserBillingIdentityLock,
}
