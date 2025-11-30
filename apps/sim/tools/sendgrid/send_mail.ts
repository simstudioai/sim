import type {
  SendGridMailBody,
  SendGridPersonalization,
  SendMailParams,
  SendMailResult,
} from '@/tools/sendgrid/types'
import type { ToolConfig } from '@/tools/types'

export const sendGridSendMailTool: ToolConfig<SendMailParams, SendMailResult> = {
  id: 'sendgrid_send_mail',
  name: 'SendGrid Send Mail',
  description: 'Send an email using SendGrid API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SendGrid API key',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sender email address (must be verified in SendGrid)',
    },
    fromName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sender name',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient email address',
    },
    toName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Recipient name',
    },
    subject: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email subject (required unless using a template with pre-defined subject)',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Email body content (required unless using a template with pre-defined content)',
    },
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type (text/plain or text/html)',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC email address',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC email address',
    },
    replyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply-to email address',
    },
    replyToName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply-to name',
    },
    attachments: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the email',
    },
    templateId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'SendGrid template ID to use',
    },
    dynamicTemplateData: {
      type: 'json',
      required: false,
      visibility: 'user-or-llm',
      description: 'JSON object of dynamic template data',
    },
  },

  request: {
    url: () => 'https://api.sendgrid.com/v3/mail/send',
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
    }),
    body: (params) => {
      const personalizations: SendGridPersonalization = {
        to: [
          {
            email: params.to,
            ...(params.toName && { name: params.toName }),
          },
        ],
      }

      if (params.cc) {
        personalizations.cc = [{ email: params.cc }]
      }

      if (params.bcc) {
        personalizations.bcc = [{ email: params.bcc }]
      }

      if (params.templateId && params.dynamicTemplateData) {
        try {
          personalizations.dynamic_template_data =
            typeof params.dynamicTemplateData === 'string'
              ? JSON.parse(params.dynamicTemplateData)
              : params.dynamicTemplateData
        } catch (e) {
          // If parsing fails, use as-is
        }
      }

      const mailBody: SendGridMailBody = {
        personalizations: [personalizations],
        from: {
          email: params.from,
          ...(params.fromName && { name: params.fromName }),
        },
        subject: params.subject,
      }

      if (params.templateId) {
        mailBody.template_id = params.templateId
      } else {
        mailBody.content = [
          {
            type: params.contentType || 'text/plain',
            value: params.content,
          },
        ]
      }

      if (params.replyTo) {
        mailBody.reply_to = {
          email: params.replyTo,
          ...(params.replyToName && { name: params.replyToName }),
        }
      }

      if (params.attachments) {
        try {
          mailBody.attachments =
            typeof params.attachments === 'string'
              ? JSON.parse(params.attachments)
              : params.attachments
        } catch (e) {
          // If parsing fails, skip attachments
        }
      }

      return { body: JSON.stringify(mailBody) }
    },
  },

  transformResponse: async (response, params): Promise<SendMailResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.errors?.[0]?.message || 'Failed to send email')
    }

    // SendGrid returns 202 Accepted with X-Message-Id header
    const messageId = response.headers.get('X-Message-Id')

    return {
      success: true,
      output: {
        success: true,
        messageId: messageId || undefined,
        to: params?.to || '',
        subject: params?.subject || '',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    messageId: { type: 'string', description: 'SendGrid message ID' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
  },
}
