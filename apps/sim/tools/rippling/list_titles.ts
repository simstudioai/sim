import type { RipplingListTitlesParams } from '@/tools/rippling/types'
import { TITLE_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListTitlesTool: ToolConfig<RipplingListTitlesParams> = {
  id: 'rippling_list_titles',
  name: 'Rippling List Titles',
  description: 'List all titles',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field. Prefix with - for descending',
    },
    cursor: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Pagination cursor from previous response',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.orderBy != null) query.set('order_by', params.orderBy)
      if (params.cursor != null) query.set('cursor', params.cursor)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/titles/${qs ? `?${qs}` : ''}`
    },
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    const results = data.results ?? []
    return {
      success: true,
      output: {
        titles: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    titles: {
      type: 'array',
      description: 'List of titles',
      items: { type: 'object', properties: TITLE_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
