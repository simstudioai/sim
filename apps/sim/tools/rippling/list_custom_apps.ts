import type { RipplingListCustomAppsParams } from '@/tools/rippling/types'
import { CUSTOM_APP_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomAppsTool: ToolConfig<RipplingListCustomAppsParams> = {
  id: 'rippling_list_custom_apps',
  name: 'Rippling List CustomApps',
  description: 'List all custom apps',
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
    url: `https://rest.ripplingapis.com/custom-apps/`,
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
        customApps: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          api_name: (item.api_name as string) ?? null,
          description: (item.description as string) ?? null,
          icon: (item.icon as string) ?? null,
          pages: (item.pages as unknown[]) ?? [],
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    customApps: {
      type: 'array',
      description: 'List of customApps',
      items: { type: 'object', properties: CUSTOM_APP_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
