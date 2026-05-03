import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/posthog/server`.
 * All defaults are bare `vi.fn()` — configure per-test as needed.
 *
 * @example
 * ```ts
 * import { posthogServerMockFns } from '@sim/testing'
 *
 * expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(...)
 * ```
 */
export const posthogServerMockFns = {
  mockCaptureServerEvent: vi.fn(),
  mockGetPostHogClient: vi.fn(() => null),
}

/**
 * Static mock module for `@/lib/posthog/server`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/posthog/server', () => posthogServerMock)
 * ```
 */
export const posthogServerMock = {
  captureServerEvent: posthogServerMockFns.mockCaptureServerEvent,
  getPostHogClient: posthogServerMockFns.mockGetPostHogClient,
}
