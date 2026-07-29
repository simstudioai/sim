import { ErrorExtractorId } from '@/tools/error-extractors'
import { buildEventUrl, CALENDAR_RETRY } from '@/tools/outlook/calendar-utils'
import type {
  OutlookCalendarRespondParams,
  OutlookCalendarRespondResponse,
  OutlookCalendarResponseType,
} from '@/tools/outlook/types'
import type { ToolConfig } from '@/tools/types'

const VALID_RESPONSE_TYPES: readonly OutlookCalendarResponseType[] = [
  'accept',
  'tentativelyAccept',
  'decline',
]

/** Agent calls may deliver booleans as the strings "true"/"false". */
const toBool = (value: unknown, fallback: boolean): boolean => {
  if (value === undefined || value === null || value === '') return fallback
  return value === true || value === 'true'
}

export const outlookCalendarRespondTool: ToolConfig<
  OutlookCalendarRespondParams,
  OutlookCalendarRespondResponse
> = {
  id: 'outlook_calendar_respond',
  name: 'Outlook Respond to Calendar Invite',
  description: 'Accept, tentatively accept, or decline an Outlook calendar event invitation',
  version: '1.0.0',

  errorExtractor: ErrorExtractorId.MICROSOFT_GRAPH_ERRORS,

  oauth: {
    required: true,
    provider: 'outlook',
  },

  params: {
    accessToken: {
      type: 'string',
      required: true,
      visibility: 'hidden',
      description: 'OAuth access token for Outlook',
    },
    eventId: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The ID of the calendar event to respond to',
    },
    responseType: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'The response: accept, tentativelyAccept, or decline',
    },
    comment: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Optional comment to include with the response',
    },
    sendResponse: {
      type: 'boolean',
      required: false,
      visibility: 'user-or-llm',
      description: 'Whether to send a response to the organizer (default: true)',
    },
  },

  request: {
    url: (params) => {
      const responseType = params.responseType as OutlookCalendarResponseType
      if (!VALID_RESPONSE_TYPES.includes(responseType)) {
        throw new Error(
          `Invalid responseType "${params.responseType}". Expected one of: ${VALID_RESPONSE_TYPES.join(', ')}`
        )
      }
      return buildEventUrl(params.eventId, responseType)
    },
    method: 'POST',
    retry: CALENDAR_RETRY,
    headers: (params) => {
      if (!params.accessToken) {
        throw new Error('Access token is required')
      }
      return {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json',
      }
    },
    body: (params) => {
      // Only send `comment` when it has content — an empty string is meaningless to the
      // organizer. Graph documents exactly two 400 conditions for accept/decline, both on
      // `proposedNewTime` (which we never send); `comment` carries no such restriction and
      // is valid alongside sendResponse=false.
      // https://learn.microsoft.com/en-us/graph/api/event-decline
      const body: Record<string, unknown> = {
        sendResponse: toBool(params.sendResponse, true),
      }
      const comment = params.comment?.trim()
      if (comment) {
        body.comment = comment
      }
      return body
    },
  },

  // Graph returns 202 Accepted on success with no body.
  transformResponse: async (response: Response, params?: OutlookCalendarRespondParams) => {
    const status = response.status
    const requestId =
      response.headers?.get('request-id') || response.headers?.get('x-ms-request-id') || undefined

    return {
      success: true,
      output: {
        message:
          status === 202 || status === 200
            ? 'Response sent successfully'
            : `Response sent (HTTP ${status})`,
        results: {
          eventId: params?.eventId ?? '',
          responseType: (params?.responseType as OutlookCalendarResponseType) ?? 'accept',
          status: 'responded',
          httpStatus: status,
          requestId,
        },
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'object',
      description: 'Response result details',
      properties: {
        eventId: { type: 'string', description: 'ID of the event responded to' },
        responseType: { type: 'string', description: 'The response that was sent' },
        status: { type: 'string', description: 'Response status' },
        httpStatus: {
          type: 'number',
          description: 'HTTP status code returned by the API',
          optional: true,
        },
        requestId: {
          type: 'string',
          description: 'Microsoft Graph request-id header for tracing',
          optional: true,
        },
      },
    },
  },
}
