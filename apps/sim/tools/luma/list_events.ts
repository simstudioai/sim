import type { LumaListEventsParams, LumaListEventsResponse } from '@/tools/luma/types'
import { LUMA_EVENT_OUTPUT_PROPERTIES } from '@/tools/luma/types'
import type { ToolConfig } from '@/tools/types'

export const listEventsTool: ToolConfig<LumaListEventsParams, LumaListEventsResponse> = {
  id: 'luma_list_events',
  name: 'Luma List Events',
  description:
    'List events from your Luma calendar with optional date range filtering, sorting, and pagination.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Luma API key',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return events after this ISO 8601 datetime (e.g., 2025-01-01T00:00:00Z)',
    },
    before: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Return events before this ISO 8601 datetime (e.g., 2025-12-31T23:59:59Z)',
    },
    paginationLimit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of events to return per page',
    },
    paginationCursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description:
        'Pagination cursor from a previous response (next_cursor) to fetch the next page of results',
    },
    sortColumn: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Column to sort by (only start_at is supported)',
    },
    sortDirection: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort direction: asc, desc, asc nulls last, or desc nulls last',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.luma.com/v1/calendar/list-events')
      if (params.after) url.searchParams.set('after', params.after)
      if (params.before) url.searchParams.set('before', params.before)
      if (params.paginationLimit)
        url.searchParams.set('pagination_limit', String(params.paginationLimit))
      if (params.paginationCursor)
        url.searchParams.set('pagination_cursor', params.paginationCursor)
      if (params.sortColumn) url.searchParams.set('sort_column', params.sortColumn)
      if (params.sortDirection) url.searchParams.set('sort_direction', params.sortDirection)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'x-luma-api-key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Failed to list events')
    }

    const events = (data.entries ?? []).map((entry: Record<string, unknown>) => {
      const event = entry.event as Record<string, unknown>
      return {
        id: (event.id as string) ?? null,
        name: (event.name as string) ?? null,
        startAt: (event.start_at as string) ?? null,
        endAt: (event.end_at as string) ?? null,
        timezone: (event.timezone as string) ?? null,
        durationInterval: (event.duration_interval as string) ?? null,
        createdAt: (event.created_at as string) ?? null,
        description: (event.description as string) ?? null,
        descriptionMd: (event.description_md as string) ?? null,
        coverUrl: (event.cover_url as string) ?? null,
        url: (event.url as string) ?? null,
        visibility: (event.visibility as string) ?? null,
        meetingUrl: (event.meeting_url as string) ?? null,
        geoAddressJson: (event.geo_address_json as Record<string, unknown>) ?? null,
        geoLatitude: (event.geo_latitude as string) ?? null,
        geoLongitude: (event.geo_longitude as string) ?? null,
        calendarId: (event.calendar_id as string) ?? null,
      }
    })

    return {
      success: true,
      output: {
        events,
        hasMore: data.has_more ?? false,
        nextCursor: data.next_cursor ?? null,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of calendar events',
      items: {
        type: 'object',
        properties: LUMA_EVENT_OUTPUT_PROPERTIES,
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available for pagination',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor to pass as paginationCursor to fetch the next page',
      optional: true,
    },
  },
}
