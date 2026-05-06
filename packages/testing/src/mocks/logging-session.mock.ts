import { vi } from 'vitest'

/**
 * Controllable mock functions for the `LoggingSession` class from
 * `@/lib/logs/execution/logging-session`. Every instance method is backed by a
 * shared `vi.fn()` so tests that construct multiple sessions observe identical
 * mock state. `mockSafeStart` defaults to `true` because callers branch on the
 * boolean result. All other methods resolve to `undefined`.
 *
 * @example
 * ```ts
 * import { loggingSessionMockFns } from '@sim/testing'
 *
 * loggingSessionMockFns.mockSafeStart.mockResolvedValueOnce(false)
 * expect(loggingSessionMockFns.mockSafeCompleteWithError).toHaveBeenCalled()
 * ```
 */
export const loggingSessionMockFns = {
  mockStart: vi.fn().mockResolvedValue(undefined),
  mockComplete: vi.fn().mockResolvedValue(undefined),
  mockCompleteWithError: vi.fn().mockResolvedValue(undefined),
  mockCompleteWithCancellation: vi.fn().mockResolvedValue(undefined),
  mockCompleteWithPause: vi.fn().mockResolvedValue(undefined),
  mockSafeStart: vi.fn().mockResolvedValue(true),
  mockWaitForCompletion: vi.fn().mockResolvedValue(undefined),
  mockWaitForPostExecution: vi.fn().mockResolvedValue(undefined),
  mockSafeComplete: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithError: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithCancellation: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithPause: vi.fn().mockResolvedValue(undefined),
  mockMarkAsFailed: vi.fn().mockResolvedValue(undefined),
}

/**
 * Constructor-shaped mock for `LoggingSession`. Each `new LoggingSession(...)`
 * call returns an object whose methods point at the shared `vi.fn()` refs in
 * `loggingSessionMockFns`.
 */
export const LoggingSessionMock = vi.fn().mockImplementation(() => ({
  start: loggingSessionMockFns.mockStart,
  complete: loggingSessionMockFns.mockComplete,
  completeWithError: loggingSessionMockFns.mockCompleteWithError,
  completeWithCancellation: loggingSessionMockFns.mockCompleteWithCancellation,
  completeWithPause: loggingSessionMockFns.mockCompleteWithPause,
  safeStart: loggingSessionMockFns.mockSafeStart,
  waitForCompletion: loggingSessionMockFns.mockWaitForCompletion,
  waitForPostExecution: loggingSessionMockFns.mockWaitForPostExecution,
  safeComplete: loggingSessionMockFns.mockSafeComplete,
  safeCompleteWithError: loggingSessionMockFns.mockSafeCompleteWithError,
  safeCompleteWithCancellation: loggingSessionMockFns.mockSafeCompleteWithCancellation,
  safeCompleteWithPause: loggingSessionMockFns.mockSafeCompleteWithPause,
  markAsFailed: loggingSessionMockFns.mockMarkAsFailed,
}))

/**
 * Static mock module for `@/lib/logs/execution/logging-session`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/logs/execution/logging-session', () => loggingSessionMock)
 * ```
 */
export const loggingSessionMock = {
  LoggingSession: LoggingSessionMock,
}
