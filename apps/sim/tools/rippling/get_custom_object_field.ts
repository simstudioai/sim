import type { RipplingGetCustomObjectFieldParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCustomObjectFieldTool: ToolConfig<RipplingGetCustomObjectFieldParams> = {
  id: 'rippling_get_custom_object_field',
  name: 'Rippling Get Custom Object Field',
  description: 'Get a specific field of a custom object',
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
    fieldApiName: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'Field API name',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/fields/${encodeURIComponent(params.fieldApiName.trim())}/`,
    method: 'GET',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    const data = await response.json()
    return {
      success: true,
      output: {
        id: (data.id as string) ?? '',
        created_at: (data.created_at as string) ?? null,
        updated_at: (data.updated_at as string) ?? null,
        name: (data.name as string) ?? null,
        custom_object: (data.custom_object as string) ?? null,
        description: (data.description as string) ?? null,
        api_name: (data.api_name as string) ?? null,
        data_type: data.data_type ?? null,
        is_unique: (data.is_unique as boolean) ?? null,
        is_immutable: (data.is_immutable as boolean) ?? null,
        is_standard: (data.is_standard as boolean) ?? null,
        enable_history: (data.enable_history as boolean) ?? null,
        managed_package_install_id: (data.managed_package_install_id as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'Field ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    custom_object: { type: 'string', description: 'Custom object', optional: true },
    description: { type: 'string', description: 'Description', optional: true },
    api_name: { type: 'string', description: 'API name', optional: true },
    data_type: { type: 'json', description: 'Data type configuration', optional: true },
    is_unique: { type: 'boolean', description: 'Is unique', optional: true },
    is_immutable: { type: 'boolean', description: 'Is immutable', optional: true },
    is_standard: { type: 'boolean', description: 'Is standard', optional: true },
    enable_history: { type: 'boolean', description: 'History enabled', optional: true },
    managed_package_install_id: {
      type: 'string',
      description: 'Package install ID',
      optional: true,
    },
  },
}
