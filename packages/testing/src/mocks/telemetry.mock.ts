import { type Mock, vi } from 'vitest'

const platformEvents = new Map<string, Mock>()

/**
 * The stable spy the mocked `PlatformEvents[name]` resolves to for the life of the test file,
 * so a test can assert on an emitted platform event without re-mocking the module.
 *
 * @example
 * ```ts
 * expect(getMockPlatformEvent('knowledgeBaseDeleted')).toHaveBeenCalledOnce()
 * ```
 */
export function getMockPlatformEvent(name: string): Mock {
  let fn = platformEvents.get(name)
  if (!fn) {
    fn = vi.fn()
    platformEvents.set(name, fn)
  }
  return fn
}

/**
 * Controllable mock functions for `@/lib/core/telemetry`. All bare `vi.fn()`s; every
 * `PlatformEvents.<name>` is a separate stable spy reached through {@link getMockPlatformEvent}.
 */
export const telemetryMockFns = {
  mockTrackPlatformEvent: vi.fn(),
  mockCreateOTelSpanFromTraceSpan: vi.fn(),
  mockCreateOTelSpansForWorkflowExecution: vi.fn(),
}

/**
 * Pre-configured telemetry mock for use with vi.mock.
 * Every `PlatformEvents` method is a no-op spy, stable per name (see {@link getMockPlatformEvent}),
 * so `expect(getMockPlatformEvent('workflowCreated')).toHaveBeenCalledWith(...)` needs no re-mock.
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
        if (typeof prop === 'string' && prop !== 'then') {
          return getMockPlatformEvent(prop)
        }
        return undefined
      },
    }
  ),
  trackPlatformEvent: telemetryMockFns.mockTrackPlatformEvent,
  createOTelSpanFromTraceSpan: telemetryMockFns.mockCreateOTelSpanFromTraceSpan,
  createOTelSpansForWorkflowExecution: telemetryMockFns.mockCreateOTelSpansForWorkflowExecution,
}
