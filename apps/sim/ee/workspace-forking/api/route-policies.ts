import {
  createV2ResourceConcealmentPolicy,
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { asOrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { WorkspaceOperationConflict } from '@/lib/workspaces/operations/receipts'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2ErrorForOrchestration,
} from '@/app/api/v2/lib/response'
import { ForkError } from '@/ee/workspace-forking/lib/lineage/authz'

export const v2ForkErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Workspace not found',
  render(error) {
    const classified = asOrchestrationError(error)
    if (classified instanceof WorkspaceOperationConflict)
      return v2ErrorForOrchestration(classified.code, classified.message, classified.details)
    if (error instanceof ForkError) {
      if (error.statusCode === 404) return v2Error('NOT_FOUND', error.message)
      if (error.statusCode === 409)
        return v2Error('CONFLICT', error.message, { details: { applied: false } })
      if (error.statusCode === 413) return v2Error('PAYLOAD_TOO_LARGE', error.message)
      if (error.statusCode === 403)
        return v2Error('FORBIDDEN', error.message, {
          details: { code: 'INSUFFICIENT_WORKSPACE_ROLE' },
        })
      if (error.statusCode === 400) return v2Error('BAD_REQUEST', error.message)
    }
    return v2CaughtOrchestrationError(error)
  },
})

export const internalForkErrorPolicy: InternalErrorPolicy = {
  project(error) {
    if (error instanceof ForkError)
      return internalErrorResponse(error.statusCode, { error: error.message })
    const classified = asOrchestrationError(error)
    if (classified)
      return internalErrorResponse(statusForOrchestrationError(classified.code), {
        error: classified.message,
      })
    return internalOrchestrationErrorPolicy.project(error)
  },
  unhandled: internalOrchestrationErrorPolicy.unhandled,
}
