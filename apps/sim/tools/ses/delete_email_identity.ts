import type {
  SESDeleteEmailIdentityParams,
  SESDeleteEmailIdentityResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const deleteEmailIdentityTool: ToolConfig<
  SESDeleteEmailIdentityParams,
  SESDeleteEmailIdentityResponse
> = {
  id: 'ses_delete_email_identity',
  name: 'SES Delete Email Identity',
  description: 'Delete a verified SES email address or domain identity',
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
    emailIdentity: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The email address or domain identity to delete',
    },
  },

  request: {
    url: '/api/tools/ses/delete-email-identity',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      emailIdentity: params.emailIdentity,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to delete email identity')
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
