import type { MailSendParams, MailSendResult } from '@/tools/mail/types'
import type { ToolConfig } from '@/tools/types'

export const mailSendTool: ToolConfig<MailSendParams, MailSendResult> = {
  id: 'mail_send',
  name: 'Send Email',
  description:
    'Send an email using the internal mail service without requiring OAuth or external configuration',
  version: '1.0.0',

  params: {
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject',
    },
    body: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email body content',
    },
  },

  request: {
    url: '/api/tools/mail/send',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: MailSendParams) => ({
      to: params.to,
      subject: params.subject,
      body: params.body,
    }),
  },

  transformResponse: async (response: Response): Promise<MailSendResult> => {
    const result = await response.json()

    return {
      success: true,
      output: {
        success: result.success,
        message: result.message,
        data: result.data,
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    message: { type: 'string', description: 'Result message from the mail service' },
    data: { type: 'json', description: 'Additional response data from the mail service' },
  },
}
