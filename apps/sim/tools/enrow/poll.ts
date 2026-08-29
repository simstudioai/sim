import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'

/** Delay between two ordinary (202 in-progress) polls. */
const POLL_INTERVAL_MS = 3000

/** Total budget for a poll, retries included. */
const MAX_POLL_TIME_MS = 120_000

/**
 * Transient upstream failures tolerated across the whole poll.
 *
 * `GET /email/{find,verify}/single` documents a 500 "could not retrieve single
 * search results", and retrieving a result consumes no credits, so a retry is
 * free and safe. The cap is a total, not per-attempt, so the loop stays bounded
 * even if every poll fails a different way.
 */
const MAX_TRANSIENT_RETRIES = 3

const TRANSIENT_BACKOFF_BASE_MS = 1000
const TRANSIENT_BACKOFF_MAX_MS = 15_000

/**
 * 429 and 5xx are the statuses a later poll can plausibly recover from.
 *
 * Bounded at the top of the 5xx range rather than left open: a status is a
 * three-digit field, and while the `Response` constructor refuses anything
 * outside 200-599, a status parsed off the wire is not built that way, so a
 * misbehaving intermediary can surface a 6xx. That is not a server error a
 * later poll recovers from, so it fails fast with the status attached instead
 * of burning retries on it.
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599)
}

function readRetryAfterMs(response: Response): number | null {
  return parseRetryAfter(response.headers?.get('retry-after') ?? null, TRANSIENT_BACKOFF_MAX_MS)
}

/**
 * Releases a response whose body this poll will never read.
 *
 * A 202 or a to-be-retried 5xx is discarded mid-stream; without cancelling it
 * the socket stays checked out of the connection pool for the rest of the poll.
 * A cancel on an already-broken stream throws and is ignored — the connection
 * is gone either way, which is the outcome the cancel was asking for.
 */
async function discardBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

/** Distinguishes an abort/timeout rejection from a genuine transport failure. */
function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')
  )
}

export interface EnrowPollOptions {
  /** Result URL, minus the job id. */
  resultUrl: string
  jobId: string
  apiKey: string
  /** Message prefix identifying the operation, e.g. `'Enrow find-email'`. */
  label: string
}

/**
 * Polls an Enrow async job until it completes, and returns the decoded 200 body.
 *
 * HTTP 202 means still running. A 429 or 5xx is retried with jittered backoff,
 * up to `MAX_TRANSIENT_RETRIES` for the whole poll. Any other non-2xx, or one
 * transient failure past the cap, throws with the status and body — and the
 * status survives even when that body cannot be read.
 *
 * The deadline covers reading the 200 body, not just receiving its headers, so
 * a stalled body ends the poll with this function's own window error.
 *
 * Two budgets bound the call and every wait is clamped to whichever is smaller.
 * `elapsed` accumulates the delays the loop intends to wait; it drives the poll
 * count and keeps that count deterministic under a stubbed `sleep`. The
 * wall-clock `deadline` is the one that actually holds, because `elapsed`
 * charges nothing for time spent inside `await fetch` — with slow or hung polls
 * the real clock runs ahead of it, so a wait sized against `elapsed` alone can
 * land past the deadline, and a request awaited without a deadline outlives the
 * window entirely. Backoff is charged against the budget rather than added to
 * it, so the loop waits out the full window without ever overrunning it.
 */
export async function pollEnrowJob({
  resultUrl,
  jobId,
  apiKey,
  label,
}: EnrowPollOptions): Promise<Record<string, unknown>> {
  const deadline = Date.now() + MAX_POLL_TIME_MS
  const url = `${resultUrl}?id=${encodeURIComponent(jobId)}`
  let elapsed = 0
  let transientFailures = 0

  /** Whichever of the two budgets has less left, floored at zero. */
  const remainingBudgetMs = () =>
    Math.max(0, Math.min(MAX_POLL_TIME_MS - elapsed, deadline - Date.now()))

  while (true) {
    const pollDelayMs = Math.min(POLL_INTERVAL_MS, remainingBudgetMs())
    if (pollDelayMs <= 0) break
    await sleep(pollDelayMs)
    elapsed += pollDelayMs

    const requestBudgetMs = deadline - Date.now()
    if (requestBudgetMs <= 0) break

    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'x-api-key': apiKey },
        signal: AbortSignal.timeout(requestBudgetMs),
      })
    } catch (error) {
      if (isAbortError(error)) break
      throw error
    }

    if (response.status === 202) {
      await discardBody(response)
      continue
    }

    if (!response.ok) {
      if (isTransientStatus(response.status) && transientFailures < MAX_TRANSIENT_RETRIES) {
        transientFailures += 1
        const backoffMs = backoffWithJitter(transientFailures, readRetryAfterMs(response), {
          baseMs: TRANSIENT_BACKOFF_BASE_MS,
          maxMs: TRANSIENT_BACKOFF_MAX_MS,
        })
        await discardBody(response)
        const delayMs = Math.min(backoffMs, remainingBudgetMs())
        if (delayMs > 0) {
          await sleep(delayMs)
          elapsed += delayMs
        }
        continue
      }
      const errorText = await response.text().catch(() => '<unreadable body>')
      throw new Error(`${label} poll error: ${response.status} - ${errorText}`)
    }

    /*
     * The body is read under the same deadline as the headers.
     *
     * `AbortSignal.timeout` fires against the whole exchange, so a 200 whose
     * headers arrive just inside the window can still have its body aborted
     * mid-read. That rejection surfaces here rather than at the `fetch` above,
     * so it needs the same abort handling: without it the raw `TimeoutError`
     * escapes, naming neither Enrow nor the window it exhausted.
     */
    try {
      return ((await response.json()) as Record<string, unknown> | null) ?? {}
    } catch (error) {
      if (isAbortError(error)) break
      throw error
    }
  }

  throw new Error(`${label} did not complete within the polling window`)
}
