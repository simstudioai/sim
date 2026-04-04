import { createLogger } from '@sim/logger'
import { useMutation } from '@tanstack/react-query'

const logger = createLogger('CopilotFeedbackMutation')

interface SubmitFeedbackVariables {
  chatId: string
  userQuery: string
  agentResponse: string
  isPositiveFeedback: boolean
  feedback?: string
}

interface SubmitFeedbackResponse {
  success: boolean
  feedbackId: string
}

export function useSubmitCopilotFeedback() {
  return useMutation({
    mutationFn: async (variables: SubmitFeedbackVariables): Promise<SubmitFeedbackResponse> => {
      const response = await fetch('/api/copilot/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(variables),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to submit feedback')
      }

      return response.json()
    },
    onError: (error) => {
      logger.error('Failed to submit copilot feedback:', error)
    },
  })
}
