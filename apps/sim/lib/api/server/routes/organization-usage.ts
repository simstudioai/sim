import { v2OrganizationErrorPolicy } from '@/lib/api/server/routes/organizations'
import type { V2ErrorPolicy } from '@/lib/api/server/routes/v2-json-route'
import {
  UsageWindowRangeInvertedError,
  UsageWindowRangeTooLargeError,
} from '@/lib/billing/core/usage-analytics'
import { v2Error } from '@/app/api/v2/lib/response'

export const v2OrganizationUsageErrorPolicy: V2ErrorPolicy = {
  render(error) {
    if (
      error instanceof UsageWindowRangeInvertedError ||
      error instanceof UsageWindowRangeTooLargeError
    ) {
      return v2Error('BAD_REQUEST', error.message)
    }
    return v2OrganizationErrorPolicy.render(error)
  },
}
