import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  MAILTRAP_SENDING_MESSAGE_DETAIL_OUTPUT_PROPERTIES,
  type MailtrapGetEmailLogParams,
  type MailtrapGetEmailLogResult,
} from '@/tools/mailtrap/types'
import { mapSendingMessage, readJsonBody } from '@/tools/mailtrap/utils'
import type { ToolConfig } from '@/tools/types'

export const mailtrapGetEmailLogTool: ToolConfig<
  MailtrapGetEmailLogParams,
  MailtrapGetEmailLogResult
> = {
  id: 'mailtrap_get_email_log',
  name: 'Mailtrap Get Email Log',
  description:
    'Retrieve a single sent message from the Mailtrap email logs by its message UUID, including the delivery/open/click event timeline and a temporary raw .eml download URL.',
  version: '1.0.0',
  errorExtractor: ErrorExtractorId.MAILTRAP_ERRORS,

  params: {
    apiToken: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Mailtrap API token with access to the sending domain',
    },
    messageId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Message UUID (the messageId from a send or from list email logs)',
    },
  },

  request: {
    url: (params) =>
      `https://mailtrap.io/api/email_logs/${encodeURIComponent(params.messageId.trim())}`,
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiToken}`,
    }),
  },

  transformResponse: async (response): Promise<MailtrapGetEmailLogResult> => {
    const data = await readJsonBody(response)
    return {
      success: true,
      output: {
        message: {
          ...mapSendingMessage(data),
          rawMessageUrl: typeof data.raw_message_url === 'string' ? data.raw_message_url : null,
          events: Array.isArray(data.events) ? (data.events as Array<Record<string, unknown>>) : [],
        },
      },
    }
  },

  outputs: {
    message: {
      type: 'object',
      description: 'The requested message',
      properties: MAILTRAP_SENDING_MESSAGE_DETAIL_OUTPUT_PROPERTIES,
    },
  },
}
