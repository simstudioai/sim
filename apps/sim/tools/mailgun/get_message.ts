import type { GetMessageParams, GetMessageResult } from '@/tools/mailgun/types'
import type { ToolConfig } from '@/tools/types'

export const mailgunGetMessageTool: ToolConfig<GetMessageParams, GetMessageResult> = {
  id: 'mailgun_get_message',
  name: 'Mailgun Get Message',
  description: 'Retrieve a stored message by its key',
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
      description: 'Mailgun domain for retrieving messages (e.g., mg.example.com)',
    },
    messageKey: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message storage key',
    },
  },

  request: {
    url: (params) =>
      `https://api.mailgun.net/v3/domains/${params.domain}/messages/${params.messageKey}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Basic ${Buffer.from(`api:${params.apiKey}`).toString('base64')}`,
    }),
  },

  transformResponse: async (response, params): Promise<GetMessageResult> => {
    if (!response.ok) {
      const error = await response.json()
      throw new Error(error.message || 'Failed to get message')
    }

    const result = await response.json()

    return {
      success: true,
      output: {
        success: true,
        recipients: result.recipients,
        from: result.from,
        subject: result.subject,
        bodyPlain: result['body-plain'],
        strippedText: result['stripped-text'],
        strippedSignature: result['stripped-signature'],
        bodyHtml: result['body-html'],
        strippedHtml: result['stripped-html'],
        attachmentCount: result['attachment-count'],
        timestamp: result.timestamp,
        messageHeaders: result['message-headers'],
        contentIdMap: result['content-id-map'],
      },
    }
  },

  outputs: {
    success: { type: 'boolean', description: 'Whether the request was successful' },
    recipients: { type: 'string', description: 'Message recipients' },
    from: { type: 'string', description: 'Sender email' },
    subject: { type: 'string', description: 'Message subject' },
    bodyPlain: { type: 'string', description: 'Plain text body' },
    strippedText: { type: 'string', description: 'Stripped text' },
    strippedSignature: { type: 'string', description: 'Stripped signature' },
    bodyHtml: { type: 'string', description: 'HTML body' },
    strippedHtml: { type: 'string', description: 'Stripped HTML' },
    attachmentCount: { type: 'number', description: 'Number of attachments' },
    timestamp: { type: 'number', description: 'Message timestamp' },
    messageHeaders: { type: 'json', description: 'Message headers' },
    contentIdMap: { type: 'json', description: 'Content ID map' },
  },
}
