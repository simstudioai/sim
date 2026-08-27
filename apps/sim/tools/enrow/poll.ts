import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'

/** Base gap between two in-progress (202) polls. */
export const POLL_INTERVAL_MS = 3000

/** Overall budget for a single job's polling loop, retries included. */
export const MAX_POLL_TIME_MS = 120_000

/**
 * Consecutive transient failures tolerated before the loop gives up.
 *
 * Enrow documents 5xx as "safe to retry after a short delay", but it also
 * returns 500 for an unknown or expired search id on the single endpoints.
 * That makes 500 ambiguous, so the retry is deliberately bounded: an expired
 * id simply re-fails on each attempt and the loop exits with the upstream
 * status and body instead of masking it.
 *
 * Source: https://docs.enrow.io/status-codes
 */
export const MAX_TRANSIENT_RETRIES = 3

/**
 * Statuses worth another bounded attempt.
 *
 * 5xx is the load-bearing arm: Enrow documents those as safe to retry.
 *
 * 429 cannot occur on this path today — Enrow documents GET endpoints as not
 * rate limited, and this loop only issues GETs — so it is kept purely as a
 * bounded fallback against an undocumented change. It is cheap (the retry
 * count caps it at MAX_TRANSIENT_RETRIES) and strictly safer than the
 * alternative, which is failing a job Enrow has already charged for.
 *
 * Source: https://docs.enrow.io/rate-limits
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

/**
 * Polls an Enrow single-job endpoint until it reports completion.
 *
 * HTTP 202 means the job is still running; HTTP 200 carries the result.
 * `label` names the tool in the thrown messages (e.g. `find-email`).
 *
 * The `MAX_POLL_TIME_MS` budget covers every wait the loop performs, so a run
 * of transient failures shortens the number of polls rather than extending the
 * overall deadline. GET is not rate limited by Enrow, so polling does not
 * consume the POST quota.
 */
export async function pollEnrowJob(
  url: string,
  apiKey: string,
  label: string
): Promise<Record<string, unknown>> {
  let elapsed = 0
  let transientFailures = 0
  let delayMs = POLL_INTERVAL_MS

  while (elapsed < MAX_POLL_TIME_MS) {
    await sleep(delayMs)
    elapsed += delayMs
    delayMs = POLL_INTERVAL_MS

    const pollResponse = await fetch(url, { headers: { 'x-api-key': apiKey } })

    if (pollResponse.status === 202) {
      transientFailures = 0
      continue
    }

    if (!pollResponse.ok) {
      if (isRetryableStatus(pollResponse.status) && transientFailures < MAX_TRANSIENT_RETRIES) {
        transientFailures += 1
        // No `Retry-After` is read: Enrow documents that its error responses
        // carry no retry hint and tells callers to use their own exponential
        // backoff. Source: https://docs.enrow.io/error-handling
        delayMs = backoffWithJitter(transientFailures, null, {
          baseMs: POLL_INTERVAL_MS,
          maxMs: MAX_POLL_TIME_MS / 4,
        })
        continue
      }
      const errorText = await pollResponse.text()
      throw new Error(`Enrow ${label} poll error: ${pollResponse.status} - ${errorText}`)
    }

    const json = await pollResponse.json()
    return (json as Record<string, unknown>) ?? {}
  }

  throw new Error(`Enrow ${label} did not complete within the polling window`)
}
