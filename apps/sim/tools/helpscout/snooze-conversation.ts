import { ErrorExtractorId } from '@/tools/error-extractors'
import type {
  HelpScoutConversationChangeResponse,
  HelpScoutSnoozeConversationParams,
} from '@/tools/helpscout/types'
import { CONVERSATION_CHANGE_OUTPUTS } from '@/tools/helpscout/types'
import {
  ACCESS_TOKEN_PARAM,
  buildHelpScoutHeaders,
  CONVERSATION_ID_PARAM,
  conversationChangeResult,
  conversationUrl,
} from '@/tools/helpscout/utils'
import type { ToolConfig } from '@/tools/types'

const ISO_DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/

/** Help Scout requires a future ISO 8601 time, in whole seconds, no later than the year 2100. */
function parseSnoozeUntil(value: string): string {
  const text = value?.trim() ?? ''
  const match = ISO_DATE_TIME_PATTERN.exec(text)
  const time = Date.parse(text)
  if (!match || Number.isNaN(time)) {
    throw new Error('snoozedUntil must be an ISO 8601 date-time, e.g. 2025-02-15T12:00:00Z')
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new Error(`snoozedUntil has an invalid calendar date: ${match[0].slice(0, 10)}`)
  }
  const wholeSeconds = Math.ceil(time / 1000) * 1000
  if (wholeSeconds <= Date.now()) throw new Error('snoozedUntil must be in the future')
  if (new Date(wholeSeconds).getUTCFullYear() > 2100) {
    throw new Error('snoozedUntil must not be after the year 2100')
  }
  return new Date(wholeSeconds).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const helpScoutSnoozeConversationTool: ToolConfig<
  HelpScoutSnoozeConversationParams,
  HelpScoutConversationChangeResponse
> = {
  id: 'helpscout_snooze_conversation',
  name: 'Help Scout Snooze Conversation',
  description:
    'Snooze a Help Scout conversation until a future time, optionally waking it when the customer replies. A new snooze replaces the previous one.',
  version: '1.0.0',
  oauth: { required: true, provider: 'helpscout' },
  errorExtractor: ErrorExtractorId.HELPSCOUT_ERRORS,
  params: {
    accessToken: ACCESS_TOKEN_PARAM,
    conversationId: CONVERSATION_ID_PARAM,
    snoozedUntil: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'When the snooze ends, as an ISO 8601 date-time (e.g. 2025-02-15T12:00:00Z)',
    },
    unsnoozeOnCustomerReply: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Wake the conversation when the customer replies (defaults to true)',
    },
  },
  request: {
    url: (params) => conversationUrl(params.conversationId, '/snooze'),
    method: 'PUT',
    headers: (params) => buildHelpScoutHeaders(params.accessToken),
    body: (params) => ({
      snoozedUntil: parseSnoozeUntil(params.snoozedUntil),
      unsnoozeOnCustomerReply: params.unsnoozeOnCustomerReply ?? true,
    }),
  },
  transformResponse: async (_response, params) => conversationChangeResult(params),
  outputs: CONVERSATION_CHANGE_OUTPUTS,
}
