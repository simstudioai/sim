import {
  createInternalResourceConcealmentPolicy,
  internalErrorResponse,
} from '@/lib/api/server/routes'
import { InternalUnauthenticatedError } from '@/lib/api/server/routes/internal-json-route'
import {
  InsufficientWorkspacePermissionsError,
  NoWorkspaceAccessError,
} from '@/lib/core/application/workspace-authorization'
import { OrchestrationError, statusForOrchestrationError } from '@/lib/core/orchestration/types'
import { CustomBlockValidationError } from '@/lib/workflows/custom-blocks/operations'

export function customBlockError(error: unknown, read = false) {
  if (error instanceof InternalUnauthenticatedError)
    return internalErrorResponse(401, { error: 'Unauthorized' })
  if (
    error instanceof InsufficientWorkspacePermissionsError ||
    error instanceof NoWorkspaceAccessError
  )
    return internalErrorResponse(403, {
      error: read ? 'Access denied' : 'Admin permissions required',
    })
  if (error instanceof CustomBlockValidationError)
    return internalErrorResponse(400, { error: error.message })
  if (error instanceof OrchestrationError)
    return internalErrorResponse(statusForOrchestrationError(error.code), { error: error.message })
  return null
}

export const customBlockResourceErrorPolicy = createInternalResourceConcealmentPolicy({
  base: { project: customBlockError },
  notFoundMessage: 'Custom block not found',
})
