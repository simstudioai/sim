import type { RipplingListCustomObjectsParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomObjectsTool: ToolConfig<RipplingListCustomObjectsParams> = {
  id: 'rippling_list_custom_objects',
  name: 'Rippling List Custom Objects',
  description: 'List all custom objects',
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
    url: `https://rest.ripplingapis.com/custom-objects/`,
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
    const results = data.results ?? []
    return {
      success: true,
      output: {
        customObjects: results.map((item: Record<string, unknown>) => ({
          id: (item.id as string) ?? '',
          created_at: (item.created_at as string) ?? null,
          updated_at: (item.updated_at as string) ?? null,
          name: (item.name as string) ?? null,
          description: (item.description as string) ?? null,
          api_name: (item.api_name as string) ?? null,
          plural_label: (item.plural_label as string) ?? null,
          category_id: (item.category_id as string) ?? null,
          enable_history: (item.enable_history as boolean) ?? null,
          native_category_id: (item.native_category_id as string) ?? null,
          managed_package_install_id: (item.managed_package_install_id as string) ?? null,
          owner_id: (item.owner_id as string) ?? null,
        })),
        totalCount: results.length,
        nextLink: (data.next_link as string) ?? null,
      },
    }
  },
  outputs: {
    customObjects: {
      type: 'array',
      description: 'List of customObjects',
      items: { type: 'object', properties: CUSTOM_OBJECT_OUTPUT_PROPERTIES },
    },
    totalCount: { type: 'number', description: 'Number of items returned' },
    nextLink: { type: 'string', description: 'Link to next page of results', optional: true },
  },
}
