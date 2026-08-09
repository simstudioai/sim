import { createV2ResourceConcealmentPolicy, type V2ErrorPolicy } from '@/lib/api/server/routes'
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
  concealTableAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Table not found',
    render: renderTableError,
  }),
  concealImportAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Table import not found',
    render: renderTableError,
  }),
  concealExportAuthorization: createV2ResourceConcealmentPolicy({
    notFoundMessage: 'Table export not found',
    render: renderTableError,
  }),
} as const
