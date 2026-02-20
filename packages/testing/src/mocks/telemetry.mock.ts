/**
 * Mock for @/lib/core/telemetry module.
 * Provides no-op implementations for telemetry functions and PlatformEvents.
 */
import { vi } from 'vitest'

/**
 * Pre-configured telemetry mock for use with vi.mock.
 * All PlatformEvents methods are no-op vi.fn() stubs.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/telemetry', () => telemetryMock)
 * ```
 */
export const telemetryMock = {
  PlatformEvents: new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (typeof prop === 'string') {
          return vi.fn()
        }
        return undefined
      },
    }
  ),
  createWorkflowSpans: vi.fn(),
  trackPlatformEvent: vi.fn(),
}
