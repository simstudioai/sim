import { getPostgresCancellationReason } from '@sim/utils/errors'
import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import { isTransientDatabaseReadError } from '@/lib/db/read-retry'

export const internalBillingReadErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (
      !isTransientDatabaseReadError(error) &&
      getPostgresCancellationReason(error) !== 'statement_timeout'
    )
      return null
    return internalErrorResponse(
      503,
      { error: 'Billing information is temporarily unavailable. Please try again.' },
      { 'Retry-After': '5' }
    )
  }
)
