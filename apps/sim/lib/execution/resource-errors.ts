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

export class ExecutionResourceLimitError extends Error {
  readonly code = EXECUTION_RESOURCE_LIMIT_CODE
  readonly statusCode: number
  readonly resource: ExecutionResourceLimitResource
  readonly attemptedBytes: number
  readonly limitBytes: number
  readonly currentBytes?: number

  constructor(details: ExecutionResourceLimitDetails) {
    super('Execution memory limit exceeded. Reduce payload size and try again.')
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
