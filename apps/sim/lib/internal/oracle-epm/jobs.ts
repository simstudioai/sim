import { interruptibleSleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import { getExecutionDeadlineAt } from '@/lib/core/execution-limits'

/** Child-owned interpretation of one provider job snapshot. */
export type OracleEpmPollClassification<TResult, TFailure> =
  | { readonly state: 'pending' }
  | { readonly state: 'success'; readonly result: TResult }
  | { readonly state: 'failure'; readonly error: TFailure }

/** Bounded scheduling policy plus child-owned read and classification callbacks. */
export interface OracleEpmPollOptions<TSnapshot, TResult, TFailure> {
  readonly read: (signal: AbortSignal) => Promise<TSnapshot>
  readonly classify: (snapshot: TSnapshot) => OracleEpmPollClassification<TResult, TFailure>
  readonly signal?: AbortSignal
  readonly deadlineAt?: Date
  readonly maxWaitMs: number
  readonly cleanupReserveMs: number
  readonly maxAttempts: number
  readonly initialDelayMs: number
  readonly maxDelayMs: number
}

/** Terminal child result annotated with the scheduler attempt count. */
export type OracleEpmPollResult<TResult, TFailure> =
  | { readonly state: 'success'; readonly result: TResult; readonly attempts: number }
  | { readonly state: 'failure'; readonly error: TFailure; readonly attempts: number }

function validateOptions(options: OracleEpmPollOptions<unknown, unknown, unknown>): void {
  if (
    !Number.isInteger(options.maxWaitMs) ||
    options.maxWaitMs < 1 ||
    options.maxWaitMs > 24 * 60 * 60 * 1_000 ||
    !Number.isInteger(options.cleanupReserveMs) ||
    options.cleanupReserveMs < 0 ||
    options.cleanupReserveMs >= options.maxWaitMs ||
    !Number.isInteger(options.maxAttempts) ||
    options.maxAttempts < 1 ||
    options.maxAttempts > 10_000 ||
    !Number.isInteger(options.initialDelayMs) ||
    options.initialDelayMs < 1 ||
    !Number.isInteger(options.maxDelayMs) ||
    options.maxDelayMs < options.initialDelayMs ||
    options.maxDelayMs > 60_000
  ) {
    throw new Error('Oracle EPM polling policy is invalid')
  }
}

function assertClassification<TResult, TFailure>(
  value: unknown
): asserts value is OracleEpmPollClassification<TResult, TFailure> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Oracle EPM polling classifier returned an invalid state')
  }
  const record = value as Record<string, unknown>
  if (record.state === 'pending') {
    if (Object.keys(record).some((key) => key !== 'state')) {
      throw new Error('Oracle EPM polling classifier returned an invalid pending state')
    }
    return
  }
  if (record.state === 'success' && Object.hasOwn(record, 'result')) return
  if (record.state === 'failure' && Object.hasOwn(record, 'error')) return
  throw new Error('Oracle EPM polling classifier returned an invalid state')
}

function throwIfPollingEnded(signal: AbortSignal, deadline: number): void {
  if (signal.aborted) {
    throw signal.reason ?? new DOMException('Oracle EPM polling aborted', 'AbortError')
  }
  if (Date.now() >= deadline) {
    throw new DOMException('Oracle EPM polling deadline exceeded', 'TimeoutError')
  }
}

function runAbortable<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(
      signal.reason ?? new DOMException('Oracle EPM polling aborted', 'AbortError')
    )
  }
  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () =>
      finish(() =>
        reject(signal.reason ?? new DOMException('Oracle EPM polling aborted', 'AbortError'))
      )
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      operation().then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      )
    } catch (error) {
      finish(() => reject(error))
    }
  })
}

/**
 * Runs child-supplied polling semantics inside caller and execution deadlines.
 * The scheduler knows nothing about Oracle job ids, statuses, results, or cancellation.
 */
export async function pollOracleEpmJob<TSnapshot, TResult, TFailure>(
  options: OracleEpmPollOptions<TSnapshot, TResult, TFailure>
): Promise<OracleEpmPollResult<TResult, TFailure>> {
  validateOptions(options as OracleEpmPollOptions<unknown, unknown, unknown>)
  const startedAt = Date.now()
  const executionDeadline = getExecutionDeadlineAt(options.signal)?.getTime()
  const explicitDeadline = options.deadlineAt?.getTime()
  const candidates = [
    startedAt + options.maxWaitMs,
    ...(executionDeadline === undefined ? [] : [executionDeadline]),
    ...(explicitDeadline === undefined ? [] : [explicitDeadline]),
  ]
  const deadline = Math.min(...candidates) - options.cleanupReserveMs
  if (!Number.isFinite(deadline) || deadline <= startedAt) {
    throw new DOMException('Oracle EPM polling deadline exceeded', 'TimeoutError')
  }

  const deadlineSignal = AbortSignal.timeout(Math.max(1, deadline - startedAt))
  const signal = options.signal ? AbortSignal.any([options.signal, deadlineSignal]) : deadlineSignal

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    throwIfPollingEnded(signal, deadline)
    const snapshot = await runAbortable(() => options.read(signal), signal)
    throwIfPollingEnded(signal, deadline)
    const classification: unknown = options.classify(snapshot)
    assertClassification<TResult, TFailure>(classification)
    throwIfPollingEnded(signal, deadline)
    if (classification.state === 'success') {
      return Object.freeze({
        state: 'success' as const,
        result: classification.result,
        attempts: attempt,
      })
    }
    if (classification.state === 'failure') {
      return Object.freeze({
        state: 'failure' as const,
        error: classification.error,
        attempts: attempt,
      })
    }
    if (attempt === options.maxAttempts) break
    const delay = backoffWithJitter(attempt, null, {
      baseMs: options.initialDelayMs,
      maxMs: options.maxDelayMs,
    })
    if (Date.now() + delay >= deadline) {
      throw new DOMException('Oracle EPM polling deadline exceeded', 'TimeoutError')
    }
    await interruptibleSleep(delay, signal)
  }
  throw new Error('Oracle EPM polling attempt limit exceeded')
}
