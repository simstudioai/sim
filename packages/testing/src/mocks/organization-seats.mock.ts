import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/billing/organizations/seats`.
 *
 * `mockReconcileOrganizationSeats` is a bare `vi.fn()` (returns `undefined`); set a
 * `{ changed, seats, previousSeats? }` result per test when the caller reads it.
 *
 * @example
 * ```ts
 * import { organizationSeatsMockFns } from '@sim/testing/mocks/organization-seats.mock'
 *
 * organizationSeatsMockFns.mockReconcileOrganizationSeats.mockResolvedValue({ changed: true, seats: 2 })
 * ```
 */
export const organizationSeatsMockFns = {
  mockReconcileOrganizationSeats: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/organizations/seats`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/organizations/seats', () => organizationSeatsMock)
 * ```
 */
export const organizationSeatsMock = {
  reconcileOrganizationSeats: organizationSeatsMockFns.mockReconcileOrganizationSeats,
}
