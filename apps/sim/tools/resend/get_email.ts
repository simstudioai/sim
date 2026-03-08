import { createLogger } from '@sim/logger'
import type { GetEmailParams, GetEmailResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendGetEmailTool')

export const resendGetEmailTool: ToolConfig<GetEmailParams, GetEmailResult> = {
  id: 'resend_get_email',
  name: 'Get Email',
  description: 'Retrieve details of a previously sent email by its ID',
  version: '1.0.0',

  params: {
    emailId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the email to retrieve',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: GetEmailParams) => `https://api.resend.com/emails/${params.emailId.trim()}`,
    method: 'GET',
    headers: (params: GetEmailParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GetEmailResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Get Email API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to retrieve email',
        output: {
          id: '',
          from: '',
          to: [],
          subject: '',
          html: '',
          text: null,
          cc: [],
          bcc: [],
          replyTo: [],
          lastEvent: '',
          createdAt: '',
          scheduledAt: null,
          tags: [],
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        from: data.from ?? '',
        to: data.to ?? [],
        subject: data.subject ?? '',
        html: data.html ?? '',
        text: data.text ?? null,
        cc: data.cc ?? [],
        bcc: data.bcc ?? [],
        replyTo: data.reply_to ?? [],
        lastEvent: data.last_event ?? '',
        createdAt: data.created_at ?? '',
        scheduledAt: data.scheduled_at ?? null,
        tags: data.tags ?? [],
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Email ID' },
    from: { type: 'string', description: 'Sender email address' },
    to: { type: 'json', description: 'Recipient email addresses' },
    subject: { type: 'string', description: 'Email subject' },
    html: { type: 'string', description: 'HTML email content' },
    text: { type: 'string', description: 'Plain text email content', optional: true },
    cc: { type: 'json', description: 'CC email addresses' },
    bcc: { type: 'json', description: 'BCC email addresses' },
    replyTo: { type: 'json', description: 'Reply-to email addresses' },
    lastEvent: { type: 'string', description: 'Last event status (e.g., delivered, bounced)' },
    createdAt: { type: 'string', description: 'Email creation timestamp' },
    scheduledAt: { type: 'string', description: 'Scheduled send timestamp', optional: true },
    tags: { type: 'json', description: 'Email tags as name-value pairs' },
  },
}
