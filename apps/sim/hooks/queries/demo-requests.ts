import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type DemoRequestBody,
  type DemoRequestResult,
  submitDemoRequestContract,
} from '@/lib/api/contracts/demo-requests'
import { captureClientEvent } from '@/lib/posthog/client'

const logger = createLogger('DemoRequestMutation')

/**
 * Submit an inbound demo request. The route notifies the sales inbox
 * (`enterprise@`, replying to the visitor) — no email is sent to the visitor.
 * Used as a best-effort notification from the demo-booking flow: failures are
 * logged and never block the visitor from scheduling.
 */
export function useSubmitDemoRequest() {
  return useMutation({
    mutationFn: async (variables: DemoRequestBody): Promise<DemoRequestResult> => {
      return requestJson(submitDemoRequestContract, { body: variables })
    },
    onSuccess: (_result, variables) => {
      captureClientEvent('landing_demo_request_submitted', {
        company_size: variables.companySize,
      })
    },
    onError: (error) => {
      logger.error('Failed to submit demo request:', error)
    },
  })
}
