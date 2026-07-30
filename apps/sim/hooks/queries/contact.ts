import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SubmitContactBody,
  type SubmitContactResult,
  submitContactContract,
} from '@/lib/api/contracts/contact'

const logger = createLogger('ContactMutation')

/**
 * Submit an inbound contact request. The route emails the help inbox (replying to
 * the visitor) and sends the visitor a confirmation. Used by the public `/contact`
 * form; the honeypot and captcha fields ride along on the same payload.
 */
export function useSubmitContact() {
  return useMutation({
    mutationFn: (variables: SubmitContactBody): Promise<SubmitContactResult> =>
      requestJson(submitContactContract, { body: variables }),
    onError: (error) => {
      logger.error('Failed to submit contact request:', error)
    },
  })
}
