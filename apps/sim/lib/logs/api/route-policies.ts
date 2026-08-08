import { type V2ErrorPolicy, v2OrchestrationErrorPolicy } from '@/lib/api/server/routes'
import { v2CaughtOrchestrationError, v2Error } from '@/app/api/v2/lib/response'

export const v2LogErrorPolicies = {
  default: v2OrchestrationErrorPolicy,
  concealDetailAuthorization: {
    render(error) {
      const response = v2CaughtOrchestrationError(error)
      if (!response) return null
      if (response.status === 403) return v2Error('NOT_FOUND', 'Log not found')
      return response
    },
  } satisfies V2ErrorPolicy,
} as const
