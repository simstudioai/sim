import { backoffWithJitter } from '@sim/utils/retry'
import {
  SCHEDULE_INFRA_RETRY_BASE_MS,
  SCHEDULE_INFRA_RETRY_MAX_MS,
} from '@/lib/workflows/schedules/execution-limits'

/**
 * Calculates the bounded, jittered delay shared by schedule infrastructure retries.
 */
export function calculateScheduleInfraRetryDelayMs(retryAttempt: number): number {
  return Math.min(
    SCHEDULE_INFRA_RETRY_MAX_MS,
    Math.round(
      backoffWithJitter(retryAttempt, null, {
        baseMs: SCHEDULE_INFRA_RETRY_BASE_MS,
        maxMs: SCHEDULE_INFRA_RETRY_MAX_MS,
      })
    )
  )
}
