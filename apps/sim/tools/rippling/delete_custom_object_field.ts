import type { RipplingDeleteCustomObjectFieldParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingDeleteCustomObjectFieldTool: ToolConfig<RipplingDeleteCustomObjectFieldParams> =
  {
    id: 'rippling_delete_custom_object_field',
    name: 'Rippling Delete Custom Object Field',
    description: 'Delete a field from a custom object',
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
      method: 'DELETE',
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
      return { success: true, output: { deleted: true } }
    },
    outputs: { deleted: { type: 'boolean', description: 'Whether the field was deleted' } },
  }
