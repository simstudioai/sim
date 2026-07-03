import { createLogger } from '@sim/logger'
import type { CancelEmailParams, CancelEmailResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendCancelEmailTool')

export const resendCancelEmailTool: ToolConfig<CancelEmailParams, CancelEmailResult> = {
  id: 'resend_cancel_email',
  name: 'Cancel Email',
  description: 'Cancel a scheduled email before it is sent',
  version: '1.0.0',

  params: {
    cancelEmailId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the scheduled email to cancel',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: CancelEmailParams) =>
      `https://api.resend.com/emails/${encodeURIComponent(params.cancelEmailId.trim())}/cancel`,
    method: 'POST',
    headers: (params: CancelEmailParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<CancelEmailResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Cancel Email API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to cancel email',
        output: {
          id: '',
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Canceled email ID' },
  },
}
