import {
  extendInternalErrorPolicy,
  internalErrorResponse,
  internalOrchestrationErrorPolicy,
} from '@/lib/api/server/routes/internal-json-route'
import { isDatabaseReadUnavailable } from '@/lib/db/read-retry'

/** Presents known temporary read failures as retryable 503s without masking permanent errors. */
export const internalBillingReadErrorPolicy = extendInternalErrorPolicy(
  internalOrchestrationErrorPolicy,
  (error) => {
    if (!isDatabaseReadUnavailable(error)) return null
    return internalErrorResponse(
      503,
      { error: 'Billing information is temporarily unavailable. Please try again.' },
      { 'Retry-After': '5' }
    )
  }
)
