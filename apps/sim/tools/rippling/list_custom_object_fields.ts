import type { RipplingListCustomObjectFieldsParams } from '@/tools/rippling/types'
import { CUSTOM_OBJECT_FIELD_OUTPUT_PROPERTIES } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingListCustomObjectFieldsTool: ToolConfig<RipplingListCustomObjectFieldsParams> =
  {
    id: 'rippling_list_custom_object_fields',
    name: 'Rippling List Custom Object Fields',
    description: 'List all fields for a custom object',
    version: '1.0.0',
    params: {
      apiKey: {
        type: 'string',
        required: true,
        visibility: 'user-only',
        description: 'Rippling API key',
      },
      customObjectApiName: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Custom object API name',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/fields/`,
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
          fields: results.map((item: Record<string, unknown>) => ({
            id: (item.id as string) ?? '',
            created_at: (item.created_at as string) ?? null,
            updated_at: (item.updated_at as string) ?? null,
            name: (item.name as string) ?? null,
            custom_object: (item.custom_object as string) ?? null,
            description: (item.description as string) ?? null,
            api_name: (item.api_name as string) ?? null,
            data_type: item.data_type ?? null,
            is_unique: (item.is_unique as boolean) ?? null,
            is_immutable: (item.is_immutable as boolean) ?? null,
            is_standard: (item.is_standard as boolean) ?? null,
            enable_history: (item.enable_history as boolean) ?? null,
            managed_package_install_id: (item.managed_package_install_id as string) ?? null,
          })),
          totalCount: results.length,
          nextLink: (data.next_link as string) ?? null,
        },
      }
    },
    outputs: {
      fields: {
        type: 'array',
        description: 'List of fields',
        items: { type: 'object', properties: CUSTOM_OBJECT_FIELD_OUTPUT_PROPERTIES },
      },
      totalCount: { type: 'number', description: 'Number of fields returned' },
      nextLink: { type: 'string', description: 'Next page link', optional: true },
    },
  }
