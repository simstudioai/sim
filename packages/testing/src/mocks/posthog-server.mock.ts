import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/lib/posthog/server`.
 * Defaults: `captureServerEvent` is a no-op, `getPostHogClient` returns `null`.
 *
 * @example
 * ```ts
 * import { posthogServerMockFns } from '@sim/testing/mocks/posthog-server.mock'
 *
 * expect(posthogServerMockFns.mockCaptureServerEvent).toHaveBeenCalledWith(
 *   'user-1',
 *   'workspace_created',
 *   expect.any(Object)
 * )
 * ```
 */
export const posthogServerMockFns = {
  mockCaptureServerEvent: vi.fn(),
  mockGetPostHogClient: vi.fn((): null => null),
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
