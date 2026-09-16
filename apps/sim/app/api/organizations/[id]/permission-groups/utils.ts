import {
  type InternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes'
import { PermissionGroupContentionError } from '@/lib/permission-groups/application/management-errors'

/** Retains each settings route's retry status and generic failure message. */
export function permissionGroupErrorPolicy(fallback: string): InternalErrorPolicy {
  return {
    project(error) {
      if (error instanceof PermissionGroupContentionError) {
        return internalErrorResponse(503, { error: error.message })
      }
      return internalOrchestrationErrorPolicy.project(error)
    },
    unhandled: () => internalErrorResponse(500, { error: fallback }),
  }
}
