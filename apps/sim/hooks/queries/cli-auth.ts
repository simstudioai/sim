import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type ApproveCliAuthBody,
  type ApproveCliAuthResult,
  approveCliAuthContract,
} from '@/lib/api/contracts'

const logger = createLogger('CliAuthQuery')

/** No cache to invalidate: the code is redeemed once, server-side. */
export function useApproveCliAuth() {
  return useMutation({
    mutationFn: async (variables: ApproveCliAuthBody): Promise<ApproveCliAuthResult> => {
      return requestJson(approveCliAuthContract, { body: variables })
    },
    onError: (error) => {
      logger.error('Failed to approve CLI authentication:', error)
    },
  })
}
