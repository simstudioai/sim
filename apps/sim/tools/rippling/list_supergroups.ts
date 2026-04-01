import type { RipplingListSupergroupsParams } from '@/tools/rippling/types'
import { SUPERGROUP_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListSupergroupsTool: ToolConfig<RipplingListSupergroupsParams> = {
  id: 'rippling_list_supergroups',
  name: 'Rippling List Supergroups',
  description: 'List all supergroups',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    filter: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Filter expression',
    },
    orderBy: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Sort field. Prefix with - for descending',
    },
  },
  request: {
    url: (params) => {
      const query = new URLSearchParams()
      if (params.filter) query.set('filter', params.filter)
      if (params.orderBy) query.set('order_by', params.orderBy)
      const qs = query.toString()
      return `https://rest.ripplingapis.com/supergroups/${qs ? `?${qs}` : ''}`
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
        supergroups: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          display_name: (item.display_name as string) ?? null,
          description: (item.description as string) ?? null,
          app_owner_id: (item.app_owner_id as string) ?? null,
          group_type: (item.group_type as string) ?? null,
          name: (item.name as string) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
      },
    }
  },
  outputs: {
    supergroups: {
      type: 'array',
      description: 'List of supergroups',
      items: { type: 'object', properties: SUPERGROUP_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
  },
}
