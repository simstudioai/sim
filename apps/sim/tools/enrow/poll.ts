import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'

/** Delay between two ordinary (202 in-progress) polls. */
const POLL_INTERVAL_MS = 3000

/** Total wall-clock budget for a poll, retries included. */
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

/** 429 and 5xx are the statuses a later poll can plausibly recover from. */
function isTransientStatus(status: number): boolean {
  return status === 429 || status >= 500
}

function readRetryAfterMs(response: Response): number | null {
  return parseRetryAfter(response.headers?.get('retry-after') ?? null, TRANSIENT_BACKOFF_MAX_MS)
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
 * up to `MAX_TRANSIENT_RETRIES` for the whole poll and always inside the same
 * `MAX_POLL_TIME_MS` budget — the backoff is charged against that budget rather
 * than added to it. Any other non-2xx, or one transient failure past the cap,
 * throws with the status and body.
 */
export async function pollEnrowJob({
  resultUrl,
  jobId,
  apiKey,
  label,
}: EnrowPollOptions): Promise<Record<string, unknown>> {
  let elapsed = 0
  let transientFailures = 0

  while (elapsed < MAX_POLL_TIME_MS) {
    await sleep(POLL_INTERVAL_MS)
    elapsed += POLL_INTERVAL_MS

    const response = await fetch(`${resultUrl}?id=${encodeURIComponent(jobId)}`, {
      headers: { 'x-api-key': apiKey },
    })

    if (response.status === 202) continue

    if (!response.ok) {
      if (isTransientStatus(response.status) && transientFailures < MAX_TRANSIENT_RETRIES) {
        transientFailures += 1
        const delayMs = backoffWithJitter(transientFailures, readRetryAfterMs(response), {
          baseMs: TRANSIENT_BACKOFF_BASE_MS,
          maxMs: TRANSIENT_BACKOFF_MAX_MS,
        })
        elapsed += delayMs
        if (elapsed >= MAX_POLL_TIME_MS) break
        await sleep(delayMs)
        continue
      }
      const errorText = await response.text()
      throw new Error(`${label} poll error: ${response.status} - ${errorText}`)
    }

    return ((await response.json()) as Record<string, unknown> | null) ?? {}
  }

  throw new Error(`${label} did not complete within the polling window`)
}
