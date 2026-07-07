import type {
  SESPutSuppressedDestinationParams,
  SESPutSuppressedDestinationResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const putSuppressedDestinationTool: ToolConfig<
  SESPutSuppressedDestinationParams,
  SESPutSuppressedDestinationResponse
> = {
  id: 'ses_put_suppressed_destination',
  name: 'SES Put Suppressed Destination',
  description: 'Add an email address to the account-level SES suppression list',
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
      description: 'The email address to add to the suppression list',
    },
    reason: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The reason the address is suppressed: BOUNCE or COMPLAINT',
    },
  },

  request: {
    url: '/api/tools/ses/put-suppressed-destination',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      emailAddress: params.emailAddress,
      reason: params.reason,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to add suppressed destination')
    }

    return {
      success: true,
      output: {
        message: data.message ?? '',
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Confirmation message' },
  },
}
