import { vi } from 'vitest'

/**
 * Mirrors `ExecutionTimeoutError` from `@/lib/core/execution-limits`: same constructor and
 * `name = 'TimeoutError'`, so the default `isTimeoutError` guard matches it. Exposed on
 * {@link executionLimitsMock} under the real export name.
 */
export class MockExecutionTimeoutError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TimeoutError'
  }
}

const MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS = 7 * 24 * 60 * 60
const RESERVATION_TTL_BUFFER_MS = 5 * 60_000
const MAX_EXECUTION_TIMEOUT_MS = MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS * 1000

const signalDeadlines = new WeakMap<AbortSignal, number>()

function parseTimeoutSeconds(value: unknown): number | null {
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_WORKFLOW_EXECUTION_TIMEOUT_SECONDS
  ) {
    return null
  }
  return parsed
}

function isTimeoutAbortReason(reason: unknown): boolean {
  if (reason === 'timeout') return true
  return (
    reason instanceof DOMException && reason.name === 'AbortError' && reason.message === 'timeout'
  )
}

/** Shape of `TimeoutAbortController` from `@/lib/core/execution-limits`. */
export interface MockTimeoutAbortController {
  signal: AbortSignal
  isTimedOut: () => boolean
  cleanup: () => void
  abort: () => void
  timeoutMs: number | undefined
}

function createTimeoutAbortController(
  timeoutMs?: number,
  parentSignal?: AbortSignal
): MockTimeoutAbortController {
  const abortController = new AbortController()
  let isTimedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const abortFromParent = () => {
    if (isTimeoutAbortReason(parentSignal?.reason)) isTimedOut = true
    abortController.abort(parentSignal?.reason ?? new DOMException('user', 'AbortError'))
  }

  if (timeoutMs) {
    signalDeadlines.set(abortController.signal, Date.now() + timeoutMs)
    timeoutId = setTimeout(() => {
      isTimedOut = true
      abortController.abort(new DOMException('timeout', 'AbortError'))
    }, timeoutMs)
  }

  if (parentSignal) {
    const parentDeadline = signalDeadlines.get(parentSignal)
    const ownDeadline = signalDeadlines.get(abortController.signal)
    if (
      parentDeadline !== undefined &&
      (ownDeadline === undefined || parentDeadline < ownDeadline)
    ) {
      signalDeadlines.set(abortController.signal, parentDeadline)
    }
    if (parentSignal.aborted) abortFromParent()
    else parentSignal.addEventListener('abort', abortFromParent, { once: true })
  }

  return {
    signal: abortController.signal,
    isTimedOut: () => isTimedOut,
    cleanup: () => {
      if (timeoutId) clearTimeout(timeoutId)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
    abort: () => abortController.abort(new DOMException('user', 'AbortError')),
    timeoutMs,
  }
}

/**
 * Controllable mock functions for `@/lib/core/execution-limits`.
 *
 * Plan/billing-dependent readers default to the real result under the default mocks (billing off,
 * no `EXECUTION_TIMEOUT_*` env): `mockGetExecutionTimeout` and
 * `mockGetAsyncExecutionTimeoutForBillingAttribution` return `0` (untimed).
 *
 * Every other function is a faithful port of the real pure logic:
 * `mockGetMaxExecutionTimeout` (7 days in ms), `mockGetExecutionReservationTtlMs` (max + 5 min),
 * `mockResolveAsyncExecutionTimeout`, `mockCapExecutionTimeoutMs`,
 * `mockToTriggerMaxDurationSeconds`, `mockIsTimeoutError`, `mockGetTimeoutErrorMessage`,
 * `mockIsTimeoutAbortReason`, and the signal-deadline family (`mockCreateTimeoutAbortController`,
 * `mockGetExecutionDeadlineAt`, `mockCombineExecutionAbortSignals`, `mockGetRemainingExecutionMs`),
 * which share one deadline registry like production.
 *
 * @example
 * ```ts
 * import { executionLimitsMockFns } from '@sim/testing/mocks/execution-limits.mock'
 *
 * executionLimitsMockFns.mockGetMaxExecutionTimeout.mockReturnValue(30_000)
 * ```
 */
export const executionLimitsMockFns = {
  mockGetExecutionTimeout: vi.fn(
    (_plan?: string, _type?: 'sync' | 'async', _enterpriseSeconds?: number): number => 0
  ),
  mockGetAsyncExecutionTimeoutForBillingAttribution: vi.fn((_billingAttribution: unknown) => 0),
  mockGetMaxExecutionTimeout: vi.fn((): number => MAX_EXECUTION_TIMEOUT_MS),
  mockResolveAsyncExecutionTimeout: vi.fn(
    (policyTimeoutMs: number, requestedTimeoutSeconds?: number): number => {
      const requested = parseTimeoutSeconds(requestedTimeoutSeconds)
      if (requested === null) return policyTimeoutMs
      const requestedTimeoutMs = requested * 1000
      return policyTimeoutMs > 0
        ? Math.min(policyTimeoutMs, requestedTimeoutMs)
        : requestedTimeoutMs
    }
  ),
  mockCapExecutionTimeoutMs: vi.fn((policyTimeoutMs: number, requestedTimeoutMs?: number) => {
    if (
      requestedTimeoutMs === undefined ||
      !Number.isFinite(requestedTimeoutMs) ||
      requestedTimeoutMs <= 0
    ) {
      return policyTimeoutMs
    }
    return policyTimeoutMs > 0 ? Math.min(policyTimeoutMs, requestedTimeoutMs) : requestedTimeoutMs
  }),
  mockToTriggerMaxDurationSeconds: vi.fn((timeoutMs?: number): number | undefined => {
    if (!timeoutMs || timeoutMs <= 0) return undefined
    return Math.max(5, Math.ceil((timeoutMs + RESERVATION_TTL_BUFFER_MS) / 1000))
  }),
  mockGetExecutionReservationTtlMs: vi.fn(
    (): number => MAX_EXECUTION_TIMEOUT_MS + RESERVATION_TTL_BUFFER_MS
  ),
  mockIsTimeoutError: vi.fn((error: unknown): boolean => {
    if (!error) return false
    if (error instanceof Error) return error.name === 'TimeoutError'
    if (typeof error === 'object' && 'name' in error) {
      return (error as { name: string }).name === 'TimeoutError'
    }
    return false
  }),
  mockGetTimeoutErrorMessage: vi.fn((_error: unknown, timeoutMs?: number): string => {
    if (timeoutMs) {
      const timeoutSeconds = Math.floor(timeoutMs / 1000)
      const timeoutMinutes = Math.floor(timeoutSeconds / 60)
      const displayTime =
        timeoutMinutes > 0
          ? `${timeoutMinutes} minute${timeoutMinutes > 1 ? 's' : ''}`
          : `${timeoutSeconds} seconds`
      return `Execution timed out after ${displayTime}`
    }
    return 'Execution timed out'
  }),
  mockIsTimeoutAbortReason: vi.fn(isTimeoutAbortReason),
  mockGetExecutionDeadlineAt: vi.fn((signal?: AbortSignal): Date | undefined => {
    if (!signal) return undefined
    const deadline = signalDeadlines.get(signal)
    return deadline === undefined ? undefined : new Date(deadline)
  }),
  mockCombineExecutionAbortSignals: vi.fn((signals: readonly AbortSignal[]): AbortSignal => {
    if (signals.length === 0) return new AbortController().signal
    if (signals.length === 1) return signals[0]
    const combined = AbortSignal.any([...signals])
    let earliestDeadline: number | undefined
    for (const signal of signals) {
      const deadline = signalDeadlines.get(signal)
      if (
        deadline !== undefined &&
        (earliestDeadline === undefined || deadline < earliestDeadline)
      ) {
        earliestDeadline = deadline
      }
    }
    if (earliestDeadline !== undefined) signalDeadlines.set(combined, earliestDeadline)
    return combined
  }),
  mockGetRemainingExecutionMs: vi.fn((signal?: AbortSignal): number | undefined => {
    if (!signal) return undefined
    const deadline = signalDeadlines.get(signal)
    if (deadline === undefined) return undefined
    return Math.max(0, deadline - Date.now())
  }),
  mockCreateTimeoutAbortController: vi.fn(createTimeoutAbortController),
}

/**
 * Static mock module for `@/lib/core/execution-limits`. Covers every runtime export;
 * `RESERVATION_TTL_BUFFER_MS` (5 min) and `DEFAULT_EXECUTION_TIMEOUT_MS` (free sync, 300 s) carry
 * the real values and `ExecutionTimeoutError` is {@link MockExecutionTimeoutError}.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/core/execution-limits', () => executionLimitsMock)
 * ```
 */
export const executionLimitsMock = {
  ExecutionTimeoutError: MockExecutionTimeoutError,
  RESERVATION_TTL_BUFFER_MS,
  DEFAULT_EXECUTION_TIMEOUT_MS: 300_000,
  getExecutionTimeout: executionLimitsMockFns.mockGetExecutionTimeout,
  getAsyncExecutionTimeoutForBillingAttribution:
    executionLimitsMockFns.mockGetAsyncExecutionTimeoutForBillingAttribution,
  getMaxExecutionTimeout: executionLimitsMockFns.mockGetMaxExecutionTimeout,
  resolveAsyncExecutionTimeout: executionLimitsMockFns.mockResolveAsyncExecutionTimeout,
  capExecutionTimeoutMs: executionLimitsMockFns.mockCapExecutionTimeoutMs,
  toTriggerMaxDurationSeconds: executionLimitsMockFns.mockToTriggerMaxDurationSeconds,
  getExecutionReservationTtlMs: executionLimitsMockFns.mockGetExecutionReservationTtlMs,
  isTimeoutError: executionLimitsMockFns.mockIsTimeoutError,
  getTimeoutErrorMessage: executionLimitsMockFns.mockGetTimeoutErrorMessage,
  isTimeoutAbortReason: executionLimitsMockFns.mockIsTimeoutAbortReason,
  getExecutionDeadlineAt: executionLimitsMockFns.mockGetExecutionDeadlineAt,
  combineExecutionAbortSignals: executionLimitsMockFns.mockCombineExecutionAbortSignals,
  getRemainingExecutionMs: executionLimitsMockFns.mockGetRemainingExecutionMs,
  createTimeoutAbortController: executionLimitsMockFns.mockCreateTimeoutAbortController,
}
