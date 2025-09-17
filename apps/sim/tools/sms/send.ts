import type { SMSSendParams, SMSSendResult } from '@/tools/sms/types'
import type { ToolConfig } from '@/tools/types'

export const smsSendTool: ToolConfig<SMSSendParams, SMSSendResult> = {
  id: 'sms_send',
  name: 'Send SMS',
  description: 'Send an SMS message using the internal SMS service powered by Twilio',
  version: '1.0.0',

  params: {
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number (include country code, e.g., +1234567890)',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'SMS message content',
    },
  },

  request: {
    url: '/api/tools/sms/send',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SMSSendParams) => ({
      to: params.to,
      body: params.body,
    }),
  },

  transformResponse: async (response: Response, params): Promise<SMSSendResult> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        success: result.success,
        to: params?.to || '',
        body: params?.body || '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the SMS was sent successfully' },
    to: { type: 'string', description: 'Recipient phone number' },
    body: { type: 'string', description: 'SMS message content' },
  },
}
