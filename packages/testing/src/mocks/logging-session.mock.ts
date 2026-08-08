import { vi } from 'vitest'

/**
 * Controllable mock functions for the `LoggingSession` class from
 * `@/lib/logs/execution/logging-session`. Every instance method is backed by a
 * shared `vi.fn()` so tests that construct multiple sessions observe identical
 * mock state. `mockSafeStart` defaults to `true` because callers branch on the
 * boolean result. Display projection methods return their input, diagnostic projection
 * fails closed to structural metadata, and other methods resolve to `undefined`.
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
  mockSetTrustedExecutionCorrelation: vi.fn(),
  mockSetExecutionDeadlineAt: vi.fn(),
  mockExportResolvedSecretTraceProvenanceForValue: vi.fn().mockReturnValue({
    version: 1,
    complete: false,
    entries: [],
  }),
  mockProjectBlockLogsForDisplay: vi.fn(async (logs: unknown) => logs),
  mockProjectDisplayContent: vi.fn(async (content: unknown) => content),
  mockProjectLiveDisplayText: vi.fn(async (_field: string, value: string) => ({ value })),
  mockProjectDiagnosticError: vi.fn((error: unknown, _details: Record<string, unknown> = {}) => ({
    errorType: error instanceof Error ? 'error' : error === null ? 'null' : typeof error,
    hasStack: error instanceof Error && typeof error.stack === 'string',
  })),
  mockSafeComplete: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithError: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithCancellation: vi.fn().mockResolvedValue(undefined),
  mockSafeCompleteWithPause: vi.fn().mockResolvedValue(undefined),
  mockMarkAsFailed: vi.fn().mockResolvedValue(undefined),
}

/**
 * Builds the object returned by each `new LoggingSession(...)` call. Declared as
 * a named function (not an arrow) so it stays constructable under vitest 4's
 * `Reflect.construct` path while remaining assignable to `mockImplementation`; a
 * returned object overrides the constructed instance.
 */
function buildLoggingSessionInstance() {
  return {
    start: loggingSessionMockFns.mockStart,
    complete: loggingSessionMockFns.mockComplete,
    completeWithError: loggingSessionMockFns.mockCompleteWithError,
    completeWithCancellation: loggingSessionMockFns.mockCompleteWithCancellation,
    completeWithPause: loggingSessionMockFns.mockCompleteWithPause,
    safeStart: loggingSessionMockFns.mockSafeStart,
    waitForCompletion: loggingSessionMockFns.mockWaitForCompletion,
    waitForPostExecution: loggingSessionMockFns.mockWaitForPostExecution,
    setTrustedExecutionCorrelation: loggingSessionMockFns.mockSetTrustedExecutionCorrelation,
    setExecutionDeadlineAt: loggingSessionMockFns.mockSetExecutionDeadlineAt,
    exportResolvedSecretTraceProvenanceForValue:
      loggingSessionMockFns.mockExportResolvedSecretTraceProvenanceForValue,
    projectBlockLogsForDisplay: loggingSessionMockFns.mockProjectBlockLogsForDisplay,
    projectDisplayContent: loggingSessionMockFns.mockProjectDisplayContent,
    projectLiveDisplayText: loggingSessionMockFns.mockProjectLiveDisplayText,
    projectDiagnosticError: loggingSessionMockFns.mockProjectDiagnosticError,
    safeComplete: loggingSessionMockFns.mockSafeComplete,
    safeCompleteWithError: loggingSessionMockFns.mockSafeCompleteWithError,
    safeCompleteWithCancellation: loggingSessionMockFns.mockSafeCompleteWithCancellation,
    safeCompleteWithPause: loggingSessionMockFns.mockSafeCompleteWithPause,
    markAsFailed: loggingSessionMockFns.mockMarkAsFailed,
  }
}

/**
 * Constructor-shaped mock for `LoggingSession`. Each `new LoggingSession(...)`
 * call returns an object whose methods point at the shared `vi.fn()` refs in
 * `loggingSessionMockFns`.
 */
export const LoggingSessionMock = vi.fn().mockImplementation(buildLoggingSessionInstance)

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
