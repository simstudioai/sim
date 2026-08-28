import type { SESGetAccountParams, SESGetAccountResponse } from '@/tools/ses/types'
import type { InternalToolConfig } from '@/tools/types'

export const getAccountTool: InternalToolConfig<SESGetAccountParams, SESGetAccountResponse> = {
  id: 'ses_get_account',
  name: 'SES Get Account',
  description: 'Get SES account sending quota and status information',
  version: '1.0.0',

  params: {
    region: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS region (e.g., us-east-1)',
    },
    accessKeyId: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS access key ID',
    },
    secretAccessKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'AWS secret access key',
    },
  },

  operation: {
    input: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get account information')
    }

    return {
      success: true,
      output: {
        sendingEnabled: data.sendingEnabled ?? false,
        max24HourSend: data.max24HourSend ?? 0,
        maxSendRate: data.maxSendRate ?? 0,
        sentLast24Hours: data.sentLast24Hours ?? 0,
      },
    }
  },

  outputs: {
    sendingEnabled: {
      type: 'boolean',
      description: 'Whether email sending is enabled for the account',
    },
    max24HourSend: { type: 'number', description: 'Maximum emails allowed per 24-hour period' },
    maxSendRate: { type: 'number', description: 'Maximum emails allowed per second' },
    sentLast24Hours: { type: 'number', description: 'Number of emails sent in the last 24 hours' },
  },
}
