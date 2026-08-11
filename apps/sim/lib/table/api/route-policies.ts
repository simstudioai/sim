import { createInternalSessionOrExecutorAuth, type V2ErrorPolicy } from '@/lib/api/server/routes'
import { TABLE_DELEGATION_AUDIENCE } from '@/lib/table/application/authorization'
import { TableOperationError } from '@/lib/table/application/errors'
import { TableLockedError } from '@/lib/table/mutation-locks'
import {
  v2CaughtOrchestrationError,
  v2Error,
  v2ErrorForOrchestration,
} from '@/app/api/v2/lib/response'

export const internalTableSessionOrExecutorAuth = createInternalSessionOrExecutorAuth({
  audience: TABLE_DELEGATION_AUDIENCE,
  resourceScope: (params) => {
    const tableId = typeof params.tableId === 'string' ? params.tableId : undefined
    return tableId ? { tableId } : undefined
  },
})

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
} as const
