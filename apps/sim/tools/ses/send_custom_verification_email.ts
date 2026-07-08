import type {
  SESSendCustomVerificationEmailParams,
  SESSendCustomVerificationEmailResponse,
} from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const sendCustomVerificationEmailTool: ToolConfig<
  SESSendCustomVerificationEmailParams,
  SESSendCustomVerificationEmailResponse
> = {
  id: 'ses_send_custom_verification_email',
  name: 'SES Send Custom Verification Email',
  description:
    'Send a branded custom verification email to an address using a custom verification email template',
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
      description: 'The email address to verify',
    },
    templateName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The name of the custom verification email template to use',
    },
    configurationSetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Configuration set to use when sending the verification email',
    },
  },

  request: {
    url: '/api/tools/ses/send-custom-verification-email',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      emailAddress: params.emailAddress,
      templateName: params.templateName,
      configurationSetName: params.configurationSetName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send custom verification email')
    }

    return {
      success: true,
      output: {
        messageId: data.messageId ?? '',
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'SES message ID for the sent verification email' },
  },
}
