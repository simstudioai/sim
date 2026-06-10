import type { DubGetEventsParams, DubGetEventsResponse } from '@/tools/dub/types'
import type { ToolConfig } from '@/tools/types'

export const getEventsTool: ToolConfig<DubGetEventsParams, DubGetEventsResponse> = {
  id: 'dub_get_events',
  name: 'Dub List Events',
  description:
    'Retrieve a paginated stream of individual click, lead, and sale events for links, with filtering by link, time range, and location.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Dub API key',
    },
    event: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Event type: clicks (default), leads, or sales',
    },
    linkId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by link ID',
    },
    externalId: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by external ID (prefix with ext_)',
    },
    domain: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by domain',
    },
    interval: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Time interval: 24h (default), 7d, 30d, 90d, 1y, mtd, qtd, ytd, or all',
    },
    start: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date/time in ISO 8601 format (overrides interval)',
    },
    end: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date/time in ISO 8601 format (defaults to now)',
    },
    country: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter by country (ISO 3166-1 alpha-2 code)',
    },
    timezone: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'IANA timezone for event timestamps (defaults to UTC)',
    },
    page: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Page number (default: 1)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of events per page (default: 100, max: 1000)',
    },
    sortOrder: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort order: desc (default) or asc',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://api.dub.co/events')
      if (params.event) url.searchParams.set('event', params.event)
      if (params.linkId) url.searchParams.set('linkId', params.linkId)
      if (params.externalId) url.searchParams.set('externalId', params.externalId)
      if (params.domain) url.searchParams.set('domain', params.domain)
      if (params.interval) url.searchParams.set('interval', params.interval)
      if (params.start) url.searchParams.set('start', params.start)
      if (params.end) url.searchParams.set('end', params.end)
      if (params.country) url.searchParams.set('country', params.country)
      if (params.timezone) url.searchParams.set('timezone', params.timezone)
      if (params.page) url.searchParams.set('page', String(params.page))
      if (params.limit) url.searchParams.set('limit', String(params.limit))
      if (params.sortOrder) url.searchParams.set('sortOrder', params.sortOrder)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      Accept: 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()

    if (!response.ok) {
      throw new Error(data.error?.message || data.error || 'Failed to list events')
    }

    const events = Array.isArray(data) ? (data as Record<string, unknown>[]) : []

    return {
      success: true,
      output: {
        events,
        count: events.length,
      },
    }
  },

  outputs: {
    events: {
      type: 'json',
      description:
        'Array of event objects (event, timestamp, click, link, and customer/sale data when applicable)',
    },
    count: { type: 'number', description: 'Number of events returned' },
  },
}
