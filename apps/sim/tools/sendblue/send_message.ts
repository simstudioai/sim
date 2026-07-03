import { filterUndefined } from '@sim/utils/object'
import type { SendblueSendMessageParams, SendblueSendMessageResponse } from '@/tools/sendblue/types'
import {
  SENDBLUE_API_BASE_URL,
  sendblueBaseParamFields,
  sendblueHeaders,
} from '@/tools/sendblue/utils'
import type { ToolConfig } from '@/tools/types'

export const sendblueSendMessageTool: ToolConfig<
  SendblueSendMessageParams,
  SendblueSendMessageResponse
> = {
  id: 'sendblue_send_message',
  name: 'Sendblue Send Message',
  description: 'Send an iMessage or SMS to a single recipient via Sendblue.',
  version: '1.0.0',

  params: {
    ...sendblueBaseParamFields,
    number: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Recipient phone number in E.164 format (e.g., +19998887777)',
    },
    from_number: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'One of your registered Sendblue phone numbers to send from, in E.164 format (e.g., +18887776666)',
    },
    content: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Message text content. Either content or media_url must be provided.',
    },
    media_url: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'URL of a media file to send. Either content or media_url must be provided.',
    },
    send_style: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'iMessage expressive style (e.g., celebration, fireworks, lasers, confetti, balloons, invisible, slam).',
    },
    seat_id: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Seat (user) the message is attributed to. Accepts the seat UUID or Firebase Auth subject.',
    },
    status_callback: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Webhook URL that Sendblue will POST message status updates to.',
    },
  },

  request: {
    url: `${SENDBLUE_API_BASE_URL}/api/send-message`,
    method: 'POST',
    headers: (params) => sendblueHeaders(params),
    body: (params) =>
      filterUndefined({
        number: params.number,
        from_number: params.from_number,
        content: params.content,
        media_url: params.media_url,
        send_style: params.send_style,
        seat_id: params.seat_id,
        status_callback: params.status_callback,
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        status: data.status ?? null,
        message_handle: data.message_handle ?? null,
        account_email: data.account_email ?? data.accountEmail ?? null,
        content: data.content ?? null,
        is_outbound: data.is_outbound ?? null,
        from_number: data.from_number ?? null,
        number: data.number ?? null,
        media_url: data.media_url ?? null,
        send_style: data.send_style ?? null,
        seat_id: data.seat_id ?? null,
        sender_email: data.sender_email ?? null,
        error_code: data.error_code ?? null,
        error_message: data.error_message ?? null,
        date_created: data.date_created ?? null,
        date_updated: data.date_updated ?? null,
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Message status: QUEUED, SENT, DELIVERED, or ERROR' },
    message_handle: { type: 'string', description: 'Unique identifier for tracking the message' },
    account_email: { type: 'string', description: 'Email of the account that sent the message' },
    content: { type: 'string', description: 'Message content', optional: true },
    is_outbound: { type: 'boolean', description: 'Whether this is an outbound message' },
    from_number: { type: 'string', description: 'Sending phone number' },
    number: { type: 'string', description: 'Recipient phone number' },
    media_url: { type: 'string', description: 'URL of attached media', optional: true },
    send_style: {
      type: 'string',
      description: 'iMessage expressive style applied',
      optional: true,
    },
    seat_id: {
      type: 'string',
      description: 'UUID of the seat that sent the message',
      optional: true,
    },
    sender_email: {
      type: 'string',
      description: 'Email of the seat (user) that sent the message',
      optional: true,
    },
    error_code: {
      type: 'number',
      description: 'Numeric error code if the message failed',
      optional: true,
    },
    error_message: {
      type: 'string',
      description: 'Error message if the message failed',
      optional: true,
    },
    date_created: { type: 'string', description: 'When the message was created', optional: true },
    date_updated: {
      type: 'string',
      description: 'When the message was last updated',
      optional: true,
    },
  },
}
