import { getPostgresCancellationReason } from '@sim/utils/errors'
import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import { DatabaseReadDeadlineError, isTransientDatabaseReadError } from '@/lib/db/read-retry'

/** Presents known temporary read failures as retryable 503s without masking permanent errors. */
export const internalBillingReadErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    const cancellationReason = getPostgresCancellationReason(error)
    if (
      !(error instanceof DatabaseReadDeadlineError) &&
      !isTransientDatabaseReadError(error) &&
      cancellationReason !== 'statement_timeout' &&
      cancellationReason !== 'transaction_timeout'
    )
      return null
    return internalErrorResponse(
      503,
      { error: 'Billing information is temporarily unavailable. Please try again.' },
      { 'Retry-After': '5' }
    )
  }
)
