import { sleep } from '@sim/utils/helpers'
import { backoffWithJitter } from '@sim/utils/retry'
import {
  classifyTransientAdmissionFailure,
  type TransientAdmissionFailure,
} from '@/lib/core/admission/transient-failure'
import type { PreprocessExecutionResult } from '@/lib/execution/preprocessing'

export const TABLE_ADMISSION_RETRY_MAX_ATTEMPTS = 4

const TABLE_ADMISSION_RETRY_BASE_MS = 500
const TABLE_ADMISSION_RETRY_MAX_MS = 5_000

interface TableAdmissionRetryEvent {
  attempt: number
  nextAttempt: number
  waitMs: number
  failure: TransientAdmissionFailure
}

interface RetryTableAdmissionOptions {
  signal?: AbortSignal
  onRetry?: (event: TableAdmissionRetryEvent) => void
}

/**
 * Retries only transient admission failures and returns the final result unchanged.
 */
export async function retryTableAdmission(
  operation: () => Promise<PreprocessExecutionResult>,
  options: RetryTableAdmissionOptions = {}
): Promise<PreprocessExecutionResult> {
  let attempt = 1

  while (true) {
    const result = await operation()
    if (result.success) return result

    const failure = classifyTransientAdmissionFailure(result.error)
    if (!failure || attempt >= TABLE_ADMISSION_RETRY_MAX_ATTEMPTS || options.signal?.aborted) {
      return result
    }

    const waitMs = Math.round(
      backoffWithJitter(attempt, null, {
        baseMs: TABLE_ADMISSION_RETRY_BASE_MS,
        maxMs: TABLE_ADMISSION_RETRY_MAX_MS,
      })
    )
    options.onRetry?.({ attempt, nextAttempt: attempt + 1, waitMs, failure })
    await sleep(waitMs)
    attempt++
  }
}
