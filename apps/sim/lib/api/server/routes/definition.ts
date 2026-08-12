import type { AnyApiRouteContract } from '@/lib/api/contracts'
import type { ApplicationOperation } from '@/lib/core/application'

export interface JsonRouteDefinitionMetadata {
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
