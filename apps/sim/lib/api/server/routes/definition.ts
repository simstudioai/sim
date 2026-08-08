import type { AnyApiRouteContract } from '@/lib/api/contracts'
import type { WorkspaceOperation } from '@/lib/workspace-files/application/operations'

export interface JsonRouteDefinitionMetadata {
  successStatus: number
}

export function requireJsonRouteDefinition(
  contract: AnyApiRouteContract,
  declaredOperation: WorkspaceOperation,
  useCaseOperation: WorkspaceOperation
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
  if (configuredStatus !== undefined && typeof configuredStatus !== 'number') {
    throw new Error(`${contract.method} ${contract.path} must declare one success status`)
  }
  const successStatus = configuredStatus ?? 200
  if (successStatus < 200 || successStatus >= 300) {
    throw new Error(`${contract.method} ${contract.path} has a non-success response status`)
  }
  return { successStatus }
}

export function requireBinaryRouteDefinition(
  contract: AnyApiRouteContract,
  declaredOperation: WorkspaceOperation,
  useCaseOperation: WorkspaceOperation
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
  return { successStatus }
}
