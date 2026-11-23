import { createLogger } from '@sim/logger'
import { outboundFetch } from '@/lib/core/network/outbound-fetch.server'
import { readResponseJsonWithLimit } from '@/lib/core/utils/stream-limits'
import { MAX_DURABLE_LARGE_VALUE_BYTES } from '@/lib/execution/payloads/limits'

const logger = createLogger('FirecrawlJobPolling')

const CANCEL_TIMEOUT_MS = 10_000

/**
 * Reads a Firecrawl job status body. The cap is the largest value a workflow output can carry:
 * Firecrawl pages its results at 10MB of characters, so a finished page of multi-byte text can
 * exceed 10 MiB, and those results reached the workflow before polling had a cap.
 */
export function readFirecrawlJobStatus<T>(response: Response, signal?: AbortSignal): Promise<T> {
  return readResponseJsonWithLimit<T>(response, {
    maxBytes: MAX_DURABLE_LARGE_VALUE_BYTES,
    label: 'Firecrawl job status',
    signal,
  })
}

/**
 * Asks Firecrawl to stop a job the workflow stopped waiting for, so a cancelled run does not keep
 * spending credits. Best effort: a failure is logged and the run still ends as cancelled.
 *
 * @param jobPath - The job's path under `/v2`, such as `crawl/<id>`.
 */
export async function cancelFirecrawlJob(jobPath: string, apiKey: string): Promise<void> {
  try {
    const response = await outboundFetch(`https://api.firecrawl.dev/v2/${jobPath}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CANCEL_TIMEOUT_MS),
    })
    await response.body?.cancel()
    if (!response.ok) {
      logger.warn('Firecrawl did not cancel the job', { jobPath, status: response.status })
    }
  } catch (error) {
    logger.warn('Failed to cancel the Firecrawl job', { jobPath, error })
  }
}
