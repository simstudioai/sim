import { formatLargeValueSize } from '@/lib/execution/payloads/large-value-ref'

export const EXECUTION_RESOURCE_LIMIT_CODE = 'execution_resource_limit_exceeded' as const

export type ExecutionResourceLimitResource =
  | 'redis_key_bytes'
  | 'execution_redis_bytes'
  | 'user_redis_bytes'
  | 'execution_payload_bytes'

export interface ExecutionResourceLimitDetails {
  resource: ExecutionResourceLimitResource
  attemptedBytes: number
  limitBytes: number
  currentBytes?: number
  statusCode?: number
}

const GENERIC_LIMIT_MESSAGE = 'Execution memory limit exceeded. Reduce payload size and try again.'

/**
 * A payload refusal names the value's size and the limit, so whoever fixes the workflow
 * (a person or Chat) can see it is a structural problem rather than retrying it. A Redis
 * budget's byte counts describe a write chunk, which means nothing to a user, and a
 * payload size that is only known to exceed the limit (`limit + 1`) is left unstated.
 */
function getResourceLimitMessage(details: ExecutionResourceLimitDetails): string {
  if (details.resource !== 'execution_payload_bytes') return GENERIC_LIMIT_MESSAGE
  const limit = formatLargeValueSize(details.limitBytes)
  if (details.attemptedBytes <= details.limitBytes + 1) {
    return `Execution memory limit exceeded: a value is larger than the ${limit} limit. Reference a smaller field, or have the blocks that produce it output less.`
  }
  return `Execution memory limit exceeded: a value is ${formatLargeValueSize(details.attemptedBytes)}, more than the ${limit} limit. Reference a smaller field, or have the blocks that produce it output less.`
}

export class ExecutionResourceLimitError extends Error {
  readonly code = EXECUTION_RESOURCE_LIMIT_CODE
  readonly statusCode: number
  readonly resource: ExecutionResourceLimitResource
  readonly attemptedBytes: number
  readonly limitBytes: number
  readonly currentBytes?: number

  constructor(details: ExecutionResourceLimitDetails) {
    super(getResourceLimitMessage(details))
    this.name = 'ExecutionResourceLimitError'
    this.resource = details.resource
    this.attemptedBytes = details.attemptedBytes
    this.limitBytes = details.limitBytes
    this.currentBytes = details.currentBytes
    this.statusCode = details.statusCode ?? (details.resource === 'user_redis_bytes' ? 429 : 413)
  }
}

export function isExecutionResourceLimitError(
  error: unknown
): error is ExecutionResourceLimitError {
  return (
    error instanceof ExecutionResourceLimitError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === EXECUTION_RESOURCE_LIMIT_CODE)
  )
}
