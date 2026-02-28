import type { MailSendParams, MailSendResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

export const resendSendTool: ToolConfig<MailSendParams, MailSendResult> = {
  id: 'resend_send',
  name: 'Send Email',
  description: 'Send an email using your own Resend API key and from address',
  version: '1.0.0',

  params: {
    fromAddress: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Email address to send from (e.g., "sender@example.com" or "Sender Name <sender@example.com>")',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Recipient email address (e.g., "recipient@example.com" or "Recipient Name <recipient@example.com>")',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject line',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email body content (plain text or HTML based on contentType)',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Content type for the email body: "text" for plain text or "html" for HTML content',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Carbon copy recipient email address',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Blind carbon copy recipient email address',
    },
    replyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply-to email address',
    },
    scheduledAt: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Schedule email to be sent later in ISO 8601 format',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Comma-separated key:value pairs for email tags (e.g., "category:welcome,type:onboarding")',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key for sending emails',
    },
  },

  request: {
    url: '/api/tools/mail/send',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: MailSendParams) => ({
      resendApiKey: params.resendApiKey,
      fromAddress: params.fromAddress,
      to: params.to,
      subject: params.subject,
      body: params.body,
      contentType: params.contentType || 'text',
      ...(params.cc && { cc: params.cc }),
      ...(params.bcc && { bcc: params.bcc }),
      ...(params.replyTo && { replyTo: params.replyTo }),
      ...(params.scheduledAt && { scheduledAt: params.scheduledAt }),
      ...(params.tags && { tags: params.tags }),
    }),
  },

  transformResponse: async (response: Response, params): Promise<MailSendResult> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        success: result.success,
        id: result.data?.id || '',
        to: params?.to || '',
        subject: params?.subject || '',
        body: params?.body || '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    id: { type: 'string', description: 'Email ID returned by Resend' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
    body: { type: 'string', description: 'Email body content' },
  },
}
