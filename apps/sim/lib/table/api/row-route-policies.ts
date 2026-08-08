import type { V2ErrorPolicy } from '@/lib/api/server/routes'
import { v2TableErrorPolicies } from '@/lib/table/api/route-policies'
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
