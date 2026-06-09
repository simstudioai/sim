import type { SendblueGetMessageParams, SendblueGetMessageResponse } from '@/tools/sendblue/types'
import {
  SENDBLUE_API_BASE_URL,
  sendblueBaseParamFields,
  sendblueHeaders,
} from '@/tools/sendblue/utils'
import type { ToolConfig } from '@/tools/types'

export const sendblueGetMessageTool: ToolConfig<
  SendblueGetMessageParams,
  SendblueGetMessageResponse
> = {
  id: 'sendblue_get_message',
  name: 'Sendblue Get Message',
  description: 'Retrieve a single message and its current status by message handle/ID.',
  version: '1.0.0',

  params: {
    ...sendblueBaseParamFields,
    message_id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The message handle/ID returned when the message was sent.',
    },
  },

  request: {
    url: (params) =>
      `${SENDBLUE_API_BASE_URL}/api/v2/messages/${encodeURIComponent(params.message_id.trim())}`,
    method: 'GET',
    headers: (params) => sendblueHeaders(params),
  },

  transformResponse: async (response) => {
    const body = await response.json()
    const data = body?.data ?? body ?? {}
    return {
      success: true,
      output: {
        status: data.status ?? null,
        message_handle: data.message_handle ?? null,
        account_email: data.accountEmail ?? data.account_email ?? null,
        content: data.content ?? null,
        is_outbound: data.is_outbound ?? null,
        from_number: data.from_number ?? null,
        number: data.number ?? null,
        to_number: data.to_number ?? null,
        media_url: data.media_url ?? null,
        message_type: data.message_type ?? null,
        service: data.service ?? null,
        group_id: data.group_id ?? null,
        group_display_name: data.group_display_name ?? null,
        participants: data.participants ?? [],
        send_style: data.send_style ?? null,
        was_downgraded: data.was_downgraded ?? null,
        opted_out: data.opted_out ?? null,
        plan: data.plan ?? null,
        sendblue_number: data.sendblue_number ?? null,
        seat_id: data.seat_id ?? null,
        sender_email: data.sender_email ?? null,
        error_code: data.error_code ?? null,
        error_message: data.error_message ?? null,
        error_reason: data.error_reason ?? null,
        error_detail: data.error_detail ?? null,
        date_sent: data.date_sent ?? null,
        date_updated: data.date_updated ?? null,
      },
    }
  },

  outputs: {
    status: { type: 'string', description: 'Current message status' },
    message_handle: { type: 'string', description: 'Unique message identifier' },
    account_email: { type: 'string', description: 'Email of the account', optional: true },
    content: { type: 'string', description: 'Message content', optional: true },
    is_outbound: {
      type: 'boolean',
      description: 'Whether the message is outbound',
      optional: true,
    },
    from_number: { type: 'string', description: 'Sending phone number', optional: true },
    number: { type: 'string', description: 'Recipient phone number', optional: true },
    to_number: { type: 'string', description: 'Destination phone number', optional: true },
    media_url: { type: 'string', description: 'URL of attached media', optional: true },
    message_type: {
      type: 'string',
      description: 'Message category: message or group',
      optional: true,
    },
    service: {
      type: 'string',
      description: 'Messaging service: iMessage, SMS, or RCS',
      optional: true,
    },
    group_id: {
      type: 'string',
      description: 'Group identifier (empty for non-group)',
      optional: true,
    },
    group_display_name: { type: 'string', description: 'Group chat name', optional: true },
    participants: {
      type: 'array',
      description: 'Participant phone numbers',
      items: { type: 'string' },
      optional: true,
    },
    send_style: { type: 'string', description: 'Expressive style applied', optional: true },
    was_downgraded: {
      type: 'boolean',
      description: 'True if the recipient lacks iMessage support',
      optional: true,
    },
    opted_out: {
      type: 'boolean',
      description: 'True if the recipient has opted out',
      optional: true,
    },
    plan: { type: 'string', description: 'Account plan type', optional: true },
    sendblue_number: { type: 'string', description: 'Sendblue phone number used', optional: true },
    seat_id: { type: 'string', description: 'Seat UUID', optional: true },
    sender_email: { type: 'string', description: 'Email of the sending seat', optional: true },
    error_code: { type: 'number', description: 'Numeric error code if failed', optional: true },
    error_message: { type: 'string', description: 'Error message if failed', optional: true },
    error_reason: { type: 'string', description: 'Additional error context', optional: true },
    error_detail: { type: 'string', description: 'Detailed error information', optional: true },
    date_sent: { type: 'string', description: 'ISO 8601 creation timestamp', optional: true },
    date_updated: { type: 'string', description: 'ISO 8601 last-update timestamp', optional: true },
  },
}
