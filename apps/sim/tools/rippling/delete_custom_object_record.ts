import type { RipplingDeleteCustomObjectRecordParams } from '@/tools/rippling/types'
import type { ToolConfig } from '@/tools/types'

export const ripplingDeleteCustomObjectRecordTool: ToolConfig<RipplingDeleteCustomObjectRecordParams> =
  {
    id: 'rippling_delete_custom_object_record',
    name: 'Rippling Delete Custom Object Record',
    description: 'Delete a custom object record',
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
      codrId: {
        type: 'string',
        required: true,
        visibility: 'user-or-llm',
        description: 'Record ID',
      },
    },
    request: {
      url: (params) =>
        `https://rest.ripplingapis.com/custom-objects/${encodeURIComponent(params.customObjectApiName.trim())}/records/${encodeURIComponent(params.codrId.trim())}/`,
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
    outputs: { deleted: { type: 'boolean', description: 'Whether the record was deleted' } },
  }
