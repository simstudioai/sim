import type { RipplingDeleteCustomAppParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingDeleteCustomAppTool: ToolConfig<RipplingDeleteCustomAppParams> = {
  id: 'rippling_delete_custom_app',
  name: 'Rippling Delete CustomApp',
  description: 'Delete a custom app',
  version: '1.0.0',
  params: {
    apiKey: {
      type: 'string',
      required: true,
      visibility: 'user-only',
      description: 'Rippling API key',
    },
    id: {
      type: 'string',
      required: true,
      visibility: 'user-or-llm',
      description: 'ID of the resource to delete',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-apps/${encodeURIComponent(params.id.trim())}/`,
    method: 'DELETE',
    headers: (params) => ({ Authorization: `Bearer ${params.apiKey}`, Accept: 'application/json' }),
  },
  transformResponse: async (response: Response) => {
    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Rippling API error (${response.status}): ${errorText}`)
    }
    return { success: true, output: { deleted: true } }
  },
  outputs: {
    deleted: { type: 'boolean', description: 'Whether the resource was deleted' },
  },
}
