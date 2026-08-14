import type { AnyApiRouteContract } from '@/lib/api/contracts'
import type { ApplicationOperation } from '@/lib/core/application'

interface JsonRouteDefinitionMetadata {
  successStatus: number
  successStatuses: readonly number[]
}

export function requireJsonRouteDefinition(
  contract: AnyApiRouteContract,
  declaredOperation: ApplicationOperation,
  useCaseOperation: ApplicationOperation
): JsonRouteDefinitionMetadata {
  if (contract.response.mode !== 'json') {
    throw new Error(`${contract.method} ${contract.path} requires a JSON response contract`)
  }
  if (declaredOperation.id !== useCaseOperation.id) {
    throw new Error(
      `Route operation ${declaredOperation.id} does not match use case ${useCaseOperation.id}`
    )
  }

  const configuredStatus = contract.response.status
  const successStatuses =
    configuredStatus === undefined
      ? [200]
      : Array.isArray(configuredStatus)
        ? [...configuredStatus]
        : [configuredStatus]
  if (successStatuses.length === 0) {
    throw new Error(`${contract.method} ${contract.path} must declare a success status`)
  }
  if (new Set(successStatuses).size !== successStatuses.length) {
    throw new Error(`${contract.method} ${contract.path} repeats a success status`)
  }
  for (const status of successStatuses) {
    if (!Number.isInteger(status) || status < 200 || status >= 300) {
      throw new Error(`${contract.method} ${contract.path} has a non-success response status`)
    }
  }
  return { successStatus: successStatuses[0], successStatuses }
}

export function requireBinaryRouteDefinition(
  contract: AnyApiRouteContract,
  declaredOperation: ApplicationOperation,
  useCaseOperation: ApplicationOperation
): JsonRouteDefinitionMetadata {
  if (contract.response.mode !== 'binary') {
    throw new Error(`${contract.method} ${contract.path} requires a binary response contract`)
  }
  if (declaredOperation.id !== useCaseOperation.id) {
    throw new Error(
      `Route operation ${declaredOperation.id} does not match use case ${useCaseOperation.id}`
    )
  }
  const configuredStatus = contract.response.status
  if (configuredStatus !== undefined && typeof configuredStatus !== 'number') {
    throw new Error(`${contract.method} ${contract.path} must declare one success status`)
  }
  const successStatus = configuredStatus ?? 200
  if (successStatus < 200 || successStatus >= 300) {
    throw new Error(`${contract.method} ${contract.path} has a non-success response status`)
  }
  return { successStatus, successStatuses: [successStatus] }
}

/**
 * Whether an incoming request's method is the one its contract declares.
 *
 * `HEAD` satisfies a `GET` contract because Next aliases a missing `HEAD`
 * export straight to the `GET` handler
 * (`auto-implement-methods.ts`: `methods.HEAD = handlers.GET`) and then drops
 * the body when sending (`send-response.ts` skips the stream when
 * `req.method === 'HEAD'`). So the handler legitimately runs with
 * `request.method === 'HEAD'` against a `GET` contract, and rejecting that made
 * every v2 read answer 500 to a plain `HEAD` — the request health checkers,
 * uptime monitors, and link checkers send. RFC 9110 §9.3.2 makes HEAD identical
 * to GET but for the body, which is exactly what running the GET path and
 * letting the framework strip the body produces.
 *
 * Everything else stays a hard error: a handler exported under the wrong verb is
 * a wiring mistake that should fail loudly rather than serve the wrong contract.
 */
export function methodMatchesContract(requestMethod: string, contractMethod: string): boolean {
  if (requestMethod === contractMethod) return true
  return requestMethod === 'HEAD' && contractMethod === 'GET'
}
