import { backoffWithJitter } from '@sim/utils/retry'
import { ORCHESTRATION_TIMEOUT_MS } from '@/lib/mothership/constants'
import { StreamContinuityError } from '@/lib/mothership/request/go/parser'
import {
  CopilotBackendError,
  StreamEndedWithoutTerminalError,
} from '@/lib/mothership/request/go/stream'

const MAX_STREAM_RETRIES = 3
const STREAM_RECOVERY_WINDOW_MS = 30_000
/** The load balancer's answers while no worker task is registered behind it. */
const GATEWAY_STATUSES: ReadonlySet<number> = new Set([502, 503, 504])
/**
 * While the worker cannot be reached at all (a gateway error page, or no
 * connection), retries continue for this long from the first failure: long
 * enough to outlast a worker task replacement (about 70 s of 502/504). Every
 * attempt re-sends the same message identity, which the worker treats as a
 * reattach, never a second run.
 */
const WORKER_REPLACEMENT_WINDOW_MS = 120_000

/**
 * Recovery is bounded independently of the healthy run's execution budget, by
 * two budgets that never share state: an unreachable worker gets a two-minute
 * window from the moment it stopped answering, and any failure of a worker that
 * did answer gets the original three retries within 30 s.
 */
export class StreamRetryWindow {
  private readonly deadline: number
  private firstFailureAt?: number
  private firstUnreachableAt?: number
  private unreachableAttempt = 0
  attempt = 0

  constructor(timeoutMs = ORCHESTRATION_TIMEOUT_MS) {
    this.deadline = Date.now() + timeoutMs
  }

  remainingMs(): number {
    const remaining = this.deadline - Date.now()
    if (remaining <= 0)
      throw new Error('The connection to the assistant could not be restored in time.')
    return remaining
  }

  /** The worker answered, so a later loss of it starts a fresh unreachable window. */
  recovered(): void {
    this.firstUnreachableAt = undefined
    this.unreachableAttempt = 0
  }

  nextDelay(error: unknown, signal?: AbortSignal): number | null {
    if (signal?.aborted || !isRetryableStreamError(error)) return null
    if (isWorkerUnreachable(error)) {
      this.firstUnreachableAt ??= Date.now()
      const delay = backoff(this.unreachableAttempt)
      if (!this.fits(delay, this.firstUnreachableAt + WORKER_REPLACEMENT_WINDOW_MS)) return null
      this.unreachableAttempt++
      return delay
    }
    // Any other retryable failure is an answer from the worker.
    this.recovered()
    this.firstFailureAt ??= Date.now()
    if (this.attempt >= MAX_STREAM_RETRIES) return null
    const delay = backoff(this.attempt)
    if (!this.fits(delay, this.firstFailureAt + STREAM_RECOVERY_WINDOW_MS)) return null
    this.attempt++
    return delay
  }

  private fits(delay: number, recoveryDeadline: number): boolean {
    return Date.now() + delay < Math.min(this.deadline, recoveryDeadline)
  }
}

function backoff(attempt: number): number {
  return backoffWithJitter(attempt + 1, null, { baseMs: 250, maxMs: 5_000 })
}

/**
 * No worker answered: a gateway error page from the load balancer, or no
 * connection at all. A JSON 5xx comes from a reachable worker, so it gets the
 * short recovery budget instead.
 */
function isWorkerUnreachable(error: unknown): boolean {
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && GATEWAY_STATUSES.has(error.status) && !isJson(error.body)
  }
  return error instanceof TypeError
}

function isJson(body: string | undefined): boolean {
  if (!body) return false
  try {
    JSON.parse(body)
    return true
  } catch {
    return false
  }
}

/** Initial sends and resumes both replay one durable identity after an ambiguous response. */
function isRetryableStreamError(error: unknown): boolean {
  if (error instanceof Error && error.name === 'AbortError') return false
  if (error instanceof StreamEndedWithoutTerminalError || error instanceof StreamContinuityError) {
    return true
  }
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && error.status >= 500
  }
  return error instanceof TypeError
}
