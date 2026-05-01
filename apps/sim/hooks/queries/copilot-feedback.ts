import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type SubmitCopilotFeedbackBody,
  type SubmitCopilotFeedbackResult,
  submitCopilotFeedbackContract,
} from '@/lib/api/contracts'

const logger = createLogger('CopilotFeedbackMutation')

export function useSubmitCopilotFeedback() {
  return useMutation({
    mutationFn: async (
      variables: SubmitCopilotFeedbackBody
    ): Promise<SubmitCopilotFeedbackResult> => {
      return requestJson(submitCopilotFeedbackContract, { body: variables })
    },
    onError: (error) => {
      logger.error('Failed to submit copilot feedback:', error)
    },
  })
}
