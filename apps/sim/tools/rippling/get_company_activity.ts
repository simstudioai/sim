import type {
  RipplingGetCompanyActivityParams,
  RipplingGetCompanyActivityResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCompanyActivityTool: ToolConfig<
  RipplingGetCompanyActivityParams,
  RipplingGetCompanyActivityResponse
> = {
  id: 'rippling_get_company_activity',
  name: 'Rippling Get Company Activity',
  description: 'Get activity events for the current company in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    startDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Start date filter in ISO format (e.g. 2024-01-01)',
    },
    endDate: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'End date filter in ISO format (e.g. 2024-12-31)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of activity events to return',
    },
    next: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Cursor for fetching the next page of results',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.startDate) query.set('startDate', params.startDate)
      if (params.endDate) query.set('endDate', params.endDate)
      if (params.limit != null) query.set('limit', String(params.limit))
      if (params.next) query.set('next', params.next)
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/company_activity${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }

    const data = await response.json()
    const results = Array.isArray(data) ? data : (data.results ?? [])
    const nextCursor = Array.isArray(data) ? null : ((data.next as string) ?? null)

    const events = results.map((event: Record<string, unknown>) => {
      const actor = (event.actor as Record<string, unknown>) ?? {}
      return {
        id: (event.id as string) ?? '',
        type: (event.type as string) ?? null,
        description: (event.description as string) ?? null,
        createdAt: (event.createdAt as string) ?? null,
        actor: {
          id: (actor.id as string) ?? null,
          name: (actor.name as string) ?? null,
        },
      }
    })

    return {
      success: true,
      output: {
        events,
        totalCount: events.length,
        nextCursor,
      },
    }
  },

  outputs: {
    events: {
      type: 'array',
      description: 'List of company activity events',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Event ID' },
          type: { type: 'string', description: 'Event type' },
          description: { type: 'string', description: 'Event description' },
          createdAt: { type: 'string', description: 'Event creation timestamp' },
          actor: { type: 'json', description: 'Actor who triggered the event (id, name)' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of activity events returned on this page',
    },
    nextCursor: {
      type: 'string',
      description: 'Cursor for fetching the next page of results',
      optional: true,
    },
  },
}
