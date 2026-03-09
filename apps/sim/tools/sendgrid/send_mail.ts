import type { SendMailParams, SendMailResult } from '@/tools/sendgrid/types'
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
      visibility: 'user-or-llm',
      description: 'Files to attach to the email (UserFile objects)',
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
    url: '/api/tools/sendgrid/send-mail',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params) => ({
      apiKey: params.apiKey,
      from: params.from,
      fromName: params.fromName,
      to: params.to,
      toName: params.toName,
      subject: params.subject,
      content: params.content,
      contentType: params.contentType,
      cc: params.cc,
      bcc: params.bcc,
      replyTo: params.replyTo,
      replyToName: params.replyToName,
      templateId: params.templateId,
      dynamicTemplateData: params.dynamicTemplateData,
      attachments: params.attachments,
    }),
  },

  transformResponse: async (response): Promise<SendMailResult> => {
    const data = await response.json()

    if (!data.success) {
      return {
        success: false,
        output: {
          success: false,
          messageId: undefined,
          to: '',
          subject: '',
        },
        error: data.error || 'Failed to send email',
      }
    }

    return {
      success: true,
      output: data.output,
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the email was sent successfully' },
    messageId: { type: 'string', description: 'SendGrid message ID' },
    to: { type: 'string', description: 'Recipient email address' },
    subject: { type: 'string', description: 'Email subject' },
  },
}
