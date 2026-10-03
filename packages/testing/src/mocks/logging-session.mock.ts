import { vi } from 'vitest'

/**
 * Controllable mock functions for the `LoggingSession` class from
 * `@/lib/logs/execution/logging-session`. Every instance method is backed by a
 * shared `vi.fn()` so tests that construct multiple sessions observe identical
 * mock state. `mockSafeStart` defaults to `true` because callers branch on the
 * boolean result. Display projection methods (incl. `projectTraceSpansForLiveDisplay`) return
 * their input, diagnostic projection fails closed to structural metadata, `hasCompleted` is
 * `false`, `getPersistedCompletionStatus` is `null`, and other methods resolve to `undefined`.
 * Defaults are `vi.fn(impl)`, so `mockReset()` restores them.
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
  mockStart: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockComplete: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockCompleteWithError: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockCompleteWithCancellation: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockCompleteWithPause: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockSafeStart: vi.fn(async (..._args: unknown[]): Promise<boolean> => true),
  mockWaitForCompletion: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockWaitForPostExecution: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockSetTrustedExecutionCorrelation: vi.fn(),
  mockSetExecutionDeadlineAt: vi.fn(),
  mockExportResolvedSecretTraceProvenanceForValue: vi.fn((_value: unknown) => ({
    version: 1,
    complete: false,
    entries: [] as unknown[],
  })),
  mockSetResolvedSecretTraceRegistry: vi.fn(),
  mockSetTraceLargeValueAccess: vi.fn(),
  mockSetPostExecutionPromise: vi.fn(),
  mockOnBlockStart: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockOnBlockComplete: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockHasCompleted: vi.fn((): boolean => false),
  mockGetPersistedCompletionStatus: vi.fn((): string | null => null),
  mockProjectTraceSpansForLiveDisplay: vi.fn(async (traceSpans: unknown) => traceSpans),
  mockMarkExecutionAsFailed: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockProjectBlockLogsForDisplay: vi.fn(async (logs: unknown) => logs),
  mockProjectDisplayContent: vi.fn(async (content: unknown) => content),
  mockProjectLiveDisplayText: vi.fn(async (_field: string, value: string) => ({ value })),
  mockProjectDiagnosticError: vi.fn((error: unknown, _details: Record<string, unknown> = {}) => ({
    errorType: error instanceof Error ? 'error' : error === null ? 'null' : typeof error,
    hasStack: error instanceof Error && typeof error.stack === 'string',
  })),
  mockSafeComplete: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockSafeCompleteWithError: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockSafeCompleteWithCancellation: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockSafeCompleteWithPause: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
  mockMarkAsFailed: vi.fn(async (..._args: unknown[]): Promise<void> => {}),
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
    setResolvedSecretTraceRegistry: loggingSessionMockFns.mockSetResolvedSecretTraceRegistry,
    setTraceLargeValueAccess: loggingSessionMockFns.mockSetTraceLargeValueAccess,
    setPostExecutionPromise: loggingSessionMockFns.mockSetPostExecutionPromise,
    onBlockStart: loggingSessionMockFns.mockOnBlockStart,
    onBlockComplete: loggingSessionMockFns.mockOnBlockComplete,
    hasCompleted: loggingSessionMockFns.mockHasCompleted,
    getPersistedCompletionStatus: loggingSessionMockFns.mockGetPersistedCompletionStatus,
    projectTraceSpansForLiveDisplay: loggingSessionMockFns.mockProjectTraceSpansForLiveDisplay,
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
 * `loggingSessionMockFns`; `LoggingSessionMock.mock.calls` records the constructor
 * arguments (`[workflowId, executionId, triggerType, requestId]`). The static
 * `LoggingSession.markExecutionAsFailed` is `loggingSessionMockFns.mockMarkExecutionAsFailed`.
 */
export const LoggingSessionMock = Object.assign(vi.fn(buildLoggingSessionInstance), {
  markExecutionAsFailed: loggingSessionMockFns.mockMarkExecutionAsFailed,
})

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
