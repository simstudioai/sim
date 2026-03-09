import type { SendMessageParams, SendMessageResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunSendMessageTool: ToolConfig<SendMessageParams, SendMessageResult> = {
  id: 'mailgun_send_message',
  name: 'Mailgun Send Message',
  description: 'Send an email using Mailgun API',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun API key',
    },
    domain: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailgun sending domain (e.g., mg.example.com)',
    },
    from: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Sender email address (e.g., sender@example.com or "Name <sender@example.com>")',
    },
    to: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Recipient email address (e.g., user@example.com). Use comma-separated values for multiple recipients',
    },
    subject: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Email subject line',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Plain text body of the email',
    },
    html: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'HTML body of the email (e.g., "<h1>Hello</h1><p>Message content</p>")',
    },
    cc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'CC recipient email address (e.g., cc@example.com). Use comma-separated values for multiple recipients',
    },
    bcc: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'BCC recipient email address (e.g., bcc@example.com). Use comma-separated values for multiple recipients',
    },
    tags: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Tags for the email (comma-separated)',
    },
  },

  request: {
    url: (params) => `https://api.mailgun.net/v3/${params.domain}/messages`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
    body: (params) => {
      const formData = new FormData()
      formData.append('from', params.from)
      formData.append('to', params.to)
      formData.append('subject', params.subject)

      if (params.text) {
        formData.append('text', params.text)
      }
      if (params.html) {
        formData.append('html', params.html)
      }
      if (params.cc) {
        formData.append('cc', params.cc)
      }
      if (params.bcc) {
        formData.append('bcc', params.bcc)
      }
      if (params.tags) {
        const tagArray = params.tags.split(',').map((t) => t.trim())
        tagArray.forEach((tag) => formData.append('o:tag', tag))
      }

      return { body: formData }
    },
  },

  transformResponse: async (response, params): Promise<SendMessageResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to send message')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        id: result.id,
        message: result.message || 'Queued. Thank you.',
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the message was sent successfully' },
    id: { type: 'string', description: 'Message ID' },
    message: { type: 'string', description: 'Response message from Mailgun' },
  },
}
