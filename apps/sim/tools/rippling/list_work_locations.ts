import type {
  RipplingListWorkLocationsParams,
  RipplingListWorkLocationsResponse,
} from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListWorkLocationsTool: ToolConfig<
  RipplingListWorkLocationsParams,
  RipplingListWorkLocationsResponse
> = {
  id: 'rippling_list_work_locations',
  name: 'Rippling List Work Locations',
  description: 'List all work locations in Rippling',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of work locations to return',
    },
    offset: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Offset for pagination',
    },
  },

  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.limit != null) query.set('limit', String(params.limit))
      if (params.offset != null) query.set('offset', String(params.offset))
      const qs = query.toString()
      return `https://api.rippling.com/platform/api/work_locations${qs ? `?${qs}` : ''}`
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

    const workLocations = results.map((loc: Record<string, unknown>) => ({
      id: (loc.id as string) ?? '',
      nickname: (loc.nickname as string) ?? null,
      street: (loc.street as string) ?? null,
      city: (loc.city as string) ?? null,
      state: (loc.state as string) ?? null,
      zip: (loc.zip as string) ?? null,
      country: (loc.country as string) ?? null,
    }))

    return {
      success: true,
      output: {
        workLocations,
        totalCount: workLocations.length,
      },
    }
  },

  outputs: {
    workLocations: {
      type: 'array',
      description: 'List of work locations',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Work location ID' },
          nickname: { type: 'string', description: 'Location nickname' },
          street: { type: 'string', description: 'Street address' },
          city: { type: 'string', description: 'City' },
          state: { type: 'string', description: 'State or province' },
          zip: { type: 'string', description: 'ZIP or postal code' },
          country: { type: 'string', description: 'Country' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of work locations returned on this page',
    },
  },
}
