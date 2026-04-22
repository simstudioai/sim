import type { SESSendEmailParams, SESSendEmailResponse } from '@/tools/ses/types'
import type { ToolConfig } from '@/tools/types'

export const sendEmailTool: ToolConfig<SESSendEmailParams, SESSendEmailResponse> = {
  id: 'ses_send_email',
  name: 'SES Send Email',
  description: 'Send an email via AWS SES using simple or HTML content',
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
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject line',
    },
    bodyText: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text email body',
    },
    bodyHtml: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML email body',
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
    replyToAddresses: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Comma-separated list of reply-to email addresses',
    },
    configurationSetName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SES configuration set name for tracking',
    },
  },

  request: {
    url: '/api/tools/ses/send-email',
    method: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    body: (params) => ({
      region: params.region,
      accessKeyId: params.accessKeyId,
      secretAccessKey: params.secretAccessKey,
      fromAddress: params.fromAddress,
      toAddresses: params.toAddresses,
      subject: params.subject,
      bodyText: params.bodyText,
      bodyHtml: params.bodyHtml,
      ccAddresses: params.ccAddresses,
      bccAddresses: params.bccAddresses,
      replyToAddresses: params.replyToAddresses,
      configurationSetName: params.configurationSetName,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error || 'Failed to send email')
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
