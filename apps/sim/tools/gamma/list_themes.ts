import type { GammaListThemesParams, GammaListThemesResponse } from '@/tools/gamma/types'
import type { ToolConfig } from '@/tools/types'

export const listThemesTool: ToolConfig<GammaListThemesParams, GammaListThemesResponse> = {
  id: 'gamma_list_themes',
  name: 'Gamma List Themes',
  description:
    'List available themes in your Gamma workspace. Returns theme IDs, names, and keywords for styling.',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Gamma API key',
    },
    query: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search query to filter themes by name (case-insensitive)',
    },
    limit: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Maximum number of themes to return per page (max 50)',
    },
    after: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from a previous response (nextCursor) to fetch the next page',
    },
  },

  request: {
    url: (params) => {
      const url = new URL('https://public-api.gamma.app/v1.0/themes')
      if (params.query) url.searchParams.append('query', params.query)
      if (params.limit) url.searchParams.append('limit', String(params.limit))
      if (params.after) url.searchParams.append('after', params.after)
      return url.toString()
    },
    method: 'GET',
    headers: (params) => ({
      'X-API-KEY': params.apiKey,
    }),
  },

  transformResponse: async (response: Response) => {
    const data = await response.json()
    const items = Array.isArray(data.data) ? data.data : Array.isArray(data) ? data : []

    return {
      success: true,
      output: {
        themes: items.map(
          (theme: {
            id?: string
            name?: string
            type?: string
            colorKeywords?: string[]
            toneKeywords?: string[]
          }) => ({
            id: theme.id ?? '',
            name: theme.name ?? '',
            type: theme.type ?? '',
            colorKeywords: theme.colorKeywords ?? [],
            toneKeywords: theme.toneKeywords ?? [],
          })
        ),
        hasMore: data.hasMore ?? false,
        nextCursor: data.nextCursor ?? null,
      },
    }
  },

  outputs: {
    themes: {
      type: 'array',
      description: 'List of available themes',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Theme ID (use with themeId parameter)' },
          name: { type: 'string', description: 'Theme display name' },
          type: { type: 'string', description: 'Theme type: standard or custom' },
          colorKeywords: {
            type: 'array',
            description: 'Color descriptors for this theme',
            items: { type: 'string', description: 'Color keyword' },
          },
          toneKeywords: {
            type: 'array',
            description: 'Tone descriptors for this theme',
            items: { type: 'string', description: 'Tone keyword' },
          },
        },
      },
    },
    hasMore: {
      type: 'boolean',
      description: 'Whether more results are available on the next page',
    },
    nextCursor: {
      type: 'string',
      description: 'Pagination cursor to pass as the after parameter for the next page',
      optional: true,
    },
  },
}
