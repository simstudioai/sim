import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes/resource-concealment'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'
import { IntegrationNotAllowedError } from '@/ee/access-control/utils/permission-check'

export const v2SelectorErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: 'Selector scope not found',
  render(error) {
    if (error instanceof SelectorContextUnavailableError)
      return v2Error('BAD_REQUEST', 'Context unavailable')
    if (error instanceof SelectorConnectionUnavailableError)
      return v2Error(
        'FORBIDDEN',
        'Connection unavailable. Connect or authorize an accessible OAuth connection before continuing.',
        {
          details: { reason: 'connection_required', humanAuthorizationMayBeRequired: true },
        }
      )
    if (error instanceof IntegrationNotAllowedError) return v2Error('FORBIDDEN', error.message)
    if (error instanceof SelectorOptionsUnavailableError)
      return v2Error(
        error.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR',
        'Selector options unavailable'
      )
    return v2CaughtOrchestrationError(error)
  },
})
