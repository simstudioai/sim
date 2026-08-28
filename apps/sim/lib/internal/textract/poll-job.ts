import type { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'
import { getMaxExecutionTimeout } from '@/lib/core/execution-limits'
import { TextractOperationError } from '@/lib/internal/textract/errors'

type TextractLogger = ReturnType<typeof createLogger>

interface PollableJobResult {
  JobStatus?: string
  StatusMessage?: string
  NextToken?: string
}

export async function pollTextractJob<TResult extends PollableJobResult>(
  requestId: string,
  logger: TextractLogger,
  getPage: (nextToken?: string) => Promise<TResult>,
  mergePage: (accumulated: TResult, page: TResult) => TResult,
  signal?: AbortSignal
): Promise<TResult> {
  const pollIntervalMs = 5000
  const maxPollTimeMs = getMaxExecutionTimeout()
  const maxAttempts = Math.ceil(maxPollTimeMs / pollIntervalMs)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    signal?.throwIfAborted()
    const result = await getPage()
    const jobStatus = result.JobStatus

    if (jobStatus === 'SUCCEEDED' || jobStatus === 'PARTIAL_SUCCESS') {
      if (jobStatus === 'PARTIAL_SUCCESS') {
        logger.warn(`[${requestId}] Job completed with partial success: ${result.StatusMessage}`)
      } else {
        logger.info(`[${requestId}] Async job completed successfully after ${attempt + 1} polls`)
      }

      let merged = result
      let nextToken = result.NextToken
      while (nextToken) {
        signal?.throwIfAborted()
        const page = await getPage(nextToken)
        merged = mergePage(merged, page)
        nextToken = page.NextToken
      }
      return merged
    }

    if (jobStatus === 'FAILED') {
      throw new TextractOperationError(
        `Textract job failed: ${result.StatusMessage || 'Unknown error'}`,
        502
      )
    }

    logger.info(`[${requestId}] Job status: ${jobStatus}, attempt ${attempt + 1}/${maxAttempts}`)
    await sleep(pollIntervalMs)
    signal?.throwIfAborted()
  }

  throw new TextractOperationError(
    `Timeout waiting for Textract job to complete (max ${maxPollTimeMs / 1000} seconds)`,
    504
  )
}
