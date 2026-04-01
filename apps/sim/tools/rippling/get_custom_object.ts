import type { RipplingGetCustomObjectParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCustomObjectTool: ToolConfig<RipplingGetCustomObjectParams> = {
  id: 'rippling_get_custom_object',
  name: 'Rippling Get Custom Object',
  description: 'Get a custom object by API name',
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
      description: 'custom object api name',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/`,
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
        description: (data.description as string) ?? null,
        api_name: (data.api_name as string) ?? null,
        plural_label: (data.plural_label as string) ?? null,
        category_id: (data.category_id as string) ?? null,
        enable_history: (data.enable_history as boolean) ?? null,
        native_category_id: (data.native_category_id as string) ?? null,
        managed_package_install_id: (data.managed_package_install_id as string) ?? null,
        owner_id: (data.owner_id as string) ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    description: { type: 'string', description: 'Description', optional: true },
    api_name: { type: 'string', description: 'API name', optional: true },
    plural_label: { type: 'string', description: 'Plural label', optional: true },
    category_id: { type: 'string', description: 'Category ID', optional: true },
    enable_history: { type: 'boolean', description: 'History enabled', optional: true },
    native_category_id: { type: 'string', description: 'Native category ID', optional: true },
    managed_package_install_id: {
      type: 'string',
      description: 'Package install ID',
      optional: true,
    },
    owner_id: { type: 'string', description: 'Owner ID', optional: true },
  },
}
