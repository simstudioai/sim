import type { SmtpSendMailParams, SmtpSendMailResult } from '@/tools/smtp/types'
import type { ToolConfig } from '@/tools/types'

export const smtpSendMailTool: ToolConfig<SmtpSendMailParams, SmtpSendMailResult> = {
  id: 'smtp_send_mail',
  name: 'SMTP Send Mail',
  description: 'Send emails via SMTP server',
  version: '1.0.0',

  params: {
    smtpHost: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SMTP server hostname (e.g., smtp.gmail.com)',
    },
    smtpPort: {
      type: 'number',
      required: true,
      visibility: 'user-only',
      description: 'SMTP server port (587 for TLS, 465 for SSL)',
    },
    smtpUsername: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SMTP authentication username',
    },
    smtpPassword: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'SMTP authentication password',
    },
    smtpSecure: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Security protocol (TLS, SSL, or None)',
    },

    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sender email address',
    },
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
    contentType: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Content type (text or html)',
    },

    // Optional Fields
    fromName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Display name for sender',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'CC recipients (comma-separated)',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'BCC recipients (comma-separated)',
    },
    replyTo: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Reply-to email address',
    },
    attachments: {
      type: 'file[]',
      required: false,
      visibility: 'user-only',
      description: 'Files to attach to the email',
    },
  },

  request: {
    url: '/api/tools/smtp/send',
    method: 'POST',
    headers: () => ({
      'Content-Type': 'application/json',
    }),
    body: (params: SmtpSendMailParams) => ({
      smtpHost: params.smtpHost,
      smtpPort: params.smtpPort,
      smtpUsername: params.smtpUsername,
      smtpPassword: params.smtpPassword,
      smtpSecure: params.smtpSecure,
      from: params.from,
      to: params.to,
      subject: params.subject,
      body: params.body,
      contentType: params.contentType || 'text',
      fromName: params.fromName,
      cc: params.cc,
      bcc: params.bcc,
      replyTo: params.replyTo,
      attachments: params.attachments,
    }),
  },

  transformResponse: async (response) => {
    const data = await response.json()

    if (!response.ok) {
      return {
        success: false,
        output: {
          success: false,
        },
        error: data.error || 'Failed to send email via SMTP',
      }
    }

    return {
      success: true,
      output: {
        success: true,
        messageId: data.messageId,
        to: data.to,
        subject: data.subject,
      },
    }
  },

  outputs: {
    success: {
      type: 'boolean',
      description: 'Whether the email was sent successfully',
    },
    messageId: {
      type: 'string',
      description: 'Message ID from SMTP server',
    },
    to: {
      type: 'string',
      description: 'Recipient email address',
    },
    subject: {
      type: 'string',
      description: 'Email subject',
    },
    error: {
      type: 'string',
      description: 'Error message if sending failed',
    },
  },
}
