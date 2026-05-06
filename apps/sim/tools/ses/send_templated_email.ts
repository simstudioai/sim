import type { SESSendTemplatedEmailParams, SESSendTemplatedEmailResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const sendTemplatedEmailTool: ToolConfig<
  SESSendTemplatedEmailParams,
  SESSendTemplatedEmailResponse
> = {
  id: 'ses_send_templated_email',
  name: 'SES Send Templated Email',
  description: 'Send an email using an SES email template with dynamic template data',
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
    fromAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Verified sender email address',
    },
    toAddresses: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of recipient email addresses',
    },
    templateName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Name of the SES email template to use',
    },
    templateData: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'JSON string of key-value pairs for template variable substitution',
    },
    ccAddresses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of CC email addresses',
    },
    bccAddresses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of BCC email addresses',
    },
    configurationSetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SES configuration set name for tracking',
    },
  },

  request: {
    url: '/api/tools/ses/send-templated-email',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      fromAddress: params.fromAddress,
      toAddresses: params.toAddresses,
      templateName: params.templateName,
      templateData: params.templateData,
      ccAddresses: params.ccAddresses,
      bccAddresses: params.bccAddresses,
      configurationSetName: params.configurationSetName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send templated email')
    }

    return {
      success: true,
      output: {
        messageId: data.messageId ?? '',
      },
    }
  },

  outputs: {
    messageId: { type: 'string', description: 'SES message ID for the sent email' },
  },
}
