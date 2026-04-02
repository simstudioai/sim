import type { RipplingListCustomPagesParams } from '@/tools/rippling/types'
import { CUSTOM_PAGE_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomPagesTool: ToolConfig<RipplingListCustomPagesParams> = {
  id: 'rippling_list_custom_pages',
  name: 'Rippling List CustomPages',
  description: 'List all custom pages',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/custom-pages/`,
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
        customPages: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          components: item.components ?? [],
          actions: item.actions ?? [],
          canvas_actions: item.canvas_actions ?? [],
          variables: item.variables ?? [],
          media: item.media ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    customPages: {
      type: 'array',
      description: 'List of customPages',
      items: { type: 'object', properties: CUSTOM_PAGE_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
