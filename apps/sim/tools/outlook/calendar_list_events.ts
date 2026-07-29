import { ErrorExtractorId } from '@/tools/error-extractors'
import {
  buildCalendarScopedUrl,
  CALENDAR_RETRY,
  flattenGraphEvent,
} from '@/tools/outlook/calendar-utils'
import type {
  GraphEventsResponse,
  OutlookCalendarListEventsParams,
  OutlookCalendarListEventsResponse,
} from '@/tools/outlook/types'
import { OUTLOOK_EVENT_OUTPUT_PROPERTIES } from '@/tools/outlook/types'
import { assertGraphNextPageUrl } from '@/tools/sharepoint/utils'
import type { ToolConfig } from '@/tools/types'

/** Graph caps `$top` on calendarView at 1000; we cap lower to bound the response payload. */
const MAX_EVENTS_PER_PAGE = 100

export const outlookCalendarListEventsTool: ToolConfig<
  OutlookCalendarListEventsParams,
  OutlookCalendarListEventsResponse
> = {
  id: 'outlook_calendar_list_events',
  name: 'Outlook List Calendar Events',
  description: 'List Outlook calendar events within a start/end time window',
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
    calendarId: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description:
        'ID of the calendar to read. Defaults to the mailbox default calendar. Calendars shared by another user are not supported and may return 403.',
    },
    // Not `required`, because a paging call supplies only `pageToken` and the window bounds
    // are baked into the nextLink. The url builder enforces "pageToken OR both bounds".
    // Mirrors tools/sharepoint/list_sites.ts.
    startDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Start of the time window (ISO 8601, e.g. 2025-06-03T00:00:00-08:00). Interpreted as UTC if no offset is given. Required unless paging with pageToken.',
    },
    endDateTime: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'End of the time window (ISO 8601, e.g. 2025-06-10T00:00:00-08:00). Interpreted as UTC if no offset is given. Required unless paging with pageToken.',
    },
    maxResults: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return per page (default: 10, max: 100)',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Order of events (default: start/dateTime)',
    },
    pageToken: {
      type: 'string',
      required: false,
      visibility: 'user-only',
      description: 'Full @odata.nextLink URL from a previous page to continue paging',
    },
  },

  request: {
    url: (params) => {
      // A nextLink is a fully-formed Graph URL. Validate the origin before reusing it
      // as the request URL — otherwise a workflow-supplied token would receive the
      // Outlook bearer. Mirrors the onedrive / microsoft_ad Graph paging guard.
      if (params.pageToken) {
        return assertGraphNextPageUrl(params.pageToken.trim())
      }

      if (!params.startDateTime?.trim() || !params.endDateTime?.trim()) {
        throw new Error(
          'startDateTime and endDateTime are required to list calendar events (calendarView needs both bounds). Supply pageToken instead to continue a previous page.'
        )
      }

      const requested = Number(params.maxResults)
      const maxResults = Number.isFinite(requested)
        ? Math.max(1, Math.min(Math.abs(requested), MAX_EVENTS_PER_PAGE))
        : 10

      const queryParams = new URLSearchParams()
      queryParams.append('startDateTime', params.startDateTime.trim())
      queryParams.append('endDateTime', params.endDateTime.trim())
      queryParams.append('$top', String(maxResults))
      queryParams.append('$orderby', params.orderBy || 'start/dateTime')

      return `${buildCalendarScopedUrl('calendarView', params.calendarId)}?${queryParams.toString()}`
    },
    method: 'GET',
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
  },

  transformResponse: async (response: Response) => {
    const data: GraphEventsResponse = await response.json()
    const events = (data.value || []).map(flattenGraphEvent)

    return {
      success: true,
      output: {
        message: `Successfully retrieved ${events.length} calendar event(s).`,
        results: events,
        nextLink: data['@odata.nextLink'],
      },
    }
  },

  outputs: {
    message: { type: 'string', description: 'Success or status message' },
    results: {
      type: 'array',
      description: 'Array of calendar event objects',
      items: {
        type: 'object',
        properties: OUTLOOK_EVENT_OUTPUT_PROPERTIES,
      },
    },
    nextLink: {
      type: 'string',
      description: 'URL for the next page of results, if any',
      optional: true,
    },
  },
}
