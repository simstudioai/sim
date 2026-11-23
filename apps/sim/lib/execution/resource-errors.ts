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
 * budget's byte counts describe a write chunk, which means nothing to a user. A size
 * that reads the same as the limit (only known to exceed it, or just over) is left unstated.
 */
function getResourceLimitMessage(details: ExecutionResourceLimitDetails): string {
  if (details.resource !== 'execution_payload_bytes') return GENERIC_LIMIT_MESSAGE
  const limit = formatSize(details.limitBytes)
  const attempted = formatSize(details.attemptedBytes)
  const size = attempted === limit ? 'is larger than' : `is ${attempted}, more than`
  return `Execution memory limit exceeded: the data ${size} the ${limit} limit. Pass a smaller field or file, or have the blocks that produce it output less.`
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : formatLargeValueSize(bytes)
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
