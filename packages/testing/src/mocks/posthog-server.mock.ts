import { vi } from 'vitest'

/**
 * Static mock module for `@/lib/posthog/server`. Every export is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/posthog/server', () => posthogServerMock)
 * ```
 */
export const posthogServerMock = {
  captureServerEvent: vi.fn(),
  getPostHogClient: vi.fn(() => null),
}
