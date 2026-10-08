import {
  createInternalResourceConcealmentPolicy,
  createInternalSessionOrExecutorAuth,
  createV2ResourceConcealmentPolicy,
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
  type V2ErrorPolicy,
} from '@/lib/api/server/routes'
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
  /**
   * Workspace-scoped bulk routes. Deliberately NOT a concealment policy: these
   * routes name a workspace, not one table, so there is no table whose
   * existence a 403 could betray, and per-item authorization failures are
   * already folded into the response's `notFound` list by the use case. The
   * same reasoning {@link internalTableErrorPolicies.bulk} is built on.
   */
  bulk: {
    render: renderTableError,
  } satisfies V2ErrorPolicy,
} as const

const internalTableGroupErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) =>
    error instanceof TableLockedError
      ? internalErrorResponse(423, { error: error.message, lock: error.lock })
      : null
)

/**
 * Internal-surface counterparts of {@link v2TableErrorPolicies}. The internal
 * routes reach the same table use cases, so they conceal the same cross-tenant
 * authorization failures behind the same not-found wording.
 */
export const internalTableErrorPolicies = {
  /**
   * Workspace-scoped bulk routes. They name a workspace, not one table, so
   * there is no table whose existence a 403 could betray — per-item
   * authorization failures are already folded into the response's `notFound`
   * list by the use case. A lock that escapes the per-item classifier still
   * renders as 423.
   */
  bulk: internalTableGroupErrorPolicy,
  concealTableAuthorization: createInternalResourceConcealmentPolicy({
    base: internalOrchestrationErrorPolicy,
    notFoundMessage: 'Table not found',
  }),
  concealTableGroupAuthorization: createInternalResourceConcealmentPolicy({
    base: internalTableGroupErrorPolicy,
    notFoundMessage: 'Table not found',
  }),
  concealImportAuthorization: createInternalResourceConcealmentPolicy({
    base: internalOrchestrationErrorPolicy,
    notFoundMessage: 'Table import not found',
  }),
  concealExportAuthorization: createInternalResourceConcealmentPolicy({
    base: internalOrchestrationErrorPolicy,
    notFoundMessage: 'Table export not found',
  }),
} as const
