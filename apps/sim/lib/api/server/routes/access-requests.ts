import { createV2ResourceConcealmentPolicy } from '@/lib/api/server/routes/resource-concealment'
import { asOrchestrationError } from '@/lib/core/orchestration/types'
import { isRetryableTransactionError } from '@/lib/db/transaction'
import { PermissionGroupBusyError } from '@/lib/permission-groups/errors'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

const NOT_FOUND_MESSAGE = 'Access request scope not found'

export const v2AccessRequestErrorPolicy = createV2ResourceConcealmentPolicy({
  notFoundMessage: NOT_FOUND_MESSAGE,
  render(error) {
    if (asOrchestrationError(error)?.code === 'not_found')
      return v2Error('NOT_FOUND', NOT_FOUND_MESSAGE)
    if (error instanceof PermissionGroupBusyError || isRetryableTransactionError(error))
      return v2Error('SERVICE_UNAVAILABLE', 'The organization is busy; retry in a moment')
    return v2CaughtOrchestrationError(error)
  },
})
