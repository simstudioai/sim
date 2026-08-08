import type { V2ErrorPolicy } from '@/lib/api/server/routes'
import { TableOperationError } from '@/lib/table/application/errors'
import { TableLockedError } from '@/lib/table/mutation-locks'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2ErrorForOrchestration,
} from '@/app/api/v2/lib/response'

function renderTableError(error: unknown) {
  if (error instanceof TableOperationError) {
    return v2ErrorForOrchestration(
      error.code,
      error.message,
      error.code === 'locked'
        ? { ...(error.lock ? { lock: error.lock } : {}), ...error.details }
        : error.details
    )
  }
  if (error instanceof TableLockedError) {
    return v2Error('LOCKED', error.message, { details: { lock: error.lock } })
  }
  return v2CaughtOrchestrationError(error)
}

export const v2TableErrorPolicies = {
  default: {
    render: renderTableError,
  } satisfies V2ErrorPolicy,
  concealTableAuthorization: {
    render(error) {
      const response = renderTableError(error)
      if (!response) return null
      if (response.status === 403) return v2Error('NOT_FOUND', 'Table not found')
      return response
    },
  } satisfies V2ErrorPolicy,
  concealImportAuthorization: {
    render(error) {
      const response = renderTableError(error)
      if (!response) return null
      if (response.status === 403) return v2Error('NOT_FOUND', 'Table import not found')
      return response
    },
  } satisfies V2ErrorPolicy,
  concealExportAuthorization: {
    render(error) {
      const response = renderTableError(error)
      if (!response) return null
      if (response.status === 403) return v2Error('NOT_FOUND', 'Table export not found')
      return response
    },
  } satisfies V2ErrorPolicy,
} as const
