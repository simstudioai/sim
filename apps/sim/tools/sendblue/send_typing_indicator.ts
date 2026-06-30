import { filterUndefined } from '@sim/utils/object'
import type {
  SendblueTypingIndicatorParams,
  SendblueTypingIndicatorResponse,
} from '@/tools/sendblue/types'
import {
  SENDBLUE_API_BASE_URL,
  sendblueBaseParamFields,
  sendblueHeaders,
} from '@/tools/sendblue/utils'
import type { ToolConfig } from '@/tools/types'

export const sendblueSendTypingIndicatorTool: ToolConfig<
  SendblueTypingIndicatorParams,
  SendblueTypingIndicatorResponse
> = {
  id: 'sendblue_send_typing_indicator',
  name: 'Sendblue Send Typing Indicator',
  description: 'Display a typing indicator to a recipient (not supported in group chats).',
  version: '1.0.0',

  params: {
    ...sendblueBaseParamFields,
    number: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: "Recipient's phone number in E.164 format (e.g., +19998887777)",
    },
    from_number: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Your Sendblue line number to send from, in E.164 format.',
    },
    state: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        '"start" (default) shows the indicator; "stop" ends an active indicator before max_duration_ms expires.',
    },
    max_duration_ms: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description:
        'How long (ms) the indicator stays visible before auto-stopping. Defaults to 60000. Must be between 1 and 300000.',
    },
  },

  request: {
    url: `${SENDBLUE_API_BASE_URL}/api/send-typing-indicator`,
    method: 'POST',
    headers: (params) => sendblueHeaders(params),
    body: (params) =>
      filterUndefined({
        number: params.number,
        from_number: params.from_number,
        state: params.state,
        max_duration_ms: params.max_duration_ms,
      }),
  },

  transformResponse: async (response) => {
    const data = await response.json()
    return {
      success: true,
      output: {
        status: data.status ?? null,
        status_code: data.status_code ?? null,
        number: data.number ?? null,
        error_message: data.error_message ?? null,
      },
    }
  },

  outputs: {
    status: {
      type: 'string',
      description: 'Delivery status of the typing indicator (e.g., QUEUED)',
    },
    status_code: { type: 'number', description: 'Numeric status code returned by Sendblue' },
    number: { type: 'string', description: 'The recipient phone number' },
    error_message: {
      type: 'string',
      description: 'Error details, null on success',
      optional: true,
    },
  },
}
