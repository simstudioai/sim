import type { PdlAutocompleteParams, PdlAutocompleteResponse } from '@/tools/peopledatalabs/types'
import { buildQueryString } from '@/tools/peopledatalabs/utils'
import type { OutputProperty, ToolConfig } from '@/tools/types'

const SUGGESTION_PROPERTIES = {
  name: { type: 'string', description: 'Suggestion value' },
  count: { type: 'number', description: 'Number of records matching this value' },
  meta: {
    type: 'object',
    description: 'Field-specific metadata (e.g., for `company`: id, website, industry)',
    optional: true,
  },
} as const satisfies Record<string, OutputProperty>

export const autocompleteTool: ToolConfig<PdlAutocompleteParams, PdlAutocompleteResponse> = {
  id: 'pdl_autocomplete',
  name: 'PDL Autocomplete',
  description:
    'Get autocomplete suggestions for a PDL field (title, skill, company, industry, location, school, major, role, sub_role).',
  version: '1.0.0',

  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'People Data Labs API key',
    },
    field: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description:
        'Field to autocomplete: all_location, class, company, country, industry, location_name, major, region, role, school, sub_role, skill, title, website',
    },
    text: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Search text prefix',
    },
    size: {
      type: 'number',
      required: false,
      visibility: 'user-or-llm',
      description: 'Number of suggestions to return (1-100, default 10)',
    },
  },

  request: {
    url: (params) => {
      const qs = buildQueryString({
        field: params.field,
        text: params.text,
        size: params.size,
      })
      return `https://api.peopledatalabs.com/v5/autocomplete${qs}`
    },
    method: 'GET',
    headers: (params) => ({
      'X-Api-Key': params.apiKey,
      Accept: 'application/json',
    }),
  },

  transformResponse: async (response: Response) => {
    const data = (await response.json()) as Record<string, unknown>

    if (!response.ok) {
      const error = (data.error as { message?: string })?.message
      throw new Error(error || `People Data Labs error: ${response.status}`)
    }

    const items =
      (data.data as { name: string; count: number; meta?: Record<string, unknown> }[]) ?? []
    return {
      success: true,
      output: {
        suggestions: items.map((item) => ({
          name: item.name,
          count: item.count ?? 0,
          meta: item.meta ?? undefined,
        })),
      },
    }
  },

  outputs: {
    suggestions: {
      type: 'array',
      description: 'Autocomplete suggestions ordered by frequency',
      items: { type: 'object', properties: SUGGESTION_PROPERTIES },
    },
  },
}
