import type { RipplingGetCustomAppParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingGetCustomAppTool: ToolConfig<RipplingGetCustomAppParams> = {
  id: 'rippling_get_custom_app',
  name: 'Rippling Get CustomApp',
  description: 'Get a specific custom app',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'Resource ID' },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-apps/${encodeURIComponent(params.id.trim())}/`,
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
        api_name: (data.api_name as string) ?? null,
        description: (data.description as string) ?? null,
        icon: (data.icon as string) ?? null,
        pages: (data.pages as unknown[]) ?? [],
        __meta: data.__meta ?? null,
      },
    }
  },
  outputs: {
    id: { type: 'string', description: 'App ID' },
    created_at: { type: 'string', description: 'Creation date', optional: true },
    updated_at: { type: 'string', description: 'Update date', optional: true },
    name: { type: 'string', description: 'Name', optional: true },
    api_name: { type: 'string', description: 'API name', optional: true },
    description: { type: 'string', description: 'Description', optional: true },
    icon: { type: 'string', description: 'Icon URL', optional: true },
    pages: { type: 'json', description: 'Array of page summaries', optional: true },
    __meta: { type: 'json', description: 'Metadata including redacted_fields', optional: true },
  },
}
