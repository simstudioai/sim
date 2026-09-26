import { vi } from 'vitest'

/**
 * Stand-in for `UsageReservationUnavailableError` with the real `name`, constructor args, and
 * the `ADMISSION_ERROR_DESCRIPTOR.RESERVATION_INFRASTRUCTURE` fields (`code`
 * `'SERVICE_OVERLOADED'`, `statusCode` 503, `retryable` `true`, `retryAfterSeconds` 5).
 * `instanceof` checks against the mocked export match it.
 */
export class MockUsageReservationUnavailableError extends Error {
  readonly code = 'SERVICE_OVERLOADED'
  readonly statusCode = 503
  readonly retryable = true
  readonly retryAfterSeconds = 5

  constructor(message: string, cause?: unknown) {
    super(message)
    this.name = 'UsageReservationUnavailableError'
    this.cause = cause
  }
}

const MAX_IDENTIFIER_LENGTH = 128

/** Faithful port of the real `resolveBillingEntityKey`, including identifier validation. */
function resolveBillingEntityKey(billingEntity: { type: string; id: string }): string {
  const id = billingEntity.id
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    new TextEncoder().encode(id).length > MAX_IDENTIFIER_LENGTH ||
    !/^[A-Za-z0-9._:-]+$/.test(id)
  ) {
    throw new MockUsageReservationUnavailableError('Invalid billing entity for usage reservation')
  }
  return `${billingEntity.type === 'organization' ? 'org' : 'user'}:${id}`
}

/**
 * Controllable mock functions for `@/lib/billing/calculations/usage-reservation`.
 *
 * `reserveExecutionSlot` and `refreshExecutionSlotExpiry` are bare `vi.fn()` (resolve
 * `undefined`); set `mockResolvedValue({ reserved: true, created: true })` for an admitted
 * path. `releaseExecutionSlot` is bare too (the real one resolves `void`).
 * `resolveBillingEntityKey` defaults to the real pure logic (`org:<id>` / `user:<id>`).
 *
 * @example
 * ```ts
 * import { billingUsageReservationMockFns } from '@sim/testing/mocks/billing-usage-reservation.mock'
 *
 * billingUsageReservationMockFns.mockReserveExecutionSlot.mockResolvedValue({ reserved: false, reason: 'payer_concurrency' })
 * ```
 */
export const billingUsageReservationMockFns = {
  mockResolveBillingEntityKey: vi.fn(resolveBillingEntityKey),
  mockReserveExecutionSlot: vi.fn(),
  mockRefreshExecutionSlotExpiry: vi.fn(),
  mockReleaseExecutionSlot: vi.fn(),
}

/**
 * Static mock module for `@/lib/billing/calculations/usage-reservation`.
 * `UsageReservationUnavailableError` is {@link MockUsageReservationUnavailableError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/billing/calculations/usage-reservation', () => billingUsageReservationMock)
 * ```
 */
export const billingUsageReservationMock = {
  UsageReservationUnavailableError: MockUsageReservationUnavailableError,
  resolveBillingEntityKey: billingUsageReservationMockFns.mockResolveBillingEntityKey,
  reserveExecutionSlot: billingUsageReservationMockFns.mockReserveExecutionSlot,
  refreshExecutionSlotExpiry: billingUsageReservationMockFns.mockRefreshExecutionSlotExpiry,
  releaseExecutionSlot: billingUsageReservationMockFns.mockReleaseExecutionSlot,
}
