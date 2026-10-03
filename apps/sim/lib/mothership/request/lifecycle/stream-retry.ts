import { backoffWithJitter } from '@sim/utils/retry'
import { StreamContinuityError } from '@/lib/mothership/request/go/parser'
import {
  CopilotBackendError,
  StreamEndedWithoutTerminalError,
  WorkerStreamInterruptedError,
  WorkerUnreachableError,
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
 * A leg whose delivered events span this long since it last re-attached has proven
 * healthy, so a later interruption, possibly hours on, gets the reachable budget
 * afresh. The span runs from its first event to its latest, so a leg that delivered
 * one event and then only kept alive has made no progress, and a leg that fails again
 * sooner keeps spending the same three retries: a deterministic failure stays bounded.
 */
const HEALTHY_STREAM_REPLENISH_MS = 5 * 60_000

/**
 * Recovery is bounded independently of the healthy leg's lifetime, by two
 * budgets that never share state: an unreachable worker gets a two-minute
 * window from the moment it stopped answering, and any failure of a worker that
 * did answer gets three retries, each burst of them within 30 s of its first
 * failure, replenished only after
 * {@link HEALTHY_STREAM_REPLENISH_MS} of healthy streaming. A leg has no deadline
 * unless the caller sets one.
 */
export class StreamRetryWindow {
  private readonly deadline?: number
  private firstFailureAt?: number
  private streamingSince?: number
  private lastEventAt?: number
  private firstUnreachableAt?: number
  private unreachableAttempt = 0
  private attempt = 0

  constructor(timeoutMs?: number) {
    this.deadline = timeoutMs === undefined ? undefined : Date.now() + timeoutMs
  }

  /** Retries taken across both budgets, for logs and spans. */
  get attempts(): number {
    return this.attempt + this.unreachableAttempt
  }

  /** Time left before the caller's deadline, or `undefined` when the leg has none. */
  remainingMs(): number | undefined {
    if (this.deadline === undefined) return undefined
    const remaining = this.deadline - Date.now()
    if (remaining <= 0)
      throw new Error('The connection to the assistant could not be restored in time.')
    return remaining
  }

  /**
   * The worker delivered an event: a later loss starts a fresh unreachable window, and
   * a fresh 30 s reachable window. Only the three reachable retries carry over.
   */
  recovered(): void {
    this.resetUnreachable()
    this.firstFailureAt = undefined
    this.lastEventAt = Date.now()
    this.streamingSince ??= this.lastEventAt
  }

  nextDelay(error: unknown, signal?: AbortSignal): number | null {
    if (signal?.aborted || !isRetryableStreamError(error)) return null
    this.replenishAfterHealthyStreaming()
    this.streamingSince = undefined
    if (isWorkerUnreachable(error)) {
      this.firstUnreachableAt ??= Date.now()
      const delay = backoff(this.unreachableAttempt)
      if (!this.fits(delay, this.firstUnreachableAt + WORKER_REPLACEMENT_WINDOW_MS)) return null
      this.unreachableAttempt++
      return delay
    }
    // Any other retryable failure is an answer from the worker.
    this.resetUnreachable()
    this.firstFailureAt ??= Date.now()
    if (this.attempt >= MAX_STREAM_RETRIES) return null
    const delay = backoff(this.attempt)
    if (!this.fits(delay, this.firstFailureAt + STREAM_RECOVERY_WINDOW_MS)) return null
    this.attempt++
    return delay
  }

  private resetUnreachable(): void {
    this.firstUnreachableAt = undefined
    this.unreachableAttempt = 0
  }

  private replenishAfterHealthyStreaming(): void {
    if (
      this.streamingSince !== undefined &&
      this.lastEventAt !== undefined &&
      this.lastEventAt - this.streamingSince >= HEALTHY_STREAM_REPLENISH_MS
    ) {
      this.attempt = 0
      this.firstFailureAt = undefined
    }
  }

  private fits(delay: number, recoveryDeadline: number): boolean {
    return (
      Date.now() + delay < Math.min(this.deadline ?? Number.POSITIVE_INFINITY, recoveryDeadline)
    )
  }
}

function backoff(attempt: number): number {
  return backoffWithJitter(attempt + 1, null, { baseMs: 250, maxMs: 5_000 })
}

/**
 * No worker answered: a gateway error page from the load balancer, or a request
 * that failed before any response headers. A JSON 5xx, or a failure after the
 * response began, comes from a reachable worker and gets the short budget.
 */
function isWorkerUnreachable(error: unknown): boolean {
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && GATEWAY_STATUSES.has(error.status) && !isJson(error.body)
  }
  return error instanceof WorkerUnreachableError
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
  if (
    error instanceof StreamEndedWithoutTerminalError ||
    error instanceof StreamContinuityError ||
    error instanceof WorkerStreamInterruptedError
  ) {
    return true
  }
  if (error instanceof CopilotBackendError) {
    return error.status !== undefined && error.status >= 500
  }
  return error instanceof WorkerUnreachableError
}
