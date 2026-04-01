import type { RipplingUpdateCustomAppParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingUpdateCustomAppTool: ToolConfig<RipplingUpdateCustomAppParams> = {
  id: 'rippling_update_custom_app',
  name: 'Rippling Update CustomApp',
  description: 'Update a custom app',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: { type: 'string', required: true, visibility: 'user-or-llm', description: 'App ID' },
    name: { type: 'string', required: false, visibility: 'user-or-llm', description: 'App name' },
    apiName: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'API name',
    },
    description: {
      type: 'string',
      required: false,
      visibility: 'user-or-llm',
      description: 'Description',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-apps/${encodeURIComponent(params.id.trim())}/`,
    method: 'PATCH',
    headers: (params) => ({
      Authorization: `Bearer ${params.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    }),
    body: (params) => {
      const body: Record<string, unknown> = {}
      if (params.name != null) body.name = params.name
      if (params.apiName != null) body.api_name = params.apiName
      if (params.description != null) body.description = params.description
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
        api_name: (data.api_name as string) ?? null,
        description: (data.description as string) ?? null,
        icon: (data.icon as string) ?? null,
        pages: (data.pages as unknown[]) ?? [],
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
  },
}
