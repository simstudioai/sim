import type { RipplingCreateCustomObjectParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingCreateCustomObjectTool: ToolConfig<RipplingCreateCustomObjectParams> = {
  id: 'rippling_create_custom_object',
  name: 'Rippling Create Custom Object',
  description: 'Create a new custom object',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    name: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Object name' },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description',
    },
    category: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Category',
    },
  },
  request: {
    url: `https://rest.ripplingapis.com/custom-objects/`,
    method: 'POST',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = { name: params.name }
      if (params.description != null) body.description = params.description
      if (params.category != null) body.category = params.category
      return body
    },
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
