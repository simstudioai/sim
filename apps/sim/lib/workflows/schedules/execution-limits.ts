import { env, envNumber } from '@/lib/core/config/env'

export const SCHEDULE_EXECUTION_QUEUE_NAME = 'schedule-execution'

export const SCHEDULE_EXECUTION_CONCURRENCY_LIMIT = envNumber(
  env.SCHEDULE_EXECUTION_CONCURRENCY_LIMIT,
  50,
  { min: 1, integer: true }
)

export const SCHEDULE_ENQUEUE_BUDGET_MULTIPLIER = envNumber(
  env.SCHEDULE_ENQUEUE_BUDGET_MULTIPLIER,
  2,
  { min: 1, integer: true }
)

export const SCHEDULE_WORKFLOW_ENQUEUE_LIMIT =
  SCHEDULE_EXECUTION_CONCURRENCY_LIMIT * SCHEDULE_ENQUEUE_BUDGET_MULTIPLIER

export const SCHEDULE_JITTER_MAX_MS = envNumber(env.SCHEDULE_JITTER_MAX_MS, 30_000, {
  min: 0,
  integer: true,
})

export const SCHEDULE_INFRA_RETRY_BASE_MS = envNumber(env.SCHEDULE_INFRA_RETRY_BASE_MS, 60_000, {
  min: 1,
  integer: true,
})

export const SCHEDULE_INFRA_RETRY_MAX_MS = envNumber(env.SCHEDULE_INFRA_RETRY_MAX_MS, 5 * 60_000, {
  min: 1,
  integer: true,
})

export const SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS = envNumber(
  env.SCHEDULE_INFRA_RETRY_MAX_ATTEMPTS,
  10,
  {
    min: 1,
    integer: true,
  }
)
