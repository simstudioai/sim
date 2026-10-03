import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/core/config/trigger-availability`.
 *
 * Default: `mockIsTriggerAvailable` returns `false` (the real result outside a Trigger.dev run
 * with no `TRIGGER_SECRET_KEY`, i.e. background work runs in-process).
 *
 * @example
 * ```ts
 * import { triggerAvailabilityMockFns } from '@sim/testing/mocks/trigger-availability.mock'
 *
 * triggerAvailabilityMockFns.mockIsTriggerAvailable.mockReturnValue(true)
 * ```
 */
export const triggerAvailabilityMockFns = {
  mockIsTriggerAvailable: vi.fn((): boolean => false),
}

/**
 * Static mock module for `@/lib/core/config/trigger-availability`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/config/trigger-availability', () => triggerAvailabilityMock)
 * ```
 */
export const triggerAvailabilityMock = {
  isTriggerAvailable: triggerAvailabilityMockFns.mockIsTriggerAvailable,
}
