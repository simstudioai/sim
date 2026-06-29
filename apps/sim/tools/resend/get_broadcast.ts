import { createLogger } from '@sim/logger'
import type { GetBroadcastParams, GetBroadcastResult } from '@/tools/resend/types'
import type { ToolConfig } from '@/tools/types'

const logger = createLogger('ResendGetBroadcastTool')

export const resendGetBroadcastTool: ToolConfig<GetBroadcastParams, GetBroadcastResult> = {
  id: 'resend_get_broadcast',
  name: 'Get Broadcast',
  description: 'Retrieve details of a broadcast by ID',
  version: '1.0.0',

  params: {
    broadcastId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the broadcast to retrieve',
    },
    resendApiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Resend API key',
    },
  },

  request: {
    url: (params: GetBroadcastParams) =>
      `https://api.resend.com/broadcasts/${encodeURIComponent(params.broadcastId.trim())}`,
    method: 'GET',
    headers: (params: GetBroadcastParams) => ({
      Authorization: `Bearer ${params.resendApiKey}`,
      'Content-Type': 'application/json',
    }),
  },

  transformResponse: async (response: Response): Promise<GetBroadcastResult> => {
    const data = await response.json()

    if (!data.id) {
      logger.error('Resend Get Broadcast API error:', JSON.stringify(data, null, 2))
      return {
        success: false,
        error: data.message || 'Failed to retrieve broadcast',
        output: {
          id: '',
          name: '',
          audienceId: null,
          segmentId: null,
          from: '',
          subject: '',
          replyTo: null,
          previewText: null,
          status: '',
          createdAt: '',
          scheduledAt: null,
          sentAt: null,
        },
      }
    }

    return {
      success: true,
      output: {
        id: data.id,
        name: data.name ?? '',
        audienceId: data.audience_id ?? null,
        segmentId: data.segment_id ?? null,
        from: data.from ?? '',
        subject: data.subject ?? '',
        replyTo: data.reply_to ?? null,
        previewText: data.preview_text ?? null,
        status: data.status ?? '',
        createdAt: data.created_at ?? '',
        scheduledAt: data.scheduled_at ?? null,
        sentAt: data.sent_at ?? null,
      },
    }
  },

  outputs: {
    id: { type: 'string', description: 'Broadcast ID' },
    name: { type: 'string', description: 'Broadcast name' },
    audienceId: { type: 'string', description: 'Audience ID (legacy)', optional: true },
    segmentId: {
      type: 'string',
      description: 'Segment ID (the current recipient field)',
      optional: true,
    },
    from: { type: 'string', description: 'Sender email address' },
    subject: { type: 'string', description: 'Broadcast subject' },
    replyTo: { type: 'string', description: 'Reply-to email address', optional: true },
    previewText: { type: 'string', description: 'Inbox preview text', optional: true },
    status: { type: 'string', description: 'Broadcast status (e.g., draft, sent)' },
    createdAt: { type: 'string', description: 'Broadcast creation timestamp' },
    scheduledAt: { type: 'string', description: 'Scheduled send timestamp', optional: true },
    sentAt: { type: 'string', description: 'Timestamp the broadcast was sent', optional: true },
  },
}
