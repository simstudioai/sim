import type {
  SESDeleteSuppressedDestinationParams,
  SESDeleteSuppressedDestinationResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const deleteSuppressedDestinationTool: ToolConfig<
  SESDeleteSuppressedDestinationParams,
  SESDeleteSuppressedDestinationResponse
> = {
  id: 'ses_delete_suppressed_destination',
  name: 'SES Delete Suppressed Destination',
  description: 'Remove an email address from the account-level SES suppression list',
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
      description: 'The email address to remove from the suppression list',
    },
  },

  request: {
    url: '/api/tools/ses/delete-suppressed-destination',
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
      throw new Error(data.error || 'Failed to remove suppressed destination')
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
