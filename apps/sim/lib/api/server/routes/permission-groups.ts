import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import {
  PermissionGroupBusyError,
  PermissionGroupOrganizationNotFoundError,
} from '@/lib/permission-groups/errors'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const internalPermissionGroupErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (error instanceof PermissionGroupOrganizationNotFoundError)
      return internalErrorResponse(403, { error: 'Admin permissions required' })
    if (error instanceof PermissionGroupBusyError)
      return internalErrorResponse(503, { error: error.message }, { 'Retry-After': '5' })
    return null
  }
)

export const v2PermissionGroupErrorPolicy: V2ErrorPolicy = {
  render(error) {
    if (error instanceof PermissionGroupBusyError)
      return v2Error('SERVICE_UNAVAILABLE', error.message)
    return v2CaughtOrchestrationError(error)
  },
}
