import type { RipplingListLevelsParams, RipplingListLevelsResponse } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListLevelsTool: ToolConfig<
  RipplingListLevelsParams,
  RipplingListLevelsResponse
> = {
  id: 'rippling_list_levels',
  name: 'Rippling List Levels',
  description: 'List all position levels in Rippling',
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
      description: 'Maximum number of levels to return',
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
      return `https://api.rippling.com/platform/api/levels${qs ? `?${qs}` : ''}`
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

    const levels = results.map((level: Record<string, unknown>) => ({
      id: (level.id as string) ?? '',
      name: (level.name as string) ?? null,
      parent: (level.parent as string) ?? null,
    }))

    return {
      success: true,
      output: {
        levels,
        totalCount: levels.length,
      },
    }
  },

  outputs: {
    levels: {
      type: 'array',
      description: 'List of position levels',
      items: {
        type: 'json',
        properties: {
          id: { type: 'string', description: 'Level ID' },
          name: { type: 'string', description: 'Level name' },
          parent: { type: 'string', description: 'Parent level ID' },
        },
      },
    },
    totalCount: {
      type: 'number',
      description: 'Number of levels returned on this page',
    },
  },
}
