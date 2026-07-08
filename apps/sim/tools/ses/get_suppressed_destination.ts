import type {
  SESGetSuppressedDestinationParams,
  SESGetSuppressedDestinationResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const getSuppressedDestinationTool: ToolConfig<
  SESGetSuppressedDestinationParams,
  SESGetSuppressedDestinationResponse
> = {
  id: 'ses_get_suppressed_destination',
  name: 'SES Get Suppressed Destination',
  description: 'Retrieve details for a specific email address on the SES suppression list',
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
    emailAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The suppressed email address to look up',
    },
  },

  request: {
    url: '/api/tools/ses/get-suppressed-destination',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      emailAddress: params.emailAddress,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to get suppressed destination')
    }

    return {
      success: true,
      output: {
        emailAddress: data.emailAddress ?? '',
        reason: data.reason ?? '',
        lastUpdateTime: data.lastUpdateTime ?? null,
        messageId: data.messageId ?? null,
        feedbackId: data.feedbackId ?? null,
      },
    }
  },

  outputs: {
    emailAddress: { type: 'string', description: 'The suppressed email address' },
    reason: { type: 'string', description: 'The reason the address is suppressed' },
    lastUpdateTime: {
      type: 'string',
      description: 'When the address was added to the suppression list',
      optional: true,
    },
    messageId: {
      type: 'string',
      description: 'The message ID associated with the bounce or complaint event',
      optional: true,
    },
    feedbackId: {
      type: 'string',
      description: 'The feedback ID associated with the bounce or complaint event',
      optional: true,
    },
  },
}
