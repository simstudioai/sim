import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  type V2ErrorPolicy,
} from '@/lib/api/server/routes'
import { internalTableErrorPolicies, v2TableErrorPolicies } from '@/lib/table/api/route-policies'
import { TableRowProvenanceError } from '@/lib/table/application/row-secret-provenance'
import { TableRowsValidationError } from '@/lib/table/application/rows'
import { v2Error } from '@/app/api/v2/lib/response'

export const v2TableRowsErrorPolicy = {
  render(error) {
    if (error instanceof TableRowsValidationError) {
      return v2Error('BAD_REQUEST', error.message, { details: error.details })
    }
    return v2TableErrorPolicies.concealTableAuthorization.render(error)
  },
} satisfies V2ErrorPolicy

/**
 * Row routes on the internal surface. The internal counterpart of
 * {@link v2TableRowsErrorPolicy}: a row-shape complaint and a provenance
 * envelope that does not authenticate are both the caller's to fix and answer
 * 400; everything else conceals a cross-tenant table behind the same not-found
 * wording the rest of the table surface uses.
 *
 * Built on the lock-aware base so a 423 keeps carrying `lock` — the only field
 * that tells a client which lock to clear. A row write is exactly as lockable
 * as a group mutation.
 */
export const internalTableRowsErrorPolicy = extendInternalErrorPolicy(
  internalTableErrorPolicies.concealTableGroupAuthorization,
  (error) =>
    error instanceof TableRowsValidationError || error instanceof TableRowProvenanceError
      ? internalErrorResponse(400, { error: error.message })
      : null
)
