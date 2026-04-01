import type { RipplingDeleteCustomObjectParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingDeleteCustomObjectTool: ToolConfig<RipplingDeleteCustomObjectParams> = {
  id: 'rippling_delete_custom_object',
  name: 'Rippling Delete Custom Object',
  description: 'Delete a custom object',
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
      description: 'ID of the resource to delete',
    },
  },
  request: {
    url: (params) =>
      `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/`,
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
